import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { JOBS_DIR, TMP_DIR } from './config.mjs';

const STEP_NAMES = ['asr', 'translate', 'copy', 'english'];

function newStep() {
  return { state: 'idle', pct: 0, message: '', error: '', startedAt: null, finishedAt: null };
}

function iso() {
  return new Date().toISOString();
}

export function makeId() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  return `${stamp}-${crypto.randomBytes(2).toString('hex')}`;
}

export function jobDir(id) {
  if (!/^[a-zA-Z0-9-]+$/.test(id)) throw new Error('非法任务 ID');
  return path.join(JOBS_DIR, id);
}

function writeJsonAtomic(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 1));
  fs.renameSync(tmp, file);
}

export function ensureJobDirs(id) {
  const dir = jobDir(id);
  for (const sub of ['', 'exports', 'logs']) fs.mkdirSync(path.join(dir, sub), { recursive: true });
  return dir;
}

export function readMeta(id) {
  const file = path.join(jobDir(id), 'meta.json');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function writeMeta(meta) {
  meta.updatedAt = iso();
  writeJsonAtomic(path.join(jobDir(meta.id), 'meta.json'), meta);
  return meta;
}

export function listJobs() {
  const entries = fs.readdirSync(JOBS_DIR, { withFileTypes: true }).filter((e) => e.isDirectory());
  const jobs = [];
  for (const entry of entries) {
    try {
      const meta = readMeta(entry.name);
      jobs.push(meta);
    } catch {
      /* ignore broken jobs */
    }
  }
  return jobs.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

export function createJob({ tmpPath, originalName, size }) {
  const id = makeId();
  const dir = ensureJobDirs(id);
  const ext = (path.extname(originalName) || '.mp4').toLowerCase();
  const sourceName = `source${ext}`;
  const dest = path.join(dir, sourceName);
  try {
    fs.renameSync(tmpPath, dest);
  } catch {
    fs.copyFileSync(tmpPath, dest);
    fs.unlinkSync(tmpPath);
  }
  const title = path
    .basename(originalName, path.extname(originalName))
    .replace(/[_-]+/g, ' ')
    .trim()
    .slice(0, 80) || '未命名课程';

  const meta = {
    id,
    title,
    createdAt: iso(),
    updatedAt: iso(),
    source: {
      filename: originalName,
      storedName: sourceName,
      size,
      duration: 0,
      width: 0,
      height: 0,
      fps: 0,
      hasAudio: true,
    },
    steps: Object.fromEntries(STEP_NAMES.map((name) => [name, newStep()])),
    models: { asr: '', translate: '', copy: '' },
    usage: { calls: 0, promptTokens: 0, completionTokens: 0 },
    logs: [],
    lastError: '',
  };
  writeMeta(meta);
  return meta;
}

export function getTranscript(id) {
  const file = path.join(jobDir(id), 'transcript.json');
  if (!fs.existsSync(file)) return { segments: [] };
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function saveTranscript(id, transcript) {
  const dir = ensureJobDirs(id);
  writeJsonAtomic(path.join(dir, 'transcript.json'), transcript);
}

export function getCopy(id) {
  const file = path.join(jobDir(id), 'copy.json');
  if (!fs.existsSync(file)) return { blocks: [] };
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function saveCopy(id, copy) {
  const dir = ensureJobDirs(id);
  writeJsonAtomic(path.join(dir, 'copy.json'), copy);
}

export function getEnglish(id) {
  const file = path.join(jobDir(id), 'english.json');
  if (!fs.existsSync(file)) return { beats: [], stats: null };
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function saveEnglish(id, data) {
  const dir = ensureJobDirs(id);
  writeJsonAtomic(path.join(dir, 'english.json'), data);
}

export function clearEnglish(id) {
  const dir = jobDir(id);
  fs.rmSync(path.join(dir, 'english.json'), { force: true });
  fs.rmSync(path.join(dir, 'english'), { recursive: true, force: true });
}

export function getAsr(id) {
  const file = path.join(jobDir(id), 'asr.json');
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function mediaPath(meta) {
  return path.join(jobDir(meta.id), meta.source.storedName || 'source.mp4');
}

export function deleteJob(id) {
  fs.rmSync(jobDir(id), { recursive: true, force: true });
}

export function addLog(meta, message, level = 'info') {
  const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  meta.logs = meta.logs || [];
  meta.logs.push({ t: time, level, message: String(message).slice(0, 500) });
  if (meta.logs.length > 300) meta.logs = meta.logs.slice(-300);
  meta.updatedAt = iso();
}

export function resetStep(meta, name) {
  meta.steps[name] = newStep();
}

export function setStep(meta, name, patch) {
  const step = meta.steps[name] || (meta.steps[name] = newStep());
  Object.assign(step, patch);
}

export function cleanupTmp(maxAgeHours = 12) {
  try {
    const cutoff = Date.now() - maxAgeHours * 3600 * 1000;
    for (const name of fs.readdirSync(TMP_DIR)) {
      const file = path.join(TMP_DIR, name);
      const stat = fs.statSync(file);
      if (stat.mtimeMs < cutoff) fs.rmSync(file, { force: true });
    }
  } catch {
    /* ignore */
  }
}
