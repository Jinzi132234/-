/** Minimal OpenAI-compatible chat client with retries and JSON extraction. */

const RETRYABLE = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

export class LLMError extends Error {
  constructor(message, { status = 0, code = '', body = '' } = {}) {
    super(message);
    this.name = 'LLMError';
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

function endpoint(baseUrl, suffix = '/chat/completions') {
  const base = String(baseUrl || '').replace(/\/+$/, '');
  if (!base) throw new LLMError('还没有填写 API 地址。', { code: 'NO_BASE_URL' });
  if (base.endsWith(suffix)) return base;
  if (base.endsWith('/chat/completions')) return base;
  return base + suffix;
}

export function modelsEndpoint(baseUrl) {
  const base = String(baseUrl || '').replace(/\/+$/, '');
  return base.endsWith('/v1') ? `${base}/models` : `${base}/models`;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function textFromContent(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part === 'string' ? part : part?.text || ''))
      .join('');
  }
  return '';
}

export async function chat(provider, {
  model,
  messages,
  temperature = 0.4,
  omitTemperature = false,
  maxTokens = 8000,
  jsonMode = false,
  signal,
  timeoutMs = 300000,
  retries = 3,
} = {}) {
  if (!provider?.baseUrl) throw new LLMError('还没有配置 API 地址，请到「设置」填写。', { code: 'NO_BASE_URL' });
  if (!provider?.apiKey) throw new LLMError('还没有填写 API Key，请到「设置」填写。', { code: 'NO_KEY' });
  if (!model) throw new LLMError('还没有选择模型。', { code: 'NO_MODEL' });

  const url = endpoint(provider.baseUrl);
  let lastError;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('timeout')), timeoutMs);
    const onAbort = () => controller.abort(new Error('cancelled'));
    signal?.addEventListener('abort', onAbort, { once: true });

    try {
      const body = {
        model,
        messages,
        max_tokens: maxTokens,
        stream: false,
      };
      if (!omitTemperature) body.temperature = temperature;
      if (jsonMode) body.response_format = { type: 'json_object' };

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${provider.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      const raw = await response.text();
      if (!response.ok) {
        let message = raw.slice(0, 500);
        try {
          const parsed = JSON.parse(raw);
          message = parsed?.error?.message || parsed?.message || message;
        } catch {
          /* keep raw */
        }
        const err = new LLMError(`模型接口返回 ${response.status}：${message}`, {
          status: response.status,
          body: raw.slice(0, 2000),
        });
        if (response.status === 400 && jsonMode) {
          // Some proxies do not support JSON mode; caller can retry with jsonMode off.
          throw Object.assign(err, { code: 'JSON_MODE_UNSUPPORTED' });
        }
        if (RETRYABLE.has(response.status) && attempt < retries) {
          lastError = err;
          await sleep(1500 * 2 ** attempt);
          continue;
        }
        throw err;
      }

      let data;
      try {
        data = JSON.parse(raw);
      } catch {
        throw new LLMError('模型返回的不是合法 JSON 响应。', { body: raw.slice(0, 2000) });
      }
      const choice = data.choices?.[0];
      const text = textFromContent(choice?.message?.content) || textFromContent(choice?.text);
      if (!text.trim()) throw new LLMError('模型返回了空内容。');
      return {
        text,
        usage: data.usage || null,
        model: data.model || model,
        finishReason: choice?.finish_reason || '',
      };
    } catch (error) {
      if (signal?.aborted) throw new LLMError('任务已取消。', { code: 'CANCELLED' });
      if (error?.name === 'AbortError' || /timeout/i.test(error?.message || '')) {
        lastError = new LLMError('模型请求超时。', { code: 'TIMEOUT' });
      } else if (error instanceof LLMError) {
        lastError = error;
      } else {
        lastError = new LLMError(`请求模型失败：${error.message}`, { code: 'NETWORK' });
      }
      if (attempt < retries && !lastError.code?.includes('NO_')) {
        await sleep(1500 * 2 ** attempt);
        continue;
      }
      throw lastError;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  }
  throw lastError;
}

/** Call a model asking for JSON; falls back once when a proxy rejects JSON mode. */
export async function chatJson(provider, args) {
  try {
    return await chat(provider, { ...args, jsonMode: args.jsonMode ?? true });
  } catch (error) {
    if (error.code === 'JSON_MODE_UNSUPPORTED') {
      return await chat(provider, { ...args, jsonMode: false });
    }
    throw error;
  }
}

function stripFences(text) {
  let out = String(text || '').trim();
  out = out.replace(/^```(?:json|JSON)?\s*/m, '').replace(/```\s*$/m, '');
  return out.trim();
}

/** Extract the first balanced JSON value from model output. */
export function extractJson(text) {
  const clean = stripFences(text);
  try {
    return JSON.parse(clean);
  } catch {
    /* scan */
  }
  const startIdx = clean.search(/[[{]/);
  if (startIdx < 0) throw new Error('模型输出里找不到 JSON。');
  const open = clean[startIdx];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = startIdx; i < clean.length; i += 1) {
    const ch = clean[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === open) depth += 1;
    else if (ch === close) {
      depth -= 1;
      if (depth === 0) {
        const candidate = clean.slice(startIdx, i + 1);
        try {
          return JSON.parse(candidate);
        } catch (error) {
          throw new Error(`JSON 解析失败：${error.message}`);
        }
      }
    }
  }
  throw new Error('模型输出的 JSON 不完整。');
}

export async function testProvider(provider, model) {
  const started = Date.now();
  const listUrl = modelsEndpoint(provider.baseUrl);
  let models = null;
  let modelsError = null;
  try {
    const res = await fetch(listUrl, {
      headers: { Authorization: `Bearer ${provider.apiKey}` },
      signal: AbortSignal.timeout(20000),
    });
    if (res.ok) {
      const data = await res.json();
      models = (data.data || []).map((m) => m.id).filter(Boolean);
    } else {
      modelsError = `HTTP ${res.status}`;
    }
  } catch (error) {
    modelsError = error.message;
  }

  const target = model || models?.[0] || provider.models?.[0];
  if (!target) {
    return { ok: false, latencyMs: Date.now() - started, models, modelsError, error: '请先填写模型名称。' };
  }
  try {
    const result = await chat(provider, {
      model: target,
      messages: [{ role: 'user', content: '只回复两个字：可用' }],
      maxTokens: 200,
      temperature: 0,
      retries: 1,
      timeoutMs: 60000,
    });
    return {
      ok: true,
      latencyMs: Date.now() - started,
      models,
      modelsError,
      model: target,
      reply: result.text.slice(0, 80),
    };
  } catch (error) {
    return {
      ok: false,
      latencyMs: Date.now() - started,
      models,
      modelsError,
      model: target,
      error: error.message,
      code: error.code || '',
      status: error.status || 0,
    };
  }
}
