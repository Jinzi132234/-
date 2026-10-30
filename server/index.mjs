import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import express from 'express';
import multer from 'multer';
import { ProxyAgent, setGlobalDispatcher } from 'undici';

import {
  ROOT,
  SETTINGS_PATH,
  TMP_DIR,
  loadSettings,
  publicSettings,
  saveSettings,
} from './config.mjs';
import {
  addLog,
  cleanupTmp,
  createJob,
  deleteJob,
  getCopy,
  getEnglish,
  getTranscript,
  jobDir,
  listJobs,
  mediaPath,
  readMeta,
  saveCopy,
  saveEnglish,
  saveTranscript,
  writeMeta,
} from './jobs.mjs';
import { testProvider, modelsEndpoint } from './llm.mjs';
import { buildExport } from './exports.mjs';
import { buildDeliveryBundle } from './bundle.mjs';
import { computeStats, normalizeBeats, writeEnglishWorkingFiles } from './english.mjs';
import { addBrief, deleteBrief, readBriefs, updateBrief } from './briefs.mjs';
import { generateMotionBrief } from './motion.mjs';
import {
  cancelProduction,
  ensureProduction,
  getAssetFile,
  getProduction,
  productionPublic,
  isProductionRunning,
  renderProduction,
  saveUploadedAsset,
  saveProduction,
  saveReference,
  saveVideoPrompt,
  deleteReference,
  getReferenceFile,
  startGenerate,
  startOpusVideo,
  startOpusPersonVideo,
  startRender,
} from './production.mjs';
import { resolveModel } from './config.mjs';
import {
  cancelJob,
  isRunning,
  probeFile,
  reviseText,
  runJob,
} from './pipeline.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(ROOT, 'public');
const PORT = Number(process.env.WB_PORT || 4321);
const HOST = process.env.WB_HOST || '127.0.0.1';

// Node 的 fetch 默认不读取代理环境变量；这里显式接管，方便访问 AIHubMix / xAI。
const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
function proxyReachable(url) {
  return new Promise((resolve) => {
    try {
      const parsed = new URL(url);
      const socket = net.connect(
        { host: parsed.hostname, port: Number(parsed.port || 80) },
        () => {
          socket.end();
          resolve(true);
        },
      );
      socket.setTimeout(1500, () => {
        socket.destroy();
        resolve(false);
      });
      socket.on('error', () => resolve(false));
    } catch {
      resolve(false);
    }
  });
}
if (proxyUrl) {
  if (await proxyReachable(proxyUrl)) {
    try {
      setGlobalDispatcher(new ProxyAgent(proxyUrl));
      console.log(`[proxy] 使用 ${proxyUrl}`);
    } catch (error) {
      console.warn(`[proxy] 代理设置失败：${error.message}`);
    }
  } else {
    console.warn(`[proxy] ${proxyUrl} 不可用，改用直连；Google/Claude 可能无法访问`);
  }
}

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '8mb' }));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  next();
});

const extSet = new Set(['.mp4', '.mov', '.m4v', '.mkv', '.webm', '.avi', '.mp3', '.m4a', '.wav', '.flac']);
const upload = multer({
  dest: TMP_DIR,
  limits: { fileSize: 4 * 1024 * 1024 * 1024, files: 1 },
  fileFilter(req, file, cb) {
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (extSet.has(ext)) cb(null, true);
    else cb(Object.assign(new Error(`不支持的文件类型：${ext || '未知'}，请上传 mp4 / mov / mkv / webm 等视频。`), { status: 400 }));
  },
});

const imageExtSet = new Set(['.png', '.jpg', '.jpeg', '.webp']);
const imageUpload = multer({
  dest: TMP_DIR,
  limits: { fileSize: 20 * 1024 * 1024, files: 1 },
  fileFilter(req, file, cb) {
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (imageExtSet.has(ext)) cb(null, true);
    else cb(Object.assign(new Error(`参考图只支持 PNG / JPG / WEBP，收到：${ext || '未知'}`), { status: 400 }));
  },
});

function asyncRoute(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

function decodeUploadName(name = '') {
  if (!/[\u0080-\u00ff]/.test(name)) return name;
  const decoded = Buffer.from(name, 'latin1').toString('utf8');
  return decoded.includes('\uFFFD') ? name : decoded;
}

function contentDisposition(filename, attachment) {
  const encoded = encodeURIComponent(filename);
  return `${attachment ? 'attachment' : 'inline'}; filename="${encoded}"; filename*=UTF-8''${encoded}`;
}

const MIME = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska',
  '.webm': 'video/webm',
  '.avi': 'video/x-msvideo',
};

/* ------------------------------------------------------------------ settings */

app.get('/api/settings', (req, res) => {
  res.json({ settings: publicSettings(loadSettings()) });
});

app.put('/api/settings', (req, res) => {
  const current = loadSettings();
  const body = req.body || {};
  const next = { ...current };

  if (Array.isArray(body.providers)) {
    next.providers = body.providers.map((incoming) => {
      const existing = current.providers.find((p) => p.id === incoming.id) || {};
      let apiKey = existing.apiKey || '';
      if (incoming.apiKey === '__CLEAR__') apiKey = '';
      else if (typeof incoming.apiKey === 'string' && incoming.apiKey.trim()) apiKey = incoming.apiKey.trim();
      return {
        id: String(incoming.id || existing.id || ''),
        name: String(incoming.name || existing.name || incoming.id || ''),
        baseUrl: String(incoming.baseUrl ?? existing.baseUrl ?? '').replace(/\/+$/, ''),
        apiKey,
        models: Array.isArray(incoming.models) ? incoming.models.map(String).filter(Boolean).slice(0, 40) : existing.models || [],
      };
    });
  }
  if (body.tasks && typeof body.tasks === 'object') {
    const tasks = { ...(current.tasks || {}) };
    for (const [task, incoming] of Object.entries(body.tasks)) {
      if (!incoming || typeof incoming !== 'object') continue;
      const existing = tasks[task] || {};
      let apiKey = existing.apiKey || '';
      if (incoming.apiKey === '__CLEAR__') apiKey = '';
      else if (typeof incoming.apiKey === 'string' && incoming.apiKey.trim()) apiKey = incoming.apiKey.trim();
      const { apiKey: _ignored, hasKey: _has, keyHint: _hint, _newKey: _new, _clearKey: _clear, ...rest } = incoming;
      tasks[task] = {
        ...existing,
        ...rest,
        baseUrl: String(rest.baseUrl || '').trim().replace(/\/+$/, ''),
        apiKey,
      };
    }
    next.tasks = tasks;
  }
  for (const key of ['asr', 'llm', 'export', 'english', 'voice', 'output']) {
    if (body[key] && typeof body[key] === 'object') next[key] = { ...current[key], ...body[key] };
  }
  if (body.video && typeof body.video === 'object') {
    const currentVideo = current.video || {};
    let apiKey = currentVideo.apiKey || '';
    if (body.video.apiKey === '__CLEAR__') apiKey = '';
    else if (typeof body.video.apiKey === 'string' && body.video.apiKey.trim()) apiKey = body.video.apiKey.trim();
    const { apiKey: _ignored, hasKey: _has, keyHint: _hint, ...videoRest } = body.video;
    next.video = { ...currentVideo, ...videoRest, apiKey };
  }
  for (const key of ['translateStyle', 'copyBrief', 'glossary']) {
    if (typeof body[key] === 'string') next[key] = body[key].slice(0, 4000);
  }
  saveSettings(next);
  res.json({ settings: publicSettings(next) });
});

app.post('/api/settings/test', asyncRoute(async (req, res) => {
  const settings = loadSettings();
  const { providerId, baseUrl, apiKey, model } = req.body || {};
  const stored = settings.providers.find((p) => p.id === providerId);
  if (!stored && !baseUrl) throw Object.assign(new Error('找不到这个服务商。'), { status: 404 });
  const provider = {
    ...(stored || {}),
    ...(baseUrl ? { baseUrl } : {}),
    ...(apiKey && apiKey !== '__KEEP__' ? { apiKey } : {}),
  };
  if (!provider.baseUrl) throw Object.assign(new Error('请填写 API 地址。'), { status: 400 });
  if (!provider.apiKey) throw Object.assign(new Error('请填写 API Key。'), { status: 400 });
  const result = await testProvider(provider, model);
  res.json(result);
}));

app.get('/api/settings/models', asyncRoute(async (req, res) => {
  const settings = loadSettings();
  const provider = settings.providers.find((p) => p.id === req.query.providerId);
  if (!provider) throw Object.assign(new Error('找不到这个服务商。'), { status: 404 });
  if (!provider.apiKey) throw Object.assign(new Error('这个服务商还没有 Key。'), { status: 400 });
  const response = await fetch(modelsEndpoint(provider.baseUrl), {
    headers: { Authorization: `Bearer ${provider.apiKey}` },
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error(`模型列表返回 HTTP ${response.status}`);
  const data = await response.json();
  res.json({ models: (data.data || []).map((m) => m.id).filter(Boolean).sort() });
}));

app.get('/api/health', asyncRoute(async (req, res) => {
  const started = Date.now();
  let asr = { ok: false, detail: '检查中' };
  try {
    const python = await new Promise((resolve, reject) => {
      const child = spawn(process.env.WB_PYTHON || 'python3', ['-c', 'import faster_whisper,sys;print(faster_whisper.__version__)'], {
        timeout: 15000,
      });
      let out = '';
      child.stdout.on('data', (d) => (out += d));
      child.on('close', (code) => (code === 0 ? resolve(out.trim()) : reject(new Error(`exit ${code}`))));
      child.on('error', reject);
    });
    asr = { ok: true, detail: `faster-whisper ${python}` };
  } catch (error) {
    asr = { ok: false, detail: error.message };
  }
  const settings = loadSettings();
  res.json({
    ok: true,
    asr,
    providers: settings.providers.map((p) => ({ id: p.id, name: p.name, hasKey: Boolean(p.apiKey) })),
    elapsedMs: Date.now() - started,
  });
}));

/* ---------------------------------------------------------------------- jobs */

app.get('/api/jobs', (req, res) => {
  const jobs = listJobs();
  res.json({ jobs, running: jobs.filter((j) => isRunning(j.id)).map((j) => j.id) });
});

app.post('/api/jobs', (req, res, next) => {
  upload.single('video')(req, res, async (error) => {
    if (error) {
      if (req.file?.path) fs.rmSync(req.file.path, { force: true });
      return next(error);
    }
    try {
      if (!req.file) throw Object.assign(new Error('没有收到视频文件。'), { status: 400 });
      const meta = createJob({
        tmpPath: req.file.path,
        originalName: decodeUploadName(req.file.originalname),
        size: req.file.size,
      });
      try {
        const info = await probeFile(mediaPath(meta));
        Object.assign(meta.source, {
          duration: info.duration,
          width: info.width,
          height: info.height,
          fps: info.fps,
          hasAudio: info.hasAudio,
        });
        addLog(meta, `已上传：${meta.source.filename}（${Math.round(info.duration / 60)} 分钟，${info.width}×${info.height}）`);
      } catch (probeError) {
        addLog(meta, `视频探测失败：${probeError.message}`, 'warn');
      }
      writeMeta(meta);
      res.status(201).json({ job: meta });
    } catch (err) {
      next(err);
    }
  });
});

app.get('/api/jobs/:id', asyncRoute(async (req, res) => {
  const meta = readMeta(req.params.id);
  const english = getEnglish(meta.id);
  res.json({
    job: { ...meta, running: isRunning(meta.id) },
    transcript: getTranscript(meta.id),
    copy: getCopy(meta.id),
    english,
    production: productionPublic(meta, english),
    briefs: readBriefs(meta.id),
  });
}));

app.post('/api/jobs/:id/motion', asyncRoute(async (req, res) => {
  const meta = readMeta(req.params.id);
  const english = getEnglish(meta.id);
  const beatId = String(req.body?.beatId || '');
  const beat = (english.beats || []).find((item) => item.id === beatId);
  if (!beat) throw Object.assign(new Error('找不到这一拍。'), { status: 404 });
  const mode = req.body?.mode === 'aroll' ? 'aroll' : 'broll';
  if (mode === 'aroll' && beat.type !== '人物口播') {
    throw Object.assign(new Error('这一拍不是人物口播，不能生成 A-roll 指令。'), { status: 400 });
  }
  if (mode === 'broll' && beat.type === '人物口播') {
    throw Object.assign(new Error('这一拍是人物口播，请选 A-roll。'), { status: 400 });
  }
  const production = getProduction(meta.id);
  const entry = production.beats?.[beatId];
  if (mode === 'aroll' && !entry?.baseAsset && !entry?.asset) {
    throw Object.assign(new Error('请先上传这一拍的无动效 Base 人物视频，再生成 A-roll 指令。'), { status: 400 });
  }
  const baseAsset = entry?.baseAsset || entry?.asset;
  const clip = {
    hasVideoClip: Boolean(baseAsset),
    duration: Number(entry?.baseAssetDuration || entry?.assetDuration || entry?.segmentDuration || beat.estSeconds || 0),
  };
  const settings = loadSettings();
  const resolved = resolveModel(settings, 'motion');
  if (!resolved.provider?.apiKey) {
    throw Object.assign(new Error('请先在设置里配置 AROLL / BROLL 指令模型（Claude 或 DeepSeek）。'), { status: 400 });
  }
  const result = await generateMotionBrief({
    meta,
    beat,
    mode,
    settings,
    provider: resolved.provider,
    model: resolved.model,
    clip,
    cardSpec: entry?.spec || null,
    cardPrompt: entry?.prompt || '',
  });
  res.json({
    ok: true,
    brief: result.brief,
    briefs: result.briefs,
    usage: result.usage,
    model: `${resolved.provider.name} · ${resolved.model}`,
    fallback: Boolean(resolved.fallback),
  });
}));

app.get('/api/jobs/:id/briefs', asyncRoute(async (req, res) => {
  const meta = readMeta(req.params.id);
  res.json({ briefs: readBriefs(meta.id) });
}));

app.post('/api/jobs/:id/briefs', asyncRoute(async (req, res) => {
  const meta = readMeta(req.params.id);
  const { xml, filename = '', beatId = null } = req.body || {};
  if (!xml) throw Object.assign(new Error('请上传或粘贴剪辑指令 XML。'), { status: 400 });
  const english = getEnglish(meta.id);
  const result = addBrief(meta.id, { xml, filename, beatId, beats: english.beats || [] });
  res.status(201).json(result);
}));

app.patch('/api/jobs/:id/briefs/:briefId', asyncRoute(async (req, res) => {
  const meta = readMeta(req.params.id);
  const result = updateBrief(meta.id, req.params.briefId, req.body || {});
  res.json(result);
}));

app.delete('/api/jobs/:id/briefs/:briefId', asyncRoute(async (req, res) => {
  const meta = readMeta(req.params.id);
  const result = deleteBrief(meta.id, req.params.briefId);
  res.json(result);
}));

app.patch('/api/jobs/:id', asyncRoute(async (req, res) => {
  const meta = readMeta(req.params.id);
  if (typeof req.body?.title === 'string' && req.body.title.trim()) {
    meta.title = req.body.title.trim().slice(0, 100);
  }
  writeMeta(meta);
  res.json({ job: meta });
}));

app.delete('/api/jobs/:id', asyncRoute(async (req, res) => {
  const meta = readMeta(req.params.id);
  if (isRunning(meta.id)) cancelJob(meta.id);
  deleteJob(meta.id);
  res.json({ ok: true });
}));

app.post('/api/jobs/:id/run', asyncRoute(async (req, res) => {
  const meta = readMeta(req.params.id);
  const steps = Array.isArray(req.body?.steps) && req.body.steps.length
    ? req.body.steps
    : ['asr', 'translate', 'copy', 'english'];
  for (const step of steps) {
    if (!['asr', 'translate', 'copy', 'english'].includes(step)) {
      throw Object.assign(new Error(`未知步骤：${step}`), { status: 400 });
    }
  }
  if (isRunning(meta.id)) throw Object.assign(new Error('这个任务正在处理中。'), { status: 409 });
  if (!meta.source.hasAudio) throw Object.assign(new Error('这个视频没有音轨。'), { status: 400 });
  const overrides = {
    providerId: req.body?.providerId,
    model: req.body?.model,
    temperature: req.body?.temperature,
  };
  runJob(meta.id, steps, overrides).catch((error) => {
    console.error('[job]', meta.id, error);
  });
  res.status(202).json({ ok: true, steps, job: readMeta(meta.id) });
}));

app.post('/api/jobs/:id/cancel', asyncRoute(async (req, res) => {
  const cancelled = cancelJob(req.params.id);
  res.json({ ok: true, cancelled });
}));

app.patch('/api/jobs/:id/transcript', asyncRoute(async (req, res) => {
  const meta = readMeta(req.params.id);
  const transcript = getTranscript(meta.id);
  const incoming = req.body?.segments;
  if (!Array.isArray(incoming)) throw Object.assign(new Error('缺少 segments。'), { status: 400 });
  const map = new Map(incoming.filter((s) => s && s.id).map((s) => [String(s.id), s]));
  for (const segment of transcript.segments) {
    const patch = map.get(segment.id);
    if (!patch) continue;
    if (typeof patch.zh === 'string') segment.zh = patch.zh.slice(0, 2000);
    if (typeof patch.text === 'string') segment.text = patch.text.slice(0, 4000);
  }
  transcript.updatedAt = new Date().toISOString();
  saveTranscript(meta.id, transcript);
  res.json({ ok: true, updated: map.size });
}));

app.patch('/api/jobs/:id/english', asyncRoute(async (req, res) => {
  const meta = readMeta(req.params.id);
  const english = getEnglish(meta.id);
  const copy = getCopy(meta.id);
  const incoming = req.body?.beats;
  if (!Array.isArray(incoming)) {
    throw Object.assign(new Error('缺少 beats。'), { status: 400 });
  }
  const allowed = (copy.blocks || []).map((block) => block.id);
  const { beats } = normalizeBeats({ beats: incoming }, allowed, { splitLong: false });
  english.beats = beats;
  english.stats = computeStats(beats);
  english.editedAt = new Date().toISOString();
  if (!english.generatedAt) english.generatedAt = english.editedAt;
  saveEnglish(meta.id, english);
  try {
    writeEnglishWorkingFiles(meta, copy.blocks, beats);
  } catch (error) {
    console.warn('[english] working files:', error.message);
  }
  writeMeta(meta);
  res.json({ english });
}));

app.patch('/api/jobs/:id/copy', asyncRoute(async (req, res) => {
  const meta = readMeta(req.params.id);
  const transcript = getTranscript(meta.id);
  const copy = getCopy(meta.id);
  const index = new Map(transcript.segments.map((s) => [s.id, s]));
  const incoming = req.body?.blocks;
  if (!Array.isArray(incoming)) throw Object.assign(new Error('缺少 blocks。'), { status: 400 });
  copy.blocks = incoming
    .filter((b) => b && typeof b.copy === 'string')
    .map((b) => {
      const startSeg = index.get(String(b.startId)) || index.get(String(b.endId));
      const endSeg = index.get(String(b.endId)) || startSeg;
      const chars = b.copy.replace(/\s/g, '').length;
      return {
        id: b.id || `b${Math.random().toString(36).slice(2, 7)}`,
        title: String(b.title || '未命名段落').slice(0, 60),
        startId: startSeg?.id || '',
        endId: endSeg?.id || '',
        start: startSeg?.start || 0,
        end: endSeg?.end || 0,
        copy: b.copy.slice(0, 20000),
        summary: String(b.summary || '').slice(0, 300),
        screenText: String(b.screenText || '').slice(0, 60),
        chars,
        estSeconds: Math.round((chars / 4.2) * 10) / 10,
      };
    })
    .sort((a, b) => a.start - b.start)
    .map((block, i) => ({ ...block, id: `b${i + 1}` }));
  saveCopy(meta.id, copy);
  res.json({ ok: true, copy });
}));

app.post('/api/jobs/:id/revise', asyncRoute(async (req, res) => {
  const meta = readMeta(req.params.id);
  const { blockId, text, instruction, providerId, model } = req.body || {};
  if (!instruction || !String(instruction).trim()) {
    throw Object.assign(new Error('请填写改写要求。'), { status: 400 });
  }
  let source = typeof text === 'string' ? text : '';
  if (!source && blockId) {
    const copy = getCopy(meta.id);
    source = copy.blocks.find((b) => b.id === blockId)?.copy || '';
  }
  if (!source) throw Object.assign(new Error('没有可改写的文本。'), { status: 400 });
  const result = await reviseText({
    text: source.slice(0, 20000),
    instruction: String(instruction).slice(0, 1000),
    providerId,
    model,
  });
  meta.usage.calls += 1;
  meta.usage.promptTokens += result.usage?.prompt_tokens || 0;
  meta.usage.completionTokens += result.usage?.completion_tokens || 0;
  writeMeta(meta);
  res.json(result);
}));

app.get('/api/jobs/:id/export/bundle', asyncRoute(async (req, res) => {
  const result = buildDeliveryBundle(req.params.id);
  res.download(result.file, result.filename);
}));

app.get('/api/jobs/:id/export/:type', asyncRoute(async (req, res) => {
  const result = buildExport(req.params.id, req.params.type);
  const download = String(req.query.download || '') === '1';
  res.setHeader('Content-Type', result.contentType);
  res.setHeader('Content-Disposition', contentDisposition(result.filename, download));
  res.setHeader('Cache-Control', 'no-store');
  res.send(result.content);
}));

app.get('/api/jobs/:id/preview/:type', asyncRoute(async (req, res) => {
  const result = buildExport(req.params.id, req.params.type);
  res.json({ filename: result.filename, content: result.content });
}));

/* --------------------------------------------------------------- production */

function streamVideoFile(req, res, file) {
  if (!file || !fs.existsSync(file)) {
    res.status(404).json({ error: '找不到视频文件。' });
    return;
  }
  const stat = fs.statSync(file);
  const ext = path.extname(file).toLowerCase();
  const type = MIME[ext] || 'video/mp4';
  const range = req.headers.range;
  if (!range) {
    res.writeHead(200, {
      'Content-Type': type,
      'Content-Length': stat.size,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-cache',
    });
    fs.createReadStream(file).pipe(res);
    return;
  }
  const match = /bytes=(\d*)-(\d*)/.exec(range);
  if (!match) {
    res.status(416).setHeader('Content-Range', `bytes */${stat.size}`).end();
    return;
  }
  let start = match[1] ? Number(match[1]) : 0;
  let end = match[2] ? Number(match[2]) : stat.size - 1;
  if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= stat.size) {
    res.status(416).setHeader('Content-Range', `bytes */${stat.size}`).end();
    return;
  }
  end = Math.min(end, stat.size - 1);
  res.writeHead(206, {
    'Content-Type': type,
    'Content-Range': `bytes ${start}-${end}/${stat.size}`,
    'Accept-Ranges': 'bytes',
    'Content-Length': end - start + 1,
    'Cache-Control': 'no-cache',
  });
  fs.createReadStream(file, { start, end }).pipe(res);
}

app.post('/api/jobs/:id/production/generate', asyncRoute(async (req, res) => {
  const meta = readMeta(req.params.id);
  const english = getEnglish(meta.id);
  if (!english.beats?.length) throw Object.assign(new Error('请先生成英文分镜。'), { status: 400 });
  const settings = loadSettings();
  const resolved = resolveModel(settings, 'production', {
    providerId: req.body?.providerId,
    model: req.body?.model,
  });
  if (!resolved.provider?.apiKey) {
    throw Object.assign(
      new Error(`请先在设置里填写 ${resolved.provider?.name || '制作模型'} 的 API Key。`),
      { status: 400 },
    );
  }
  const mode = ['auto', 'prompt', 'video', 'base'].includes(req.body?.mode) ? req.body.mode : 'auto';
  const beatIds = Array.isArray(req.body?.beatIds) && req.body.beatIds.length
    ? req.body.beatIds.filter((id) => english.beats.some((beat) => beat.id === id))
    : english.beats.map((beat) => beat.id);
  if (!beatIds.length) throw Object.assign(new Error('没有选中的分镜。'), { status: 400 });
  if (isProductionRunning(meta.id)) {
    throw Object.assign(new Error('这个项目正在制作中。'), { status: 409 });
  }
  startGenerate(
    meta,
    english,
    beatIds,
    settings,
    resolved.provider,
    resolved.model,
    () => {},
    (error) => console.error('[production]', meta.id, error),
    mode,
  );
  res.status(202).json({ ok: true, beatIds, mode, running: true });
}));

app.post('/api/jobs/:id/production/render', asyncRoute(async (req, res) => {
  const meta = readMeta(req.params.id);
  const english = getEnglish(meta.id);
  if (!english.beats?.length) throw Object.assign(new Error('请先生成英文分镜。'), { status: 400 });
  const settings = loadSettings();
  const subtitles =
    req.body?.subtitles !== undefined ? Boolean(req.body.subtitles) : settings.output?.subtitles !== false;
  if (isProductionRunning(meta.id)) {
    throw Object.assign(new Error('这个项目正在制作中。'), { status: 409 });
  }
  startRender(
    meta,
    english,
    settings,
    subtitles,
    () => {},
    (error) => console.error('[render]', meta.id, error),
  );
  res.status(202).json({ ok: true, subtitles, running: true });
}));

app.post('/api/jobs/:id/production/cancel', asyncRoute(async (req, res) => {
  res.json({ ok: true, cancelled: cancelProduction(req.params.id) });
}));

app.post('/api/jobs/:id/production/upload', (req, res, next) => {
  upload.single('asset')(req, res, async (error) => {
    if (error) {
      if (req.file?.path) fs.rmSync(req.file.path, { force: true });
      return next(error);
    }
    try {
      const beatId = String(req.body?.beatId || '');
      if (!beatId || !req.file) throw Object.assign(new Error('缺少 beatId 或文件。'), { status: 400 });
      const meta = readMeta(req.params.id);
      const english = getEnglish(meta.id);
      const result = await saveUploadedAsset(
        meta,
        english,
        beatId,
        req.file.path,
        decodeUploadName(req.file.originalname),
        String(req.body?.kind || 'asset'),
      );
      res.json({ ok: true, production: productionPublic(meta, english), entry: result.entry });
    } catch (err) {
      if (req.file?.path) fs.rmSync(req.file.path, { force: true });
      next(err);
    }
  });
});

app.patch('/api/jobs/:id/production/prompt/:beatId', asyncRoute(async (req, res) => {
  const meta = readMeta(req.params.id);
  const english = getEnglish(meta.id);
  const production = ensureProduction(meta, english);
  const entry = saveVideoPrompt(meta, production, req.params.beatId, req.body?.videoPrompt);
  res.json({ ok: true, production: productionPublic(meta, english), entry });
}));

app.post('/api/jobs/:id/production/reference', (req, res, next) => {
  imageUpload.single('reference')(req, res, async (error) => {
    if (error) {
      if (req.file?.path) fs.rmSync(req.file.path, { force: true });
      return next(error);
    }
    try {
      const beatId = String(req.body?.beatId || '');
      const kind = String(req.body?.kind || '');
      if (!beatId || !req.file) throw Object.assign(new Error('缺少 beatId 或参考图。'), { status: 400 });
      const meta = readMeta(req.params.id);
      const english = getEnglish(meta.id);
      const production = ensureProduction(meta, english);
      const entry = saveReference(meta, production, beatId, kind, req.file.path, decodeUploadName(req.file.originalname));
      res.json({ ok: true, production: productionPublic(meta, english), entry });
    } catch (err) {
      if (req.file?.path) fs.rmSync(req.file.path, { force: true });
      next(err);
    }
  });
});

app.post('/api/jobs/:id/production/ref-url', asyncRoute(async (req, res) => {
  const meta = readMeta(req.params.id);
  const english = getEnglish(meta.id);
  const production = ensureProduction(meta, english);
  const beatId = String(req.body?.beatId || '');
  const kind = String(req.body?.kind || '');
  const url = String(req.body?.url || '').trim();
  if (!['character', 'scene', 'face'].includes(kind)) {
    throw Object.assign(new Error('參考圖類型無效。'), { status: 400 });
  }
  if (url && !/^https?:\/\//i.test(url)) {
    throw Object.assign(new Error('請填寫 http(s) 公開圖片 URL。'), { status: 400 });
  }
  const entry = production.beats?.[beatId];
  if (!entry) throw Object.assign(new Error('找不到這一拍。'), { status: 404 });
  entry.refUrls = entry.refUrls || {};
  if (url) entry.refUrls[kind] = url;
  else delete entry.refUrls[kind];
  entry.updatedAt = new Date().toISOString();
  saveProduction(meta.id, production);
  res.json({ ok: true, production: productionPublic(meta, english), entry });
}));

app.delete('/api/jobs/:id/production/reference/:beatId/:kind', asyncRoute(async (req, res) => {
  const meta = readMeta(req.params.id);
  const english = getEnglish(meta.id);
  const production = ensureProduction(meta, english);
  const entry = deleteReference(meta, production, req.params.beatId, req.params.kind);
  res.json({ ok: true, production: productionPublic(meta, english), entry });
}));

app.get('/api/jobs/:id/production/reference/:beatId/:kind', asyncRoute(async (req, res) => {
  const meta = readMeta(req.params.id);
  const english = getEnglish(meta.id);
  const production = getProduction(meta.id);
  const file = getReferenceFile(meta, production, req.params.beatId, req.params.kind);
  if (!file) throw Object.assign(new Error('这一拍还没有这张参考图。'), { status: 404 });
  res.setHeader('Cache-Control', 'no-store');
  res.sendFile(file);
}));

app.get('/api/jobs/:id/production/asset/:beatId', asyncRoute(async (req, res) => {
  const meta = readMeta(req.params.id);
  const english = getEnglish(meta.id);
  const production = productionPublic(meta, english);
  const file = getAssetFile(meta, production, req.params.beatId);
  if (!file) throw Object.assign(new Error('这一拍还没有素材。'), { status: 404 });
  streamVideoFile(req, res, file);
}));

app.post('/api/jobs/:id/production/opus/:beatId', asyncRoute(async (req, res) => {
  const meta = readMeta(req.params.id);
  const english = getEnglish(meta.id);
  if (!english.beats?.length) throw Object.assign(new Error('请先生成英文分镜。'), { status: 400 });
  const settings = loadSettings();
  const resolved = resolveModel(settings, 'opus');
  if (!resolved.provider?.apiKey) {
    throw Object.assign(new Error('请先在设定配置 Opus 5.5 的 API Key。'), { status: 400 });
  }
  if (isProductionRunning(meta.id)) {
    throw Object.assign(new Error('这个项目正在制作中。'), { status: 409 });
  }
  const beatId = String(req.params.beatId || '');
  const beat = (english.beats || []).find((item) => item.id === beatId);
  if (!beat) throw Object.assign(new Error('找不到这一拍。'), { status: 404 });
  if (beat.type === '人物口播') {
    startOpusPersonVideo(meta, english, beatId, resolved.provider, resolved.model, () => {}, () => {});
  } else {
    startOpusVideo(meta, english, beatId, resolved.provider, resolved.model, () => {}, () => {});
  }
  res.status(202).json({ ok: true, beatId, model: `${resolved.provider.name} · ${resolved.model}` });
}));

app.post('/api/jobs/:id/production/approve/:beatId', asyncRoute(async (req, res) => {
  const meta = readMeta(req.params.id);
  const english = getEnglish(meta.id);
  const production = ensureProduction(meta, english);
  const entry = production.beats?.[req.params.beatId];
  if (!entry) throw Object.assign(new Error('找不到這一拍。'), { status: 404 });
  const approved = Boolean(req.body?.approved);
  if (approved && !entry.asset && !entry.baseAsset) {
    throw Object.assign(new Error('這一拍還沒有可通過的影片。'), { status: 400 });
  }
  entry.approved = approved;
  entry.approvedAt = approved ? new Date().toISOString() : '';
  entry.updatedAt = new Date().toISOString();
  saveProduction(meta.id, production);
  res.json({ ok: true, production: productionPublic(meta, english), entry });
}));

app.get('/api/jobs/:id/production/base/:beatId', asyncRoute(async (req, res) => {
  const meta = readMeta(req.params.id);
  const english = getEnglish(meta.id);
  const production = getProduction(meta.id);
  const entry = production.beats?.[req.params.beatId];
  if (!entry?.baseAsset) throw Object.assign(new Error('这一拍还没有 Base 视频。'), { status: 404 });
  const file = path.join(jobDir(meta.id), 'production', entry.baseAsset);
  if (!fs.existsSync(file)) throw Object.assign(new Error('Base 视频文件不存在。'), { status: 404 });
  streamVideoFile(req, res, file);
}));

app.get('/api/jobs/:id/production/final', asyncRoute(async (req, res) => {
  const meta = readMeta(req.params.id);
  const english = getEnglish(meta.id);
  const production = getProduction(meta.id);
  if (!production.final?.file) throw Object.assign(new Error('还没有成片。'), { status: 404 });
  const file = path.join(jobDir(meta.id), 'production', production.final.file);
  streamVideoFile(req, res, file);
}));

/* --------------------------------------------------------------------- media */

app.get('/api/media/:id', asyncRoute(async (req, res) => {
  const meta = readMeta(req.params.id);
  const file = mediaPath(meta);
  if (!fs.existsSync(file)) throw Object.assign(new Error('找不到视频文件。'), { status: 404 });
  const stat = fs.statSync(file);
  const ext = path.extname(file).toLowerCase();
  const type = MIME[ext] || 'application/octet-stream';
  const range = req.headers.range;

  if (!range) {
    res.writeHead(200, {
      'Content-Type': type,
      'Content-Length': stat.size,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-cache',
    });
    fs.createReadStream(file).pipe(res);
    return;
  }

  const match = /bytes=(\d*)-(\d*)/.exec(range);
  if (!match) {
    res.status(416).setHeader('Content-Range', `bytes */${stat.size}`).end();
    return;
  }
  let start = match[1] ? Number(match[1]) : 0;
  let end = match[2] ? Number(match[2]) : stat.size - 1;
  if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= stat.size) {
    res.status(416).setHeader('Content-Range', `bytes */${stat.size}`).end();
    return;
  }
  end = Math.min(end, stat.size - 1);
  res.writeHead(206, {
    'Content-Type': type,
    'Content-Range': `bytes ${start}-${end}/${stat.size}`,
    'Accept-Ranges': 'bytes',
    'Content-Length': end - start + 1,
    'Cache-Control': 'no-cache',
  });
  fs.createReadStream(file, { start, end }).pipe(res);
}));

/* -------------------------------------------------------------------- static */

app.use(express.static(PUBLIC_DIR, { extensions: ['html'] }));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  const status = error.status || (error.code === 'LIMIT_FILE_SIZE' ? 413 : 500);
  const message =
    error.code === 'LIMIT_FILE_SIZE' ? '文件太大（上限 4GB）。' : error.message || '服务器错误';
  if (status >= 500) console.error('[api]', req.method, req.originalUrl, error);
  res.status(status).json({ error: message });
});

if (!fs.existsSync(SETTINGS_PATH)) saveSettings(loadSettings());

cleanupTmp();
const server = app.listen(PORT, HOST, () => {
  console.log(`\n  课程视频工作台  http://${HOST}:${PORT}\n`);
  console.log(`  数据目录：${path.join(ROOT, 'data')}`);
  console.log(`  当前时间：${new Date().toLocaleString('zh-CN')}\n`);
});
server.requestTimeout = 0;
server.headersTimeout = 120000;
