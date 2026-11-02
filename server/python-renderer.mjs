import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import ffmpegPath from 'ffmpeg-static';

function cleanup(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

export function extractPython(text = '') {
  let raw = String(text || '').trim();
  const fence = raw.match(/```(?:python|py)?\s*([\s\S]*?)```/i);
  if (fence) raw = fence[1].trim();
  const start = raw.search(/^(?:#!.*\n)?(?:from\s+\S+\s+import|import\s+\S+)/m);
  if (start < 0) return '';
  return raw.slice(start).trim();
}

export function validatePython(script = '') {
  const code = String(script || '');
  if (!code.trim()) throw new Error('Python 腳本是空的。');
  if (/```/.test(code)) throw new Error('Python 腳本仍包含 Markdown fence。');
  if (/\b(?:subprocess|socket|requests|urllib|httpx|http\.client|ftplib|ctypes|multiprocessing|threading|shutil)\b/.test(code)) {
    throw new Error('Python 腳本含被禁止的網路／系統模組。');
  }
  if (/\b(?:eval|exec|__import__)\s*\(/.test(code) || /os\.(?:system|popen|spawn|exec)/.test(code)) {
    throw new Error('Python 腳本含被禁止的動態執行或系統呼叫。');
  }
  const imports = [...code.matchAll(/^\s*(?:from|import)\s+([A-Za-z0-9_.]+)/gm)].map((m) => m[1]);
  const allowed = /^(PIL|numpy|math|os|sys|json|colorsys|typing|dataclasses|components)(\.|$)/;
  for (const name of imports) {
    if (!allowed.test(name)) throw new Error(`Python 腳本 import 了未允許的模組：${name}`);
  }
  if (!/frames/.test(code) || !/frame_/.test(code) || !/(?:%0?\d*d|:0?\d*d)/.test(code)) {
    throw new Error('Python 腳本必須輸出 frames/frame_00000.png 這種逐幀檔案。');
  }
  return true;
}

export function makeContactSheet(videoFile, outFile, { cols = 3, rows = 2, width = 480, fps = 1 } = {}) {
  if (!ffmpegPath || !fs.existsSync(videoFile)) return false;
  const result = spawnSync(ffmpegPath, [
    '-y', '-loglevel', 'error', '-i', videoFile,
    '-vf', `fps=${fps},scale=${width}:-1,tile=${cols}x${rows}`,
    '-frames:v', '1', outFile,
  ], { stdio: 'ignore' });
  return result.status === 0 && fs.existsSync(outFile);
}

/**
 * Execute an Opus-authored Pillow script that writes frames, then encode with FFmpeg.
 * The script runs in a temporary directory with an audit hook that blocks sockets/processes.
 */
export async function renderPythonToMp4({
  script,
  outFile,
  duration = 6,
  width = 1920,
  height = 1080,
  fps = 30,
  audioFile = '',
  inputDir = '',
  onProgress,
}) {
  if (!ffmpegPath) throw new Error('找不到 FFmpeg。');
  validatePython(script);
  const seconds = Math.max(1, Number(duration) || 6);
  const totalFrames = Math.max(1, Math.round(seconds * fps));
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-pyrender-'));
  try {
    fs.writeFileSync(path.join(temp, 'main.py'), String(script));
    if (inputDir && fs.existsSync(inputDir)) fs.cpSync(inputDir, path.join(temp, 'base_frames'), { recursive: true });
    fs.writeFileSync(
      path.join(temp, 'run.py'),
      `import sys\n\ndef _audit(event, args):\n    if event.startswith(("socket.", "subprocess.", "os.system", "os.exec", "os.spawn")):\n        raise RuntimeError("blocked: " + event)\n\nsys.addaudithook(_audit)\nimport runpy\nrunpy.run_path("main.py", run_name="__main__")\n`,
    );
    onProgress?.(10, '執行 Python/Pillow 動畫…');
    const python = process.env.WB_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
    const run = spawnSync(python, ['-B', 'run.py'], {
      cwd: temp,
      timeout: Math.max(120000, (seconds + 30) * 1000),
      maxBuffer: 20 * 1024 * 1024,
      encoding: 'utf8',
      env: {
        ...process.env,
        PYTHONDONTWRITEBYTECODE: '1',
        PYTHONPATH: [path.resolve('skills/broll-design-pack'), process.env.PYTHONPATH || ''].filter(Boolean).join(path.delimiter),
      },
    });
    if (run.error) throw new Error(`Python 執行失敗：${run.error.message}`);
    if (run.status !== 0) {
      throw new Error(`Python 腳本失敗：${String(run.stderr || run.stdout || '').slice(-1200)}`);
    }
    const framesDir = path.join(temp, 'frames');
    if (!fs.existsSync(framesDir)) throw new Error('Python 腳本沒有建立 frames/。');
    const frames = fs.readdirSync(framesDir).filter((name) => /^frame_\d+\.png$/.test(name)).sort();
    if (frames.length < Math.max(1, totalFrames - 2)) {
      throw new Error(`Python 只輸出了 ${frames.length}/${totalFrames} 幀。`);
    }
    const firstFrame = frames[0];
    const digits = (firstFrame.match(/^frame_(\d+)\.png$/) || [])[1] || '';
    const startNumber = Number(digits) || 0;
    const pattern = path.join(framesDir, `frame_%0${digits.length || 5}d.png`);
    onProgress?.(75, 'FFmpeg 編碼 MP4…');
    const args = [
      '-y',
      '-framerate', String(fps),
      '-start_number', String(startNumber),
      '-i', pattern,
    ];
    if (audioFile && fs.existsSync(audioFile)) args.push('-i', audioFile);
    args.push(
      '-t', String(seconds),
      '-vf', `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black`,
      '-r', String(fps),
      '-map', '0:v:0',
    );
    if (audioFile && fs.existsSync(audioFile)) {
      args.push('-map', '1:a:0', '-af', 'apad', '-c:a', 'aac', '-b:a', '160k');
    } else {
      args.push('-an');
    }
    args.push(
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', '20',
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
    );
    args.push(outFile);
    const encoded = spawnSync(ffmpegPath, args, { encoding: 'utf8' });
    if (encoded.status !== 0 || !fs.existsSync(outFile)) {
      throw new Error(`FFmpeg 編碼失敗：${String(encoded.stderr || encoded.stdout || '').slice(-1200)}`);
    }
    onProgress?.(100, 'MP4 完成');
    return outFile;
  } finally {
    cleanup(temp);
  }
}
