import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import ffmpegPath from 'ffmpeg-static';

import { getCopy, getEnglish, getTranscript, jobDir, readMeta } from './jobs.mjs';
import { getProduction, productionDir } from './production.mjs';
import { buildCopyMarkdown, buildSrt, clock, safeFilename } from './exports.mjs';
import { buildVoTable } from './english.mjs';

function pad(n, width = 2) {
  return String(n).padStart(width, '0');
}

function dateStamp() {
  const d = new Date();
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

function asciiSlug(name, fallback = 'course-video') {
  const ascii = String(name || '')
    .normalize('NFKD')
    .replace(/[^\x20-\x7E]/g, ' ')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 48);
  return ascii || fallback;
}

function csvCell(value) {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function csv(rows) {
  return rows.map((row) => row.map(csvCell).join(',')).join('\n') + '\n';
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function shotType(type) {
  return type === 'B字卡' ? 'Broll' : type;
}

function videoFragment(row) {
  return `video/final.mp4#t=${Number(row.start || 0).toFixed(2)},${Number(row.end || 0).toFixed(2)}`;
}

function buildShotTableHtml(meta, timeline, clips) {
  const rows = timeline.map((row) => {
    const clip = clips.get(row.beatId);
    const video = clip
      ? `<video class="clip" controls preload="metadata" src="${escapeHtml(clip)}"></video>`
      : `<a class="final-link" href="${escapeHtml(videoFragment(row))}">播放 final ${clock(row.start)}–${clock(row.end)}</a>`;
    return `<tr id="beat-${escapeHtml(row.beatId)}">
      <td class="num">${String(row.index).padStart(2, '0')}</td>
      <td><span class="type">${escapeHtml(shotType(row.type))}</span></td>
      <td class="vo">${escapeHtml(row.vo)}</td>
      <td class="visual">${escapeHtml(row.visual)}<div class="time">${clock(row.start)}–${clock(row.end)}</div></td>
      <td class="video">${video}</td>
    </tr>`;
  }).join('\n');
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(meta.title)} · 分鏡交付表</title>
<style>
  :root { --ink:#1f2329; --muted:#646a73; --line:#e5e6eb; --pale:#f7f8fa; --accent:#d97b4a; }
  * { box-sizing:border-box; }
  body { margin:0; background:#fff; color:var(--ink); font:14px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif; }
  .page { max-width:1440px; margin:0 auto; padding:32px 28px 48px; }
  h1 { font-size:24px; margin:0 0 6px; }
  .meta { color:var(--muted); font-size:12px; margin-bottom:18px; }
  .final-wrap { margin:0 0 22px; padding:12px; border:1px solid var(--line); border-radius:10px; background:var(--pale); }
  .final-wrap video { width:100%; max-height:420px; border-radius:8px; background:#000; display:block; }
  .final-label { color:var(--muted); font-size:11px; margin-bottom:8px; }
  table { width:100%; border-collapse:collapse; table-layout:fixed; }
  th { position:sticky; top:0; z-index:1; background:#fff; border-bottom:1px solid var(--line); color:var(--muted); font-size:11px; font-weight:600; text-align:left; padding:9px 8px; }
  td { border-bottom:1px solid var(--line); padding:10px 8px; vertical-align:top; }
  tbody tr:nth-child(even) { background:#fbfbfc; }
  th:nth-child(1), td:nth-child(1) { width:52px; }
  th:nth-child(2), td:nth-child(2) { width:72px; }
  th:nth-child(3), td:nth-child(3) { width:32%; }
  th:nth-child(4), td:nth-child(4) { width:30%; }
  th:nth-child(5), td:nth-child(5) { width:250px; }
  .num { color:var(--muted); font-variant-numeric:tabular-nums; }
  .type { display:inline-block; padding:2px 7px; border-radius:5px; background:#f2f3f5; font-size:11px; white-space:nowrap; }
  .vo { font-weight:500; }
  .visual { color:var(--muted); font-size:12px; }
  .time { margin-top:5px; color:#8f959e; font-size:10px; font-variant-numeric:tabular-nums; }
  .video .clip { width:100%; max-height:150px; border-radius:7px; background:#000; display:block; }
  .final-link { display:inline-block; color:var(--accent); font-size:11px; text-decoration:none; border:1px solid #f0d6c6; background:#fff8f3; border-radius:6px; padding:6px 8px; }
  .final-link:hover { text-decoration:underline; }
  .note { margin-top:16px; color:var(--muted); font-size:11px; line-height:1.7; }
  @media (max-width:820px) {
    .page { padding:18px 12px 32px; }
    table { table-layout:auto; }
    th:nth-child(4), td:nth-child(4) { display:none; }
    th:nth-child(5), td:nth-child(5) { width:180px; }
  }
</style>
</head>
<body>
<div class="page">
  <h1>${escapeHtml(meta.title)}</h1>
  <div class="meta">分鏡交付表 · ${timeline.length} 拍 · ${clock(timeline.at(-1)?.end || 0)} · 生成於 ${escapeHtml(new Date().toLocaleString('zh-CN'))}</div>
  <div class="final-wrap">
    <div class="final-label">完成影片</div>
    <video controls preload="metadata" src="video/final.mp4"></video>
  </div>
  <table>
    <thead><tr><th>序號</th><th>畫面類型</th><th>英文文案</th><th>畫面提示</th><th>對應視頻</th></tr></thead>
    <tbody>
${rows}
    </tbody>
  </table>
  <div class="note">
    每一拍的「對應視頻」若是獨立素材，可直接播放；沒有獨立素材的拍，點擊時間碼會跳到 final.mp4 的對應區間。<br />
    這個 HTML 可以直接用瀏覽器打開，也可以把表格複製到飛書文檔；飛書要直接播放影片時，請把 clips/ 內的影片上傳到飛書，再把連結貼進表格。
  </div>
</div>
</body>
</html>`;
}

function xmlEscape(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function docxParagraph(text, { bold = false, size = 18, color = '1F2329', align = '' } = {}) {
  const pPr = `<w:pPr>${align ? `<w:jc w:val="${align}"/>` : ''}<w:spacing w:before="0" w:after="80" w:line="240" w:lineRule="auto"/></w:pPr>`;
  const rPr = `<w:rPr>${bold ? '<w:b/>' : ''}<w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="PingFang SC"/><w:sz w:val="${size}"/><w:color w:val="${color}"/></w:rPr>`;
  return `<w:p>${pPr}<w:r>${rPr}<w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r></w:p>`;
}

function docxImageRun(relId, index) {
  const cx = 1905000;
  const cy = 1070625;
  return `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${index + 1}" name="shot-${index}"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${index + 1}" name="shot-${index}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${relId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
}

function docxCell(text, width, { bold = false, fill = '', imageRel = '', imageIndex = 0, size = 18, color = '1F2329' } = {}) {
  const fillXml = fill ? `<w:shd w:val="clear" w:color="auto" w:fill="${fill}"/>` : '';
  const image = imageRel ? `<w:p>${docxImageRun(imageRel, imageIndex)}</w:p>` : '';
  const body = image || docxParagraph(text, { bold, size, color });
  return `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>${fillXml}<w:vAlign w:val="top"/></w:tcPr>${body}</w:tc>`;
}

function buildShotDocx(meta, timeline, clips, thumbs, outFile) {
  const temp = `${outFile}.tmp-${Date.now()}`;
  const mediaDir = path.join(temp, 'word', 'media');
  fs.mkdirSync(mediaDir, { recursive: true });
  fs.mkdirSync(path.join(temp, '_rels'), { recursive: true });
  fs.mkdirSync(path.join(temp, 'word', '_rels'), { recursive: true });

  const rels = [];
  const rows = [];
  let imageIndex = 0;
  for (const row of timeline) {
    const clip = clips.get(row.beatId);
    const thumb = thumbs.get(row.beatId);
    let imageRel = '';
    let imageName = '';
    if (thumb && fs.existsSync(thumb)) {
      imageIndex += 1;
      imageName = `thumb-${pad(imageIndex, 2)}.jpg`;
      fs.copyFileSync(thumb, path.join(mediaDir, imageName));
      imageRel = `rId${20 + imageIndex}`;
      rels.push(`<Relationship Id="${imageRel}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${imageName}"/>`);
    }
    const videoText = clip ? path.basename(clip) : `final ${clock(row.start)}–${clock(row.end)}`;
    rows.push(`<w:tr>
      ${docxCell(String(row.index).padStart(2, '0'), 640, { color: '646A73' })}
      ${docxCell(shotType(row.type), 920)}
      ${docxCell(row.vo, 5600)}
      ${docxCell(row.visual, 4700, { color: '646A73', size: 17 })}
      <w:tc><w:tcPr><w:tcW w:w="3100" w:type="dxa"/><w:vAlign w:val="top"/></w:tcPr>${imageRel ? `<w:p>${docxImageRun(imageRel, imageIndex)}</w:p>` : ''}${docxParagraph(videoText, { size: 15, color: '646A73' })}</w:tc>
    </w:tr>`);
  }

  const table = `<w:tbl>
    <w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblLayout w:type="fixed"/><w:tblBorders>
      <w:top w:val="single" w:sz="4" w:space="0" w:color="E5E6EB"/>
      <w:left w:val="single" w:sz="4" w:space="0" w:color="E5E6EB"/>
      <w:bottom w:val="single" w:sz="4" w:space="0" w:color="E5E6EB"/>
      <w:right w:val="single" w:sz="4" w:space="0" w:color="E5E6EB"/>
      <w:insideH w:val="single" w:sz="4" w:space="0" w:color="E5E6EB"/>
      <w:insideV w:val="single" w:sz="4" w:space="0" w:color="E5E6EB"/>
    </w:tblBorders></w:tblPr>
    <w:tblGrid><w:gridCol w:w="640"/><w:gridCol w:w="920"/><w:gridCol w:w="5600"/><w:gridCol w:w="4700"/><w:gridCol w:w="3100"/></w:tblGrid>
    <w:tr><w:trPr><w:tblHeader/></w:trPr>
      ${docxCell('序號', 640, { bold: true, fill: 'F2F3F5' })}
      ${docxCell('畫面類型', 920, { bold: true, fill: 'F2F3F5' })}
      ${docxCell('英文文案', 5600, { bold: true, fill: 'F2F3F5' })}
      ${docxCell('畫面提示', 4700, { bold: true, fill: 'F2F3F5' })}
      ${docxCell('對應視頻', 3100, { bold: true, fill: 'F2F3F5' })}
    </w:tr>
    ${rows.join('')}
  </w:tbl>`;

  const body = [
    docxParagraph(meta.title, { bold: true, size: 32 }),
    docxParagraph(`分鏡交付表 · ${timeline.length} 拍 · ${clock(timeline.at(-1)?.end || 0)} · 生成於 ${new Date().toLocaleString('zh-CN')}`, { size: 16, color: '646A73' }),
    docxParagraph('匯入飛書後表格與縮圖會保留；影片要線上播放，請把 clips/ 內的影片上傳到飛書，貼到對應列。', { size: 15, color: '9A6A2F' }),
    table,
    docxParagraph('對應影片：有獨立素材的檔名在 clips/；沒有獨立素材的顯示 final 時間碼。', { size: 15, color: '646A73' }),
    '<w:sectPr><w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="360" w:footer="360" w:gutter="0"/></w:sectPr>',
  ].join('');

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
<w:body>${body}</w:body></w:document>`;
  write(path.join(temp, 'word', 'document.xml'), documentXml);
  write(path.join(temp, 'word', '_rels', 'document.xml.rels'), `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.join('')}</Relationships>`);
  write(path.join(temp, '_rels', '.rels'), `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
  write(path.join(temp, '[Content_Types].xml'), `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="jpg" ContentType="image/jpeg"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`);

  const zipped = spawnSync('/usr/bin/zip', ['-r', '-q', outFile, '.'], { cwd: temp, stdio: 'ignore' });
  fs.rmSync(temp, { recursive: true, force: true });
  return zipped.status === 0 && fs.existsSync(outFile);
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function walk(dir, root = dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, root));
    else out.push(path.relative(root, full).split(path.sep).join('/'));
  }
  return out.sort();
}

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function makeThumbnail(videoFile, outFile, at = 1) {
  if (!ffmpegPath || !fs.existsSync(videoFile)) return false;
  const result = spawnSync(ffmpegPath, [
    '-y', '-loglevel', 'error', '-ss', String(at), '-i', videoFile,
    '-frames:v', '1', '-q:v', '2', outFile,
  ], { stdio: 'ignore' });
  return result.status === 0 && fs.existsSync(outFile);
}

function chineseByBeat(english, copy, transcript) {
  const result = new Map();
  const segments = transcript.segments || [];
  for (const block of copy.blocks || []) {
    const beats = (english.beats || []).filter((beat) => beat.sourceBlock === block.id);
    if (!beats.length) continue;
    const rows = segments.filter(
      (segment) => Number(segment.start) >= Number(block.start) - 0.25 && Number(segment.end) <= Number(block.end) + 0.25,
    );
    if (!rows.length) {
      for (const beat of beats) result.set(beat.id, block.summary || '');
      continue;
    }
    const weights = beats.map((beat) => Math.max(1, Number(beat.words) || String(beat.vo || '').split(/\s+/).length));
    const total = weights.reduce((sum, value) => sum + value, 0);
    let offset = 0;
    let accumulated = 0;
    for (let index = 0; index < beats.length; index += 1) {
      accumulated += weights[index];
      const target = index === beats.length - 1
        ? rows.length
        : Math.max(offset + 1, Math.round((accumulated / total) * rows.length));
      const slice = rows.slice(offset, target);
      offset = target;
      const text = slice.map((segment) => segment.zh || segment.text || '').join('').trim();
      result.set(beats[index].id, text || block.summary || '');
    }
  }
  return result;
}

function timelineFor(meta, english, production, chineseMap = new Map()) {
  let cursor = 0;
  return (english.beats || []).map((beat, index) => {
    const entry = production.beats?.[beat.id] || {};
    const duration = Number(entry.segmentDuration || beat.estSeconds) || 0;
    const start = cursor;
    const end = start + duration;
    cursor = end;
    return {
      index: index + 1,
      beatId: beat.id,
      type: beat.type,
      start: Number(start.toFixed(3)),
      end: Number(end.toFixed(3)),
      duration: Number(duration.toFixed(3)),
      vo: beat.vo,
      visual: beat.visual,
      chinese: chineseMap.get(beat.id) || '',
      route: entry.route || '',
      status: entry.status || 'todo',
      words: beat.words || 0,
      asset: entry.asset || '',
      brief: entry.brief || '',
    };
  });
}

function chaptersFor(copy) {
  return (copy.blocks || [])
    .map((block) => `${clock(block.start)} ${block.title}`)
    .join('\n');
}

export function buildDeliveryBundle(jobId) {
  const meta = readMeta(jobId);
  const transcript = getTranscript(jobId);
  const copy = getCopy(jobId);
  const english = getEnglish(jobId);
  const production = getProduction(jobId);
  if (!production.final?.file) {
    throw Object.assign(new Error('还没有成片，请先在剪輯页生成 final.mp4。'), { status: 400 });
  }
  if (!english.beats?.length) {
    throw Object.assign(new Error('还没有英文分鏡，无法生成交付包。'), { status: 400 });
  }
  const productionRoot = productionDir(jobId);
  const videoFile = path.join(productionRoot, production.final.file);
  if (!fs.existsSync(videoFile)) {
    throw Object.assign(new Error('成片文件不存在，请重新剪辑。'), { status: 400 });
  }

  const slug = asciiSlug(meta.title, `project-${meta.id}`);
  const exportRoot = path.join(jobDir(jobId), 'export');
  fs.mkdirSync(exportRoot, { recursive: true });
  const tempRoot = path.join(exportRoot, `tmp-${Date.now()}`);
  const root = path.join(tempRoot, slug);
  fs.mkdirSync(root, { recursive: true });

  const chineseMap = chineseByBeat(english, copy, transcript);
  const timeline = timelineFor(meta, english, production, chineseMap);
  const finalDuration = Number(production.final.duration || timeline.at(-1)?.end || 0);
  const subtitles = Boolean(production.final.subtitles);

  // video + cover
  fs.mkdirSync(path.join(root, 'video'), { recursive: true });
  fs.copyFileSync(videoFile, path.join(root, 'video', 'final.mp4'));
  makeThumbnail(videoFile, path.join(root, 'video', 'cover.jpg'));

  // subtitles
  fs.mkdirSync(path.join(root, 'subtitles'), { recursive: true });
  write(path.join(root, 'subtitles', 'zh.srt'), buildSrt(transcript, { mode: 'zh' }));
  write(path.join(root, 'subtitles', 'en.srt'), buildSrt(transcript, { mode: 'en' }));
  write(path.join(root, 'subtitles', 'bilingual.srt'), buildSrt(transcript, { mode: 'bilingual' }));

  // copy
  fs.mkdirSync(path.join(root, 'copy'), { recursive: true });
  write(path.join(root, 'copy', 'zh-copy.md'), buildCopyMarkdown(meta, transcript, copy));
  write(path.join(root, 'copy', 'en-vo.md'), buildVoTable(english.beats));
  write(path.join(root, 'copy', 'en-vo.csv'), csv([
    ['beat_id', 'index', 'type', 'start', 'end', 'duration', 'words', 'english_vo', 'chinese_copy', 'visual'],
    ...timeline.map((row) => [row.beatId, row.index, row.type, row.start, row.end, row.duration, row.words, row.vo, row.chinese, row.visual]),
  ]));
  const blockById = new Map((copy.blocks || []).map((block) => [block.id, block]));
  write(path.join(root, 'copy', 'bilingual-timeline.csv'), csv([
    ['index', 'beat_id', 'type', 'start', 'end', 'duration', 'english_vo', 'chinese_copy', 'chinese_block', 'visual'],
    ...timeline.map((row) => {
      const source = (english.beats || []).find((beat) => beat.id === row.beatId)?.sourceBlock || '';
      const block = blockById.get(source) || {};
      return [row.index, row.beatId, row.type, row.start, row.end, row.duration, row.vo, row.chinese, block.title || '', row.visual];
    }),
  ]));

  // per-shot clips + Feishu-style shot table
  const clips = new Map();
  const clipsRoot = path.join(root, 'clips');
  fs.mkdirSync(clipsRoot, { recursive: true });
  const thumbs = new Map();
  const thumbsRoot = path.join(root, 'thumbs');
  fs.mkdirSync(thumbsRoot, { recursive: true });
  for (const row of timeline) {
    const entry = production.beats?.[row.beatId];
    if (!entry?.asset) continue;
    const source = path.join(productionRoot, entry.asset);
    if (!fs.existsSync(source)) continue;
    const ext = (path.extname(source) || '.mp4').toLowerCase();
    const name = `${pad(row.index, 2)}-${row.type === 'B字卡' ? 'broll' : row.type === '人物口播' ? 'aroll' : 'screen'}-${asciiSlug(row.vo, 'shot').slice(0, 28)}${ext}`;
    const dest = path.join(clipsRoot, name);
    fs.copyFileSync(source, dest);
    clips.set(row.beatId, `clips/${name}`);
    const thumb = path.join(thumbsRoot, `${pad(row.index, 2)}.jpg`);
    if (makeThumbnail(dest, thumb)) thumbs.set(row.beatId, thumb);
  }
  if (!thumbs.size) {
    for (const row of timeline) {
      const thumb = path.join(thumbsRoot, `${pad(row.index, 2)}.jpg`);
      if (makeThumbnail(videoFile, thumb, Math.max(0.2, Number(row.start || 0) + 0.8))) thumbs.set(row.beatId, thumb);
    }
  }
  write(path.join(root, 'shot-table.html'), buildShotTableHtml(meta, timeline, clips));
  buildShotDocx(meta, timeline, clips, thumbs, path.join(root, 'shot-table.docx'));
  write(path.join(root, 'shot-table.md'), [
    `# ${meta.title} · 分鏡交付表`,
    '',
    `- 分鏡：${timeline.length} 拍`,
    `- 成片：${Math.round(finalDuration)} 秒`,
    `- 對應視頻：有獨立素材的放 \`clips/\`；沒有的連到 \`video/final.mp4\` 的時間碼`,
    '',
    '| 序號 | 畫面類型 | 英文文案 | 畫面提示 | 對應視頻 |',
    '|---|---|---|---|---|',
    ...timeline.map((row) => {
      const clip = clips.get(row.beatId);
      const link = clip ? `[影片](${clip})` : `[final ${clock(row.start)}](${videoFragment(row)})`;
      return `| ${String(row.index).padStart(2, '0')} | ${shotType(row.type)} | ${String(row.vo || '').replace(/\|/g, '\\|')} | ${String(row.visual || '').replace(/\|/g, '\\|')} | ${link} |`;
    }),
    '',
    '> HTML 版 `shot-table.html` 可以直接打開、複製到飛書；影片要線上播放時，把 `clips/` 上傳到飛書再換連結。',
  ].join('\n'));
  write(path.join(root, 'shot-table.csv'), csv([
    ['index', 'type', 'english_vo', 'visual', 'start', 'end', 'clip', 'final_link'],
    ...timeline.map((row) => [row.index, shotType(row.type), row.vo, row.visual, row.start, row.end, clips.get(row.beatId) || '', videoFragment(row)]),
  ]));

  // edit
  fs.mkdirSync(path.join(root, 'edit'), { recursive: true });
  write(path.join(root, 'edit', 'shot-list.csv'), csv([
    ['index', 'beat_id', 'type', 'route', 'status', 'start', 'end', 'duration', 'asset', 'english_vo'],
    ...timeline.map((row) => [row.index, row.beatId, row.type, row.route, row.status, row.start, row.end, row.duration, row.asset, row.vo]),
  ]));
  write(path.join(root, 'edit', 'timeline.json'), JSON.stringify({
    project: { id: meta.id, title: meta.title },
    video: {
      file: 'video/final.mp4',
      duration: finalDuration,
      width: production.final.width || 1920,
      height: production.final.height || 1080,
      subtitlesBurned: subtitles,
    },
    beats: timeline,
  }, null, 2));

  // source data
  fs.mkdirSync(path.join(root, 'source'), { recursive: true });
  write(path.join(root, 'source', 'transcript.json'), JSON.stringify(transcript, null, 2));
  write(path.join(root, 'source', 'production.json'), JSON.stringify(production, null, 2));
  write(path.join(root, 'source', 'job.json'), JSON.stringify(meta, null, 2));

  // publishing copy
  fs.mkdirSync(path.join(root, 'publish'), { recursive: true });
  write(path.join(root, 'publish', 'chapters.txt'), chaptersFor(copy));
  write(path.join(root, 'publish', 'youtube-description.md'), [
    `# ${meta.title}`,
    '',
    copy.brief ? `${copy.brief}\n` : '',
    ...((copy.blocks || []).map((block) => `- ${block.summary || block.title}`)),
    '',
    '## Chapters',
    chaptersFor(copy),
    '',
    '## Files',
    '- video/final.mp4：完成影片',
    `- subtitles/：中文、英文、中英雙語 SRT`,
    '- copy/：中文文案、英文 VO、雙語時間軸',
    '- edit/：分鏡與剪輯時間軸',
  ].join('\n'));

  // readme
  const totalBeats = timeline.length;
  write(path.join(root, 'README.md'), [
    `# ${meta.title}`,
    '',
    `- 專案 ID：${meta.id}`,
    `- 成片：${Math.round(finalDuration)} 秒 · ${production.final.width || 1920}×${production.final.height || 1080}`,
    `- 分鏡：${totalBeats} 拍`,
    `- 字幕：${subtitles ? '已燒錄' : '未燒錄'}`,
    `- 生成時間：${new Date().toLocaleString('zh-CN')}`,
    '',
    '## 交付內容',
    '',
    '- `video/final.mp4`：完成影片；`video/cover.jpg`：封面候選',
    '- `subtitles/`：`zh.srt`、`en.srt`、`bilingual.srt`',
    '- `copy/zh-copy.md`：中文分段文案',
    '- `copy/en-vo.md` / `en-vo.csv`：英文口播分鏡',
    '- `copy/bilingual-timeline.csv`：逐拍中英對照與時間碼',
    '- `edit/shot-list.csv` / `timeline.json`：剪輯與素材對照',
    '- `publish/`：章節與 YouTube 描述草稿',
    '- `shot-table.docx`：可直接 import 到飛書文檔的分鏡表（表格＋影片縮圖＋檔名）',
    '- `shot-table.html`：像飛書文檔的分鏡表（可直接打開；可把表格複製到飛書）',
    '- `shot-table.md` / `shot-table.csv`：同一份表格的 Markdown／CSV',
    '- `clips/`：每一拍對應的獨立影片（沒有獨立素材時連到 final 的時間碼）',
    '- `source/`：轉寫、製作、專案原始資料',
    '- `manifest.json` / `checksums.txt`：檔案清單與 SHA256',
    '',
    '## 使用方式',
    '',
    '1. 把 `video/final.mp4` 拖進剪映 / Premiere / Final Cut。',
    '2. 需要字幕時匯入 `subtitles/` 對應語言的 SRT。',
    '3. 文案與分鏡對照看 `copy/bilingual-timeline.csv`。',
    '4. 要改某一拍，回工作台用 `edit/timeline.json` 的 beat_id 定位。',
    '',
    '',
    subtitles ? '> 注意：final.mp4 已燒錄字幕，若要在剪輯軟體改字幕，請用 video/final.mp4 並關閉內建字幕。' : '',
  ].join('\n'));

  // manifest (without itself)
  const filesBeforeManifest = walk(root);
  const manifest = {
    schema: 'course-video-delivery/v1',
    generatedAt: new Date().toISOString(),
    project: {
      id: meta.id,
      title: meta.title,
      createdAt: meta.createdAt,
      duration: finalDuration,
    },
    video: {
      file: 'video/final.mp4',
      width: production.final.width || 1920,
      height: production.final.height || 1080,
      subtitlesBurned: subtitles,
    },
    counts: {
      segments: transcript.segments?.length || 0,
      blocks: copy.blocks?.length || 0,
      beats: totalBeats,
    },
    models: meta.models || {},
    files: filesBeforeManifest.map((file) => ({
      path: file,
      bytes: fs.statSync(path.join(root, file)).size,
      sha256: sha256(path.join(root, file)),
    })),
    notes: [
      'final.mp4 may contain burned-in subtitles.',
      'beat_id in edit/timeline.json matches English VO rows.',
    ],
  };
  write(path.join(root, 'manifest.json'), JSON.stringify(manifest, null, 2));

  const allFiles = walk(root);
  write(path.join(root, 'checksums.txt'), allFiles.map((file) => `${sha256(path.join(root, file))}  ${file}`).join('\n') + '\n');

  const zipName = `${slug}-delivery-${dateStamp()}.zip`;
  const zipFile = path.join(exportRoot, zipName);
  const zipped = spawnSync('/usr/bin/zip', ['-r', '-q', zipFile, slug], { cwd: tempRoot, stdio: 'ignore' });
  if (zipped.status !== 0 || !fs.existsSync(zipFile)) {
    throw new Error('打包 ZIP 失败：系统缺少 zip 命令或文件写入失败。');
  }
  fs.rmSync(tempRoot, { recursive: true, force: true });
  return {
    file: zipFile,
    filename: zipName,
    contentType: 'application/zip',
    stats: {
      beats: totalBeats,
      duration: finalDuration,
      files: allFiles.length + 1,
      size: fs.statSync(zipFile).size,
    },
  };
}
