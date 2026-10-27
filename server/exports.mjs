import fs from 'node:fs';
import path from 'node:path';

import { JOBS_DIR, loadSettings } from './config.mjs';
import { getCopy, getEnglish, getTranscript, readMeta } from './jobs.mjs';
import { buildVoTable, computeStats } from './english.mjs';

function pad(n, width = 2) {
  return String(n).padStart(width, '0');
}

export function srtTime(seconds) {
  const ms = Math.max(0, Math.round(Number(seconds) * 1000));
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const milli = ms % 1000;
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(milli, 3)}`;
}

export function clock(seconds) {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

const CJK_PUNCT = /[。！？；，、：…]/;

/** Split Chinese subtitle text into at most 2 short lines. */
export function wrapChinese(text, maxChars = 20) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return [''];
  if (clean.length <= maxChars) return [clean];

  const lines = [];
  let rest = clean;
  const minCut = Math.floor(maxChars * 0.55);
  while (rest.length > maxChars && lines.length < 2) {
    let cut = -1;
    // 1) break after punctuation  2) break at a space  3) hard cut
    for (let i = maxChars; i >= minCut; i -= 1) {
      if (CJK_PUNCT.test(rest[i - 1] || '')) {
        cut = i;
        break;
      }
    }
    if (cut < 0) {
      for (let i = maxChars; i >= minCut; i -= 1) {
        if (/\s/.test(rest[i - 1] || '')) {
          cut = i;
          break;
        }
      }
    }
    if (cut < 0) cut = maxChars;
    const line = rest.slice(0, cut).trim();
    if (line) lines.push(line);
    rest = rest.slice(cut).trimStart();
  }
  if (rest) lines.push(rest);
  if (lines.length > 2) {
    lines.length = 1;
    lines.push(rest);
  }
  return lines.slice(0, 2);
}

export function wrapEnglish(text, maxChars = 46) {
  const words = String(text || '').replace(/\s+/g, ' ').trim().split(' ');
  const lines = [];
  let line = '';
  for (const word of words) {
    if (!line) line = word;
    else if ((line + ' ' + word).length <= maxChars) line += ' ' + word;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

export function buildSrt(transcript, { mode = 'zh', maxLineChars = 20 } = {}) {
  const segments = transcript.segments || [];
  const entries = [];
  for (let i = 0; i < segments.length; i += 1) {
    const segment = segments[i];
    const next = segments[i + 1];
    let end = Number(segment.end) || 0;
    if (next && Number(next.start) > 0 && end > Number(next.start)) {
      end = Math.max(Number(segment.start) + 0.2, Number(next.start) - 0.04);
    }
    if (end <= Number(segment.start)) end = Number(segment.start) + 1;
    const zhLines = wrapChinese(segment.zh || segment.text, maxLineChars);
    const enLines = wrapEnglish(segment.text, 46);
    const lines =
      mode === 'bilingual' ? [...zhLines, ...enLines] : mode === 'en' ? enLines : zhLines;
    entries.push(
      `${entries.length + 1}\n${srtTime(segment.start)} --> ${srtTime(end)}\n${lines.join('\n')}`,
    );
  }
  return entries.join('\n\n') + '\n';
}

export function buildBilingualTxt(transcript) {
  const lines = [];
  lines.push(`英文课程转写与中文翻译`);
  lines.push(`生成时间：${new Date().toLocaleString('zh-CN')}`);
  lines.push('');
  for (const segment of transcript.segments || []) {
    lines.push(`[${clock(segment.start)} - ${clock(segment.end)}]`);
    lines.push(`EN: ${segment.text}`);
    if (segment.zh) lines.push(`ZH: ${segment.zh}`);
    lines.push('');
  }
  return lines.join('\n');
}

export function buildCopyMarkdown(meta, transcript, copy) {
  const lines = [];
  lines.push(`# ${meta.title}`);
  lines.push('');
  lines.push(`- 时长：${clock(meta.source?.duration || transcript.duration || 0)}`);
  lines.push(`- 字幕句数：${(transcript.segments || []).length}`);
  lines.push(`- 分段数：${(copy.blocks || []).length}`);
  lines.push(`- 生成时间：${new Date().toLocaleString('zh-CN')}`);
  lines.push('');
  if (copy.brief) {
    lines.push(`> 项目要求：${copy.brief}`);
    lines.push('');
  }
  for (const block of copy.blocks || []) {
    lines.push(`## ${block.title}`);
    lines.push('');
    lines.push(`\`${clock(block.start)} – ${clock(block.end)}\` · ${block.chars} 字 · 口播约 ${Math.round(block.estSeconds || 0)} 秒`);
    if (block.summary) lines.push('');
    if (block.summary) lines.push(`> ${block.summary}`);
    lines.push('');
    for (const paragraph of String(block.copy || '').split(/\n+/)) {
      if (paragraph.trim()) lines.push(paragraph.trim());
      lines.push('');
    }
    if (block.screenText) {
      lines.push(`**屏幕字：** ${block.screenText}`);
      lines.push('');
    }
    lines.push('---');
    lines.push('');
  }
  return lines.join('\n');
}

export function buildVoiceScript(meta, copy) {
  const lines = [];
  const total = (copy.blocks || []).reduce((sum, b) => sum + (b.chars || 0), 0);
  lines.push(`# ${meta.title} · 配音稿`);
  lines.push('');
  lines.push(`总字数：${total} 字　预计口播：${Math.round(total / 4.2)} 秒（约 ${(total / 4.2 / 60).toFixed(1)} 分钟）`);
  lines.push('朗读提示：语速平稳，段落之间停 0.6–1 秒；方括号内是时间码，不要读出来。');
  lines.push('');
  (copy.blocks || []).forEach((block, index) => {
    lines.push(`【第 ${index + 1} 段】${block.title}`);
    lines.push(`[${clock(block.start)} - ${clock(block.end)}]　${block.chars} 字`);
    if (block.screenText) lines.push(`（屏幕字：${block.screenText}）`);
    lines.push('');
    for (const paragraph of String(block.copy || '').split(/\n+/)) {
      if (paragraph.trim()) lines.push(paragraph.trim());
    }
    lines.push('');
    lines.push('');
  });
  return lines.join('\n');
}

export function buildFullJson(meta, transcript, copy) {
  return JSON.stringify(
    {
      project: {
        id: meta.id,
        title: meta.title,
        duration: meta.source?.duration,
        created_at: meta.createdAt,
        models: meta.models,
      },
      transcript: transcript.segments || [],
      blocks: copy.blocks || [],
    },
    null,
    2,
  );
}

export function safeFilename(name, fallback = 'export') {
  return (
    String(name || fallback)
      .replace(/[\\/:*?"<>|\n\r\t]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80) || fallback
  );
}

export function buildExport(jobId, type) {
  const meta = readMeta(jobId);
  const transcript = getTranscript(jobId);
  const copy = getCopy(jobId);
  if (!transcript.segments?.length) throw Object.assign(new Error('还没有转写内容。'), { status: 400 });
  const settings = loadSettings();
  const maxLineChars = Number(settings.export?.maxLineChars) || 20;

  const base = safeFilename(meta.title, jobId);
  switch (type) {
    case 'srt':
    case 'srt-bilingual':
    case 'srt-en': {
      const mode = type === 'srt-bilingual' ? 'bilingual' : type === 'srt-en' ? 'en' : 'zh';
      const suffix = mode === 'bilingual' ? '.中英' : mode === 'en' ? '.英文' : '.中文';
      return {
        filename: `${base}${suffix}.srt`,
        contentType: 'application/x-subrip; charset=utf-8',
        content: buildSrt(transcript, { mode, maxLineChars }),
      };
    }
    case 'txt':
      return {
        filename: `${base}.转写.txt`,
        contentType: 'text/plain; charset=utf-8',
        content: buildBilingualTxt(transcript),
      };
    case 'copy':
      if (!copy.blocks?.length) throw Object.assign(new Error('还没有生成分段文案。'), { status: 400 });
      return {
        filename: `${base}.文案.md`,
        contentType: 'text/markdown; charset=utf-8',
        content: buildCopyMarkdown(meta, transcript, copy),
      };
    case 'voice':
      if (!copy.blocks?.length) throw Object.assign(new Error('还没有生成分段文案。'), { status: 400 });
      return {
        filename: `${base}.配音稿.txt`,
        contentType: 'text/plain; charset=utf-8',
        content: buildVoiceScript(meta, copy),
      };
    case 'json':
      return {
        filename: `${base}.json`,
        contentType: 'application/json; charset=utf-8',
        content: buildFullJson(meta, transcript, copy),
      };
    case 'vo': {
      const english = getEnglish(jobId);
      if (!english.beats?.length) throw Object.assign(new Error('还没有生成英文分镜。'), { status: 400 });
      return {
        filename: `${base}.en-vo-shots-table.md`,
        contentType: 'text/markdown; charset=utf-8',
        content: buildVoTable(english.beats),
      };
    }
    case 'vo-json': {
      const english = getEnglish(jobId);
      if (!english.beats?.length) throw Object.assign(new Error('还没有生成英文分镜。'), { status: 400 });
      return {
        filename: `${base}.en-vo-shots.json`,
        contentType: 'application/json; charset=utf-8',
        content: JSON.stringify(
          {
            project: { id: meta.id, title: meta.title },
            skill: 'chinese-course-to-english-youtube-vo-shots',
            stats: english.stats || computeStats(english.beats),
            beats: english.beats,
          },
          null,
          2,
        ),
      };
    }
    default:
      throw Object.assign(new Error('未知的导出类型。'), { status: 400 });
  }
}

export function writeExportToDisk(jobId, type) {
  const result = buildExport(jobId, type);
  const dir = path.join(JOBS_DIR, jobId, 'exports');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, result.filename);
  fs.writeFileSync(file, result.content, 'utf8');
  return { ...result, file };
}
