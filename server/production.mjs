/**
 * Production stage: turn English VO beats into per-beat assets, then assemble
 * a draft 16:9 video locally (cards + TTS + optional subtitles).
 *
 * Claude produces a VideoSpec. B字卡 cards are rendered locally with FFmpeg.
 * 人物口播 can be generated with Google Veo when configured, or uploaded.
 * 實操 gets a screen-recording script and waits for an uploaded recording.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { jobDir } from './jobs.mjs';
import { chatJson } from './llm.mjs';
import {
  normalizeSpec,
  probeMedia,
  renderCard,
  renderFinal,
  renderSegment,
  synthesizeTts,
  ttsCachePath,
} from './video.mjs';
import { generateOmni, generateVeo } from './veo.mjs';

const running = new Map();
const progress = new Map();

export function isProductionRunning(id) {
  return running.has(id);
}

export function productionDir(id) {
  const dir = path.join(jobDir(id), 'production');
  fs.mkdirSync(path.join(dir, 'assets'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'segments'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'tts'), { recursive: true });
  return dir;
}

export function getProduction(id) {
  const file = path.join(jobDir(id), 'production.json');
  if (!fs.existsSync(file)) return { beats: {}, final: null, updatedAt: null };
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return { beats: {}, final: null, updatedAt: null };
  }
}

export function saveProduction(id, production) {
  const dir = jobDir(id);
  production.updatedAt = new Date().toISOString();
  fs.writeFileSync(path.join(dir, 'production.json'), JSON.stringify(production, null, 1), 'utf8');
  return production;
}

export function routeForType(type) {
  if (type === '人物口播') return 'veo';
  if (type === '實操') return 'screen';
  return 'card';
}

export function ensureProduction(meta, english) {
  const production = getProduction(meta.id);
  production.beats = production.beats || {};
  const valid = new Set();
  for (const beat of english.beats || []) {
    valid.add(beat.id);
    const existing = production.beats[beat.id];
    const route = routeForType(beat.type);
    const voHash = crypto.createHash('sha1').update(beat.vo || '').digest('hex').slice(0, 10);
    if (!existing) {
      production.beats[beat.id] = {
        id: beat.id,
        route,
        status: 'todo',
        voHash,
        spec: null,
        prompt: '',
        videoPrompt: '',
        refs: {},
        asset: null,
        error: '',
        notes: '',
        updatedAt: new Date().toISOString(),
      };
    } else {
      if (existing.voHash && existing.voHash !== voHash) {
        existing.status = 'todo';
        existing.spec = null;
        existing.error = '';
        existing.asset = null;
        existing.segment = null;
        existing.voHash = voHash;
      }
      existing.route = route;
      existing.refs = existing.refs || {};
    }
  }
  for (const id of Object.keys(production.beats)) {
    if (!valid.has(id)) delete production.beats[id];
  }
  return production;
}

export function assetPathFor(id, beatId, ext = 'mp4') {
  return path.join(productionDir(id), 'assets', `${beatId}.${ext}`);
}

export function getAssetFile(meta, production, beatId) {
  const entry = production.beats?.[beatId];
  if (!entry?.asset) return null;
  const file = path.join(productionDir(meta.id), entry.asset);
  return fs.existsSync(file) ? file : null;
}

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp']);

function imageMime(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  return 'image/jpeg';
}

export function referenceDir(id) {
  const dir = path.join(productionDir(id), 'refs');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function saveReference(meta, production, beatId, kind, tempPath, originalName = '') {
  if (!['character', 'scene', 'face'].includes(kind)) {
    throw Object.assign(new Error('参考图类型无效。'), { status: 400 });
  }
  const entry = production.beats?.[beatId];
  if (!entry) throw Object.assign(new Error('找不到这一拍。'), { status: 404 });
  const ext = path.extname(originalName || tempPath).toLowerCase();
  if (!IMAGE_EXT.has(ext)) {
    throw Object.assign(new Error('参考图只支持 PNG / JPG / WEBP。'), { status: 400 });
  }
  const dir = referenceDir(meta.id);
  const target = path.join(dir, `${beatId}-${kind}${ext}`);
  const previous = entry.refs?.[kind];
  fs.copyFileSync(tempPath, target);
  fs.rmSync(tempPath, { force: true });
  if (previous) {
    const oldFile = path.join(productionDir(meta.id), previous);
    if (oldFile !== target) fs.rmSync(oldFile, { force: true });
  }
  entry.refs = entry.refs || {};
  entry.refs[kind] = path.relative(productionDir(meta.id), target);
  entry.updatedAt = new Date().toISOString();
  saveProduction(meta.id, production);
  return entry;
}

export function deleteReference(meta, production, beatId, kind) {
  const entry = production.beats?.[beatId];
  if (!entry) throw Object.assign(new Error('找不到这一拍。'), { status: 404 });
  const previous = entry.refs?.[kind];
  if (previous) {
    fs.rmSync(path.join(productionDir(meta.id), previous), { force: true });
    delete entry.refs[kind];
  }
  entry.updatedAt = new Date().toISOString();
  saveProduction(meta.id, production);
  return entry;
}

export function saveVideoPrompt(meta, production, beatId, videoPrompt = '') {
  const entry = production.beats?.[beatId];
  if (!entry) throw Object.assign(new Error('找不到这一拍。'), { status: 404 });
  const text = String(videoPrompt || '').trim().slice(0, 4000);
  entry.videoPrompt = text;
  entry.spec = { ...(entry.spec || {}), videoPrompt: text };
  entry.status = text ? 'prompt' : entry.asset ? 'ready' : 'todo';
  entry.error = '';
  entry.updatedAt = new Date().toISOString();
  if (production.final) production.finalDirty = true;
  saveProduction(meta.id, production);
  return entry;
}

export function getReferenceFile(meta, production, beatId, kind) {
  const previous = production.beats?.[beatId]?.refs?.[kind];
  if (!previous) return null;
  const file = path.join(productionDir(meta.id), previous);
  return fs.existsSync(file) ? file : null;
}

function loadReferenceImages(meta, production, beatId) {
  const entry = production.beats?.[beatId];
  const result = [];
  for (const kind of ['character', 'scene', 'face']) {
    const file = getReferenceFile(meta, production, beatId, kind);
    if (!file) continue;
    result.push({ kind, buffer: fs.readFileSync(file), mimeType: imageMime(file) });
  }
  return result;
}

function referencePrompt(entry) {
  const notes = [];
  if (entry.refs?.character) {
    notes.push('Use the uploaded character three-view sheet as the identity reference: same face, hair, body type, and outfit in every shot.');
  }
  if (entry.refs?.scene) {
    notes.push('Use the uploaded scene image as the environment reference: same room, furniture, lighting, and camera side.');
  }
  if (entry.refs?.face) {
    notes.push('Use the uploaded close-up as an additional facial identity reference.');
  }
  return notes.join(' ');
}

function buildSpecMessages(meta, beat, settings) {
  const kind =
    beat.type === '人物口播' ? 'talking_head' : beat.type === '實操' ? 'screen' : 'card';
  const system = `你是资深 YouTube 教学视频的视觉制作设计。把一拍的英文 VO 与画面提示，变成可执行的制作方案。
只输出 JSON，不要 Markdown，不要解释。字段固定：
{
  "kind": "card" | "broll" | "talking_head" | "screen",
  "title": "英文画面主标题",
  "subtitle": "英文副标题，可空",
  "bullets": ["英文要点，最多 4 条，每条不超过 8 个单词"],
  "layout": "title" | "list" | "quote",
  "theme": "dark" | "light",
  "accent": "#RRGGBB",
  "motion": "fade" | "slide",
  "duration": 5,
  "videoPrompt": "给 Veo 的文生视频提示词，英文，仅人物口播/实拍 B-roll 使用",
  "negativePrompt": "英文负面提示，可空",
  "brollPrompt": "英文 B-roll 生成提示，可空",
  "screenSteps": ["英文/中英混合的录屏步骤，最多 7 条"]
}
规则：
- 只使用输入里的事实，不新增产品、功能、数据或结论。
- 画面文字必须是英文，适合英文 YouTube 观众；简短、可读，不要长句。
- B字卡：kind=card，title 不超过 7 个单词，bullets 不超过 4 条；设计要像课程章节卡，不要广告。
- B字卡 subtitle 必须补充新信息，禁止逐字重复 title 或 VO；bullets 不可与 subtitle 重复；VO 里有两个动作就拆成两条 bullet。
- visual 提到图标／箭头时，用 bullets 表达对应关系；不要把「两个图标」写进画面文字。
- 人物口播：kind=talking_head，videoPrompt 描述 16:9 中景、主持人看镜头自然讲话、干净背景、自然手势、6–8 秒；不要屏幕文字。
- 實操：kind=screen，screenSteps 是可执行的点击/输入步骤；不要编造界面里没有的按钮。
- B-roll：kind=broll，brollPrompt 描述镜头、光线、动作与氛围，不写文字。
- duration 建议 4–8 秒，必须接近这一拍的预估时长。
课程标题：${meta.title}
本拍类型：${beat.type}；预估 ${beat.estSeconds || 4} 秒。`;
  const user = JSON.stringify(
    {
      type: beat.type,
      vo: beat.vo,
      visual: beat.visual,
      sourceBlock: beat.sourceBlock,
      words: beat.words,
      estSeconds: beat.estSeconds,
      style: settings.english?.brief || '',
    },
    null,
    0,
  );
  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

function defaultSpec(beat) {
  return normalizeSpec(
    {
      kind: beat.type === '人物口播' ? 'talking_head' : beat.type === '實操' ? 'screen' : 'card',
      title: String(beat.vo || '').split(/[.!?]/)[0].slice(0, 70),
      subtitle: String(beat.visual || '').slice(0, 90),
      bullets: beat.type === '實操' ? [] : [],
      duration: beat.estSeconds || 4,
      videoPrompt: '',
      brollPrompt: '',
      screenSteps: [],
    },
    beat,
  );
}

async function createSpec({ meta, beat, settings, provider, model, signal }) {
  try {
    const result = await chatJson(provider, {
      model,
      messages: buildSpecMessages(meta, beat, settings),
      temperature: 0.5,
      maxTokens: 2500,
      signal,
      jsonMode: settings.llm?.jsonMode !== false,
      retries: 2,
    });
    let payload;
    try {
      payload = JSON.parse(result.text.trim());
    } catch {
      const { extractJson } = await import('./llm.mjs');
      payload = extractJson(result.text);
    }
    const spec = normalizeSpec(payload, beat);
    return { spec, usage: result.usage };
  } catch (error) {
    if (signal?.aborted) throw error;
    return { spec: defaultSpec(beat), usage: null, warning: error.message };
  }
}

function cardPrompt(spec = {}, beat = {}) {
  const lines = [
    'Create a flat 16:9 1920×1080 course card (no logos, no faces, no invented facts).',
    `Title: ${spec.title || beat.vo || ''}`,
  ];
  if (spec.subtitle) lines.push(`Subtitle: ${spec.subtitle}`);
  if (Array.isArray(spec.bullets) && spec.bullets.length) {
    lines.push('Bullets:');
    spec.bullets.forEach((bullet) => lines.push(`- ${bullet}`));
  }
  if (spec.layout) lines.push(`Layout: ${spec.layout}`);
  if (spec.theme) lines.push(`Theme: ${spec.theme}`);
  if (spec.accent) lines.push(`Accent: ${spec.accent}`);
  if (spec.motion) lines.push(`Motion: ${spec.motion}`);
  if (spec.brollPrompt) lines.push(`Visual direction: ${spec.brollPrompt}`);
  lines.push('Text must be English, short, readable, no paragraph copy.');
  return lines.join('\n');
}

function entryPrompt(entry, beat = {}) {
  const spec = entry.spec || {};
  if (entry.route === 'veo') return spec.videoPrompt || spec.brollPrompt || '';
  if (entry.route === 'screen') return (spec.screenSteps || []).map((step, i) => `${i + 1}. ${step}`).join('\n');
  return spec.brollPrompt || cardPrompt(spec, beat);
}

/**
 * Generate specs (and B字卡 videos / Veo clips) for selected beats.
 */
export async function generateProduction({
  meta,
  english,
  beatIds,
  settings,
  provider,
  model,
  mode = 'auto',
  signal,
  onProgress,
}) {
  const dir = productionDir(meta.id);
  const production = ensureProduction(meta, english);
  production.error = '';
  production.failedAt = '';
  if (production.final) production.finalDirty = true;
  const beats = (english.beats || []).filter((beat) => beatIds.includes(beat.id));
  let promptTokens = 0;
  let completionTokens = 0;
  let calls = 0;
  let done = 0;

  const promptOnly = mode === 'prompt';
  const videoOnly = mode === 'video';
  for (const beat of beats) {
    if (signal?.aborted) throw new Error('CANCELLED');
    const entry = production.beats[beat.id] || {
      id: beat.id,
      route: routeForType(beat.type),
      status: 'todo',
    };
    production.beats[beat.id] = entry;
    entry.status = 'generating';
    entry.error = '';
    entry.updatedAt = new Date().toISOString();
    saveProduction(meta.id, production);
    onProgress?.(done, beats.length, `正在制作第 ${done + 1}/${beats.length} 拍…`);

    try {
      let spec;
      let usage = null;
      let warning = '';
      if (videoOnly && beat.type === '人物口播' && (entry.videoPrompt || entry.spec?.videoPrompt)) {
        spec = entry.spec || { videoPrompt: entry.videoPrompt };
        if (!spec.videoPrompt) spec.videoPrompt = entry.videoPrompt;
      } else {
        const result = await createSpec({ meta, beat, settings, provider, model, signal });
        spec = result.spec;
        usage = result.usage;
        warning = result.warning;
      }
      entry.spec = spec;
      entry.prompt = entryPrompt({ ...entry, spec }, beat);
      if (usage) {
        promptTokens += usage.prompt_tokens || 0;
        completionTokens += usage.completion_tokens || 0;
        calls += 1;
      }
      if (warning) entry.warning = warning;

      if (beat.type === 'B字卡') {
        entry.spec = spec;
        entry.prompt = cardPrompt(spec, beat);
        if (promptOnly) {
          entry.status = 'prompt';
        } else {
          const tts = await synthesizeTts(beat.vo, ttsCachePath(dir, beat), {
            voice: settings.voice?.name || 'Samantha',
            rate: settings.voice?.rate || 165,
          });
          spec.duration = Math.max(spec.duration, Math.ceil(tts + 0.6));
          entry.spec = spec;
          const asset = assetPathFor(meta.id, beat.id, 'mp4');
          await renderCard(spec, asset, { beat });
          entry.asset = path.relative(dir, asset);
          entry.status = 'ready';
        }
      } else if (beat.type === '人物口播') {
        entry.videoPrompt = spec.videoPrompt || entry.videoPrompt || '';
        const referenceImages = loadReferenceImages(meta, production, beat.id);
        const videoPrompt = [spec.videoPrompt, referencePrompt(entry)].filter(Boolean).join(' ');
        if (!promptOnly && settings.video?.apiKey && spec.videoPrompt && referenceImages.length) {
          const videoModel = settings.video.model || 'gemini-omni-1.1-flash';
          const useOmni =
            settings.video.provider === 'google-omni' || /^gemini-omni/i.test(videoModel);
          const result = useOmni
            ? await generateOmni({
                apiKey: settings.video.apiKey,
                model: videoModel,
                baseUrl: settings.video.baseUrl,
                prompt: videoPrompt,
                negativePrompt: spec.negativePrompt,
                aspectRatio: settings.video.aspectRatio || '16:9',
                resolution: settings.video.resolution || '1080p',
                referenceImages,
                signal,
                onProgress: (event) => {
                  entry.realtimeMessage = event.message;
                  saveProduction(meta.id, production);
                },
              })
            : await generateVeo({
                apiKey: settings.video.apiKey,
                model: videoModel,
                baseUrl: settings.video.baseUrl,
                prompt: videoPrompt,
                negativePrompt: spec.negativePrompt,
                aspectRatio: settings.video.aspectRatio || '16:9',
                resolution: settings.video.resolution || '1080p',
                durationSeconds: 8,
                referenceImages,
                signal,
                onProgress: (event) => {
                  entry.realtimeMessage = event.message;
                  saveProduction(meta.id, production);
                },
              });
          const asset = assetPathFor(meta.id, beat.id, 'mp4');
          fs.writeFileSync(asset, result.buffer);
          entry.asset = path.relative(dir, asset);
          entry.status = 'ready';
        } else {
          entry.status = 'prompt';
        }
      } else if (beat.type === '實操') {
        entry.status = 'script';
      } else {
        entry.status = 'prompt';
      }
      entry.updatedAt = new Date().toISOString();
    } catch (error) {
      if (signal?.aborted) throw error;
      entry.status = 'error';
      entry.error = error.message;
      entry.updatedAt = new Date().toISOString();
    }
    done += 1;
    saveProduction(meta.id, production);
    onProgress?.(done, beats.length, `已完成 ${done}/${beats.length}`);
  }

  return {
    production,
    usage: { promptTokens, completionTokens, calls },
  };
}

/** Render the final 16:9 draft; missing assets become cards. */
export async function renderProduction({
  meta,
  english,
  settings,
  subtitles = true,
  signal,
  onProgress,
}) {
  const dir = productionDir(meta.id);
  const production = ensureProduction(meta, english);
  production.error = '';
  production.failedAt = '';
  const segments = [];
  let done = 0;
  const total = (english.beats || []).length;

  for (const beat of english.beats || []) {
    if (signal?.aborted) throw new Error('CANCELLED');
    const entry = production.beats[beat.id] || {};
    entry.status = entry.asset ? 'ready' : entry.status || 'todo';
    const assetFile = getAssetFile(meta, production, beat.id);
    const spec = entry.spec ? normalizeSpec(entry.spec, beat) : defaultSpec(beat);
    if (!spec.title && !spec.subtitle && !spec.bullets.length) {
      spec.title = `Beat ${beat.id}`;
    }
    const out = path.join(dir, 'segments', `${beat.id}.mp4`);
    const tts = ttsCachePath(dir, beat);
    onProgress?.(Math.round((done / Math.max(1, total)) * 85), `正在合成第 ${done + 1}/${total} 拍…`);
    const result = await renderSegment({
      beat,
      spec,
      assetPath: assetFile || undefined,
      ttsPath: tts,
      outPath: out,
      onProgress: () => {},
    });
    segments.push({ file: out, duration: result.duration, text: beat.vo, beatId: beat.id });
    done += 1;
    entry.segment = path.relative(dir, out);
    entry.segmentDuration = result.duration;
    entry.updatedAt = new Date().toISOString();
    saveProduction(meta.id, production);
  }

  const final = await renderFinal({
    productionDir: dir,
    segments,
    subtitles,
    onProgress: (pct) => onProgress?.(85 + Math.round(pct * 0.15), '正在拼接成片…'),
  });
  production.finalDirty = false;
  production.final = {
    file: path.relative(dir, final.file),
    duration: final.duration,
    width: final.width,
    height: final.height,
    subtitles: Boolean(subtitles),
    generatedAt: new Date().toISOString(),
  };
  saveProduction(meta.id, production);
  return { production, final };
}

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} 超时`)), ms)),
  ]);
}

export async function startGenerate(meta, english, beatIds, settings, provider, model, onDone, onError, mode = 'auto') {
  if (running.has(meta.id)) throw new Error('这个项目正在处理中。');
  const controller = new AbortController();
  running.set(meta.id, { controller, kind: 'generate' });
  progress.set(meta.id, { pct: 0, message: '准备制作素材…' });
  generateProduction({
    meta,
    english,
    beatIds,
    settings,
    provider,
    model,
    mode,
    signal: controller.signal,
    onProgress: (done, total, message) => {
      progress.set(meta.id, {
        pct: total ? Math.round((done / total) * 100) : 0,
        message: message || `制作中 ${done}/${total}`,
      });
    },
  })
    .then(onDone)
    .catch((error) => {
      try {
        const production = getProduction(meta.id);
        production.error = error.message;
        production.failedAt = new Date().toISOString();
        saveProduction(meta.id, production);
      } catch {
        /* ignore */
      }
      onError?.(error);
    })
    .finally(() => {
      running.delete(meta.id);
      setTimeout(() => progress.delete(meta.id), 8000);
    });
  return controller;
}

export async function startRender(meta, english, settings, subtitles, onDone, onError) {
  if (running.has(meta.id)) throw new Error('这个项目正在处理中。');
  const controller = new AbortController();
  running.set(meta.id, { controller, kind: 'render' });
  progress.set(meta.id, { pct: 0, message: '准备剪辑…' });
  renderProduction({
    meta,
    english,
    settings,
    subtitles,
    signal: controller.signal,
    onProgress: (pct, message) => {
      progress.set(meta.id, { pct: Number(pct) || 0, message: message || '剪辑中…' });
    },
  })
    .then(onDone)
    .catch((error) => {
      try {
        const production = getProduction(meta.id);
        production.error = error.message;
        production.failedAt = new Date().toISOString();
        saveProduction(meta.id, production);
      } catch {
        /* ignore */
      }
      onError?.(error);
    })
    .finally(() => {
      running.delete(meta.id);
      setTimeout(() => progress.delete(meta.id), 8000);
    });
  return controller;
}

export function cancelProduction(id) {
  const state = running.get(id);
  if (!state) return false;
  state.controller.abort();
  return true;
}

export async function saveUploadedAsset(meta, english, beatId, tmpPath, originalName, kind = 'asset') {
  const production = ensureProduction(meta, english);
  const entry = production.beats?.[beatId];
  if (!entry) throw new Error('找不到这一拍。');
  const ext = (path.extname(originalName || '').toLowerCase() || '.mp4').replace(/[^.a-z0-9]/g, '');
  const dest = assetPathFor(meta.id, beatId, ext === '.mov' ? 'mov' : 'mp4');
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  try {
    fs.renameSync(tmpPath, dest);
  } catch {
    fs.copyFileSync(tmpPath, dest);
    fs.rmSync(tmpPath, { force: true });
  }
  const rel = path.relative(productionDir(meta.id), dest);
  let duration = 0;
  try {
    const info = await probeMedia(dest);
    duration = Number(info.duration) || 0;
  } catch {
    duration = 0;
  }
  if (kind === 'base') {
    entry.baseAsset = rel;
    entry.baseAssetDuration = duration;
  } else {
    entry.asset = rel;
    entry.assetDuration = duration;
    entry.status = 'ready';
  }
  entry.error = '';
  entry.updatedAt = new Date().toISOString();
  if (production.final) production.finalDirty = true;
  saveProduction(meta.id, production);
  return { production, entry };
}

export function productionPublic(meta, english) {
  const production = ensureProduction(meta, english);
  return {
    beats: production.beats,
    final: production.final,
    finalDirty: Boolean(production.finalDirty),
    error: production.error || '',
    failedAt: production.failedAt || '',
    updatedAt: production.updatedAt,
    running: isProductionRunning(meta.id),
    progress: progress.get(meta.id) || null,
  };
}
