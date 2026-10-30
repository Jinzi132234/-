import fs from 'node:fs';
import path from 'node:path';

import { jobDir } from './jobs.mjs';

const FILE = 'briefs.json';
const MAX_XML = 200_000;

const text = (value = '') => String(value).replace(/\r\n/g, '\n').trim();

function section(xml, name) {
  const match = xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, 'i'));
  return text(match?.[1] || '');
}

function parseTime(value) {
  const raw = String(value || '').trim();
  if (!raw) return 0;
  const parts = raw.split(':').map(Number);
  if (parts.some((part) => Number.isNaN(part))) return 0;
  return parts.reduce((total, part) => total * 60 + part, 0);
}

function parseTimed(script) {
  const rows = [];
  for (const line of script.split('\n')) {
    const match = line.trim().match(/^(\d+(?::\d+)?(?:\.\d+)?)\s*[–—−-]\s*(\d+(?::\d+)?(?:\.\d+)?)\s+(.+)$/);
    if (!match) continue;
    rows.push({ start: parseTime(match[1]), end: parseTime(match[2]), text: text(match[3]) });
  }
  return rows;
}

function parseEdit(edit) {
  const rows = [];
  for (const line of edit.split('\n')) {
    const match = line.trim().match(/^Beat\s+([A-Z])\s*·\s*(\d+(?::\d+)?(?:\.\d+)?)\s*[–—−-]\s*(\d+(?::\d+)?(?:\.\d+)?)\s*·\s*(.+)$/i);
    if (!match) continue;
    const parts = match[4].split('·').map((part) => text(part)).filter(Boolean);
    rows.push({
      label: match[1].toUpperCase(),
      start: parseTime(match[2]),
      end: parseTime(match[3]),
      stage: parts[0] || '',
      elements: parts.slice(1).join(' · '),
    });
  }
  return rows;
}

function plateCodes(role = '') {
  const line = String(role)
    .split('\n')
    .find((item) => /NEW this cut/i.test(item)) || '';
  return [...new Set(line.match(/\b[M|I|E]\d{1,4}\b/g) || [])];
}

export function parseBriefXml(xml, filename = '') {
  let raw = text(xml);
  if (raw && /<role\b/i.test(raw) && !/<\/role>/i.test(raw)) {
    raw = raw.replace(/(<source\b)/i, '</role>\n$1');
  }
  if (!raw) throw Object.assign(new Error('剪輯指令是空的。'), { status: 400 });
  if (raw.length > MAX_XML) throw Object.assign(new Error('剪輯指令檔案太大。'), { status: 413 });
  if (!/<role>|<source>|<edit>/i.test(raw)) {
    throw Object.assign(new Error('這不是可辨識的剪輯指令 XML（缺少 role/source/edit）。'), { status: 400 });
  }

  const role = section(raw, 'role');
  const source = section(raw, 'source');
  const script = section(raw, 'script_timed');
  const edit = section(raw, 'edit');
  const plateMatch = role.match(/Plate\s+(\d+)/i) || filename.match(/plate[-_ ]?(\d+)/i);
  const partMatch = role.match(/PART\s+([\d/]+)/i);
  const voMatch =
    source.match(/Authoritative VO[^:\n]*:\s*[“"]([\s\S]*?)[”"]/i) ||
    source.match(/VO\s*\(verbatim\)[^:\n]*:\s*[“"]([\s\S]*?)[”"]/i);
  const onScreenMatch = source.match(/On-screen[^:\n]*:\s*([^\n]+(?:\n(?!\n)[^\n]+)*)/i);
  const title = role.split('\n').map((line) => text(line)).find(Boolean) || filename;

  return {
    plate: plateMatch ? Number(plateMatch[1]) : null,
    part: partMatch ? partMatch[1] : '',
    title: title.slice(0, 240),
    filename: text(filename).slice(0, 200),
    vo: voMatch ? text(voMatch[1]) : '',
    onScreen: onScreenMatch ? text(onScreenMatch[1]) : '',
    timed: parseTimed(script),
    edit: parseEdit(edit),
    role,
    source,
    script,
    stitch: section(raw, 'stitch'),
    style: section(raw, 'style_lock'),
    icons: section(raw, 'icons'),
    ending: section(raw, 'end'),
    banned: section(raw, 'banned'),
    selfCheck: section(raw, 'self_check'),
    deliver: section(raw, 'deliver'),
    raw,
  };
}

function filePath(jobId) {
  return path.join(jobDir(jobId), FILE);
}

export function readBriefs(jobId) {
  const file = filePath(jobId);
  if (!fs.existsSync(file)) return [];
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(data?.briefs) ? data.briefs : [];
  } catch {
    return [];
  }
}

function writeBriefs(jobId, briefs) {
  fs.mkdirSync(jobDir(jobId), { recursive: true });
  fs.writeFileSync(filePath(jobId), JSON.stringify({ briefs }, null, 2));
}

function firstHeading(md = '') {
  const lines = String(md).split('\n');
  const heading = lines.find((line) => /^#{1,3}\s+\S/.test(line.trim()));
  if (heading) return heading.replace(/^#+\s*/, '').trim();
  const shot = String(md).match(/【镜头】\s*([^\n]+)/);
  if (shot) return shot[1].trim();
  return lines.map((line) => line.trim()).find(Boolean) || 'A-roll 指示词';
}

/** A-roll 指示词 is plain Markdown (see skills/aroll-motion-prompts/SKILL.md), not XML. */
export function parseMarkdownBrief(md, filename = '') {
  const raw = text(md);
  if (!raw) throw Object.assign(new Error('A-roll 指示词是空的。'), { status: 400 });
  if (raw.length > MAX_XML) throw Object.assign(new Error('A-roll 指示词太大。'), { status: 413 });
  const plateMatch = String(filename || '').match(/(?:plate|aroll)[-_ ]?(\d+)/i);
  return {
    format: 'md',
    plate: plateMatch ? Number(plateMatch[1]) : null,
    part: '',
    title: firstHeading(raw).slice(0, 240),
    filename: text(filename).slice(0, 200),
    vo: '',
    onScreen: '',
    timed: [],
    edit: [],
    role: '',
    source: '',
    script: '',
    stitch: '',
    style: '',
    icons: '',
    ending: '',
    banned: '',
    selfCheck: '',
    deliver: '',
    raw,
  };
}


function words(value = '') {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 2);
}

function similarity(a, b) {
  const left = new Set(words(a));
  const right = new Set(words(b));
  if (!left.size || !right.size) return 0;
  let overlap = 0;
  for (const word of left) if (right.has(word)) overlap += 1;
  const jaccard = overlap / (left.size + right.size - overlap);
  const short = String(a || '').toLowerCase().trim().slice(0, 60);
  const exact = short.length > 12 && String(b || '').toLowerCase().includes(short);
  return exact ? Math.max(jaccard, 0.9) : jaccard;
}

export function matchBeatForBrief(vo, beats = [], usedBeatIds = new Set()) {
  let best = null;
  for (const beat of beats) {
    if (!beat?.id || usedBeatIds.has(beat.id)) continue;
    const score = similarity(vo, beat.vo);
    if (!best || score > best.score) best = { beat, score };
  }
  return best && best.score >= 0.22 ? best : null;
}

export function addBrief(jobId, { xml, filename = '', beatId = null, beats = [], format = 'xml' } = {}) {
  const parsed = format === 'md' ? parseMarkdownBrief(xml, filename) : parseBriefXml(xml, filename);
  const briefs = readBriefs(jobId);
  const samePlate = briefs.find((brief) => brief.plate === parsed.plate && brief.beatId);
  let resolvedBeatId = beatId || samePlate?.beatId || null;
  let autoMatched = false;
  if (!resolvedBeatId && parsed.vo && beats.length) {
    const used = new Set(briefs.map((brief) => brief.beatId).filter(Boolean));
    const match = matchBeatForBrief(parsed.vo, beats, used);
    if (match) {
      resolvedBeatId = match.beat.id;
      autoMatched = true;
    }
  }
  const id = parsed.plate
    ? `plate-${parsed.plate}${resolvedBeatId ? `-${resolvedBeatId}` : ''}`
    : `brief-${Date.now()}`;
  const existing = briefs.find((brief) => brief.id === id);
  const brief = {
    ...parsed,
    codes: plateCodes(parsed.role),
    id,
    beatId: resolvedBeatId,
    autoMatched,
    importedAt: new Date().toISOString(),
  };
  const next = briefs.filter((item) => item.id !== id);
  next.unshift(brief);
  writeBriefs(jobId, next);
  return { brief, briefs: next, autoMatched };
}

/** 分鏡重生成後，掛在該拍上的指示詞就不再有對應關係了；標記而不是刪除。 */
export function markBriefStale(jobId, beatId, reason = '') {
  const briefs = readBriefs(jobId);
  let changed = 0;
  const next = briefs.map((brief) => {
    if (brief.beatId !== beatId || brief.stale) return brief;
    changed += 1;
    return { ...brief, stale: true, staleReason: reason, staleAt: new Date().toISOString() };
  });
  if (changed) writeBriefs(jobId, next);
  return changed;
}

export function updateBrief(jobId, briefId, patch = {}) {
  const briefs = readBriefs(jobId);
  const brief = briefs.find((item) => item.id === briefId);
  if (!brief) throw Object.assign(new Error('找不到這個剪輯指令。'), { status: 404 });
  if (patch.beatId !== undefined) {
    brief.beatId = patch.beatId ? String(patch.beatId) : null;
    brief.autoMatched = false;
  }
  if (patch.notes !== undefined) brief.notes = String(patch.notes || '').slice(0, 4000);
  brief.updatedAt = new Date().toISOString();
  writeBriefs(jobId, briefs);
  return { brief, briefs };
}

export function deleteBrief(jobId, briefId) {
  const briefs = readBriefs(jobId);
  const next = briefs.filter((item) => item.id !== briefId);
  if (next.length === briefs.length) throw Object.assign(new Error('找不到這個剪輯指令。'), { status: 404 });
  writeBriefs(jobId, next);
  return { briefs: next };
}
