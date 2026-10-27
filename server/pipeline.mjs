import { spawn } from 'node:child_process';
import path from 'node:path';
import readline from 'node:readline';

import {
  MODELS_DIR,
  ROOT,
  WORKER_DIR,
  loadSettings,
  saveSettings,
  resolveModel,
} from './config.mjs';
import {
  addLog,
  getAsr,
  getCopy,
  getTranscript,
  jobDir,
  mediaPath,
  readMeta,
  saveCopy,
  saveEnglish,
  saveTranscript,
  setStep,
  writeMeta,
} from './jobs.mjs';
import { chat, chatJson } from './llm.mjs';
import { applyGlossary, applyGlossaryToSegments, glossaryHint } from './glossary.mjs';
import {
  buildCopyMessages,
  buildReviseMessages,
  buildTranslateMessages,
} from './prompts.mjs';
import {
  computeStats,
  generateEnglishBeats,
  writeEnglishWorkingFiles,
} from './english.mjs';

const PYTHON = process.env.WB_PYTHON || 'python3';
const running = new Map();

export function isRunning(id) {
  return running.has(id);
}

export function cancelJob(id) {
  const state = running.get(id);
  if (!state) return false;
  state.cancelled = true;
  state.controller.abort();
  if (state.child) {
    state.child.kill('SIGTERM');
    setTimeout(() => {
      try {
        state.child?.kill('SIGKILL');
      } catch {
        /* ignore */
      }
    }, 3000);
  }
  return true;
}

function runPython(args, { timeoutMs = 60000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(PYTHON, args, { cwd: ROOT, env: { ...process.env, PYTHONUNBUFFERED: '1' } });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('分析视频超时。'));
    }, timeoutMs);
    child.stdout.on('data', (chunk) => (stdout += chunk.toString()));
    child.stderr.on('data', (chunk) => (stderr += chunk.toString()));
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr.trim().split('\n').slice(-3).join(' ') || `python exited ${code}`));
    });
  });
}

export async function probeFile(file) {
  const out = await runPython([path.join(WORKER_DIR, 'probe.py'), file], { timeoutMs: 30000 });
  const data = JSON.parse(out.trim().split('\n').pop());
  if (data.error) throw new Error(data.error);
  return data;
}

function cleanTranslation(value) {
  return String(value ?? '')
    .replace(/\r/g, '')
    .replace(/\s*\n+\s*/g, ' ')
    .replace(/^["'“”「」『』]+|["'“”「」『』]+$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function normalizeId(value) {
  if (value === undefined || value === null) return '';
  const str = String(value).trim();
  return str;
}

function chunkSegments(segments, maxChars, maxItems) {
  const chunks = [];
  let current = [];
  let chars = 0;
  for (const segment of segments) {
    const length = (segment.text || '').length + 24;
    if (current.length && (chars + length > maxChars || current.length >= maxItems)) {
      chunks.push(current);
      current = [];
      chars = 0;
    }
    current.push(segment);
    chars += length;
  }
  if (current.length) chunks.push(current);
  return chunks;
}

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await fn(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

function parseItems(payload) {
  const raw = Array.isArray(payload) ? payload : payload?.items || payload?.data || [];
  const map = new Map();
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const id = normalizeId(item.id ?? item.segmentId ?? item.key);
    const zh = item.zh ?? item.text ?? item.translation ?? item.chinese ?? item.value;
    if (id && zh) map.set(id, cleanTranslation(zh));
  }
  return map;
}

function parseBlocks(payload) {
  if (Array.isArray(payload)) return payload;
  return payload?.blocks || payload?.data || payload?.items || [];
}

function textSignature(segment) {
  return `${segment.start}|${segment.end}|${segment.text}`;
}

async function runAsr({ meta, state, save }) {
  const step = 'asr';
  if (!meta.source.hasAudio) throw new Error('这个视频没有音轨，无法转写。');
  const settings = loadSettings();
  const asrModel = settings.asr?.model || 'small';
  meta.models.asr = asrModel;
  setStep(meta, step, {
    state: 'running',
    pct: 0,
    message: '准备转写…',
    error: '',
    startedAt: new Date().toISOString(),
    finishedAt: null,
  });
  addLog(meta, `开始转写（Whisper ${asrModel}）`);
  save(true);

  const output = path.join(jobDir(meta.id), 'asr.json');
  const args = [
    '-u',
    path.join(WORKER_DIR, 'transcribe.py'),
    '--input',
    mediaPath(meta),
    '--output',
    output,
    '--model',
    asrModel,
    '--language',
    settings.asr?.language || 'en',
    '--beam-size',
    String(settings.asr?.beamSize || 5),
    '--model-dir',
    MODELS_DIR,
  ];
  if (settings.asr?.vad === false) args.push('--no-vad');

  const child = spawn(PYTHON, args, {
    cwd: ROOT,
    env: { ...process.env, PYTHONUNBUFFERED: '1' },
  });
  state.child = child;
  const closed = new Promise((resolve, reject) => {
    child.on('close', (code) => resolve(code));
    child.on('error', reject);
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
    if (stderr.length > 8000) stderr = stderr.slice(-8000);
  });

  const rl = readline.createInterface({ input: child.stdout });
  let donePayload = null;
  let asrInfo = null;

  for await (const line of rl) {
    if (state.cancelled) {
      child.kill('SIGTERM');
      break;
    }
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (event.type === 'info') {
      asrInfo = { ...(asrInfo || {}), ...event };
      if (event.duration) {
        meta.source.duration = Math.round(event.duration * 10) / 10;
      }
    } else if (event.type === 'phase') {
      setStep(meta, step, { message: event.message || '' });
      save();
    } else if (event.type === 'progress') {
      const pct = Math.max(1, Math.min(99, Number(event.pct) || 0));
      setStep(meta, step, {
        pct: Math.round(pct),
        message:
          event.phase === 'decode'
            ? `解码音频 ${Math.round(pct)}%`
            : `识别语音 ${Math.round(pct)}%${event.segments ? ` · 已识别 ${event.segments} 句` : ''}`,
      });
      save();
    } else if (event.type === 'done') {
      donePayload = event;
    } else if (event.type === 'error') {
      throw new Error(event.message || '转写失败');
    }
  }

  const exitCode = await closed;
  if (!state.cancelled && exitCode !== 0) {
    const tail = stderr.trim().split('\n').slice(-4).join('\n');
    throw new Error(`转写进程退出（${exitCode}）：${tail || '未知错误'}`);
  }

  if (state.cancelled) throw new Error('CANCELLED');
  const asr = getAsr(meta.id);
  if (!asr || !asr.segments?.length) throw new Error(donePayload?.error || '没有拿到转写结果。');

  const previous = getTranscript(meta.id);
  const reuse = new Map();
  for (const old of previous?.segments || []) {
    if (old.zh) reuse.set(textSignature(old), old.zh);
  }
  const segments = asr.segments.map((segment) => ({ ...segment, zh: '' }));
  applyGlossaryToSegments(segments, settings.glossary || '');
  for (const segment of segments) {
    segment.zh = reuse.get(textSignature(segment)) || '';
  }

  meta.source.duration = asr.duration || meta.source.duration;
  saveTranscript(meta.id, {
    language: asr.language || 'en',
    duration: asr.duration || meta.source.duration,
    model: asrModel,
    segments,
    updatedAt: new Date().toISOString(),
  });

  setStep(meta, step, {
    state: 'done',
    pct: 100,
    message: `识别完成：${segments.length} 句${donePayload?.elapsed_seconds ? `，用时 ${Math.round(donePayload.elapsed_seconds)} 秒` : ''}`,
    finishedAt: new Date().toISOString(),
  });
  addLog(meta, `转写完成，共 ${segments.length} 句`);
  save(true);
}

async function translateChunk(provider, model, { items, context, style, glossary, temperature, signal, jsonMode }) {
  const messages = buildTranslateMessages(items, { contextBefore: context, style, glossary });
  let result;
  try {
    result = await chatJson(provider, {
      model,
      messages,
      temperature,
      maxTokens: 8000,
      signal,
      jsonMode,
      retries: 2,
    });
  } catch (error) {
    throw new Error(`翻译请求失败：${error.message}`);
  }
  let payload;
  try {
    payload = JSON.parse(result.text.trim());
  } catch {
    const { extractJson } = await import('./llm.mjs');
    payload = extractJson(result.text);
  }
  const map = parseItems(payload);

  let missing = items.filter((item) => !map.get(item.id));
  if (missing.length) {
    const retryMessages = buildTranslateMessages(missing, { contextBefore: context, style, glossary });
    try {
      const retry = await chatJson(provider, {
        model,
        messages: retryMessages,
        temperature,
        maxTokens: 4000,
        signal,
        jsonMode,
        retries: 1,
      });
      const retryPayload = JSON.parse(retry.text.trim());
      for (const [id, text] of parseItems(retryPayload)) map.set(id, text);
      missing = items.filter((item) => !map.get(item.id));
    } catch {
      /* fall through */
    }
  }
  const coverage = 1 - missing.length / Math.max(1, items.length);
  if (coverage < 0.6) {
    throw new Error(`这一批翻译只返回了 ${Math.round(coverage * 100)}% 的内容，已停止以免出现大段空白。`);
  }
  return { map, usage: result.usage, missing: missing.map((m) => m.id), model: result.model };
}

async function runTranslate({ meta, state, save, overrides }) {
  const step = 'translate';
  const settings = loadSettings();
  const resolved = resolveModel(settings, 'translate', overrides);
  if (!resolved.provider || !resolved.provider.apiKey) {
    throw new Error(
      `还没有配置翻译模型的 API Key。请打开「设置」，给 ${resolved.provider?.name || '模型服务'} 填写 Key。`,
    );
  }
  const transcript = getTranscript(meta.id);
  if (!transcript.segments?.length) throw new Error('请先完成英文转写。');

  setStep(meta, step, {
    state: 'running',
    pct: 0,
    message: '准备翻译…',
    error: '',
    startedAt: new Date().toISOString(),
    finishedAt: null,
  });
  meta.models.translate = `${resolved.provider.name} · ${resolved.model}`;
  addLog(meta, `开始翻译：${resolved.provider.name} / ${resolved.model}`);
  if (resolved.fallback) addLog(meta, `未配置所选翻译模型 Key，暂用 ${resolved.provider.name} / ${resolved.model}`, 'warn');
  save(true);

  applyGlossaryToSegments(transcript.segments, settings.glossary || '');
  saveTranscript(meta.id, transcript);
  const style = settings.translateStyle || '';
  const glossary = glossaryHint(settings.glossary || '');
  const chunks = chunkSegments(transcript.segments, 3000, 40);
  const concurrency = Math.max(1, Math.min(6, Number(settings.llm?.concurrency) || 4));
  let completed = 0;

  const results = await mapLimit(chunks, concurrency, async (chunk, index) => {
    if (state.cancelled) throw new Error('CANCELLED');
    const first = transcript.segments.indexOf(chunk[0]);
    const context = transcript.segments.slice(Math.max(0, first - 2), first);
    const result = await translateChunk(resolved.provider, resolved.model, {
      items: chunk,
      context,
      style,
      glossary,
      temperature: resolved.temperature,
      signal: state.controller.signal,
      jsonMode: settings.llm?.jsonMode !== false,
    });
    completed += 1;
    setStep(meta, step, {
      pct: Math.round((completed / chunks.length) * 96),
      message: `翻译中 ${completed}/${chunks.length} 批 · 已完成 ${Math.min(completed * 40, transcript.segments.length)} 句`,
    });
    save();
    return { result, chunk };
  });

  const translation = new Map();
  let promptTokens = 0;
  let completionTokens = 0;
  let calls = 0;
  const missingIds = [];
  for (const { result, chunk } of results) {
    for (const [id, text] of result.map) translation.set(id, text);
    missingIds.push(...result.missing);
    promptTokens += result.usage?.prompt_tokens || 0;
    completionTokens += result.usage?.completion_tokens || 0;
    calls += 1;
  }

  let translated = 0;
  for (const segment of transcript.segments) {
    const zh = translation.get(segment.id);
    if (zh) {
      segment.zh = applyGlossary(zh, settings.glossary || '');
      translated += 1;
    }
  }
  transcript.updatedAt = new Date().toISOString();
  transcript.translateModel = `${resolved.provider.name} · ${resolved.model}`;
  saveTranscript(meta.id, transcript);

  meta.usage.calls += calls;
  meta.usage.promptTokens += promptTokens;
  meta.usage.completionTokens += completionTokens;
  setStep(meta, step, {
    state: 'done',
    pct: 100,
    message: `翻译完成：${translated}/${transcript.segments.length} 句${missingIds.length ? `，${missingIds.length} 句缺失` : ''}`,
    finishedAt: new Date().toISOString(),
  });
  addLog(meta, `翻译完成，${translated} 句${missingIds.length ? `，缺失 ${missingIds.length} 句` : ''}`);
  save(true);
  return { translated, missingIds };
}

function buildBlocksFromPayload(payload, segmentIndex) {
  const rawBlocks = parseBlocks(payload);
  const blocks = [];
  for (const raw of rawBlocks) {
    if (!raw || typeof raw !== 'object') continue;
    const startId = normalizeId(raw.startId ?? raw.start_id ?? raw.from ?? raw.firstId);
    const endId = normalizeId(raw.endId ?? raw.end_id ?? raw.to ?? raw.lastId);
    const startSeg = segmentIndex.get(startId);
    const endSeg = segmentIndex.get(endId) || startSeg;
    if (!startSeg || !endSeg) continue;
    const copy = String(raw.copy ?? raw.text ?? raw.content ?? raw.body ?? '').trim();
    if (!copy) continue;
    const chars = copy.replace(/\s/g, '').length;
    blocks.push({
      title: String(raw.title ?? raw.heading ?? '').trim().slice(0, 40) || '未命名段落',
      startId,
      endId,
      start: startSeg.start,
      end: Math.max(endSeg.end, startSeg.start + 1),
      copy,
      summary: String(raw.summary ?? raw.abstract ?? '').trim().slice(0, 200),
      screenText: String(raw.screenText ?? raw.screen_text ?? raw.onscreen ?? '').trim().slice(0, 30),
      chars,
      estSeconds: Math.round((chars / 4.2) * 10) / 10,
    });
  }
  blocks.sort((a, b) => a.start - b.start);
  for (let i = 0; i < blocks.length; i += 1) blocks[i].id = `b${i + 1}`;
  return blocks;
}

async function generateCopyPart({
  segments,
  partIndex,
  partCount,
  depth,
  meta,
  provider,
  model,
  temperature,
  brief,
  glossary,
  signal,
}) {
  const messages = buildCopyMessages(segments, {
    brief,
    partIndex,
    partCount,
    glossary: glossaryHint(glossary || ''),
  });
  let result;
  try {
    result = await chatJson(provider, {
      model,
      messages,
      temperature,
      maxTokens: 8000,
      signal,
      jsonMode: true,
      retries: 2,
    });
  } catch (error) {
    if (/JSON/i.test(error.message) && depth < 2 && segments.length > 1) {
      addLog(meta, `分段 JSON 不完整，拆分 ${segments.length} 句重試…`, 'warn');
      const mid = Math.ceil(segments.length / 2);
      const left = await generateCopyPart({ segments: segments.slice(0, mid), partIndex, partCount, depth: depth + 1, meta, provider, model, temperature, brief, glossary, signal });
      const right = await generateCopyPart({ segments: segments.slice(mid), partIndex, partCount, depth: depth + 1, meta, provider, model, temperature, brief, glossary, signal });
      return {
        blocks: [...left.blocks, ...right.blocks],
        promptTokens: left.promptTokens + right.promptTokens,
        completionTokens: left.completionTokens + right.completionTokens,
        calls: left.calls + right.calls,
      };
    }
    throw error;
  }
  let payload;
  try {
    payload = JSON.parse(result.text.trim());
  } catch {
    const { extractJson } = await import('./llm.mjs');
    try {
      payload = extractJson(result.text);
    } catch (error) {
      if (depth < 2 && segments.length > 1) {
        addLog(meta, `分段 JSON 不完整，拆分 ${segments.length} 句重試…`, 'warn');
        const mid = Math.ceil(segments.length / 2);
        const left = await generateCopyPart({ segments: segments.slice(0, mid), partIndex, partCount, depth: depth + 1, meta, provider, model, temperature, brief, glossary, signal });
        const right = await generateCopyPart({ segments: segments.slice(mid), partIndex, partCount, depth: depth + 1, meta, provider, model, temperature, brief, glossary, signal });
        return {
          blocks: [...left.blocks, ...right.blocks],
          promptTokens: left.promptTokens + (result.usage?.prompt_tokens || 0) + right.promptTokens,
          completionTokens: left.completionTokens + (result.usage?.completion_tokens || 0) + right.completionTokens,
          calls: left.calls + 1 + right.calls,
        };
      }
      throw error;
    }
  }
  const segmentIndex = new Map(segments.map((segment) => [segment.id, segment]));
  const blocks = buildBlocksFromPayload(payload, segmentIndex);
  return {
    blocks,
    promptTokens: result.usage?.prompt_tokens || 0,
    completionTokens: result.usage?.completion_tokens || 0,
    calls: 1,
  };
}

async function runCopy({ meta, state, save, overrides }) {
  const step = 'copy';
  const settings = loadSettings();
  const resolved = resolveModel(settings, 'copy', overrides);
  if (!resolved.provider || !resolved.provider.apiKey) {
    throw new Error(
      `还没有配置文案模型的 API Key。请打开「设置」，给 ${resolved.provider?.name || '模型服务'} 填写 Key。`,
    );
  }
  const transcript = getTranscript(meta.id);
  if (!transcript.segments?.length) throw new Error('请先完成转写。');
  const zhCount = transcript.segments.filter((s) => s.zh).length;
  if (zhCount < transcript.segments.length * 0.5) {
    throw new Error('中文翻译还不完整，请先完成翻译再分段。');
  }

  setStep(meta, step, {
    state: 'running',
    pct: 0,
    message: '准备整理文案…',
    error: '',
    startedAt: new Date().toISOString(),
    finishedAt: null,
  });
  meta.models.copy = `${resolved.provider.name} · ${resolved.model}`;
  addLog(meta, `开始整理分段文案：${resolved.provider.name} / ${resolved.model}`);
  if (resolved.fallback) addLog(meta, `未配置所选文案模型 Key，暂用 ${resolved.provider.name} / ${resolved.model}`, 'warn');
  save(true);

  const parts = chunkSegments(transcript.segments, 5500, 80);
  const segmentIndex = new Map(transcript.segments.map((s) => [s.id, s]));
  const allBlocks = [];
  let promptTokens = 0;
  let completionTokens = 0;
  let calls = 0;
  const brief = settings.copyBrief || '';

  for (let index = 0; index < parts.length; index += 1) {
    if (state.cancelled) throw new Error('CANCELLED');
    setStep(meta, step, {
      pct: Math.round((index / parts.length) * 95),
      message: `整理文案 ${index + 1}/${parts.length} 段…`,
    });
    save();
    const result = await generateCopyPart({
      segments: parts[index],
      partIndex: index,
      partCount: parts.length,
      depth: 0,
      meta,
      provider: resolved.provider,
      model: resolved.model,
      temperature: resolved.temperature,
      brief,
      glossary: settings.glossary || '',
      signal: state.controller.signal,
    });
    promptTokens += result.promptTokens;
    completionTokens += result.completionTokens;
    calls += result.calls;
    const blocks = result.blocks;
    if (!blocks.length) throw new Error('文案模型没有返回有效的分段（startId/endId 对不上字幕）。');
    for (const block of blocks) {
      block.title = applyGlossary(block.title, settings.glossary || '');
      block.copy = applyGlossary(block.copy, settings.glossary || '');
      block.summary = applyGlossary(block.summary, settings.glossary || '');
      block.screenText = applyGlossary(block.screenText, settings.glossary || '');
    }
    allBlocks.push(...blocks);
  }

  allBlocks.sort((a, b) => a.start - b.start);
  allBlocks.forEach((block, index) => (block.id = `b${index + 1}`));

  saveCopy(meta.id, {
    blocks: allBlocks,
    model: `${resolved.provider.name} · ${resolved.model}`,
    brief,
    generatedAt: new Date().toISOString(),
  });
  meta.usage.calls += calls;
  meta.usage.promptTokens += promptTokens;
  meta.usage.completionTokens += completionTokens;

  const totalChars = allBlocks.reduce((sum, b) => sum + b.chars, 0);
  setStep(meta, step, {
    state: 'done',
    pct: 100,
    message: `分段完成：${allBlocks.length} 段 · ${totalChars} 字`,
    finishedAt: new Date().toISOString(),
  });
  addLog(meta, `文案分段完成，${allBlocks.length} 段`);
  save(true);
  return { blocks: allBlocks.length };
}

async function runEnglish({ meta, state, save, overrides }) {
  const step = 'english';
  const settings = loadSettings();
  const resolved = resolveModel(settings, 'english', overrides);
  if (!resolved.provider || !resolved.provider.apiKey) {
    throw new Error(
      `还没有配置英文分镜模型的 API Key。请打开「设置」，给 ${resolved.provider?.name || '模型服务'} 填写 Key。`,
    );
  }
  const copy = getCopy(meta.id);
  if (!copy.blocks?.length) throw new Error('请先生成中文分段文案。');

  setStep(meta, step, {
    state: 'running',
    pct: 0,
    message: '准备生成英文 YouTube 分镜…',
    error: '',
    startedAt: new Date().toISOString(),
    finishedAt: null,
  });
  meta.models.english = `${resolved.provider.name} · ${resolved.model}`;
  addLog(meta, `开始英文 YouTube 分镜：${resolved.provider.name} / ${resolved.model}`);
  if (resolved.fallback) addLog(meta, `未配置所选分镜模型 Key，暂用 ${resolved.provider.name} / ${resolved.model}`, 'warn');
  save(true);

  const generated = await generateEnglishBeats({
    settings,
    meta,
    blocks: copy.blocks,
    provider: resolved.provider,
    model: resolved.model,
    temperature: resolved.temperature,
    signal: state.controller.signal,
    onProgress: (done, total) => {
      setStep(meta, step, {
        pct: total ? Math.round((done / total) * 96) : 0,
        message: `生成分镜 ${Math.min(done + 1, total)}/${total} 批…`,
      });
      save();
    },
  });

  if (state.cancelled) throw new Error('CANCELLED');
  if (!generated.beats.length) throw new Error('没有生成任何英文分镜。');

  const stats = generated.stats || computeStats(generated.beats);
  saveEnglish(meta.id, {
    beats: generated.beats,
    stats,
    model: `${resolved.provider.name} · ${resolved.model}`,
    mode: settings.english?.mode || 'oncamera',
    brief: settings.english?.brief || '',
    generatedAt: new Date().toISOString(),
    parts: generated.parts,
    repairCalls: generated.repairCalls,
  });
  writeEnglishWorkingFiles(meta, copy.blocks, generated.beats);

  meta.usage.calls += generated.usage.calls;
  meta.usage.promptTokens += generated.usage.promptTokens;
  meta.usage.completionTokens += generated.usage.completionTokens;

  setStep(meta, step, {
    state: 'done',
    pct: 100,
    message: `完成：${stats.beats} 拍 · 人物 ${stats.labels.人物口播} / B字卡 ${stats.labels.B字卡} / 實操 ${stats.labels.實操}`,
    finishedAt: new Date().toISOString(),
  });
  addLog(
    meta,
    `英文分镜完成：${stats.beats} 拍，${stats.words} words，约 ${stats.estSeconds} 秒`,
  );
  save(true);
  return { stats };
}

export async function runJob(id, steps = ['asr'], overrides = {}) {
  if (running.has(id)) throw new Error('这个任务正在处理中。');
  const meta = readMeta(id);
  const controller = new AbortController();
  const state = { controller, cancelled: false, child: null };
  running.set(id, state);

  const order = ['asr', 'translate', 'copy', 'english'];
  const selected = order.filter((step) => steps.includes(step));
  if (selected.includes('copy')) {
    try {
      clearEnglish(meta.id);
    } catch {
      /* ignore */
    }
    meta.steps.english = {
      state: 'idle',
      pct: 0,
      message: '文案已更新，等待重新生成',
      error: '',
      startedAt: null,
      finishedAt: null,
    };
  }
  for (const step of selected) {
    meta.steps[step] = {
      state: 'idle',
      pct: 0,
      message: '',
      error: '',
      startedAt: null,
      finishedAt: null,
    };
  }
  meta.lastError = '';
  writeMeta(meta);

  let lastWrite = 0;
  const save = (force = false) => {
    const now = Date.now();
    if (force || now - lastWrite > 700) {
      lastWrite = now;
      try {
        writeMeta(meta);
      } catch {
        /* ignore transient write errors */
      }
    }
  };

  let currentStep = null;
  try {
    for (const step of selected) {
      if (state.cancelled) throw new Error('CANCELLED');
      currentStep = step;
      if (step === 'asr') await runAsr({ meta, state, save });
      if (step === 'translate') {
        if (!selected.includes('asr')) {
          const transcript = getTranscript(id);
          if (!transcript.segments?.length) throw new Error('请先完成英文转写。');
        }
        await runTranslate({ meta, state, save, overrides });
      }
      if (step === 'copy') await runCopy({ meta, state, save, overrides });
      if (step === 'english') await runEnglish({ meta, state, save, overrides });
    }
    addLog(meta, '全部完成');
    meta.lastError = '';
  } catch (error) {
    try {
      state.child?.kill('SIGTERM');
    } catch {
      /* ignore */
    }
    const cancelled = state.cancelled || /CANCELLED/.test(error.message);
    const message = cancelled ? '已取消' : error.message || '处理失败';
    const activeStep = selected.find((step) => meta.steps[step]?.state === 'running') || currentStep;
    if (activeStep) {
      setStep(meta, activeStep, {
        state: cancelled ? 'idle' : 'error',
        error: cancelled ? '' : message,
        message,
        finishedAt: new Date().toISOString(),
      });
    }
    if (!cancelled) {
      meta.lastError = message;
      addLog(meta, message, 'error');
    } else {
      addLog(meta, '任务已取消', 'warn');
    }
  } finally {
    running.delete(id);
    state.child = null;
    try {
      writeMeta(meta);
    } catch {
      /* ignore */
    }
  }
}

export async function reviseText({ text, instruction, providerId, model }) {
  const settings = loadSettings();
  const resolved = resolveModel(settings, 'revise', { providerId, model });
  if (!resolved.provider?.apiKey) {
    throw new Error(`请先在「设置」里填写 ${resolved.provider?.name || '模型服务'} 的 API Key。`);
  }
  const messages = buildReviseMessages(text, instruction);
  const result = await chat(resolved.provider, {
    model: resolved.model,
    messages,
    temperature: resolved.temperature,
    maxTokens: 4000,
    retries: 2,
  });
  return { text: result.text.trim(), usage: result.usage, model: `${resolved.provider.name} · ${resolved.model}` };
}

export function updateSettings(patch) {
  const settings = loadSettings();
  const next = { ...settings, ...patch };
  saveSettings(next);
  return next;
}
