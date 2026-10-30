/**
 * "Chinese course to English YouTube VO shots" skill.
 *
 * The authoritative instructions live in
 * skills/chinese-course-to-english-youtube-vo-shots/SKILL.md.
 * This module turns the Chinese segmented copy into English YouTube
 * voice-over beats with one shot label per beat, validates the hard rules,
 * and renders the Markdown table deliverable.
 */
import fs from 'node:fs';
import path from 'node:path';

import { ROOT } from './config.mjs';
import { jobDir } from './jobs.mjs';
import { chatJson, extractJson } from './llm.mjs';

const SKILL_PATH = path.join(
  ROOT,
  'skills',
  'chinese-course-to-english-youtube-vo-shots',
  'SKILL.md',
);

function readSkill() {
  try {
    return fs.readFileSync(SKILL_PATH, 'utf8');
  } catch {
    return 'Turn a Chinese course script into short English YouTube teaching voice-over beats with one shot label per beat.';
  }
}

export const SKILL_TEXT = readSkill();
export const VO_LABELS = ['人物口播', 'B字卡', '實操'];
const MAX_WORDS = 25;
const WORDS_PER_SECOND = 2.5;
const MAX_WORDS_BY_TYPE = { 人物口播: 30, B字卡: 35, 實操: 80 };
const MAX_SECONDS_BY_TYPE = { 人物口播: 12, B字卡: 14, 實操: 36 };
function maxWordsFor(type) { return MAX_WORDS_BY_TYPE[type] || MAX_WORDS; }
function maxSecondsFor(type) { return MAX_SECONDS_BY_TYPE[type] || 12; }

const OUTPUT_CONTRACT = `

## 本次执行的输出契约（优先于 SKILL.md 的交付格式）

1. 你只输出一个 JSON 对象，不要输出 Markdown 表格、标题或解释。
2. JSON 结构固定为：
   {"beats":[{"type":"人物口播","vo":"English voiceover line","visual":"画面/字卡说明","sourceBlock":"b1"}]}
3. type 必须是以下三个值之一，使用繁体中文：人物口播 / B字卡 / 實操。
3a. 實操優先：如果這一段正在演示軟件、界面、點擊、輸入或螢幕操作，口播即使是在解釋概念，也必須標為 實操，畫面用當前的操作畫面承載；不要拆成 B字卡。
3b. B字卡只在沒有可用操作畫面、或需要獨立概念圖時使用；不要為了配比把可被操作畫面覆蓋的概念硬拆成字卡。
3c. 操作型章節的目標：實操 70–80%，人物口播主要 opening／轉場／結尾，B字卡只留給無法用操作畫面承載的概念。概念型章節（幾乎沒有可用 UI）則以 B字卡／人物為主，不要硬湊 70% 實操。
4. 每个 beat 对应一个镜头或一个连续操作段。vo 必须是英文。
   - 人物口播：目標 8–12 秒（約 10 秒），最多 30 words；不要每句拆一拍，同一段連續說話合併到一個人物段落。
   - B字卡：最多 35 words，朗读不超过 14 秒。
   - 實操：可以合并连续点击/输入/讲解为一个 15–36 秒的操作段，最多 80 words；不要每点一下鼠标就拆一拍。
5. visual 用简体中文写，简洁说明观众看到什么：字卡文字、UI 操作步骤、主持人构图。不要把画面说明写进 vo。
6. sourceBlock 必须是输入中真实存在的段落 id（例如 b1）。每个 beat 必须能追溯到某一段。
7. 不要使用连字符或破折号（- — –）作为口播停顿；用逗号、句号或短句。
8. 不要新增输入里没有的话题、模块、数据、承诺或 CTA。
9. 不要输出 id 字段，程序会按顺序编号。`;

function modeInstruction(mode) {
  if (mode === 'faceless') {
    return `镜头模式：无露脸优先。操作型章節目標 實操 70–80%，其餘用 B字卡；人物口播最多 10%。概念型章節可以 B字卡 為主，不要硬湊實操。`;
  }
  if (mode === 'auto') {
    return `镜头模式：操作優先，按內容自動判斷。操作型章節目標 實操 70–80%；人物口播主要 opening／轉場／結尾；B字卡只用在沒有可用操作畫面的概念。概念型章節可以 B字卡／人物 為主，不要硬湊 70% 實操。`;
  }
  return `镜头模式：操作優先的真人課程。操作型章節目標 實操 70–80%；人物口播主要 opening、章節轉場、結尾；實操段口播講概念時，只要操作畫面能承載，就留在實操，不要拆成 B字卡。B字卡只用在沒有可用操作畫面的概念。概念型章節可提高 B字卡／人物比例，按內容判斷，不要為了配比注水。`;
}

export function computeWords(text) {
  const tokens = String(text || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return tokens.filter((token) => /[A-Za-z0-9]/.test(token)).length;
}

export function computeStats(beats) {
  const labels = { 人物口播: 0, B字卡: 0, 實操: 0 };
  let words = 0;
  let maxWords = 0;
  const seconds = beats.reduce((sum, beat) => {
    labels[beat.type] = (labels[beat.type] || 0) + 1;
    words += beat.words || computeWords(beat.vo);
    maxWords = Math.max(maxWords, beat.words || 0);
    return sum + (beat.estSeconds || 0);
  }, 0);
  const count = beats.length || 1;
  return {
    beats: beats.length,
    words,
    maxWords,
    avgWords: Math.round((words / count) * 10) / 10,
    estSeconds: Math.round(seconds),
    labels,
    mix: {
      人物口播: Math.round((labels.人物口播 / count) * 100),
      B字卡: Math.round((labels.B字卡 / count) * 100),
      實操: Math.round((labels.實操 / count) * 100),
    },
  };
}

function cleanText(value) {
  return String(value ?? '')
    .replace(/\r/g, '')
    .replace(/\n+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/^["'“”「」『』]+|["'“”「」『』]+$/g, '')
    .trim();
}

function normalizeType(value) {
  const text = String(value || '');
  if (text.includes('人物') || /talking|host|face/i.test(text)) return '人物口播';
  if (text.includes('實操') || text.includes('实操') || /demo|screen|ui/i.test(text)) return '實操';
  return 'B字卡';
}

function splitSentences(text) {
  const sentences = String(text).match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [String(text)];
  return sentences.map((s) => s.trim()).filter(Boolean);
}

/** Keep every beat under the hard 25-word limit, splitting at sentence/comma. */
function splitLongVo(vo, type = '人物口播') {
  const limit = maxWordsFor(type);
  if (computeWords(vo) <= limit) return [vo];
  const chunks = [];
  let current = '';
  const flush = () => {
    if (current.trim()) chunks.push(current.trim());
    current = '';
  };

  for (const sentence of splitSentences(vo)) {
    if (computeWords(sentence) <= limit) {
      const candidate = current ? `${current} ${sentence}` : sentence;
      if (computeWords(candidate) <= limit) current = candidate;
      else {
        flush();
        current = sentence;
      }
      continue;
    }
    flush();
    const clauses = sentence.split(/(?<=[,;:])\s+/).filter(Boolean);
    let clauseBuffer = '';
    for (const clause of clauses) {
      if (computeWords(clause) > limit) {
        if (clauseBuffer) {
          chunks.push(clauseBuffer.trim());
          clauseBuffer = '';
        }
        const words = clause.split(/\s+/);
        for (let i = 0; i < words.length; i += limit) {
          chunks.push(words.slice(i, i + limit).join(' '));
        }
        continue;
      }
      const candidate = clauseBuffer ? `${clauseBuffer} ${clause}` : clause;
      if (computeWords(candidate) <= limit) clauseBuffer = candidate;
      else {
        if (clauseBuffer) chunks.push(clauseBuffer.trim());
        clauseBuffer = clause;
      }
    }
    if (clauseBuffer) chunks.push(clauseBuffer.trim());
  }
  flush();
  return chunks.filter(Boolean);
}

/** Normalize arbitrary model output into beats + per-beat issues. */
export function normalizeBeats(payload, allowedBlockIds = [], { splitLong = true } = {}) {
  const raw = Array.isArray(payload)
    ? payload
    : payload?.beats || payload?.data?.beats || payload?.items || [];
  const beats = [];
  const issues = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    let vo = cleanText(item.vo ?? item.english ?? item.text ?? item.voiceover ?? item.line);
    if (!vo) continue;
    const type = normalizeType(item.type ?? item.shot ?? item.label ?? item.visualType);
    let visual = cleanText(item.visual ?? item.screen ?? item.card ?? item.direction ?? item.visualNote);
    const sourceRaw = String(item.sourceBlock ?? item.source_block ?? item.blockId ?? '').trim();
    const sourceBlock = allowedBlockIds.includes(sourceRaw) ? sourceRaw : '';
    let autoSplit = false;

    const pieces = splitLong ? splitLongVo(vo, type) : [vo];
    if (pieces.length > 1) autoSplit = true;
    pieces.forEach((piece, index) => {
      const words = computeWords(piece);
      const chinese = (piece.match(/[\u4e00-\u9fff]/g) || []).length;
      const estSeconds = Math.max(2, Math.round((words / WORDS_PER_SECOND) * 10) / 10);
      const codes = [];
      if (words > maxWordsFor(type)) codes.push('too_long');
      if (estSeconds > maxSecondsFor(type)) codes.push('too_long_seconds');
      if (chinese > 0) codes.push('chinese_in_vo');
      if (/(?:^|\s)[—–]|\s-\s/.test(piece)) codes.push('dash_pause');
      if (!visual) codes.push('missing_visual');
      if (!sourceBlock) codes.push('missing_source');
      beats.push({
        type,
        vo: piece,
        visual: visual || '画面待补充',
        sourceBlock,
        words,
        estSeconds,
        autoSplit: autoSplit || index > 0,
        warnings: codes,
      });
      if (codes.length) issues.push({ index: beats.length, codes, words, vo: piece });
    });
  }
  beats.forEach((beat, index) => {
    beat.id = `e${index + 1}`;
  });
  return { beats, issues };
}

/** In a block that already has screen recording, prefer the live UI for concepts too. */
export function promoteConceptBrollToScreen(beats = []) {
  const screenBlocks = new Set(
    beats.filter((beat) => beat.type === '實操' && beat.sourceBlock).map((beat) => beat.sourceBlock),
  );
  const uiVisual = /(界面|窗口|按鈕|按钮|點擊|点击|輸入|输入|屏幕|螢幕|软件|軟件|列表|聊天|设置|設置|操作|表单|表單|气泡|氣泡|截图|截圖|页面|頁面)/;
  return beats.map((beat) => {
    if (beat.type !== 'B字卡' || !beat.sourceBlock || !screenBlocks.has(beat.sourceBlock)) return beat;
    if (!uiVisual.test(beat.visual || '')) return beat;
    return {
      ...beat,
      type: '實操',
      visual: `用當前操作畫面承載；${beat.visual || ''}`.trim(),
      promotedFromBroll: true,
    };
  });
}

/** Merge consecutive talking-head beats up to a ten-second take. */
export function mergePersonBeats(beats = []) {
  const out = [];
  for (const beat of beats) {
    const last = out[out.length - 1];
    const canMerge =
      last &&
      last.type === '人物口播' &&
      beat.type === '人物口播' &&
      last.sourceBlock === beat.sourceBlock &&
      !last.warnings?.length &&
      !beat.warnings?.length &&
      computeWords(`${last.vo} ${beat.vo}`) <= 25 &&
      (Number(last.estSeconds) || 0) + (Number(beat.estSeconds) || 0) <= 10;
    if (!canMerge) {
      out.push({ ...beat });
      continue;
    }
    last.vo = `${last.vo} ${beat.vo}`.replace(/\s{2,}/g, ' ').trim();
    last.visual = [last.visual, beat.visual].filter(Boolean).join('；');
    last.words = computeWords(last.vo);
    last.estSeconds = Math.round((last.words / WORDS_PER_SECOND) * 10) / 10;
    last.merged = (last.merged || 1) + 1;
  }
  out.forEach((beat, index) => { beat.id = `e${index + 1}`; });
  return out;
}

/** Merge consecutive screen-recording beats into fewer, longer takes. *//** Merge consecutive screen-recording beats into fewer, longer takes. */
export function mergeScreenBeats(beats = []) {
  const out = [];
  for (const beat of beats) {
    const last = out[out.length - 1];
    const canMerge =
      last &&
      last.type === '實操' &&
      beat.type === '實操' &&
      last.sourceBlock === beat.sourceBlock &&
      !last.warnings?.length &&
      !beat.warnings?.length &&
      computeWords(`${last.vo} ${beat.vo}`) <= maxWordsFor('實操') &&
      (Number(last.estSeconds) || 0) + (Number(beat.estSeconds) || 0) <= maxSecondsFor('實操');
    if (!canMerge) {
      out.push({ ...beat });
      continue;
    }
    last.vo = `${last.vo} ${beat.vo}`.replace(/\s{2,}/g, ' ').trim();
    last.visual = [last.visual, beat.visual].filter(Boolean).join('；');
    last.words = computeWords(last.vo);
    last.estSeconds = Math.round((last.words / WORDS_PER_SECOND) * 10) / 10;
    last.autoSplit = false;
    last.merged = (last.merged || 1) + 1;
  }
  out.forEach((beat, index) => {
    beat.id = `e${index + 1}`;
  });
  return out;
}

function buildSystemPrompt() {
  return `${SKILL_TEXT}

${OUTPUT_CONTRACT}`;
}

function blockPayload(blocks) {
  return blocks.map((block) => ({
    id: block.id,
    title: block.title,
    time: `${clock(block.start)}-${clock(block.end)}`,
    text: block.copy,
    screenText: block.screenText || '',
  }));
}

export function buildEnglishMessages(settings, meta, blocks, partIndex, partCount) {
  const mode = settings.english?.mode || 'oncamera';
  const brief = settings.english?.brief || '';
  const partNote =
    partCount > 1
      ? `这是第 ${partIndex + 1}/${partCount} 部分。只处理给出的段落，不要补写前后内容；第一部分负责 opening hook，只有最后一部分做 recap 和自然 CTA；中间部分用自然的过渡句。`
      : '这是完整内容；开头要有 value hook，结尾若有原文依据就做简短 recap 和 takeaway。';
  const user = `课程标题：${meta.title}

${modeInstruction(mode)}
${brief ? `补充要求：${brief}` : ''}
${partNote}

请把下面这段中文课程文案改写成英文 YouTube 教学口播分镜（每个 beat 一个镜头），严格返回 JSON：
${JSON.stringify(blockPayload(blocks), null, 0)}`;
  return [
    { role: 'system', content: buildSystemPrompt() },
    { role: 'user', content: user },
  ];
}

function buildRepairMessages(settings, meta, beats, issues) {
  return [
    { role: 'system', content: buildSystemPrompt() },
    {
      role: 'user',
      content: `课程标题：${meta.title}
下面这批 beats 违反了硬规则。请修正后返回完整的 beats JSON（顺序不变，可以拆分过长 beat，不得新增内容，不得删掉有效内容）。

问题：
${issues
  .slice(0, 40)
  .map((issue) => `- 第 ${issue.index} 拍：${issue.codes.join(', ')}（${issue.words} words）`)
  .join('\n')}

当前 beats：
${JSON.stringify(
  beats.map((beat) => ({
    type: beat.type,
    vo: beat.vo,
    visual: beat.visual,
    sourceBlock: beat.sourceBlock,
  })),
  null,
  0,
)}`,
    },
  ];
}

function combineParts(left, right) {
  return { beats: [...left.beats, ...right.beats] };
}

function parsePayload(text) {
  try {
    return JSON.parse(String(text).trim());
  } catch {
    return extractJson(text);
  }
}

export function chunkBlocks(blocks, maxChars = 4800, maxBlocks = 8) {
  const chunks = [];
  let current = [];
  let chars = 0;
  for (const block of blocks) {
    const length = String(block.copy || '').length + 80;
    if (current.length && (chars + length > maxChars || current.length >= maxBlocks)) {
      chunks.push(current);
      current = [];
      chars = 0;
    }
    current.push(block);
    chars += length;
  }
  if (current.length) chunks.push(current);
  return chunks;
}

/**
 * Generate all beats. `callModel` is injected so the pipeline can reuse the
 * configured provider and track usage.
 */
export async function generateEnglishBeats({
  settings,
  meta,
  blocks,
  provider,
  model,
  temperature,
  signal,
  onProgress,
}) {
  const parts = chunkBlocks(blocks, 3000, 5);
  const all = [];
  let promptTokens = 0;
  let completionTokens = 0;
  let calls = 0;
  let repairCalls = 0;

  const runPart = async (part, index, depth = 0) => {
    if (signal?.aborted) throw new Error('CANCELLED');
    const allowed = part.map((block) => block.id);
    const messages = buildEnglishMessages(settings, meta, part, index, parts.length);
    let result;
    try {
      result = await chatJson(provider, {
        model,
        messages,
        temperature,
        maxTokens: 8000,
        signal,
        jsonMode: settings.llm?.jsonMode !== false,
        retries: 2,
      });
    } catch (error) {
      if (/JSON/i.test(error.message) && depth < 2 && part.length > 1) {
        const mid = Math.ceil(part.length / 2);
        return combineParts(
          await runPart(part.slice(0, mid), index, depth + 1),
          await runPart(part.slice(mid), index, depth + 1),
        );
      }
      throw error;
    }

    calls += 1;
    promptTokens += result.usage?.prompt_tokens || 0;
    completionTokens += result.usage?.completion_tokens || 0;

    let parsed;
    try {
      parsed = parsePayload(result.text);
    } catch (error) {
      if (depth < 2 && part.length > 1) {
        const mid = Math.ceil(part.length / 2);
        return combineParts(
          await runPart(part.slice(0, mid), index, depth + 1),
          await runPart(part.slice(mid), index, depth + 1),
        );
      }
      throw error;
    }
    let normalized = normalizeBeats(parsed, allowed, { splitLong: false });

    if (normalized.issues.length) {
      const repairMessages = buildRepairMessages(settings, meta, normalized.beats, normalized.issues);
      try {
        const repaired = await chatJson(provider, {
          model,
          messages: repairMessages,
          temperature: Math.min(Number(temperature) || 0.5, 0.4),
          maxTokens: 8000,
          signal,
          jsonMode: settings.llm?.jsonMode !== false,
          retries: 1,
        });
        const repairedNormalized = normalizeBeats(parsePayload(repaired.text), allowed, { splitLong: false });
        repairCalls += 1;
        calls += 1;
        promptTokens += repaired.usage?.prompt_tokens || 0;
        completionTokens += repaired.usage?.completion_tokens || 0;
        if (repairedNormalized.beats.length && repairedNormalized.issues.length < normalized.issues.length) {
          normalized = repairedNormalized;
        }
      } catch (error) {
        if (signal?.aborted) throw error;
      }
    }

    if (normalized.issues.some((issue) => issue.codes.includes('too_long'))) {
      normalized = normalizeBeats({ beats: normalized.beats }, allowed, { splitLong: true });
    }
    if (!normalized.beats.length) {
      if (depth < 2 && part.length > 1) {
        const mid = Math.ceil(part.length / 2);
        return combineParts(
          await runPart(part.slice(0, mid), index, depth + 1),
          await runPart(part.slice(mid), index, depth + 1),
        );
      }
      throw new Error(`第 ${index + 1}/${parts.length} 部分没有生成有效的英文分镜。`);
    }
    return { beats: normalized.beats };
  };

  for (let index = 0; index < parts.length; index += 1) {
    if (signal?.aborted) throw new Error('CANCELLED');
    onProgress?.(index, parts.length);
    const result = await runPart(parts[index], index);
    all.push(...result.beats);
    onProgress?.(index + 1, parts.length);
  }

  const personMerged = mergePersonBeats(all);
  const promoted = promoteConceptBrollToScreen(personMerged);
  const merged = mergeScreenBeats(promoted);
  merged.forEach((beat, index) => {
    beat.id = `e${index + 1}`;
  });
  const stats = computeStats(merged);
  return {
    beats: merged,
    stats,
    usage: { promptTokens, completionTokens, calls },
    repairCalls,
    parts: parts.length,
  };
}

export function buildVoTable(beats) {
  const escape = (value) => String(value ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
  const lines = [
    '| # | 畫面類型 | English VO | 畫面/字卡 |',
    '|---|----------|------------|-----------|',
  ];
  beats.forEach((beat, index) => {
    lines.push(
      `| ${index + 1} | ${beat.type} | ${escape(beat.vo)} | ${escape(beat.visual)} |`,
    );
  });
  return lines.join('\n') + '\n';
}

export function buildZhSource(meta, blocks) {
  const lines = [`# ${meta.title}`, '', `> 中文课程文案 → 英文 YouTube VO 分镜的输入源`, ''];
  for (const block of blocks) {
    lines.push(`## ${block.id} ${block.title}`);
    lines.push('');
    lines.push(`\`${clock(block.start)} – ${clock(block.end)}\``);
    lines.push('');
    lines.push(block.copy);
    if (block.screenText) {
      lines.push('');
      lines.push(`屏幕字：${block.screenText}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

export function writeEnglishWorkingFiles(meta, blocks, beats) {
  const dir = path.join(jobDir(meta.id), 'english');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'zh-source.txt'), buildZhSource(meta, blocks), 'utf8');
  fs.writeFileSync(path.join(dir, 'en-vo-shots-table.md'), buildVoTable(beats), 'utf8');
  fs.writeFileSync(
    path.join(dir, 'en-vo-shots.json'),
    JSON.stringify({ beats, stats: computeStats(beats), generatedAt: new Date().toISOString() }, null, 2),
    'utf8',
  );
}

export function clock(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (value) => String(value).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}
