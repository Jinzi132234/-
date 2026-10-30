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
import os from 'node:os';
import path from 'node:path';

import ffmpegPath from 'ffmpeg-static';
import { spawnSync } from 'node:child_process';

import { jobDir } from './jobs.mjs';
import { readBriefs } from './briefs.mjs';
import { chat, chatJson } from './llm.mjs';
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
import { renderHtmlToMp4 } from './renderer.mjs';
import { extractPython, renderPythonToMp4, makeContactSheet } from './python-renderer.mjs';

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

const FLOW_TEMPLATE = `根據我提供的場景圖、三視圖和文案生成影片。

硬性要求：
1. 鏡頭角度、視點、構圖全程固定不變，不允許移動相機，不能搖鏡、推拉、旋轉、環繞、切換鏡頭，維持場景圖原本的視角。
2. 不要字幕，不要文字，不要花字，不要標題，不要任何畫面文字。
3. 根據文案生成人物說話效果，人物嘴型必須與文案內容、語句節奏、停頓和語氣同步。
4. 三視圖用來確認結構、比例和細節，可作為輕微參考疊圖，但不能改變主畫面視角，也不能替換場景圖。
5. 除人物嘴型外，可加入非常輕微的表情變化、眨眼、呼吸、頭部小幅度自然點頭，以及細微光影變化。
6. 禁止任何相機運動，禁止新增鏡頭，禁止切換角度，禁止特寫切換，禁止環繞拍攝。

文案：
{{VO}}

生成要求：
畫面保持專業、自然、穩定，人物口型準確對應文案，語速清晰，表情克制，不誇張。`;

export function flowPromptFor(beat = {}) {
  return FLOW_TEMPLATE.replace('{{VO}}', String(beat.vo || '').trim());
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
        videoPrompt: beat.type === '人物口播' ? flowPromptFor(beat) : '',
        refs: {},
        refUrls: {},
        approved: false,
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
        if (beat.type === '人物口播') existing.videoPrompt = flowPromptFor(beat);
      }
      if (
        beat.type === '人物口播' &&
        (!existing.videoPrompt || !String(existing.videoPrompt).includes('鏡頭角度、視點、構圖全程固定不變'))
      ) {
        existing.videoPrompt = flowPromptFor(beat);
      }
      existing.route = route;
      existing.refs = existing.refs || {};
      existing.refUrls = existing.refUrls || {};
      existing.approved = Boolean(existing.approved);
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
  if (entry.refUrls) delete entry.refUrls[kind];
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

function compressReferenceImage(file) {
  if (!ffmpegPath || !fs.existsSync(file)) return null;
  const attempts = [1280, 1024, 800, 640];
  for (const width of attempts) {
    const out = path.join(os.tmpdir(), `ref-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`);
    const result = spawnSync(ffmpegPath, [
      '-y', '-loglevel', 'error', '-i', file,
      '-vf', `scale=${width}:-2:force_original_aspect_ratio=decrease`,
      '-q:v', '3', out,
    ], { stdio: 'ignore' });
    if (result.status === 0 && fs.existsSync(out)) {
      const stat = fs.statSync(out);
      if (stat.size <= 1200 * 1024 || width === attempts[attempts.length - 1]) {
        return { file: out, cleanup: true };
      }
      fs.rmSync(out, { force: true });
    }
  }
  return null;
}

function loadReferenceImages(meta, production, beatId) {
  const entry = production.beats?.[beatId];
  const result = [];
  for (const kind of ['character', 'scene', 'face']) {
    const publicUrl = String(entry.refUrls?.[kind] || '').trim();
    if (publicUrl) {
      result.push({ kind, url: publicUrl });
      continue;
    }
    const file = getReferenceFile(meta, production, beatId, kind);
    if (!file) continue;
    const originalSize = fs.statSync(file).size;
    const compressed = compressReferenceImage(file);
    if (compressed) {
      const buffer = fs.readFileSync(compressed.file);
      fs.rmSync(compressed.file, { force: true });
      result.push({ kind, buffer, mimeType: 'image/jpeg' });
      console.log(`[refs] ${beatId}/${kind}: ${Math.round(originalSize / 1024)}KB → ${Math.round(buffer.length / 1024)}KB`);
    } else {
      result.push({ kind, buffer: fs.readFileSync(file), mimeType: imageMime(file) });
    }
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
  const baseOnly = mode === 'base';
  for (const beat of beats) {
    if (signal?.aborted) throw new Error('CANCELLED');
    const entry = production.beats[beat.id] || {
      id: beat.id,
      route: routeForType(beat.type),
      status: 'todo',
    };
    production.beats[beat.id] = entry;
    if (entry.approved) throw new Error(`第 ${beat.id} 拍已通過，先取消通過才能重新生成。`);
    entry.status = 'generating';
    entry.error = '';
    entry.updatedAt = new Date().toISOString();
    saveProduction(meta.id, production);
    onProgress?.(done, beats.length, `正在制作第 ${done + 1}/${beats.length} 拍…`);

    try {
      let spec;
      let usage = null;
      let warning = '';
      if (beat.type === '人物口播' && (mode === 'prompt' || baseOnly)) {
        spec = entry.spec || normalizeSpec({ kind: 'talking_head', duration: beat.estSeconds || 6 }, beat);
        spec.videoPrompt = flowPromptFor(beat);
      } else if (videoOnly && beat.type === '人物口播' && (entry.videoPrompt || entry.spec?.videoPrompt)) {
        spec = entry.spec || { videoPrompt: entry.videoPrompt };
        if (!spec.videoPrompt) spec.videoPrompt = entry.videoPrompt;
        spec.videoPrompt = flowPromptFor(beat);
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
        entry.videoPrompt = spec.videoPrompt || entry.videoPrompt || flowPromptFor(beat);
        const referenceImages = loadReferenceImages(meta, production, beat.id);
        const refsReady = Boolean(entry.refs?.character && entry.refs?.scene);
        if (baseOnly && !refsReady) {
          throw new Error('请先上传场景图和人物三视图，再生成人物口播视频。');
        }
        if (baseOnly && !settings.video?.apiKey) {
          throw new Error('还没有配置 Veo／Omni 的 API Key，先上传 Base 视频或到设置配置。');
        }
        const videoPrompt = [spec.videoPrompt, referencePrompt(entry)].filter(Boolean).join(' ');
        const baseDuration = beat.type === '人物口播' ? 10 : 8;
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
                durationSeconds: baseDuration,
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
                durationSeconds: baseDuration,
                referenceImages,
                signal,
                onProgress: (event) => {
                  entry.realtimeMessage = event.message;
                  saveProduction(meta.id, production);
                },
              });
          const asset = assetPathFor(meta.id, beat.id, baseOnly ? 'base.mp4' : 'mp4');
          fs.writeFileSync(asset, result.buffer);
          const rel = path.relative(dir, asset);
          if (baseOnly) {
            entry.baseAsset = rel;
            try {
              const info = await probeMedia(asset);
              entry.baseAssetDuration = Number(info.duration) || 0;
            } catch {
              entry.baseAssetDuration = 0;
            }
            entry.status = 'base';
          } else {
            entry.asset = rel;
            entry.assetDuration = Number(result.duration) || entry.assetDuration || 0;
            entry.status = 'ready';
          }
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

function extractVideoUrl(text = '') {
  const raw = String(text || '').trim();
  try {
    const json = JSON.parse(raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, ''));
    const candidate = json.video_url || json.videoUrl || json.url || json.output?.video_url || json.video?.url;
    if (candidate) return String(candidate);
  } catch {
    /* not JSON */
  }
  const url = raw.match(/https?:\/\/[^\s"'<>]+\.(?:mp4|webm|mov)(?:\?[^\s"'<>]*)?/i);
  if (url) return url[0];
  const data = raw.match(/data:video\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=\s]+/i);
  return data ? data[0] : '';
}

async function saveVideoFromUrl(meta, beat, videoRef) {
  const dir = productionDir(meta.id);
  const asset = assetPathFor(meta.id, beat.id, 'mp4');
  if (/^data:video\//i.test(videoRef)) {
    const comma = videoRef.indexOf(',');
    const buffer = Buffer.from(videoRef.slice(comma + 1).replace(/\s+/g, ''), 'base64');
    fs.writeFileSync(asset, buffer);
    return path.relative(dir, asset);
  }
  const response = await fetch(videoRef, { redirect: 'follow' });
  if (!response.ok) throw new Error(`Opus 回傳的影片下載失敗：HTTP ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length) throw new Error('Opus 回傳的影片是空的。');
  fs.writeFileSync(asset, buffer);
  return path.relative(dir, asset);
}

function extractHtml(text = '') {
  let raw = String(text || '').trim();
  raw = raw.replace(/^```(?:html)?\s*/i, '').replace(/```\s*$/i, '').trim();
  const start = raw.search(/<!doctype\s+html|<html[\s>]/i);
  if (start < 0) return '';
  const end = raw.toLowerCase().lastIndexOf('</html>');
  return end > start ? raw.slice(start, end + 7).trim() : raw.slice(start).trim();
}

function imagePart(file) {
  if (!file || !fs.existsSync(file)) return null;
  return {
    type: 'image_url',
    image_url: { url: `data:image/jpeg;base64,${fs.readFileSync(file).toString('base64')}` },
  };
}

async function reviseOpusPython({ provider, model, brief, duration, currentScript, contactFile, referenceFile, signal }) {
  const images = [imagePart(contactFile), imagePart(referenceFile)].filter(Boolean);
  const text = `You are reviewing your own Python/Pillow render.

Attached image 1: contact sheet of your CURRENT render.
Attached image 2: TARGET style reference (full-bleed MODS motion graphics).

BROLL XML:
${brief.raw}

CURRENT Python:
${currentScript}

Find the concrete visual problems, then return a COMPLETE revised Python script.

Focus on:
- card too small / too much empty space → full-bleed stage, main card 55–70% width, 4–8 meaningful elements
- missing or tiny text → every title/subtitle/bullet verbatim, large and readable
- weak motion → clear entrances, easing, arrows/lines/counters that animate
- flat UI → gradients, soft shadows, rounded cards, mac-style chrome
- visual hierarchy → bold headline 64–110px, secondary 28–42px, body 22–30px
- keep duration exactly ${duration.toFixed(2)}s at 30fps

Rules:
- Use from components import * from skills/broll-design-pack and its helpers/palette.
- Do NOT call components.run(); save frames yourself.
- Return ONLY the complete Python script, no Markdown, no explanation.
- Keep it under 160 lines / 6000 characters so the API does not truncate it.
- Same imports/contract as before: frames/frame_%05d.png or f"frame_{i:05d}.png".
- No network, subprocess, eval/exec, randomness.
- It MUST be syntactically complete and save every frame.`;
  const result = await chat(provider, {
    model,
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text },
        ...images,
      ],
    }],
    omitTemperature: true,
    maxTokens: 20000,
    signal,
    timeoutMs: 300000,
    retries: 1,
  });
  return extractPython(result.text);
}

export async function startOpusVideo(meta, english, beatId, provider, model, onDone, onError) {
  if (running.has(meta.id)) throw new Error('这个项目正在处理中。');
  const controller = new AbortController();
  running.set(meta.id, { controller, kind: 'opus' });
  progress.set(meta.id, { pct: 3, message: '正在送出 BROLL 給 Opus 5.5…' });
  (async () => {
    const production = ensureProduction(meta, english);
    const beat = (english.beats || []).find((item) => item.id === beatId);
    if (!beat) throw new Error('找不到这一拍。');
    const entry = production.beats[beatId];
    if (entry.approved) throw new Error('这一拍已通過，先取消通過才能重新生成。');
    const brief = readBriefs(meta.id).find((item) => item.beatId === beatId);
    if (!brief?.raw) throw new Error('这一拍还没有 BROLL／AROLL XML。');
    const timedEnd = Math.max(0, ...(brief.timed || []).map((item) => Number(item.end) || 0));
    const duration = Math.min(30, Math.max(2, timedEnd || beat.estSeconds || 6));
    entry.status = 'generating';
    entry.error = '';
    entry.opusOutput = '';
    saveProduction(meta.id, production);

    const packRoot = path.resolve('skills/broll-design-pack');
    let packExample = '';
    try {
      packExample = fs.readFileSync(path.join(packRoot, 'plates', 'plate-184.py'), 'utf8');
    } catch {
      packExample = '';
    }
    const prompt = `You are Opus 5.5, a senior MODS motion designer and Python/Pillow engineer.
Turn the BROLL XML below into a FINAL Python 3 script that renders the video frame by frame.

DESIGN PACK:
Use the local pack at skills/broll-design-pack. Import it with:
  from components import *
Available helpers include: bg, card, plaque, stubcard, darkpanel, mac, bot, disc,
place, comp, fade, dim, p, lerp, eob, eoc, eio, spring, clamp, dashed, partial,
arrowhead, dashed_arrow, check, peek, tab_out, jolt, F.
Use the pack's palette (CREAM, INK, CORAL, stages) and its 1920x1080 / 30fps conventions.
Do NOT call components.run(); this workbench writes frames itself.
Define build() if needed and frame(t), then save frames from a manual loop.
Example plate (style/API reference only; do not copy its content):
${packExample}

HARD OUTPUT RULES:
- Return ONLY one complete Python script. No Markdown fences, no explanation.
- 1920×1080, 16:9, exactly 30fps, duration exactly ${duration.toFixed(2)} seconds.
- Write frames to ./frames/frame_%05d.png (use f"frames/frame_{i:05d}.png"), starting at 00000.
- Use ONLY: PIL (Pillow), numpy, math, os, sys, json, colorsys, typing, dataclasses.
- No network, no external files, no subprocess, no eval/exec, no randomness, no current time.
- Use Pillow drawing: rounded rectangles, gradients, soft shadows via blurred alpha layers, bold kinetic typography, thin vector lines/arrows, mac-style windows.
- Use system fonts, e.g. /System/Library/Fonts/Supplemental/Arial Bold.ttf and Arial.ttf; wrap font loading in try/except and fall back to ImageFont.load_default().
- Full-bleed saturated stage: do NOT put a tiny card in a corner with huge empty space. Main card should occupy ~55–65% of the frame. Use 4–8 meaningful elements.
- Follow the BROLL XML's stage hue, card language, timing, M/I/E codes, icon specs, and end treatment.
- Render EVERY title, subtitle, bullet, label, and caption from the XML as actual readable text, verbatim. Do NOT replace text with blank bars unless the XML explicitly says blank.
- No people, faces, talking heads, or photographic footage.
- The script must finish in under 90 seconds.
- KEEP THE SCRIPT COMPACT: target 120–160 lines and under 6000 characters. Avoid long helper libraries and excessive supersampling. It MUST be syntactically complete; the last lines must generate and save every frame.
- Do not stop mid-function. If space is tight, simplify the drawing, not the frame loop.

BROLL XML:
${brief.raw}`;

    progress.set(meta.id, { pct: 8, message: 'Opus 5.5 正在撰寫 Python/Pillow 動效…' });
    const result = await chat(provider, {
      model,
      messages: [{ role: 'user', content: prompt }],
      omitTemperature: true,
      maxTokens: 20000,
      signal: controller.signal,
      timeoutMs: 300000,
      retries: 1,
    });
    entry.opusOutput = String(result.text || '').slice(0, 2000);
    progress.set(meta.id, { pct: 35, message: 'Opus 已回傳，準備渲染…' });

    const directVideo = extractVideoUrl(result.text);
    const dir = productionDir(meta.id);
    const asset = assetPathFor(meta.id, beat.id, 'mp4');
    if (directVideo) {
      progress.set(meta.id, { pct: 60, message: '下載 Opus 回傳的影片…' });
      const rel = await saveVideoFromUrl(meta, beat, directVideo);
      entry.asset = rel;
    } else {
      const python = extractPython(result.text);
      if (python) {
        const codeDir = path.join(dir, 'opus');
        fs.mkdirSync(codeDir, { recursive: true });
        const codePath = path.join(codeDir, `${beat.id}.py`);
        fs.writeFileSync(codePath, python);
        entry.opusPy = path.relative(dir, codePath);
        entry.opusOutput = String(result.text || '').slice(0, 2000);
        saveProduction(meta.id, production);
        progress.set(meta.id, { pct: 40, message: '執行 Python/Pillow 動效…' });
        await renderPythonToMp4({
          script: python,
          outFile: asset,
          duration,
          onProgress: (pct, message) => {
            progress.set(meta.id, { pct: Math.min(95, 35 + Math.round(pct * 0.6)), message });
          },
        });
        entry.asset = path.relative(dir, asset);
        entry.opusRounds = 1;
        saveProduction(meta.id, production);

        // Two visual-feedback passes: Opus sees the rendered contact sheet,
        // compares it with the target style, and rewrites the Python script.
        let currentScript = python;
        const referenceFile = path.resolve('skills/broll-rules/ref-notes/style-reference.jpg');
        for (let round = 2; round <= 3; round += 1) {
          const contactFile = path.join(codeDir, `${beat.id}-round${round - 1}.jpg`);
          if (!makeContactSheet(asset, contactFile)) break;
          progress.set(meta.id, { pct: 78, message: `第 ${round - 1} 輪：Opus 看畫面並修正…` });
          let revised = '';
          try {
            revised = await reviseOpusPython({
              provider,
              model,
              brief,
              duration,
              currentScript,
              contactFile,
              referenceFile,
              signal: controller.signal,
            });
          } catch (error) {
            entry.opusWarning = `視覺修正略過：${error.message}`;
            break;
          }
          if (!revised) break;
          currentScript = revised;
          const roundPath = path.join(codeDir, `${beat.id}-round${round}.py`);
          fs.writeFileSync(roundPath, revised);
          entry.opusPy = path.relative(dir, roundPath);
          entry.opusRounds = round;
          saveProduction(meta.id, production);
          progress.set(meta.id, { pct: 82, message: `第 ${round} 輪：重新渲染…` });
          try {
            await renderPythonToMp4({
              script: revised,
              outFile: asset,
              duration,
              onProgress: (pct, message) => {
                progress.set(meta.id, { pct: Math.min(97, 82 + Math.round(pct * 0.15)), message });
              },
            });
            entry.asset = path.relative(dir, asset);
            saveProduction(meta.id, production);
          } catch (error) {
            entry.opusWarning = `第 ${round} 輪修正失敗，保留上一版：${error.message}`;
            break;
          }
        }
      } else {
        const html = extractHtml(result.text);
        if (!html) {
          throw new Error(`Opus 回傳的內容不是 Python 或 HTML。回應開頭：${String(result.text || '').slice(0, 160)}`);
        }
        const htmlDir = path.join(dir, 'opus');
        fs.mkdirSync(htmlDir, { recursive: true });
        const htmlPath = path.join(htmlDir, `${beat.id}.html`);
        fs.writeFileSync(htmlPath, html);
        entry.opusHtml = path.relative(dir, htmlPath);
        progress.set(meta.id, { pct: 40, message: '渲染 HTML 動效…' });
        await renderHtmlToMp4({
          html,
          outFile: asset,
          duration,
          onProgress: (pct, message) => {
            progress.set(meta.id, { pct: Math.min(95, 40 + Math.round(pct * 0.55)), message });
          },
        });
        entry.asset = path.relative(dir, asset);
      }
    }
    entry.status = 'ready';
    entry.updatedAt = new Date().toISOString();
    progress.set(meta.id, { pct: 100, message: 'Opus 影片完成' });
    saveProduction(meta.id, production);
  })()
    .then(onDone)
    .catch((error) => {
      try {
        const production = getProduction(meta.id);
        const entry = production.beats?.[beatId];
        if (entry) {
          entry.status = 'error';
          entry.error = error.message;
          entry.updatedAt = new Date().toISOString();
          saveProduction(meta.id, production);
        }
      } catch {
        /* ignore */
      }
      progress.delete(meta.id);
      onError?.(error);
    })
    .finally(() => {
      running.delete(meta.id);
      setTimeout(() => progress.delete(meta.id), 8000);
    });
  return controller;
}

export async function startOpusPersonVideo(meta, english, beatId, provider, model, onDone, onError) {
  if (running.has(meta.id)) throw new Error('这个项目正在处理中。');
  const controller = new AbortController();
  running.set(meta.id, { controller, kind: 'opus-person' });
  progress.set(meta.id, { pct: 3, message: '正在準備 Base 影片與 AROLL…' });
  (async () => {
    const production = ensureProduction(meta, english);
    const beat = (english.beats || []).find((item) => item.id === beatId);
    if (!beat) throw new Error('找不到这一拍。');
    const entry = production.beats[beatId];
    if (entry.approved) throw new Error('这一拍已通過，先取消通過才能重新生成。');
    const brief = readBriefs(meta.id).find((item) => item.beatId === beatId);
    if (!brief?.raw) throw new Error('这一拍还没有 AROLL XML。');
    if (!entry.baseAsset) throw new Error('这一拍还没有 Base 視頻，先完成 Base。');
    const dir = productionDir(meta.id);
    const baseFile = path.join(dir, entry.baseAsset);
    if (!fs.existsSync(baseFile)) throw new Error('Base 視頻檔案不存在。');
    const duration = Math.min(10, Math.max(2, Number(entry.baseAssetDuration) || Number(beat.estSeconds) || 8));
    const totalFrames = Math.round(duration * 30);

    const framesDir = path.join(dir, 'opus', `${beatId}-baseframes`);
    fs.rmSync(framesDir, { recursive: true, force: true });
    fs.mkdirSync(framesDir, { recursive: true });
    if (!ffmpegPath) throw new Error('找不到 FFmpeg。');
    const extract = spawnSync(ffmpegPath, [
      '-y', '-loglevel', 'error', '-i', baseFile,
      '-vf', `fps=30,scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black`,
      '-start_number', '0', path.join(framesDir, 'frame_%05d.png'),
    ], { encoding: 'utf8' });
    if (extract.status !== 0) throw new Error(`Base 抽幀失敗：${(extract.stderr || '').slice(-600)}`);

    entry.status = 'generating';
    entry.error = '';
    entry.opusOutput = '';
    saveProduction(meta.id, production);

    const prompt = `You are Opus 5.5, a senior A-roll motion designer.
Finish this talking-head A-roll using the provided BASE VIDEO FRAMES and the AROLL XML.

BASE FRAMES:
- Local folder: base_frames/
- Files: base_frames/frame_00000.png ... frame_${String(totalFrames - 1).padStart(5, '0')}.png
- 1920×1080, 30fps, exactly ${duration.toFixed(2)} seconds.
- These frames are the real person footage. NEVER replace, crop out, or regenerate the face/body/environment.
- Only add overlays, type, UI cards, lower thirds, stage/PiP treatments, and motion graphics on top.

TASK:
Write a complete Python 3 / Pillow script that:
1. Loads each base frame from base_frames/frame_%05d.png.
2. Draws the AROLL overlays exactly as specified by the XML.
3. Saves every composited frame to frames/frame_%05d.png (start 00000, ${totalFrames} frames).
4. Keeps the face visible and unobstructed; follow the AROLL sparse rules.
5. Uses only PIL, numpy, math, os, sys, json, colorsys, typing, dataclasses.
6. No subprocess, no network, no external image files, no randomness.
7. All on-screen text must be verbatim from the XML; do not invent copy.
8. Return ONLY the Python script, no Markdown fence, no explanation.
9. Keep it compact and syntactically complete; target under 6000 characters. The last lines must write all ${totalFrames} frames.

AROLL XML:
${brief.raw}`;

    progress.set(meta.id, { pct: 12, message: 'Opus 5.5 正在設計 A-roll 疊加層…' });
    const result = await chat(provider, {
      model,
      messages: [{ role: 'user', content: prompt }],
      omitTemperature: true,
      maxTokens: 20000,
      signal: controller.signal,
      timeoutMs: 300000,
      retries: 1,
    });
    entry.opusOutput = String(result.text || '').slice(0, 2000);
    const python = extractPython(result.text);
    if (!python) throw new Error(`Opus 沒有回傳可用的 Python 腳本。回應開頭：${String(result.text || '').slice(0, 160)}`);
    const codeDir = path.join(dir, 'opus');
    fs.mkdirSync(codeDir, { recursive: true });
    const codePath = path.join(codeDir, `${beatId}-aroll.py`);
    fs.writeFileSync(codePath, python);
    entry.opusPy = path.relative(dir, codePath);
    saveProduction(meta.id, production);

    progress.set(meta.id, { pct: 35, message: '把 AROLL 疊加到 Base 畫面上…' });
    const asset = assetPathFor(meta.id, beat.id, 'mp4');
    await renderPythonToMp4({
      script: python,
      outFile: asset,
      duration,
      inputDir: framesDir,
      onProgress: (pct, message) => {
        progress.set(meta.id, { pct: Math.min(96, 35 + Math.round(pct * 0.6)), message });
      },
    });
    entry.asset = path.relative(dir, asset);
    entry.assetDuration = duration;
    entry.status = 'ready';
    entry.updatedAt = new Date().toISOString();
    progress.set(meta.id, { pct: 100, message: 'Opus A-roll 完成' });
    saveProduction(meta.id, production);
  })()
    .then(onDone)
    .catch((error) => {
      try {
        const production = getProduction(meta.id);
        const entry = production.beats?.[beatId];
        if (entry) {
          entry.status = 'error';
          entry.error = error.message;
          entry.updatedAt = new Date().toISOString();
          saveProduction(meta.id, production);
        }
      } catch {
        /* ignore */
      }
      progress.delete(meta.id);
      onError?.(error);
    })
    .finally(() => {
      running.delete(meta.id);
      setTimeout(() => progress.delete(meta.id), 8000);
    });
  return controller;
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
