/**
 * Local video rendering: B-roll cards, TTS voice-over, beat segments and the
 * final assembled MP4. Claude produces a VideoSpec; FFmpeg renders it.
 */
import { spawn, execFile, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import ffmpegPath from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';

export const FFMPEG = ffmpegPath;
export const FFPROBE = ffprobeStatic.path;
const IS_WINDOWS = process.platform === 'win32';
const FONT_FILE = IS_WINDOWS ? 'C:\\Windows\\Fonts\\msyh.ttc' : '/System/Library/Fonts/Hiragino Sans GB.ttc';
const FONT_NAME = IS_WINDOWS ? 'Microsoft YaHei' : 'Hiragino Sans GB';
const SAY = IS_WINDOWS ? '' : '/usr/bin/say';

const CJK_FONT_FALLBACKS = IS_WINDOWS
  ? [
      'C:\\Windows\\Fonts\\msyh.ttc',
      'C:\\Windows\\Fonts\\msyhbd.ttc',
      'C:\\Windows\\Fonts\\simhei.ttf',
      'C:\\Windows\\Fonts\\arial.ttf',
    ]
  : [
      '/System/Library/Fonts/Hiragino Sans GB.ttc',
      '/System/Library/Fonts/STHeiti Medium.ttc',
      '/System/Library/Fonts/Supplemental/Songti.ttc',
    ];

function existingFont() {
  return CJK_FONT_FALLBACKS.find((file) => fs.existsSync(file)) || FONT_FILE;
}

function quoteFilterPath(file) {
  return `'${String(file).replace(/\\/g, '/').replace(/'/g, "'\\''")}'`;
}

function hexColor(value, fallback = '0x10151f') {
  const raw = String(value || '').trim();
  const match = /^(?:#|0x)?([0-9a-fA-F]{6})$/.exec(raw);
  return match ? `0x${match[1]}` : fallback;
}

export function runFfmpeg(args, { onProgress, totalSeconds = 0 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(FFMPEG, ['-y', '-hide_banner', '-loglevel', 'error', '-progress', 'pipe:1', ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    let stdout = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > 12000) stderr = stderr.slice(-12000);
    });
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
      let index;
      while ((index = stdout.indexOf('\n')) >= 0) {
        const line = stdout.slice(0, index).trim();
        stdout = stdout.slice(index + 1);
        const match = /^out_time_ms=(\d+)/.exec(line);
        if (match && totalSeconds && onProgress) {
          const seconds = Number(match[1]) / 1_000_000;
          onProgress(Math.max(0, Math.min(99, Math.round((seconds / totalSeconds) * 100))));
        }
      }
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim().split('\n').slice(-4).join(' ') || `ffmpeg exited ${code}`));
    });
  });
}

export function probeMedia(file) {
  return new Promise((resolve, reject) => {
    execFile(
      FFPROBE,
      ['-v', 'error', '-show_entries', 'format=duration,size', '-show_entries', 'stream=codec_type,width,height', '-of', 'json', file],
      { timeout: 30000 },
      (error, stdout) => {
        if (error) return reject(error);
        try {
          const data = JSON.parse(stdout);
          const streams = data.streams || [];
          const video = streams.find((s) => s.codec_type === 'video');
          resolve({
            duration: Number(data.format?.duration) || 0,
            size: Number(data.format?.size) || 0,
            width: video?.width || 0,
            height: video?.height || 0,
            hasAudio: streams.some((s) => s.codec_type === 'audio'),
          });
        } catch (err) {
          reject(err);
        }
      },
    );
  });
}

function hashText(text, extra = '') {
  return crypto.createHash('sha1').update(`${text}|${extra}`).digest('hex').slice(0, 12);
}

/** macOS `say` -> 48kHz stereo WAV. Returns duration; falls back to silence. */
export async function synthesizeTts(text, outWav, { voice = 'Samantha', rate = 165 } = {}) {
  fs.mkdirSync(path.dirname(outWav), { recursive: true });
  if (fs.existsSync(outWav)) {
    try {
      const info = await probeMedia(outWav);
      if (info.duration > 0.2) return info.duration;
    } catch {
      /* regenerate */
    }
  }
  const tempAudio = path.join(os.tmpdir(), `wb-tts-${Date.now()}-${Math.random().toString(36).slice(2)}${IS_WINDOWS ? '.wav' : '.aiff'}`);
  let spoken = false;
  if (IS_WINDOWS) {
    try {
      const textFile = path.join(os.tmpdir(), `wb-tts-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`);
      fs.writeFileSync(textFile, String(text || ''), 'utf8');
      const quote = (value) => `'${String(value).replace(/'/g, "''")}'`;
      const script = [
        'Add-Type -AssemblyName System.Speech',
        '$s = New-Object System.Speech.Synthesis.SpeechSynthesizer',
        `$s.SetOutputToWaveFile(${quote(tempAudio)})`,
        `$s.Speak([System.IO.File]::ReadAllText(${quote(textFile)}, [System.Text.Encoding]::UTF8))`,
        '$s.Dispose()',
      ].join('; ');
      const result = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], {
        timeout: 60000,
        encoding: 'utf8',
      });
      spoken = result.status === 0 && fs.existsSync(tempAudio);
      fs.rmSync(textFile, { force: true });
    } catch {
      spoken = false;
    }
  } else if (SAY) {
    const args = ['-v', voice, '-r', String(rate), '-o', tempAudio, String(text || '')];
    await new Promise((resolve) => {
      const child = spawn(SAY, args, { stdio: ['ignore', 'ignore', 'pipe'] });
      child.on('error', () => resolve(false));
      child.on('close', (code) => resolve(code === 0 && fs.existsSync(tempAudio)));
    });
    spoken = fs.existsSync(tempAudio);
  }
  if (!spoken) {
    await runFfmpeg(['-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-t', '3', '-c:a', 'pcm_s16le', outWav]);
    return 3;
  }
  await runFfmpeg(['-i', tempAudio, '-ar', '48000', '-ac', '2', '-c:a', 'pcm_s16le', outWav]);
  fs.rmSync(tempAudio, { force: true });
  const info = await probeMedia(outWav);
  return info.duration || 3;
}

export function normalizeSpec(spec, beat) {
  const theme = spec?.theme === 'light' ? 'light' : 'dark';
  const duration = Math.min(12, Math.max(3, Number(spec?.duration) || Number(beat.estSeconds) || 4));
  return {
    title: String(spec?.title || beat.vo || '').slice(0, 60),
    subtitle: String(spec?.subtitle || beat.visual || '').slice(0, 100),
    bullets: Array.isArray(spec?.bullets)
      ? spec.bullets.map((item) => String(item).slice(0, 60)).filter(Boolean).slice(0, 4)
      : [],
    layout: ['title', 'list', 'quote'].includes(spec?.layout) ? spec.layout : 'title',
    theme,
    accent: hexColor(spec?.accent, '0xe8b04b'),
    motion: spec?.motion === 'slide' ? 'slide' : 'fade',
    duration,
    brollPrompt: String(spec?.brollPrompt || '').slice(0, 2000),
    negativePrompt: String(spec?.negativePrompt || '').slice(0, 1000),
    videoPrompt: String(spec?.videoPrompt || '').slice(0, 2000),
    screenSteps: Array.isArray(spec?.screenSteps) ? spec.screenSteps.map(String).slice(0, 8) : [],
  };
}

function writeTextFile(dir, name, value) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, String(value || '').trim() || ' ', 'utf8');
  return file;
}

/**
 * Render a 1920x1080 motion card (silent). Used for B字卡 and placeholders.
 */
export async function renderCard(spec, outPath, { beat, onProgress } = {}) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-card-'));
  const normalized = normalizeSpec(spec, beat || {});
  const dark = normalized.theme !== 'light';
  const bg = dark ? '0x0d1219' : '0xf3eee4';
  const fg = dark ? '0xffffff' : '0x141a22';
  const muted = dark ? '0xb6c0cf' : '0x4a5565';
  const accent = normalized.accent;
  const font = existingFont();
  const titleFile = writeTextFile(tmp, 'title.txt', normalized.title);
  const subtitleFile = writeTextFile(tmp, 'subtitle.txt', normalized.subtitle);
  const bulletsFile = writeTextFile(tmp, 'bullets.txt', normalized.bullets.join('\n'));
  const duration = normalized.duration.toFixed(2);
  const slide = normalized.motion === 'slide';

  const titleAlpha = "min(1,t/0.45)";
  const bodyAlpha = "min(1,max(0,(t-0.25)/0.55))";
  const titleX = slide ? `170+50*(1-min(1,t/0.5))` : '170';
  const bodyX = slide ? `175+30*(1-min(1,max(0,(t-0.25)/0.6)))` : '175';

  const filters = [
    `drawbox=x=0:y=0:w=iw:h=ih:color=${bg}:t=fill`,
    `drawbox=x=118:y=152:w=7:h=116:color=${accent}:t=fill`,
    `drawtext=textfile=${quoteFilterPath(titleFile)}:fontfile=${quoteFilterPath(font)}:fontsize=72:fontcolor=${fg}:x='${titleX}':y=148:alpha='${titleAlpha}'`,
    `drawtext=textfile=${quoteFilterPath(subtitleFile)}:fontfile=${quoteFilterPath(font)}:fontsize=36:fontcolor=${muted}:x='${bodyX}':y=258:line_spacing=14:alpha='${bodyAlpha}'`,
  ];
  if (normalized.bullets.length) {
    filters.push(
      `drawtext=textfile=${quoteFilterPath(bulletsFile)}:fontfile=${quoteFilterPath(font)}:fontsize=36:fontcolor=${fg}:x='${bodyX}':y=392:line_spacing=22:alpha='${bodyAlpha}'`,
    );
  }

  await runFfmpeg(
    [
      '-f',
      'lavfi',
      '-i',
      `color=c=${bg}:s=1920x1080:r=30:d=${duration}`,
      '-vf',
      filters.join(','),
      '-t',
      duration,
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '20',
      '-pix_fmt',
      'yuv420p',
      '-an',
      outPath,
    ],
    { onProgress, totalSeconds: normalized.duration },
  );
  fs.rmSync(tmp, { recursive: true, force: true });
  return { duration: normalized.duration, spec: normalized };
}

/**
 * Build one normalized 1920x1080/30fps segment with English TTS as its audio.
 */
export async function renderSegment({
  beat,
  spec,
  assetPath,
  ttsPath,
  outPath,
  width = 1920,
  height = 1080,
  fps = 30,
  onProgress,
}) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const ttsDuration = await synthesizeTts(beat.vo, ttsPath);
  let assetInfo = null;
  if (assetPath && fs.existsSync(assetPath)) {
    try {
      assetInfo = await probeMedia(assetPath);
    } catch {
      assetInfo = null;
    }
  }
  const desired = Math.max(3, Number(spec?.duration) || 0, Number(beat.estSeconds) || 0, ttsDuration + 0.55);
  const duration = Math.min(30, Math.round(desired * 10) / 10);
  const d = duration.toFixed(2);

  if (assetInfo && assetInfo.width > 0) {
    await runFfmpeg(
      [
        '-i',
        assetPath,
        '-i',
        ttsPath,
        '-filter_complex',
        `[0:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${fps},tpad=stop_mode=clone:stop_duration=3,trim=duration=${d},setpts=PTS-STARTPTS[v];[1:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,atrim=duration=${d},apad=whole_dur=${d}[a]`,
        '-map',
        '[v]',
        '-map',
        '[a]',
        '-t',
        d,
        '-c:v',
        'libx264',
        '-preset',
        'veryfast',
        '-crf',
        '20',
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'aac',
        '-b:a',
        '192k',
        '-ar',
        '48000',
        '-ac',
        '2',
        outPath,
      ],
      { onProgress, totalSeconds: duration },
    );
    return { duration, ttsDuration };
  }

  // No asset: render a card, then attach TTS.
  const card = `${outPath}.card.mp4`;
  await renderCard(spec, card, { beat });
  await runFfmpeg(
    [
      '-i',
      card,
      '-i',
      ttsPath,
      '-filter_complex',
      `[1:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,atrim=duration=${d},apad=whole_dur=${d}[a]`,
      '-map',
      '0:v',
      '-map',
      '[a]',
      '-t',
      d,
      '-c:v',
      'copy',
      '-c:a',
      'aac',
      '-b:a',
      '192k',
      '-ar',
      '48000',
      '-ac',
      '2',
      outPath,
    ],
    { onProgress, totalSeconds: duration },
  );
  fs.rmSync(card, { force: true });
  return { duration, ttsDuration };
}

function assTime(seconds) {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const centi = Math.floor((ms % 1000) / 10);
  const pad = (v, n = 2) => String(v).padStart(n, '0');
  return `${h}:${pad(m)}:${pad(s)}.${pad(centi)}`;
}

export function buildAss(entries) {
  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,${FONT_NAME},46,&H00FFFFFF,&H00FFFFFF,&H00101010,&H80000000,0,0,0,0,100,100,0,0,1,2.5,1,2,150,150,58,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text`;
  let cursor = 0;
  const lines = [header];
  for (const entry of entries) {
    const start = cursor;
    const end = cursor + entry.duration - 0.08;
    cursor += entry.duration;
    const text = String(entry.text || '')
      .replace(/\r?\n/g, ' ')
      .replace(/\{/g, '（')
      .replace(/\}/g, '）')
      .trim();
    if (text) {
      lines.push(`Dialogue: 0,${assTime(start)},${assTime(Math.max(start + 0.2, end))},Default,,0,0,0,,${text}`);
    }
  }
  return lines.join('\n') + '\n';
}

/**
 * Assemble final 16:9 video from per-beat segments + TTS + optional subtitles.
 */
export async function renderFinal({
  productionDir,
  segments,
  subtitles = true,
  onProgress,
}) {
  const segmentsDir = path.join(productionDir, 'segments');
  fs.mkdirSync(segmentsDir, { recursive: true });
  const listFile = path.join(segmentsDir, 'concat.txt');
  fs.writeFileSync(
    listFile,
    segments.map((segment) => `file ${quoteFilterPath(segment.file)}`).join('\n') + '\n',
    'utf8',
  );
  const draft = path.join(productionDir, 'draft.mp4');
  await runFfmpeg(['-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', draft], {
    onProgress: (pct) => onProgress?.(Math.round(pct * 0.3)),
    totalSeconds: segments.reduce((sum, segment) => sum + segment.duration, 0) || 1,
  });

  const final = path.join(productionDir, 'final.mp4');
  if (subtitles) {
    const assFile = path.join(productionDir, 'subtitles.ass');
    fs.writeFileSync(assFile, buildAss(segments), 'utf8');
    await runFfmpeg(
      [
        '-i',
        draft,
        '-vf',
        `ass=${quoteFilterPath(assFile)}:fontsdir=${quoteFilterPath('/System/Library/Fonts')}`,
        '-c:v',
        'libx264',
        '-preset',
        'veryfast',
        '-crf',
        '20',
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'copy',
        final,
      ],
      {
        onProgress: (pct) => onProgress?.(30 + Math.round(pct * 0.7)),
        totalSeconds: segments.reduce((sum, segment) => sum + segment.duration, 0) || 1,
      },
    );
  } else {
    fs.copyFileSync(draft, final);
    onProgress?.(100);
  }
  const info = await probeMedia(final);
  return { file: final, duration: info.duration, width: info.width, height: info.height };
}

export function ttsCachePath(productionDir, beat) {
  const dir = path.join(productionDir, 'tts');
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${beat.id}-${hashText(beat.vo)}.wav`);
}
