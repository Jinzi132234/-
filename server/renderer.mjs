import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import ffmpegPath from 'ffmpeg-static';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (!process.env.PLAYWRIGHT_BROWSERS_PATH) {
  process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(ROOT, '.playwright');
}
// Playwright's video recorder looks for its own ffmpeg build. Reuse the
// bundled ffmpeg-static binary so users do not need `playwright install`.
const pwFfmpeg = path.join(process.env.PLAYWRIGHT_BROWSERS_PATH, 'ffmpeg-1013', 'ffmpeg-mac');
try {
  if (ffmpegPath && !fs.existsSync(pwFfmpeg)) {
    fs.mkdirSync(path.dirname(pwFfmpeg), { recursive: true });
    fs.symlinkSync(ffmpegPath, pwFfmpeg);
  }
} catch {
  /* fall back to Playwright's own lookup */
}
const { chromium } = await import('playwright-core');

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Users/gold/.agent-browser/browsers/chrome-153.0.8010.36/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
].filter(Boolean);

function findChrome() {
  for (const candidate of CHROME_CANDIDATES) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error('找不到 Chrome。請設定 CHROME_PATH 或安裝 Google Chrome。');
}

function cleanup(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

/**
 * Render a self-contained HTML animation to H.264 MP4.
 * The page is executed in headless Chrome, recorded by Playwright, then encoded by FFmpeg.
 */
export async function renderHtmlToMp4({
  html,
  outFile,
  duration = 6,
  width = 1920,
  height = 1080,
  fps = 30,
  audioFile = '',
  onProgress,
}) {
  if (!ffmpegPath) throw new Error('找不到 FFmpeg。');
  if (!html || !String(html).trim()) throw new Error('HTML 是空的。');
  const seconds = Math.max(1, Number(duration) || 6);
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-render-'));
  let browser;
  try {
    onProgress?.(5, '啟動 headless Chrome…');
    browser = await chromium.launch({
      executablePath: findChrome(),
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--hide-scrollbars',
        '--force-device-scale-factor=1',
        '--autoplay-policy=no-user-gesture-required',
      ],
    });
    const context = await browser.newContext({
      viewport: { width, height },
      deviceScaleFactor: 1,
      reducedMotion: 'no-preference',
      recordVideo: { dir: temp, size: { width, height } },
    });
    const page = await context.newPage();
    // Enforce a self-contained animation: no external network fetches.
    await page.route('**/*', (route) => {
      const url = route.request().url();
      if (url.startsWith('data:') || url.startsWith('blob:') || url.startsWith('about:')) {
        route.continue();
      } else {
        route.abort();
      }
    });
    page.on('pageerror', (error) => {
      console.warn('[renderer] page error:', error.message);
    });
    onProgress?.(15, '載入 HTML 動畫…');
    await page.setContent(String(html), { waitUntil: 'load', timeout: 30000 });
    await page.evaluate(async () => {
      if (document.fonts?.ready) await document.fonts.ready;
      window.dispatchEvent(new Event('resize'));
    });
    await page.waitForTimeout(250);
    onProgress?.(25, `錄製 ${seconds.toFixed(1)} 秒動畫…`);
    await page.waitForTimeout(Math.ceil(seconds * 1000) + 250);
    const video = page.video();
    await context.close();
    const webm = await video.path();
    await browser.close();
    browser = null;
    onProgress?.(80, 'FFmpeg 編碼 MP4…');
    const args = [
      '-y',
      '-i', webm,
      '-t', String(seconds),
      '-vf', `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black`,
      '-r', String(fps),
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', '20',
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
    ];
    if (audioFile && fs.existsSync(audioFile)) {
      args.push('-i', audioFile, '-map', '0:v:0', '-map', '1:a:0', '-c:a', 'aac', '-b:a', '160k', '-shortest');
    } else {
      args.push('-an');
    }
    args.push(outFile);
    const encoded = spawnSync(ffmpegPath, args, { stdio: 'ignore' });
    if (encoded.status !== 0 || !fs.existsSync(outFile)) {
      throw new Error('FFmpeg 編碼失敗。');
    }
    onProgress?.(100, 'MP4 完成');
    return outFile;
  } finally {
    if (browser) await browser.close().catch(() => {});
    cleanup(temp);
  }
}
