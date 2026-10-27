import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const ROOT = path.resolve(__dirname, '..');
export const DATA_DIR = process.env.WB_DATA_DIR
  ? path.resolve(process.env.WB_DATA_DIR)
  : path.join(ROOT, 'data');
export const JOBS_DIR = path.join(DATA_DIR, 'jobs');
export const TMP_DIR = path.join(DATA_DIR, 'tmp');
export const MODELS_DIR = path.join(DATA_DIR, 'models');
export const SETTINGS_PATH = path.join(DATA_DIR, 'settings.json');
export const WORKER_DIR = path.join(ROOT, 'worker');
export const PUBLIC_DIR = path.join(ROOT, 'public');

for (const dir of [DATA_DIR, JOBS_DIR, TMP_DIR, MODELS_DIR]) {
  fs.mkdirSync(dir, { recursive: true });
}

/** Curated model lists; the settings UI can still accept any model id. */
export const PROVIDER_PRESETS = {
  aihubmix: {
    name: 'AIHubMix',
    baseUrl: 'https://aihubmix.com/v1',
    models: [
      'claude-opus-5-5',
      'claude-sonnet-5-5',
      'claude-haiku-5-5',
      'grok-4.7',
      'gemini-3.8-flash',
      'gpt-6.1-sol',
    ],
  },
  deepseek: {
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    models: ['deepseek-v4-pro', 'deepseek-flash'],
  },
  xai: {
    name: 'xAI (Grok)',
    baseUrl: 'https://api.x.ai/v1',
    models: ['grok-4.7', 'grok-4.6', 'grok-4.5', 'grok-4'],
  },
  openai: {
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    models: ['gpt-6.1-sol', 'gpt-5.5', 'gpt-4o'],
  },
  openrouter: {
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    models: [
      'anthropic/claude-opus-5.5',
      'anthropic/claude-sonnet-5.5',
      'anthropic/claude-haiku-5.5',
      'google/gemini-3.8-flash',
    ],
  },
  custom: {
    name: '自定义（OpenAI 兼容）',
    baseUrl: '',
    models: [],
  },
};

function baseProviders() {
  return Object.entries(PROVIDER_PRESETS).map(([id, preset]) => ({
    id,
    name: preset.name,
    baseUrl: preset.baseUrl,
    apiKey: '',
    models: [...preset.models],
  }));
}

function envSeed(providers) {
  const map = {
    aihubmix: process.env.WB_AIHUBMIX_API_KEY,
    deepseek: process.env.WB_DEEPSEEK_API_KEY,
    xai: process.env.WB_XAI_API_KEY,
    openai: process.env.WB_OPENAI_API_KEY,
  };
  for (const provider of providers) {
    if (!provider.apiKey && map[provider.id]) provider.apiKey = map[provider.id];
  }
  return providers;
}

export function defaultSettings() {
  return {
    version: 2,
    providers: envSeed(baseProviders()),
    tasks: {
      translate: { providerId: 'aihubmix', model: 'claude-sonnet-5-5', temperature: 0.2 },
      copy: { providerId: 'aihubmix', model: 'claude-opus-5-5', temperature: 0.7 },
      revise: { providerId: 'aihubmix', model: 'claude-opus-5-5', temperature: 0.7 },
      english: { providerId: 'aihubmix', model: 'claude-opus-5-5', temperature: 0.7 },
      production: { providerId: 'aihubmix', model: 'claude-opus-5-5', temperature: 0.6 },
      motion: { providerId: 'aihubmix', model: 'claude-opus-5-5', temperature: 0.75 },
    },
    asr: {
      model: 'medium',
      language: 'en',
      beamSize: 5,
      vad: true,
    },
    llm: {
      concurrency: 4,
      maxTokens: 8000,
      jsonMode: true,
      fallbackProviderId: 'deepseek',
      fallbackModel: 'deepseek-flash',
    },
    export: {
      subtitleMode: 'zh', // zh | bilingual
      maxLineChars: 20,
    },
    english: {
      autoRun: true,
      mode: 'oncamera',
      brief: '',
    },
    video: {
      provider: 'google-omni',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      apiKey: '',
      model: 'gemini-omni-1.1-flash',
      aspectRatio: '16:9',
      resolution: '1080p',
      durationSeconds: 8,
    },
    voice: {
      name: 'Samantha',
      rate: 165,
    },
    output: {
      subtitles: true,
    },
    translateStyle: '口语化、忠实原意，保留英文品牌名与技术名词',
    copyBrief: '',
    glossary: [
      'Grokbot = Grogobot, Grok Bot, Grok bot',
      'Mobbin = Mobin',
      'Masterclass = Masked Class, Master Class, master class',
      'Claude Code = Claude code',
      'Ethan = Eason, Isen',
    ].join('\n'),
  };
}

function deepMerge(base, override) {
  if (Array.isArray(override)) return override;
  if (override && typeof override === 'object' && !Array.isArray(base)) {
    const out = { ...base };
    for (const [key, value] of Object.entries(override)) {
      out[key] = key in base ? deepMerge(base[key], value) : value;
    }
    return out;
  }
  return override === undefined ? base : override;
}

export function ensureDirs() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(JOBS_DIR, { recursive: true });
  fs.mkdirSync(TMP_DIR, { recursive: true });
}

export function loadSettings() {
  ensureDirs();
  let stored = {};
  try {
    stored = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
  } catch {
    stored = {};
  }
  const merged = deepMerge(defaultSettings(), stored);
  // Guarantee every built-in provider exists.
  for (const [id, preset] of Object.entries(PROVIDER_PRESETS)) {
    if (!merged.providers.some((p) => p.id === id)) {
      merged.providers.push({
        id,
        name: preset.name,
        baseUrl: preset.baseUrl,
        apiKey: '',
        models: [...preset.models],
      });
    }
  }
  return merged;
}

export function saveSettings(settings) {
  ensureDirs();
  const tmp = `${SETTINGS_PATH}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(settings, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, SETTINGS_PATH);
  try {
    fs.chmodSync(SETTINGS_PATH, 0o600);
  } catch {
    /* ignore */
  }
  return settings;
}

export function resolveModel(settings, task, override = {}) {
  let binding = { ...(settings.tasks?.[task] || {}) };
  let providerId = override.providerId || binding.providerId;
  let provider = settings.providers.find((p) => p.id === providerId);

  // Per-step API override: a task can use its own base URL / key, even when it
  // shares a provider preset with other steps.
  if (binding.baseUrl || binding.apiKey) {
    provider = {
      ...(provider || {}),
      id: `task-${task}`,
      name: `${provider?.name || '自訂'} · ${task}`,
      baseUrl: binding.baseUrl || provider?.baseUrl || '',
      apiKey: binding.apiKey || provider?.apiKey || '',
      models: provider?.models || (binding.model ? [binding.model] : []),
    };
  }

  // The English VO step inherits the copy model when its own binding has no key,
  // so a one-model setup works without configuring every task twice.
  if (task === 'english' && !override.providerId && !binding.baseUrl && !binding.apiKey && !provider?.apiKey) {
    const fallback = settings.tasks?.copy || {};
    const fallbackProvider = settings.providers.find((p) => p.id === fallback.providerId);
    if (fallbackProvider?.apiKey) {
      binding = { ...fallback };
      provider = fallbackProvider;
    }
  }

  if (task === 'production' && !override.providerId && !binding.baseUrl && !binding.apiKey && !provider?.apiKey) {
    for (const fallbackTask of ['english', 'copy']) {
      const fallback = settings.tasks?.[fallbackTask] || {};
      const fallbackProvider = settings.providers.find((p) => p.id === fallback.providerId);
      if (fallbackProvider?.apiKey) {
        binding = { ...fallback };
        provider = fallbackProvider;
        break;
      }
    }
  }

  let fallback = false;
  if (!provider?.apiKey && !override.providerId && !binding.baseUrl && !binding.apiKey) {
    const preferredId = settings.llm?.fallbackProviderId;
    const preferred = settings.providers.find((p) => p.id === preferredId && p.apiKey);
    const anyProvider = settings.providers.find((p) => p.apiKey);
    const fallbackProvider = preferred || settings.providers.find((p) => p.id === 'deepseek' && p.apiKey) || anyProvider;
    if (fallbackProvider) {
      fallback = true;
      provider = fallbackProvider;
      binding = {
        providerId: fallbackProvider.id,
        model:
          fallbackProvider.id === settings.llm?.fallbackProviderId
            ? settings.llm?.fallbackModel || fallbackProvider.models?.[0]
            : fallbackProvider.models?.[0],
        temperature: binding.temperature,
      };
    }
  }

  return {
    provider,
    model: override.model || binding.model || provider?.models?.[0],
    temperature:
      override.temperature !== undefined
        ? Number(override.temperature)
        : binding.temperature ?? 0.4,
    fallback,
  };
}

export function publicSettings(settings) {
  const { apiKey: videoKey, ...videoRest } = settings.video || {};
  return {
    ...settings,
    providers: settings.providers.map(({ apiKey, ...rest }) => ({
      ...rest,
      hasKey: Boolean(apiKey),
      keyHint: apiKey ? `••••${apiKey.slice(-4)}` : '',
    })),
    tasks: Object.fromEntries(
      Object.entries(settings.tasks || {}).map(([task, binding]) => {
        const { apiKey, ...rest } = binding || {};
        return [task, {
          ...rest,
          hasKey: Boolean(apiKey),
          keyHint: apiKey ? `••••${apiKey.slice(-4)}` : '',
        }];
      }),
    ),
    video: {
      ...videoRest,
      hasKey: Boolean(videoKey),
      keyHint: videoKey ? `••••${videoKey.slice(-4)}` : '',
    },
  };
}

export function maskSecret(value = '') {
  return value ? `${value.slice(0, 4)}…${value.slice(-4)}` : '';
}
