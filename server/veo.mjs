/**
 * Google Veo / Gemini API video generation adapter.
 *
 * Flow:
 *   POST /v1beta/models/{model}:predictLongRunning
 *   GET  /v1beta/{operation.name}  (poll until done)
 *   download the generated video URI
 *
 * The exact response shape has changed across Veo previews, so the extractor
 * accepts the common variants.
 */
const DEFAULT_BASE = 'https://generativelanguage.googleapis.com/v1beta';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function pickVideoUri(payload) {
  const candidates = [];
  const walk = (value, depth = 0) => {
    if (!value || depth > 6) return;
    if (typeof value === 'string') {
      if (/^https?:\/\/.+\.(mp4|mov|webm)(\?.*)?$/i.test(value) || /generativelanguage.*files/i.test(value)) {
        candidates.push(value);
      }
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) walk(item, depth + 1);
      return;
    }
    if (typeof value === 'object') {
      for (const [key, item] of Object.entries(value)) {
        if (key === 'uri' || key === 'videoUri' || key === 'video_uri' || key === 'url' || key === 'gcsUri') {
          if (typeof item === 'string' && item) candidates.push(item);
        } else {
          walk(item, depth + 1);
        }
      }
    }
  };
  walk(payload);
  return candidates[0] || '';
}

function normalizeMediaUrl(uri, apiKey) {
  if (!uri) return '';
  if (uri.startsWith('gs://')) return uri;
  if (!/^https?:\/\//.test(uri)) return uri;
  const url = new URL(uri);
  if (!url.searchParams.has('key')) url.searchParams.set('key', apiKey);
  return url.toString();
}

async function prepareReferenceBuffers(referenceImages = [], signal) {
  const out = [];
  for (const ref of referenceImages.slice(0, 3)) {
    if (ref.buffer) {
      out.push(ref);
      continue;
    }
    if (!ref.url) continue;
    const response = await fetch(ref.url, { signal });
    if (!response.ok) throw new Error(`下載參考圖失敗：HTTP ${response.status}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length) throw new Error('參考圖是空的。');
    out.push({ ...ref, buffer, mimeType: response.headers.get('content-type') || 'image/jpeg' });
  }
  return out;
}

export async function generateVeo({
  apiKey,
  model = 'veo-3.1-generate-preview',
  prompt,
  negativePrompt = '',
  aspectRatio = '16:9',
  resolution = '1080p',
  durationSeconds = 8,
  referenceImages = [],
  baseUrl = DEFAULT_BASE,
  signal,
  onProgress,
  pollIntervalMs = 10000,
  timeoutMs = 15 * 60 * 1000,
}) {
  if (!apiKey) throw new Error('还没有配置 Google Veo / Gemini API Key。');
  if (!prompt) throw new Error('缺少视频提示词。');
  const base = String(baseUrl || DEFAULT_BASE).replace(/\/+$/, '');
  const submitUrl = `${base}/models/${encodeURIComponent(model)}:predictLongRunning?key=${encodeURIComponent(apiKey)}`;
  const body = {
    instances: [{ prompt }],
    parameters: {
      aspectRatio,
      resolution,
      durationSeconds,
      sampleCount: 1,
      personGeneration: 'allow_adult',
    },
  };
  if (negativePrompt) body.instances[0].negativePrompt = negativePrompt;
  const images = await prepareReferenceBuffers(referenceImages, signal);
  if (images.length) {
    body.instances[0].referenceImages = images.map((ref) => ({
      image: {
        bytesBase64Encoded: ref.buffer.toString('base64'),
        mimeType: ref.mimeType,
      },
      referenceType: 'asset',
    }));
  }

  onProgress?.({ phase: 'submit', message: '提交 Veo 任務…' });
  const submit = await fetch(submitUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  const submitText = await submit.text();
  let submitJson;
  try {
    submitJson = JSON.parse(submitText);
  } catch {
    submitJson = null;
  }
  if (!submit.ok) {
    const message = submitJson?.error?.message || submitText.slice(0, 500) || `HTTP ${submit.status}`;
    throw new Error(`Veo 提交失败：${message}`);
  }
  const operationName = submitJson?.name;
  if (!operationName) throw new Error('Veo 没有返回 operation name，请检查模型名与 API 版本。');

  const started = Date.now();
  let attempt = 0;
  while (Date.now() - started < timeoutMs) {
    if (signal?.aborted) throw new Error('CANCELLED');
    await sleep(pollIntervalMs);
    attempt += 1;
    onProgress?.({
      phase: 'poll',
      message: `Veo 生成中… ${Math.round((Date.now() - started) / 1000)}s`,
      attempt,
    });
    const pollUrl = `${base}/${operationName}?key=${encodeURIComponent(apiKey)}`;
    const response = await fetch(pollUrl, { signal });
    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
    if (!response.ok) {
      const message = data?.error?.message || text.slice(0, 500) || `HTTP ${response.status}`;
      throw new Error(`Veo 轮询失败：${message}`);
    }
    if (!data?.done) continue;
    if (data.error) throw new Error(`Veo 生成失败：${data.error.message || JSON.stringify(data.error)}`);
    const uri = pickVideoUri(data.response || data);
    if (!uri) throw new Error('Veo 已完成，但响应里找不到视频地址。');
    if (uri.startsWith('gs://')) {
      throw new Error(`Veo 返回了 gs:// 地址（${uri}），需要配置 GCS 下载权限；请改用可下载的 URI。`);
    }
    onProgress?.({ phase: 'download', message: '下载 Veo 视频…' });
    const downloadUrl = normalizeMediaUrl(uri, apiKey);
    const videoResponse = await fetch(downloadUrl, {
      headers: { Authorization: `Bearer ${apiKey}`, 'x-goog-api-key': apiKey },
      signal,
    });
    if (!videoResponse.ok) throw new Error(`下载 Veo 视频失败：HTTP ${videoResponse.status}`);
    const buffer = Buffer.from(await videoResponse.arrayBuffer());
    if (!buffer.length) throw new Error('Veo 返回了空视频。');
    return { buffer, uri, operation: operationName };
  }
  throw new Error('Veo 生成超时（15 分钟）。');
}

export function isVeoConfigured(settings) {
  return Boolean(settings?.video?.apiKey);
}

/**
 * Gemini Omni Flash video generation through the Interactions API.
 * This is the current default video model (Veo 3.1 previews shut down 2026-10-22).
 */
function isApiModelsBase(baseUrl = '') {
  return /(^|\.)apimodels\.app/i.test(String(baseUrl));
}

function normalizeApiModelsBase(baseUrl = '') {
  return String(baseUrl || 'https://api.apimodels.app/v1')
    .replace(/^https?:\/\/apimodels\.app/i, 'https://api.apimodels.app')
    .replace(/\/+$/, '');
}

async function generateApiModelsVideo({
  apiKey,
  model,
  baseUrl,
  prompt,
  aspectRatio,
  resolution,
  durationSeconds = 8,
  referenceImages = [],
  signal,
  onProgress,
  pollIntervalMs = 6000,
  timeoutMs = 12 * 60 * 1000,
}) {
  const base = normalizeApiModelsBase(baseUrl);
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };
  const body = {
    model,
    prompt,
    aspect_ratio: aspectRatio || '16:9',
    duration: Math.max(3, Math.min(10, Number(durationSeconds) || 8)),
  };
  if (resolution) body.resolution = resolution;
  const imageUrls = referenceImages.map((ref) => ref.url).filter(Boolean);
  if (imageUrls.length) body.images = imageUrls;
  onProgress?.({ phase: 'submit', message: '提交 APIMODELS 影片任務…' });
  const submit = await fetch(`${base}/video/generations`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal,
  });
  const submitText = await submit.text();
  let submitJson;
  try { submitJson = JSON.parse(submitText); } catch { submitJson = null; }
  if (!submit.ok) {
    const message = submitJson?.error?.message || submitJson?.msg || submitText.slice(0, 500) || `HTTP ${submit.status}`;
    throw new Error(`Omni 提交失败（APIMODELS）：${message}`);
  }
  const taskId = submitJson?.data?.taskId || submitJson?.taskId;
  if (!taskId) throw new Error(`APIMODELS 沒有返回 taskId：${submitText.slice(0, 300)}`);

  const started = Date.now();
  while (true) {
    if (signal?.aborted) throw new Error('CANCELLED');
    if (Date.now() - started > timeoutMs) throw new Error('Omni 生成超时（12 分钟）。');
    await sleep(pollIntervalMs);
    const poll = await fetch(`${base}/video/generations?task_id=${encodeURIComponent(taskId)}`, { headers, signal });
    const text = await poll.text();
    let data;
    try { data = JSON.parse(text); } catch { data = null; }
    if (!poll.ok) throw new Error(`Omni 轮询失败：${data?.error?.message || data?.msg || text.slice(0, 500)}`);
    const state = data?.data?.state;
    onProgress?.({ phase: 'poll', message: `Omni 生成中… ${Math.round((Date.now() - started) / 1000)}s` });
    if (state === 'failed' || state === 'cancelled') {
      throw new Error(`Omni 生成失败：${data?.data?.failMsg || state}`);
    }
    if (state === 'completed') {
      const url = data?.data?.resultUrls?.[0] || data?.data?.resultUrl;
      if (!url) throw new Error('Omni 已完成，但沒有 resultUrls。');
      onProgress?.({ phase: 'download', message: '下載 Omni 影片…' });
      const download = await fetch(url, { signal });
      if (!download.ok) throw new Error(`下載 Omni 影片失敗：HTTP ${download.status}`);
      const buffer = Buffer.from(await download.arrayBuffer());
      if (!buffer.length) throw new Error('Omni 回傳了空影片。');
      return { buffer, uri: url, interactionId: taskId };
    }
  }
}

export async function generateOmni({
  apiKey,
  model = 'gemini-omni-1.1-flash',
  baseUrl = DEFAULT_BASE,
  prompt,
  negativePrompt = '',
  aspectRatio = '16:9',
  resolution = '1080p',
  durationSeconds = 8,
  referenceImages = [],
  signal,
  onProgress,
  pollIntervalMs = 6000,
  timeoutMs = 12 * 60 * 1000,
}) {
  if (!apiKey) throw new Error('还没有配置 Google Gemini API Key。');
  if (!prompt) throw new Error('缺少视频提示词。');
  const base = String(baseUrl || DEFAULT_BASE).replace(/\/+$/, '');
  if (isApiModelsBase(base)) {
    if (referenceImages.length) {
      const missing = referenceImages.filter((ref) => !ref.url);
      if (missing.length) {
        throw new Error('APIMODELS 需要公開圖片 URL。請在人物口播卡填入場景圖／三視圖的 https 公開 URL，或改用 Flow 上傳 Base。');
      }
    }
    return generateApiModelsVideo({
      apiKey,
      model,
      baseUrl: base,
      prompt: negativePrompt ? `${prompt}\n\nAvoid: ${negativePrompt}` : prompt,
      aspectRatio,
      resolution,
      durationSeconds,
      referenceImages,
      signal,
      onProgress,
    });
  }
  const inputText = negativePrompt ? `${prompt}\n\nAvoid: ${negativePrompt}` : prompt;
  const images = await prepareReferenceBuffers(referenceImages, signal);
  const input = images.length
    ? [
        ...images.map((ref) => ({
          type: 'image',
          data: ref.buffer.toString('base64'),
          mime_type: ref.mimeType,
        })),
        { type: 'text', text: inputText },
      ]
    : inputText;
  const headers = {
    'Content-Type': 'application/json',
    'x-goog-api-key': apiKey,
  };
  onProgress?.({ phase: 'submit', message: '提交 Omni 影片任務…' });
  const submit = await fetch(`${base}/interactions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      input,
      store: false,
      ...(images.length
        ? { generation_config: { video_config: { task: 'reference_to_video' } } }
        : {}),
      response_format: {
        type: 'video',
        aspect_ratio: aspectRatio,
        resolution,
        delivery: 'uri',
      },
    }),
    signal,
  });
  const submitText = await submit.text();
  let interaction;
  try {
    interaction = JSON.parse(submitText);
  } catch {
    interaction = null;
  }
  if (!submit.ok) {
    let message = interaction?.error?.message || submitText.slice(0, 500) || `HTTP ${submit.status}`;
    if (/FUNCTION_PAYLOAD_TOO_LARGE|Entity Too Large/i.test(message)) {
      message = '參考圖總量過大（Google payload limit）。系統已自動壓縮參考圖，請再按一次「生成人物口播視頻」。';
    }
    throw new Error(`Omni 提交失败：${message}`);
  }
  if (!interaction?.id) throw new Error('Omni 没有返回 interaction id。');

  const started = Date.now();
  while (interaction.status !== 'completed' && !(interaction.status === undefined && findOmniVideo(interaction))) {
    if (signal?.aborted) throw new Error('CANCELLED');
    if (interaction.status === 'failed' || interaction.status === 'cancelled' || interaction.status === 'incomplete') {
      const detail = (interaction.errors || []).map((e) => e.message || e.code).join('; ');
      throw new Error(`Omni 生成失败：${detail || interaction.status}`);
    }
    if (Date.now() - started > timeoutMs) throw new Error('Omni 生成超时（12 分钟）。');
    await sleep(pollIntervalMs);
    onProgress?.({
      phase: 'poll',
      message: `Omni 生成中… ${Math.round((Date.now() - started) / 1000)}s`,
    });
    const response = await fetch(`${base}/interactions/${encodeURIComponent(interaction.id)}`, {
      headers: { 'x-goog-api-key': apiKey },
      signal,
    });
    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
    if (!response.ok) {
      throw new Error(`Omni 轮询失败：${data?.error?.message || text.slice(0, 500) || `HTTP ${response.status}`}`);
    }
    interaction = data;
  }

  const video = findOmniVideo(interaction);
  if (!video) throw new Error('Omni 已完成，但响应里找不到视频 data/uri。');
  if (video.data) {
    const buffer = Buffer.from(video.data, 'base64');
    if (!buffer.length) throw new Error('Omni 返回了空视频。');
    return { buffer, uri: '', interactionId: interaction.id };
  }
  if (video.uri) {
    onProgress?.({ phase: 'download', message: '下载 Omni 视频…' });
    const downloadUrl = video.uri.startsWith('http')
      ? video.uri
      : `https://generativelanguage.googleapis.com${video.uri.startsWith('/') ? '' : '/'}${video.uri}`;
    const response = await fetch(downloadUrl, {
      headers: { 'x-goog-api-key': apiKey },
      signal,
    });
    if (!response.ok) throw new Error(`下载 Omni 视频失败：HTTP ${response.status}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length) throw new Error('Omni 返回了空视频。');
    return { buffer, uri: video.uri, interactionId: interaction.id };
  }
  throw new Error('Omni 视频内容为空。');
}

function findOmniVideo(payload) {
  const candidates = [];
  const walk = (value, depth = 0) => {
    if (!value || depth > 8) return;
    if (Array.isArray(value)) {
      for (const item of value) walk(item, depth + 1);
      return;
    }
    if (typeof value !== 'object') return;
    if (value.type === 'video' && (value.data || value.uri)) {
      candidates.push({ data: value.data || '', uri: value.uri || '' });
    }
    if (value.output_video && (value.output_video.data || value.output_video.uri)) {
      candidates.push({ data: value.output_video.data || '', uri: value.output_video.uri || '' });
    }
    for (const [key, item] of Object.entries(value)) {
      if (key === 'data' && typeof item === 'string' && item.length > 1000) {
        const parent = value;
        if (parent.type === 'video' || parent.mime_type) {
          candidates.push({ data: item, uri: parent.uri || '' });
        }
      }
      walk(item, depth + 1);
    }
  };
  walk(payload);
  return candidates.find((c) => c.data || c.uri) || null;
}
