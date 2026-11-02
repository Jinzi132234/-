/* global document, window, fetch, XMLHttpRequest, AbortController, FormData, location, setTimeout, clearTimeout */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const state = {
  settings: null,
  jobs: [],
  job: null,
  transcript: { segments: [] },
  copy: { blocks: [] },
  english: { beats: [], stats: null },
  production: { beats: {}, final: null, running: false },
  briefs: [],
  briefsRenderedKey: '',
  currentId: null,
  tab: 'subtitles',
  pollTimer: null,
  polling: false,
  segDirty: new Map(),
  copyDirty: false,
  englishDirty: false,
  pendingAssetBeat: null,
  pendingRef: null,
  pendingBriefBeat: null,
  motionGenerating: new Set(),
  motionStartedAt: new Map(),
  motionMessage: '',
  promptDrafts: new Map(),
  saveTimer: null,
  copySaveTimer: null,
  englishSaveTimer: null,
  activeSegId: null,
  followedSegId: null,
  lastRenderedId: null,
  renderedTranscript: '',
  renderedCopy: '',
  renderedEnglish: '',
  renderedProduction: '',
  renderedEdit: '',
  renderedPrompts: '',
  pipelineManual: null,
  editSubtitlesTouched: false,
  renderedLogs: '',
  uploadXhr: null,
  settingsDraft: null,
  settingsSimple: true,
  promptFilter: 'all',
  pendingAssetKind: 'asset',
  motionBatch: false,
  motionBatchMessage: '',
  wasRunning: false,
  quickPrompts: ['更口语，像老师在讲课', '缩短 30%，删掉重复', '开头加一个钩子', '改成第二人称，更有代入感'],
};

const fmtTime = (seconds) => {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
};

const fmtBytes = (bytes) => {
  const n = Number(bytes) || 0;
  if (n > 1024 ** 3) return `${(n / 1024 ** 3).toFixed(2)} GB`;
  if (n > 1024 ** 2) return `${(n / 1024 ** 2).toFixed(0)} MB`;
  return `${Math.round(n / 1024)} KB`;
};

const esc = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body && !(options.body instanceof FormData)) headers['Content-Type'] = 'application/json';
  const response = await fetch(path, { ...options, headers });
  let data = null;
  const type = response.headers.get('content-type') || '';
  if (type.includes('application/json')) data = await response.json().catch(() => null);
  if (!response.ok) {
    const message = data?.error || (data && data.message) || `请求失败（HTTP ${response.status}）`;
    throw new Error(message);
  }
  return data;
}

function toast(message, type = '') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  $('#toasts').appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transition = 'opacity .2s';
    setTimeout(() => el.remove(), 220);
  }, type === 'error' ? 6000 : 3200);
}

function setSaveState(text) {
  $('#saveState').textContent = text;
}

/* ------------------------------------------------------------------ dialogs */
let dialogResolve = null;
function openDialog({ title, text = '', input = false, value = '', okText = '确定', danger = false }) {
  $('#dialogTitle').textContent = title;
  $('#dialogText').textContent = text;
  $('#dialogText').classList.toggle('hidden', !text);
  const inputEl = $('#dialogInput');
  inputEl.classList.toggle('hidden', !input);
  inputEl.value = value;
  const ok = $('#dialogOk');
  ok.textContent = okText;
  ok.classList.toggle('danger', danger);
  $('#dialogModal').classList.remove('hidden');
  if (input) setTimeout(() => inputEl.focus(), 30);
  return new Promise((resolve) => {
    dialogResolve = resolve;
  });
}
function closeDialog(result) {
  $('#dialogModal').classList.add('hidden');
  const resolve = dialogResolve;
  dialogResolve = null;
  resolve?.(result);
}
$('#dialogCancel').addEventListener('click', () => closeDialog(null));
$('#dialogModal').addEventListener('click', (event) => {
  if (event.target === $('#dialogModal')) closeDialog(null);
});
$('#dialogOk').addEventListener('click', () => {
  const input = $('#dialogInput');
  closeDialog(input.classList.contains('hidden') ? true : input.value.trim());
});
$('#dialogInput').addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) $('#dialogOk').click();
});

/* --------------------------------------------------------------------- init */
async function init() {
  bindStaticEvents();
  initColumnSplitter();
  applyCinema(false);
  applySidebarCollapsed(localStorage.getItem('dshSidebarCollapsed') === '1');
  try {
    await loadSettings();
  } catch (error) {
    toast(`读取设置失败：${error.message}`, 'error');
  }
  await loadJobs();
  checkHealth();
  const hashMatch = /#\/job\/([a-zA-Z0-9-]+)/.exec(location.hash);
  if (hashMatch) openJob(hashMatch[1]);
  else showEmpty();
}

async function loadSettings() {
  const data = await api('/api/settings');
  state.settings = data.settings;
  if ($('#editSubtitles') && !state.editSubtitlesTouched) $('#editSubtitles').checked = data.settings.output?.subtitles !== false;
  return state.settings;
}

async function loadJobs() {
  try {
    const data = await api('/api/jobs');
    state.jobs = data.jobs || [];
    renderJobList();
  } catch (error) {
    console.warn(error);
  }
}

async function checkHealth() {
  const el = $('#health');
  try {
    const data = await api('/api/health');
    if (data.asr.ok) {
      el.className = 'health ok';
      el.querySelector('span').textContent = '本地转写就绪';
      el.title = data.asr.detail;
    } else {
      el.className = 'health bad';
      el.querySelector('span').textContent = '转写环境异常';
      el.title = data.asr.detail;
    }
  } catch (error) {
    el.className = 'health bad';
    el.querySelector('span').textContent = '服务未连接';
    el.title = error.message;
  }
}

/* ----------------------------------------------------------------- job list */
function jobStatus(job) {
  if (job.running) return 'run';
  const steps = job.steps || {};
  if (Object.values(steps).some((step) => step?.state === 'error')) return 'error';
  if (steps.copy?.state === 'done') return 'done';
  if (steps.asr?.state === 'done') return 'partial';
  return 'idle';
}

function renderJobList() {
  const list = $('#jobList');
  list.innerHTML = '';
  $('#jobCount').textContent = state.jobs.length;
  if (!state.jobs.length) {
    const empty = document.createElement('div');
    empty.className = 'job-empty';
    empty.style.cssText = 'padding:14px 9px;color:var(--faint);font-size:11px;line-height:1.7';
    empty.textContent = '还没有项目，点上方「新建项目」上传第一支课程视频。';
    list.appendChild(empty);
    return;
  }
  for (const job of state.jobs) {
    const status = jobStatus(job);
    const hasEnglish = job.steps?.english?.state === 'done';
    const item = document.createElement('div');
    item.className = `job-item${job.id === state.currentId ? ' active' : ''}`;
    item.dataset.id = job.id;
    item.innerHTML = `
      <span class="dot ${status}"></span>
      <div class="ji-body">
        <div class="ji-title">${esc(job.title)}</div>
        <div class="ji-meta"><span>${fmtTime(job.source?.duration || 0)}</span><span>${hasEnglish ? '已出分鏡' : status === 'done' ? '已生成文案' : status === 'run' ? '处理中' : status === 'error' ? '出错' : status === 'partial' ? '已转写' : '待处理'}</span></div>
      </div>
      <button class="ji-del" title="删除">×</button>`;
    item.addEventListener('click', (event) => {
      if (event.target.closest('.ji-del')) return;
      openJob(job.id);
    });
    item.querySelector('.ji-del').addEventListener('click', async (event) => {
      event.stopPropagation();
      if (!(await openDialog({ title: '删除这个项目？', text: `「${job.title}」的视频、字幕和文案都会从本机删除。`, okText: '删除', danger: true }))) return;
      try {
        await api(`/api/jobs/${job.id}`, { method: 'DELETE' });
        if (state.currentId === job.id) showEmpty();
        await loadJobs();
        toast('项目已删除');
      } catch (error) {
        toast(error.message, 'error');
      }
    });
    list.appendChild(item);
  }
}

/* -------------------------------------------------------------------- views */
function showEmpty() {
  flushEdits().catch(() => {});
  stopPolling();
  state.currentId = null;
  state.job = null;
  state.transcript = { segments: [] };
  state.copy = { blocks: [] };
  state.english = { beats: [], stats: null };
  state.production = { beats: {}, final: null, running: false };
  state.briefs = [];
  state.briefsRenderedKey = '';
  state.promptDrafts.clear();
  state.renderedPrompts = '';
  state.segDirty.clear();
  state.copyDirty = false;
  state.englishDirty = false;
  $('#emptyView').classList.remove('hidden');
  $('#jobView').classList.add('hidden');
  $('#jobView').classList.remove('focus');
  history.replaceState(null, '', location.pathname);
  renderJobList();
}

async function flushEdits() {
  if (state.segDirty.size) await saveTranscriptEdits();
  if (state.copyDirty) await saveCopyEdits();
  if (state.englishDirty) await saveEnglishEdits();
}

async function openJob(id) {
  if (!id) return;
  await flushEdits();
  stopPolling();
  state.currentId = id;
  state.segDirty.clear();
  state.copyDirty = false;
  state.renderedTranscript = '';
  state.renderedCopy = '';
  state.renderedEnglish = '';
  state.renderedProduction = '';
  state.renderedEdit = '';
  state.renderedLogs = '';
  state.englishDirty = false;
  state.english = { beats: [], stats: null };
  state.production = { beats: {}, final: null, running: false };
  state.briefs = [];
  state.briefsRenderedKey = '';
  state.promptDrafts.clear();
  state.renderedPrompts = '';
  state.lastRenderedId = null;
  $('#emptyView').classList.add('hidden');
  $('#jobView').classList.remove('hidden');
  history.replaceState(null, '', `#/job/${id}`);
  try {
    const data = await api(`/api/jobs/${id}`);
    applyData(data, { force: true });
    setTab(state.tab);
    renderJobList();
    if (data.job.running || data.production?.running) startPolling();
  } catch (error) {
    toast(`打开项目失败：${error.message}`, 'error');
    showEmpty();
  }
}

function applyData(data, { force = false } = {}) {
  const previousRunning = state.job?.running;
  state.job = data.job;
  const wasRunning = Boolean(data.job.running);
  state.wasRunning = wasRunning;

  const incoming = data.transcript?.segments || [];
  if (force || state.transcript.segments.length !== incoming.length) {
    state.transcript = data.transcript || { segments: [] };
  } else {
    const byId = new Map(incoming.map((segment) => [segment.id, segment]));
    for (const segment of state.transcript.segments) {
      const fresh = byId.get(segment.id);
      if (!fresh) continue;
      if (state.segDirty.has(segment.id)) continue;
      if (document.activeElement?.dataset?.segId === segment.id) continue;
      segment.zh = fresh.zh;
      segment.text = fresh.text;
    }
  }

  const copyBlocks = data.copy?.blocks || [];
  if (force || state.renderedCopy !== `${data.copy?.generatedAt || ''}|${copyBlocks.length}`) {
    if (!state.copyDirty) state.copy = data.copy || { blocks: [] };
  }

  const englishBeats = data.english?.beats || [];
  const englishKey = `${data.english?.generatedAt || ''}|${data.english?.editedAt || ''}|${englishBeats.length}`;
  if (force || state.renderedEnglish !== englishKey) {
    if (!state.englishDirty) state.english = data.english || { beats: [], stats: null };
  }

  renderJobHeader();
  renderPipeline();
  renderNotice();
  renderPrimaryButton();
  renderTabsMeta();
  const prodKey = `${data.production?.updatedAt || ''}|${data.production?.final?.generatedAt || ''}|${data.production?.running ? 1 : 0}|${data.production?.progress?.pct || 0}|${data.production?.progress?.message || ''}|${Object.values(data.production?.beats || {})
    .map((entry) => `${entry.status}${entry.updatedAt || ''}`)
    .join(',')}`;
  if (force || state.renderedProduction !== prodKey) state.production = data.production || { beats: {}, final: null, running: false };

  state.briefs = Array.isArray(data.briefs) ? data.briefs : [];

  renderTranscript();
  renderCopy();
  renderEnglish();
  if (state.tab === 'production') renderProduction();
  renderPrompts();
  renderModelMap();
  renderEdit();
  renderBriefs();
  renderLogs();
  if (state.tab === 'export') renderExportGrid();

  if (previousRunning && !data.job.running) {
    // Pipeline just settled: refresh list + full render once.
    loadJobs();
    setTimeout(() => {
      if (state.currentId) refreshOnce();
    }, 800);
  }
}

async function refreshOnce() {
  if (!state.currentId) return;
  try {
    const data = await api(`/api/jobs/${state.currentId}`);
    state.renderedTranscript = '';
    state.renderedCopy = '';
    applyData(data, { force: false });
    if (data.job.running || data.production?.running) startPolling();
  } catch (error) {
    console.warn(error);
  }
}

function startPolling() {
  if (state.polling) return;
  state.polling = true;
  const tick = async () => {
    if (!state.currentId) {
      state.polling = false;
      return;
    }
    try {
      const data = await api(`/api/jobs/${state.currentId}`);
      applyData(data);
      if (!data.job.running && !data.production?.running) {
        state.polling = false;
        return;
      }
    } catch (error) {
      console.warn(error);
    }
    state.pollTimer = setTimeout(tick, 1200);
  };
  tick();
}

function stopPolling() {
  state.polling = false;
  if (state.pollTimer) clearTimeout(state.pollTimer);
  state.pollTimer = null;
}

function renderJobHeader() {
  const job = state.job;
  if (!job) return;
  if (state.lastRenderedId !== job.id) {
    $('#jobTitle').textContent = job.title;
    $('#jobIdShort').textContent = job.id;
    state.lastRenderedId = job.id;
    const player = $('#player');
    player.src = `/api/media/${job.id}`;
    player.load();
    $('#playerEmpty').classList.remove('hidden');
    player.addEventListener('loadeddata', () => $('#playerEmpty').classList.add('hidden'), { once: true });
    player.addEventListener('error', () => {
      $('#playerEmpty').textContent = '视频无法播放，但转写与文案不受影响';
      $('#playerEmpty').classList.remove('hidden');
    }, { once: true });
  }
  $('#jobTitle').title = '点击可重命名';

  const chips = $('#jobChips');
  chips.innerHTML = '';
  const addChip = (html, cls = '') => {
    const chip = document.createElement('span');
    chip.className = `chip ${cls}`;
    chip.innerHTML = html;
    chips.appendChild(chip);
  };
  addChip(`<b>${fmtTime(job.source?.duration || 0)}</b> 时长`);
  if (job.source?.width) addChip(`${job.source.width}×${job.source.height}`);
  addChip(fmtBytes(job.source?.size || 0));
  addChip(`<b>${state.transcript.segments.length}</b> 句字幕`);
  if (state.english.beats?.length) addChip(`<b>${state.english.beats.length}</b> 拍分鏡`);
  if (job.models?.translate) addChip(esc(job.models.translate), 'model');

  const meta = $('#playerMeta');
  meta.innerHTML = '';
  meta.appendChild(makeChip(`${state.transcript.segments.filter((s) => s.zh).length}/${state.transcript.segments.length} 句已翻译`));
  if (job.usage?.calls) meta.appendChild(makeChip(`${job.usage.calls} 次模型调用`));
  if (job.usage?.completionTokens) meta.appendChild(makeChip(`${job.usage.completionTokens} tokens 输出`));
}

function makeChip(text) {
  const chip = document.createElement('span');
  chip.className = 'chip';
  chip.textContent = text;
  return chip;
}

const STEP_TABS = { asr: 'subtitles', translate: 'subtitles', copy: 'copy', english: 'english' };

function jumpToStep(step) {
  const tab = STEP_TABS[step];
  if (!tab) return;
  setTab(tab);
  state.pipelineManual = step;
  updatePipelineActive(tab);
  if (step === 'asr') {
    requestAnimationFrame(() => {
      const list = $('#segList');
      if (list) list.scrollTop = 0;
    });
  }
  if (step === 'translate') {
    requestAnimationFrame(() => {
      const row = $$('#segList .seg').find((el) => el.querySelector('textarea.zh')?.value.trim());
      (row || $('#segList'))?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
  }
}

function updatePipelineActive(tab = state.tab) {
  let active = state.pipelineManual || '';
  if (!active && tab === 'subtitles') {
    active = state.transcript.segments.some((segment) => segment.zh) ? 'translate' : 'asr';
  } else if (!active && tab === 'copy') active = 'copy';
  else if (!active && (tab === 'english' || tab === 'production' || tab === 'edit' || tab === 'export')) active = 'english';
  $$('.pipe-step').forEach((el) => el.classList.toggle('active', el.dataset.step === active));
}

const STEP_LABELS = { asr: '英文转写', translate: '中文翻译', copy: '文案分段', english: '英文分鏡' };
function renderPipeline() {
  const job = state.job;
  if (!job) return;
  const steps = job.steps || {};
  let total = 0;
  for (const name of ['asr', 'translate', 'copy', 'english']) {
    const step = steps[name] || {};
    const el = $(`.pipe-step[data-step="${name}"]`);
    if (!el) continue;
    el.className = `pipe-step ${step.state || 'idle'}`;
    const dot = el.querySelector('.pipe-dot');
    dot.innerHTML = step.state === 'done' ? '✓' : `<span>${name === 'asr' ? 1 : name === 'translate' ? 2 : name === 'copy' ? 3 : 4}</span>`;
    const body = el.querySelector('.pipe-body');
    body.querySelector('strong').textContent = STEP_LABELS[name];
    body.querySelector('em').textContent =
      step.state === 'running'
        ? step.message || '处理中…'
        : step.state === 'done'
          ? step.message || '完成'
          : step.state === 'error'
            ? step.error || step.message || '失败'
            : step.state === 'idle' && step.message
              ? step.message
              : name === 'translate'
                ? '等待转写'
                : name === 'copy'
                  ? '等待翻译'
                  : name === 'english'
                    ? '等待文案'
                    : '等待开始';
    el.querySelector('.pipe-pct').textContent = step.state === 'running' ? `${step.pct || 0}%` : '';
    total += step.state === 'done' ? 100 : Number(step.pct) || 0;
  }
  $('#pipeBar').style.width = `${Math.round(total / 4)}%`;
  $('#pipeOverall').textContent = `${Math.round(total / 4)}%`;
  updatePipelineActive(state.tab);
}

function hasKeyFor(task) {
  if (!state.settings) return false;
  const find = (name) => {
    const binding = state.settings.tasks?.[name];
    return state.settings.providers?.find((p) => p.id === binding?.providerId);
  };
  const binding = state.settings.tasks?.[task];
  if (binding?.hasKey) return true;
  let provider = find(task);
  if (provider?.hasKey) return true;
  if (task === 'english') {
    const copyProvider = find('copy');
    if (copyProvider?.hasKey) return true;
  }
  // A custom base URL without a key will not fall back; keep the warning.
  if (binding?.baseUrl) return false;
  const fallback = state.settings.providers?.find(
    (p) => p.id === state.settings.llm?.fallbackProviderId,
  );
  return Boolean(fallback?.hasKey);
}

function renderNotice() {
  const notice = $('#notice');
  const job = state.job;
  if (!job) return;
  const running = job.running;
  const hasSegments = state.transcript.segments.length > 0;
  const zhCount = state.transcript.segments.filter((s) => s.zh).length;
  const hasCopy = (state.copy.blocks || []).length > 0;
  const failed =
    Object.values(job.steps || {}).find((step) => step.state === 'error') ||
    (!running && job.lastError ? { error: job.lastError } : null);

  if (failed && !running) {
    notice.className = 'notice error';
    notice.innerHTML = `<b>处理中断</b><span>${esc(failed.error || failed.message || '未知错误')}</span><span class="spacer"></span><button class="btn small ghost" data-notice="settings">检查设置</button><button class="btn small ghost" data-notice="retry">重试</button>`;
  } else if (running) {
    notice.className = 'notice';
    const active = ['asr', 'translate', 'copy'].find((name) => job.steps?.[name]?.state === 'running');
    notice.innerHTML = `<b>正在处理</b><span>${esc(job.steps?.[active]?.message || '请稍候…')}</span>`;
  } else if (!hasSegments) {
    notice.className = 'notice';
    notice.innerHTML = `<b>视频已就绪</b><span>点击右上角「开始转写」，本机识别英文并生成时间戳。视频不会上传到云端。</span>`;
  } else if (zhCount === 0) {
    notice.className = 'notice warn';
    notice.innerHTML = hasKeyFor('translate')
      ? `<b>英文转写完成</b><span>可以生成中文文案了。</span><span class="spacer"></span><button class="btn small primary" data-notice="translate">生成中文</button>`
      : `<b>转写完成</b><span>还没有配置翻译模型。到「设置」里填入 Claude / Grok 的 API Key 后即可生成中文。</span><span class="spacer"></span><button class="btn small ghost" data-notice="settings">去设置</button>`;
  } else if (zhCount > 0 && zhCount < state.transcript.segments.length) {
    notice.className = 'notice warn';
    notice.innerHTML = `<b>翻译未完成</b><span>还有 ${state.transcript.segments.length - zhCount} 句没有中文，可继续翻译。</span><span class="spacer"></span><button class="btn small ghost" data-notice="translate">继续翻译</button>`;
  } else if (!hasCopy) {
    notice.className = 'notice';
    notice.innerHTML = `<b>中文翻译完成</b><span>接下来把字幕整理成可拍摄的分段文案。</span><span class="spacer"></span><button class="btn small primary" data-notice="copy">生成分段文案</button>`;
  } else if (!(state.english.beats || []).length) {
    if (!hasKeyFor('english')) {
      notice.className = 'notice warn';
      notice.innerHTML = `<b>中文文案已完成</b><span>下一步要生成英文 YouTube 分鏡，但还没有配置分鏡模型的 Key。</span><span class="spacer"></span><button class="btn small ghost" data-notice="settings">去设置</button>`;
    } else {
      notice.className = 'notice';
      notice.innerHTML = `<b>中文文案已完成</b><span>依 SKILL 生成英文 YouTube 口播分鏡：每拍一个镜头、≤25 words。</span><span class="spacer"></span><button class="btn small primary" data-notice="english">生成英文分鏡</button>`;
    }
  } else {
    notice.className = 'notice hidden';
    notice.innerHTML = '';
  }

  notice.querySelectorAll('[data-notice]').forEach((button) => {
    button.addEventListener('click', () => {
      const action = button.dataset.notice;
      if (action === 'settings') openSettings();
      if (action === 'translate') runSteps(['translate', 'copy', 'english']);
      if (action === 'copy') runSteps(['copy', 'english']);
      if (action === 'english') runSteps(['english']);
      if (action === 'retry') retryFailed();
    });
  });
}

function retryFailed() {
  const steps = state.job?.steps || {};
  if (steps.asr?.state !== 'done') return runSteps(['asr', 'translate', 'copy', 'english']);
  if (steps.translate?.state !== 'done') return runSteps(['translate', 'copy', 'english']);
  if (steps.copy?.state !== 'done') return runSteps(['copy', 'english']);
  if (steps.english?.state !== 'done') return runSteps(['english']);
}

function renderPrimaryButton() {
  const job = state.job;
  if (!job) return;
  const button = $('#runBtn');
  const cancel = $('#cancelBtn');
  cancel.classList.toggle('hidden', !job.running);
  button.disabled = Boolean(job.running);
  if (job.running) {
    button.textContent = '处理中…';
    return;
  }
  const hasSegments = state.transcript.segments.length > 0;
  const zhCount = state.transcript.segments.filter((s) => s.zh).length;
  const hasCopy = (state.copy.blocks || []).length > 0;
  const hasEnglish = (state.english.beats || []).length > 0;
  if (!hasSegments) {
    button.textContent = '开始转写';
    button.dataset.action = 'asr';
  } else if (zhCount < state.transcript.segments.length * 0.5) {
    button.textContent = '生成中文文案';
    button.dataset.action = 'translate';
  } else if (!hasCopy) {
    button.textContent = '生成分段文案';
    button.dataset.action = 'copy';
  } else if (!hasEnglish) {
    button.textContent = '生成英文分鏡';
    button.dataset.action = 'english';
  } else {
    button.textContent = '查看导出';
    button.dataset.action = 'export';
  }
}

function renderTabsMeta() {
  $('#subCount').textContent = state.transcript.segments.length;
  $('#copyCount').textContent = (state.copy.blocks || []).length;
  $('#voCount').textContent = (state.english.beats || []).length;
  if ($('#promptCount')) $('#promptCount').textContent = (state.english.beats || []).length;
}

/* --------------------------------------------------------------- transcript */
function renderTranscript() {
  const segments = state.transcript.segments;
  const key = `${segments.length}|${segments[0]?.text || ''}|${segments[segments.length - 1]?.id || ''}`;
  if (state.renderedTranscript === key && $('#segList').children.length === segments.length) {
    updateTranscriptTexts();
    applyTranscriptFilter();
    return;
  }
  state.renderedTranscript = key;
  const list = $('#segList');
  list.innerHTML = '';
  if (!segments.length) {
    list.innerHTML = '<div style="padding:50px 20px;text-align:center;color:var(--faint);font-size:12px">还没有字幕。点击右上角「开始转写」。</div>';
    return;
  }
  const fragment = document.createDocumentFragment();
  for (const segment of segments) {
    const row = document.createElement('div');
    row.className = 'seg';
    row.dataset.id = segment.id;
    const time = document.createElement('button');
    time.className = 'time';
    time.textContent = fmtTime(segment.start);
    time.title = '跳转到这一句';
    const body = document.createElement('div');
    const en = document.createElement('div');
    en.className = 'en';
    en.textContent = segment.text;
    const zh = document.createElement('textarea');
    zh.className = 'zh';
    zh.rows = 1;
    zh.dataset.segId = segment.id;
    zh.value = segment.zh || '';
    zh.placeholder = segment.zh ? '' : '（待翻译）';
    zh.spellcheck = false;
    body.append(en, zh);
    row.append(time, body);
    fragment.appendChild(row);
  }
  list.appendChild(fragment);
  $$('#segList textarea.zh').forEach(autoGrow);
  $('#showEn').checked = !$('#segList').classList.contains('hide-en');
  applyTranscriptFilter();
}

function autoGrow(textarea) {
  textarea.style.height = 'auto';
  textarea.style.height = `${Math.max(23, textarea.scrollHeight)}px`;
}

function updateTranscriptTexts() {
  for (const segment of state.transcript.segments) {
    const row = $(`.seg[data-id="${segment.id}"]`);
    if (!row) continue;
    const en = row.querySelector('.en');
    if (en && en.textContent !== segment.text) en.textContent = segment.text;
    const zh = row.querySelector('textarea.zh');
    if (zh && document.activeElement !== zh && !state.segDirty.has(segment.id)) {
      if (zh.value !== (segment.zh || '')) {
        zh.value = segment.zh || '';
        autoGrow(zh);
      }
      zh.placeholder = segment.zh ? '' : '（待翻译）';
    }
  }
}

function applyTranscriptFilter() {
  const query = $('#segSearch').value.trim().toLowerCase();
  const rows = $$('#segList .seg');
  for (const row of rows) {
    if (!query) {
      row.style.display = '';
      continue;
    }
    const text = row.textContent.toLowerCase();
    row.style.display = text.includes(query) ? '' : 'none';
  }
}

function onTranscriptInput(event) {
  const textarea = event.target.closest('textarea.zh');
  if (!textarea) return;
  const id = textarea.dataset.segId;
  const segment = state.transcript.segments.find((s) => s.id === id);
  if (!segment) return;
  segment.zh = textarea.value;
  state.segDirty.set(id, textarea.value);
  autoGrow(textarea);
  setSaveState('未保存…');
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(saveTranscriptEdits, 900);
}

async function saveTranscriptEdits() {
  if (!state.segDirty.size || !state.currentId) return;
  const payload = Array.from(state.segDirty.entries()).map(([id, zh]) => ({ id, zh }));
  state.segDirty.clear();
  try {
    await api(`/api/jobs/${state.currentId}/transcript`, {
      method: 'PATCH',
      body: JSON.stringify({ segments: payload }),
    });
    setSaveState(`已保存 ${new Date().toLocaleTimeString('zh-CN', { hour12: false })}`);
  } catch (error) {
    for (const [id, zh] of payload) state.segDirty.set(id, zh);
    setSaveState('保存失败');
    toast(`字幕保存失败：${error.message}`, 'error');
  }
}

/* -------------------------------------------------------------- video sync */
let lastTimeSync = 0;
function syncPlayback() {
  const video = $('#player');
  const segments = state.transcript.segments;
  if (!segments.length || !video.duration) return;
  const now = video.currentTime;
  if (Date.now() - lastTimeSync < 120) return;
  lastTimeSync = Date.now();
  const active = findSegmentAt(now);
  $('#nowTime').textContent = fmtTime(now);
  if (active) {
    $('#nowZh').textContent = active.zh || active.text;
    if (state.activeSegId !== active.id) {
      state.activeSegId = active.id;
      $$('#segList .seg.active').forEach((el) => el.classList.remove('active'));
      const row = $(`.seg[data-id="${active.id}"]`);
      if (row) {
        row.classList.add('active');
        if ($('#followPlay').checked && row.offsetParent !== null) {
          row.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }
      }
    }
  } else {
    $('#nowZh').textContent = '…';
  }
}

function findSegmentAt(time) {
  const segments = state.transcript.segments;
  let low = 0;
  let high = segments.length - 1;
  let found = null;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const segment = segments[mid];
    if (time < segment.start) high = mid - 1;
    else if (time > segment.end) low = mid + 1;
    else {
      found = segment;
      break;
    }
  }
  return found;
}

function seekTo(seconds) {
  const video = $('#player');
  const target = Math.max(0, Number(seconds) || 0);
  const apply = () => {
    try {
      video.currentTime = target;
      video.play().catch(() => {});
      syncPlayback();
    } catch {
      /* metadata not ready yet */
    }
  };
  if (video.readyState >= 1) apply();
  else video.addEventListener('loadedmetadata', apply, { once: true });
}

/* -------------------------------------------------------------------- copy */
function renderCopy() {
  const blocks = state.copy.blocks || [];
  const key = `${blocks.length}|${state.copy.generatedAt || ''}`;
  if (state.renderedCopy === key && $('#copyList').children.length === blocks.length) {
    updateCopyTexts();
    return;
  }
  state.renderedCopy = key;
  const list = $('#copyList');
  list.innerHTML = '';
  if (!blocks.length) {
    list.innerHTML = `<div style="padding:50px 20px;text-align:center;color:var(--faint);font-size:12px;line-height:1.9">还没有分段文案。<br/>完成中文翻译后，点右上角「生成分段文案」。</div>`;
    return;
  }
  blocks.forEach((block, index) => list.appendChild(buildCopyCard(block, index)));
}

function buildCopyCard(block, index) {
  const card = document.createElement('div');
  card.className = 'copy-card';
  card.dataset.blockId = block.id;

  const head = document.createElement('div');
  head.className = 'copy-head';
  const badge = document.createElement('span');
  badge.className = 'copy-index';
  badge.textContent = String(index + 1).padStart(2, '0');
  const title = document.createElement('input');
  title.className = 'copy-title';
  title.value = block.title;
  title.dataset.field = 'title';
  title.spellcheck = false;
  const time = document.createElement('button');
  time.className = 'copy-time';
  time.textContent = `${fmtTime(block.start)} – ${fmtTime(block.end)}`;
  time.title = '定位到这一段';
  time.addEventListener('click', () => seekTo(block.start));
  head.append(badge, title, time);

  const text = document.createElement('textarea');
  text.className = 'copy-text';
  text.value = block.copy;
  text.dataset.field = 'copy';
  text.spellcheck = false;
  text.rows = 1;

  const foot = document.createElement('div');
  foot.className = 'copy-foot';
  const stat = document.createElement('div');
  stat.className = 'copy-stat';
  stat.innerHTML = `<span>${block.chars || text.value.replace(/\s/g, '').length} 字</span><span>口播约 ${Math.round(block.estSeconds || 0)} 秒</span>`;
  const screen = document.createElement('input');
  screen.className = 'copy-screen';
  screen.placeholder = '屏幕字（可留空）';
  screen.value = block.screenText || '';
  screen.dataset.field = 'screenText';
  const actions = document.createElement('div');
  actions.className = 'copy-actions';
  const revise = document.createElement('button');
  revise.className = 'btn small ghost';
  revise.textContent = 'AI 改写';
  revise.addEventListener('click', () => toggleReviseBox(card, block));
  const copyBtn = document.createElement('button');
  copyBtn.className = 'icon-btn';
  copyBtn.title = '复制这一段';
  copyBtn.textContent = '⧉';
  copyBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(text.value);
      toast('已复制这一段文案');
    } catch {
      toast('浏览器不允许访问剪贴板', 'error');
    }
  });
  actions.append(revise, copyBtn);
  foot.append(stat, screen, document.createElement('span'), actions);
  foot.querySelector('.spacer')?.remove();
  const spacer = document.createElement('div');
  spacer.className = 'spacer';
  foot.insertBefore(spacer, actions);

  card.append(head, text, foot);
  text.addEventListener('input', () => {
    block.copy = text.value;
    block.chars = text.value.replace(/\s/g, '').length;
    block.estSeconds = Math.round((block.chars / 4.2) * 10) / 10;
    stat.innerHTML = `<span>${block.chars} 字</span><span>口播约 ${Math.round(block.estSeconds)} 秒</span>`;
    autoGrow(text);
    markCopyDirty();
  });
  title.addEventListener('input', () => {
    block.title = title.value;
    markCopyDirty();
  });
  screen.addEventListener('input', () => {
    block.screenText = screen.value;
    markCopyDirty();
  });
  if (block.summary) {
    const summary = document.createElement('div');
    summary.className = 'copy-summary';
    summary.style.cssText = 'font-size:10.5px;color:var(--faint);margin-top:2px';
    summary.textContent = block.summary;
    card.insertBefore(summary, text);
  }
  requestAnimationFrame(() => autoGrow(text));
  return card;
}

function updateCopyTexts() {
  if (state.copyDirty) return;
  for (const block of state.copy.blocks || []) {
    const card = $(`.copy-card[data-block-id="${block.id}"]`);
    if (!card) continue;
    const text = card.querySelector('.copy-text');
    const title = card.querySelector('.copy-title');
    if (text && document.activeElement !== text) text.value = block.copy;
    if (title && document.activeElement !== title) title.value = block.title;
  }
}

function markCopyDirty() {
  state.copyDirty = true;
  setSaveState('未保存…');
  clearTimeout(state.copySaveTimer);
  state.copySaveTimer = setTimeout(saveCopyEdits, 1000);
}

async function saveCopyEdits() {
  if (!state.copyDirty || !state.currentId) return;
  state.copyDirty = false;
  try {
    const result = await api(`/api/jobs/${state.currentId}/copy`, {
      method: 'PATCH',
      body: JSON.stringify({ blocks: state.copy.blocks }),
    });
    if (!state.copyDirty) state.copy = result.copy;
    setSaveState(`已保存 ${new Date().toLocaleTimeString('zh-CN', { hour12: false })}`);
  } catch (error) {
    state.copyDirty = true;
    setSaveState('保存失败');
    toast(`文案保存失败：${error.message}`, 'error');
  }
}

function toggleReviseBox(card, block) {
  const existing = card.querySelector('.revise-box');
  if (existing) {
    existing.remove();
    return;
  }
  const box = document.createElement('div');
  box.className = 'revise-box';
  const chips = document.createElement('div');
  chips.className = 'quick-prompts';
  state.quickPrompts.forEach((prompt) => {
    const button = document.createElement('button');
    button.textContent = prompt;
    button.addEventListener('click', () => {
      input.value = prompt;
      input.focus();
    });
    chips.appendChild(button);
  });
  const row = document.createElement('div');
  row.className = 'revise-row';
  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = '告诉 AI 怎么改这一段，例如：更口语、缩到 200 字…';
  const run = document.createElement('button');
  run.className = 'btn small primary';
  run.textContent = '改写';
  row.append(input, run);
  const result = document.createElement('div');
  result.className = 'revise-result hidden';
  const actions = document.createElement('div');
  actions.className = 'revise-actions hidden';
  const apply = document.createElement('button');
  apply.className = 'btn small primary';
  apply.textContent = '替换原文';
  const cancel = document.createElement('button');
  cancel.className = 'btn small ghost';
  cancel.textContent = '取消';
  actions.append(cancel, apply);
  box.append(chips, row, result, actions);
  card.appendChild(box);

  cancel.addEventListener('click', () => box.remove());
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) run.click();
  });
  let revised = '';
  run.addEventListener('click', async () => {
    const instruction = input.value.trim();
    if (!instruction) {
      input.focus();
      return;
    }
    run.disabled = true;
    run.textContent = '改写中…';
    try {
      const data = await api(`/api/jobs/${state.currentId}/revise`, {
        method: 'POST',
        body: JSON.stringify({ blockId: block.id, instruction }),
      });
      revised = data.text;
      result.textContent = revised;
      result.classList.remove('hidden');
      actions.classList.remove('hidden');
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      run.disabled = false;
      run.textContent = '改写';
    }
  });
  apply.addEventListener('click', () => {
    if (!revised) return;
    const textarea = card.querySelector('.copy-text');
    textarea.value = revised;
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    box.remove();
    toast('已替换，记得检查一遍再导出', 'ok');
  });
  setTimeout(() => input.focus(), 30);
}

/* ------------------------------------------------------------- english VO */
function countEnglishWords(text) {
  return String(text || '')
    .trim()
    .split(/\s+/)
    .filter((token) => /[A-Za-z0-9]/.test(token)).length;
}

function beatMetrics(beat) {
  beat.words = countEnglishWords(beat.vo);
  beat.estSeconds = Math.max(2, Math.round((beat.words / 2.5) * 10) / 10);
  const warnings = [];
  if (beat.words > 25) warnings.push('too_long');
  if (/[\u4e00-\u9fff]/.test(beat.vo)) warnings.push('chinese_in_vo');
  if (/(?:^|\s)[—–]|\s-\s/.test(beat.vo)) warnings.push('dash_pause');
  if (!String(beat.visual || '').trim()) warnings.push('missing_visual');
  beat.warnings = warnings;
  return beat;
}

function renderEnglish() {
  const beats = state.english?.beats || [];
  const key = `${beats.length}|${state.english?.generatedAt || ''}|${state.english?.editedAt || ''}`;
  const wrap = $('#voWrap');
  const empty = $('#voEmpty');
  $('#voCopyBtn').disabled = !beats.length;
  $('#voDownloadBtn').disabled = !beats.length;
  $('#voRegenerateBtn').disabled = !state.transcript.segments.length;
  if (state.renderedEnglish === key && $('#voBody').children.length === beats.length) {
    renderVoStats();
    return;
  }
  if (state.englishDirty) return;
  state.renderedEnglish = key;
  const body = $('#voBody');
  body.innerHTML = '';
  if (!beats.length) {
    wrap.classList.add('hidden');
    empty.classList.remove('hidden');
    empty.innerHTML = state.copy.blocks?.length
      ? '中文文案已经就绪。<br/>生成英文 YouTube 口播分镜：每拍一个镜头，英文 VO ≤25 words。'
      : '完成中文分段文案后，才能生成英文分镜。';
    if (state.copy.blocks?.length) {
      const button = document.createElement('button');
      button.className = 'btn small primary';
      button.textContent = '生成英文分鏡';
      button.addEventListener('click', () => runSteps(['english']));
      empty.appendChild(document.createElement('br'));
      empty.appendChild(button);
    }
    renderVoStats();
    return;
  }
  wrap.classList.remove('hidden');
  empty.classList.add('hidden');
  beats.forEach((beat, index) => body.appendChild(buildVoRow(beat, index)));
  requestAnimationFrame(() => {
    $$('#voBody textarea').forEach(autoGrow);
    $$('#voBody select').forEach(updateVoTypeClass);
  });
  renderVoStats();
}

function updateVoTypeClass(select) {
  select.classList.remove('t1', 't2', 't3');
  const beat = state.english.beats.find((item) => item.id === select.dataset.beatId);
  if (!beat) return;
  if (beat.type === '人物口播') select.classList.add('t1');
  else if (beat.type === 'B字卡') select.classList.add('t2');
  else select.classList.add('t3');
}

function beatSourceRange(beat) {
  const blocks = state.copy.blocks || [];
  const block = blocks.find((item) => item.id === beat.sourceBlock);
  if (!block) return null;
  const group = (state.english.beats || []).filter((item) => item.sourceBlock === beat.sourceBlock);
  if (group.length <= 1) return { start: Number(block.start) || 0, end: Number(block.end) || 0 };
  const total = group.reduce((sum, item) => sum + Math.max(1, Number(item.words) || 1), 0);
  let cursor = 0;
  let start = Number(block.start) || 0;
  for (const item of group) {
    const span = (Number(block.end) - Number(block.start) || 0) * (Math.max(1, Number(item.words) || 1) / total);
    if (item.id === beat.id) return { start, end: start + span };
    start += span;
  }
  return null;
}

function buildVoRow(beat, index) {
  const row = document.createElement('tr');
  row.dataset.beatId = beat.id;
  if (beat.warnings?.length) row.classList.add('over');

  const num = document.createElement('td');
  num.className = 'vo-num';
  const numIndex = document.createElement('span');
  numIndex.textContent = String(index + 1).padStart(2, '0');
  const range = beatSourceRange(beat);
  const time = document.createElement('button');
  time.type = 'button';
  time.className = 'vo-time';
  time.textContent = range ? fmtTime(range.start) : '--:--';
  time.title = range ? '跳到原片這一拍' : '找不到對應時間碼';
  time.addEventListener('click', (event) => {
    event.stopPropagation();
    if (range) seekTo(range.start);
  });
  num.append(numIndex, time);
  if (range) {
    row.dataset.start = String(range.start);
    row.dataset.end = String(range.end);
    row.title = '點擊跳到原片這一拍';
  }

  const typeCell = document.createElement('td');
  const select = document.createElement('select');
  select.className = 'vo-type';
  select.dataset.beatId = beat.id;
  for (const [value, label] of [['人物口播', '人物口播'], ['實操', '實操']]) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    option.selected = value === beat.type;
    select.appendChild(option);
  }
  updateVoTypeClass(select);
  typeCell.appendChild(select);

  const voCell = document.createElement('td');
  const vo = document.createElement('textarea');
  vo.className = 'vo-text';
  vo.rows = 1;
  vo.value = beat.vo;
  vo.spellcheck = false;
  const meta = document.createElement('div');
  meta.className = 'vo-meta';
  const metaText = document.createElement('span');
  const source = document.createElement('span');
  source.textContent = beat.sourceBlock ? `source ${beat.sourceBlock}` : 'source ?';
  meta.append(metaText, source);
  voCell.append(vo, meta);

  const visualCell = document.createElement('td');
  const visual = document.createElement('textarea');
  visual.className = 'vo-visual';
  visual.rows = 1;
  visual.value = beat.visual || '';
  visual.placeholder = 'UI 步骤 / 主持人构图';
  visual.spellcheck = false;
  visualCell.appendChild(visual);

  const actionCell = document.createElement('td');
  const remove = document.createElement('button');
  remove.className = 'icon-btn vo-del';
  remove.title = '删除这一拍';
  remove.textContent = '×';
  remove.addEventListener('click', () => {
    state.english.beats = state.english.beats.filter((item) => item.id !== beat.id);
    renumberBeats();
    state.renderedEnglish = '';
    renderEnglish();
    markEnglishDirty();
  });
  actionCell.appendChild(remove);

  const refreshMeta = () => {
    metaText.textContent = `${beat.words} words · ≈${beat.estSeconds}s`;
    metaText.className = beat.words > (beat.type === '實操' ? 80 : 30) ? 'over' : '';
    source.className = beat.warnings?.includes('chinese_in_vo') ? 'over' : '';
    row.classList.toggle('over', Boolean(beat.warnings?.length));
  };
  refreshMeta();

  vo.addEventListener('input', () => {
    beat.vo = vo.value;
    beatMetrics(beat);
    refreshMeta();
    autoGrow(vo);
    renderVoStats();
    markEnglishDirty();
  });
  visual.addEventListener('input', () => {
    beat.visual = visual.value;
    beatMetrics(beat);
    refreshMeta();
    autoGrow(visual);
    markEnglishDirty();
  });
  select.addEventListener('change', () => {
    beat.type = select.value;
    updateVoTypeClass(select);
    renderVoStats();
    markEnglishDirty();
  });

  row.append(num, typeCell, voCell, visualCell, actionCell);
  requestAnimationFrame(() => {
    autoGrow(vo);
    autoGrow(visual);
  });
  return row;
}

function renumberBeats() {
  state.english.beats.forEach((beat, index) => {
    beat.id = `e${index + 1}`;
  });
  $('#voBody').querySelectorAll('tr').forEach((row, index) => {
    row.querySelector('.vo-num').textContent = String(index + 1).padStart(2, '0');
  });
}

function renderVoStats() {
  const beats = state.english?.beats || [];
  const el = $('#voStats');
  if (!el) return;
  if (!beats.length) {
    el.innerHTML = '';
    return;
  }
  const counts = { 人物口播: 0, 實操: 0 };
  let words = 0;
  let seconds = 0;
  let over = 0;
  for (const beat of beats) {
    counts[beat.type] = (counts[beat.type] || 0) + 1;
    const currentWords = beat.words || countEnglishWords(beat.vo);
    words += currentWords;
    seconds += beat.estSeconds || 0;
    const wordLimit = beat.type === '實操' ? 80 : 30;
    if (
      currentWords > wordLimit ||
      /[\u4e00-\u9fff]/.test(beat.vo) ||
      /(?:^|\s)[—–]|\s-\s/.test(beat.vo)
    ) {
      over += 1;
    }
  }
  const total = beats.length;
  const pct = (value) => Math.round((value / total) * 100);
  el.innerHTML = `
    <span class="stat">${total} 拍</span>
    <span class="stat"><i class="dot d1"></i>人物 ${counts.人物口播} · ${pct(counts.人物口播)}%</span>
    <span class="stat"><i class="dot d3"></i>實操 ${counts.實操} · ${pct(counts.實操)}%</span>
    <span class="stat">${words} words · ≈${Math.round(seconds)}s</span>
    ${over ? `<span class="stat warn">${over} 拍待修正</span>` : ''}`;
}

function markEnglishDirty() {
  state.englishDirty = true;
  setSaveState('未保存…');
  clearTimeout(state.englishSaveTimer);
  state.englishSaveTimer = setTimeout(saveEnglishEdits, 1000);
}

async function saveEnglishEdits() {
  if (!state.englishDirty || !state.currentId) return;
  state.englishDirty = false;
  const beats = state.english.beats;
  try {
    const result = await api(`/api/jobs/${state.currentId}/english`, {
      method: 'PATCH',
      body: JSON.stringify({ beats }),
    });
    state.english.stats = result.english.stats;
    setSaveState(`已保存 ${new Date().toLocaleTimeString('zh-CN', { hour12: false })}`);
  } catch (error) {
    state.englishDirty = true;
    setSaveState('保存失败');
    toast(`分镜保存失败：${error.message}`, 'error');
  }
}

function voTableMarkdown() {
  const escape = (value) => String(value ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
  const lines = [
    '| # | 畫面類型 | English VO | 畫面 |',
    '|---|----------|------------|-----------|',
  ];
  (state.english.beats || []).forEach((beat, index) => {
    lines.push(`| ${index + 1} | ${beat.type} | ${escape(beat.vo)} | ${escape(beat.visual)} |`);
  });
  return lines.join('\n') + '\n';
}

async function copyVoTable() {
  if (!state.english.beats?.length) return;
  try {
    await navigator.clipboard.writeText(voTableMarkdown());
    toast('已复制 Markdown 表格', 'ok');
  } catch (error) {
    toast('浏览器不允许访问剪贴板', 'error');
  }
}

function downloadVoTable() {
  if (!state.english.beats?.length || !state.currentId) return;
  const link = document.createElement('a');
  link.href = `/api/jobs/${state.currentId}/export/vo?download=1`;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

/* ---------------------------------------------------------------- production */
const PROD_STATUS = {
  todo: '待製作',
  generating: '生成中',
  ready: '素材就緒',
  prompt: '提示詞就緒',
  script: '待錄屏',
  error: '失敗',
};

const PROD_ROUTE = {
  card: 'BROLL XML（不渲染）',
  veo: 'FLOW 手動',
  screen: '錄屏',
};

function prodCheckedIds() {
  return $$('#prodList .prod-check:checked').map((input) => input.dataset.beatId);
}

function renderProduction() {
  const list = $('#prodList');
  if (!list) return;
  const beats = state.english.beats || [];
  const production = state.production || { beats: {}, final: null, running: false };
  const entries = production.beats || {};
  if ($('#prodCount')) $('#prodCount').textContent = beats.length;
  $('#prodGenerateBtn').disabled = production.running;
  $('#prodGenerateBtn').innerHTML = production.running ? '<span class="prod-spinner"></span>處理中…' : '生成提示詞';

  const stats = { total: beats.length, ready: 0, pending: 0, error: 0 };
  for (const beat of beats) {
    const entry = entries[beat.id];
    if (entry?.status === 'ready') stats.ready += 1;
    else if (entry?.status === 'error') stats.error += 1;
    else stats.pending += 1;
  }
  $('#prodStats').innerHTML = `
    <span>${stats.total} 拍</span>
    <span>素材 ${stats.ready}</span>
    <span>待處理 ${stats.pending}</span>
    ${stats.error ? `<span style="color:var(--red)">失敗 ${stats.error}</span>` : ''}
    ${production.running ? '<span style="color:var(--accent)">處理中…</span>' : ''}
    ${production.error ? `<span style="color:var(--red)" title="${esc(production.error)}">製作失敗：${esc(production.error.slice(0, 80))}</span>` : ''}`;

  if (!beats.length) {
    list.innerHTML = '<div class="prod-empty">先完成「英文分鏡」，再進入製作。<br/>每一拍會變成一張製作卡。</div>';
    return;
  }

  const briefKey = (state.briefs || []).map((brief) => `${brief.id}:${brief.beatId || ''}`).join(',');
  const motionKey = [...(state.motionGenerating || [])].join(',');
  const key = `${beats.length}|${production.updatedAt || ''}|${production.final?.generatedAt || ''}|${briefKey}|${motionKey}|${Object.values(entries)
    .map((entry) => `${entry.status || ''}${entry.updatedAt || ''}${entry.asset || ''}`)
    .join(',')}`;
  if (state.renderedProduction === key && list.children.length === beats.length) {
    return;
  }
  const checked = new Set(prodCheckedIds());
  const scrollTop = list.scrollTop;
  state.renderedProduction = key;
  list.innerHTML = '';
  beats.forEach((beat, index) => list.appendChild(buildProdCard(beat, index, entries[beat.id] || {})));
  list.scrollTop = scrollTop;
  for (const input of $$('#prodList .prod-check')) {
    input.checked = checked.has(input.dataset.beatId);
  }
  updateProdSelectAll();
}

function formatMinutes(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function cardPromptFromSpec(spec = {}, beat = {}) {
  const lines = [`Create a flat 16:9 1920×1080 course card (no logos, no faces, no invented facts).`, `Title: ${spec.title || beat.vo || ''}`];
  if (spec.subtitle) lines.push(`Subtitle: ${spec.subtitle}`);
  if (Array.isArray(spec.bullets) && spec.bullets.length) {
    lines.push('Bullets:');
    spec.bullets.forEach((bullet) => lines.push(`- ${bullet}`));
  }
  if (spec.layout) lines.push(`Layout: ${spec.layout}`);
  if (spec.theme) lines.push(`Theme: ${spec.theme}`);
  if (spec.accent) lines.push(`Accent: ${spec.accent}`);
  if (spec.motion) lines.push(`Motion: ${spec.motion}`);
  if (spec.brollPrompt) lines.push(`Visual direction: ${spec.brollPrompt}`);
  lines.push('Text must be English, short, readable, no paragraph copy.');
  return lines.join('\n');
}

function briefMatchesCard(brief, entry = {}) {
  if (!brief) return false;
  const spec = entry.spec || {};
  const values = [spec.title, spec.subtitle, ...(spec.bullets || [])].filter(Boolean);
  if (!values.length) return true;
  const raw = brief.raw || '';
  return values.every((value) => raw.includes(value));
}

function promptTextFor(beat, entry = {}) {
  const spec = entry.spec || {};
  if (beat.type === '人物口播') return entry.videoPrompt || spec.videoPrompt || '';
  if (beat.type === 'B字卡') {
    if (entry.prompt) return entry.prompt;
    if (spec.brollPrompt) return spec.brollPrompt;
    if (spec.title && (spec.subtitle || (spec.bullets || []).length)) return cardPromptFromSpec(spec, beat);
    return '';
  }
  return entry.prompt || (spec.screenSteps || []).map((step, i) => `${i + 1}. ${step}`).join('\n');
}

function downloadBriefXml(beat, brief, mode) {
  if (!brief?.raw) {
    toast(`這一拍還沒有 ${briefLabel(mode)}`, 'error');
    return;
  }
  const spec = state.production?.beats?.[beat.id]?.spec || {};
  const slug = String(spec.title || beat.vo || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .split('-')
    .slice(0, 6)
    .join('-') || 'plate';
  const filename = mode === 'aroll'
    ? `aroll-${brief.plate || 'x'}-${slug}.md`
    : `plate-${brief.plate || 'x'}-${slug}-${mode}.xml`;
  const blob = new Blob([brief.raw], { type: 'application/xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function typeLabel(type) {
  return type === 'B字卡' ? 'Broll' : type;
}

function briefLabel(mode) {
  return mode === 'aroll' ? 'A-roll 指示詞' : 'BROLL XML';
}

function providerHasKey(providerId) {
  return Boolean((state.settings?.providers || []).find((provider) => provider.id === providerId)?.hasKey);
}

function taskConfigured(taskKey) {
  const task = state.settings?.tasks?.[taskKey];
  if (!task) return false;
  return Boolean(task.hasKey || task.apiKey || providerHasKey(task.providerId));
}

function applySidebarCollapsed(on) {
  const sidebar = $('#sidebar');
  const toggle = $('#sidebarToggle');
  if (!sidebar) return;
  sidebar.classList.toggle('collapsed', Boolean(on));
  if (toggle) {
    toggle.textContent = on ? '›' : '‹';
    toggle.title = on ? '展開專案欄' : '收起專案欄';
    toggle.setAttribute('aria-label', toggle.title);
  }
  localStorage.setItem('dshSidebarCollapsed', on ? '1' : '0');
}

function applyCinema(on) {
  const view = $('#jobView');
  if (!view) return;
  view.classList.toggle('cinema', Boolean(on));
  const button = $('#cinemaToggle');
  if (button) {
    button.textContent = on ? '分欄模式' : '影院模式';
    button.classList.toggle('active', Boolean(on));
  }
  localStorage.setItem('dshCinema', on ? '1' : '0');
}

function renderModelMap() {
  const video = state.settings?.video || {};
  const opus = state.settings?.tasks?.opus || {};
  const baseName = document.querySelector('#modelBaseName');
  const baseStatus = document.querySelector('#modelBaseStatus');
  const opusName = document.querySelector('#modelOpusName');
  const opusStatus = document.querySelector('#modelOpusStatus');
  if (baseName) baseName.textContent = video.model || 'Veo／Omni';
  if (baseStatus) {
    baseStatus.textContent = video.hasKey ? '已配置' : '待配置';
    baseStatus.style.color = video.hasKey ? '#2e7d32' : '';
  }
  if (opusName) opusName.textContent = opus.model || 'Opus 5.5';
  if (opusStatus) {
    opusStatus.textContent = taskConfigured('opus') ? '已配置' : '待配置';
    opusStatus.style.color = taskConfigured('opus') ? '#2e7d32' : '';
  }
}

async function saveReferenceUrl(beatId, kind, url) {
  if (!state.currentId) return;
  try {
    const data = await api(`/api/jobs/${state.currentId}/production/ref-url`, {
      method: 'POST',
      body: JSON.stringify({ beatId, kind, url }),
    });
    state.production = data.production;
    renderPrompts();
    toast(url ? '公開圖片 URL 已保存' : '已清除公開圖片 URL', 'ok');
  } catch (error) {
    toast(error.message, 'error');
  }
}

async function toggleApproved(beatId, approved) {
  if (!state.currentId) return;
  try {
    const data = await api(`/api/jobs/${state.currentId}/production/approve/${beatId}`, {
      method: 'POST',
      body: JSON.stringify({ approved }),
    });
    state.production = data.production;
    renderPrompts();
    toast(approved ? '已通過並鎖定，重新生成前要先取消通過' : '已取消通過', 'ok');
  } catch (error) {
    toast(error.message, 'error');
  }
}

function downloadControl(downloadHref, downloadName) {
  const download = document.createElement('a');
  download.className = 'btn small ghost';
  download.href = downloadHref;
  download.download = downloadName;
  download.textContent = '下載保存';
  return download;
}

function approvalControls(beatId, entry, downloadHref, downloadName) {
  const box = document.createElement('div');
  box.className = 'base-player-actions';
  const approve = document.createElement('button');
  approve.type = 'button';
  approve.className = `btn small ${entry.approved ? 'primary' : 'ghost'}`;
  approve.textContent = entry.approved ? '已通過 🔒' : '通過並鎖定';
  approve.title = entry.approved ? '已鎖定，重新生成前要先取消通過' : '標記為通過並鎖定，避免被重新生成覆蓋';
  approve.addEventListener('click', () => toggleApproved(beatId, !entry.approved));
  const download = document.createElement('a');
  download.className = 'btn small ghost';
  download.href = downloadHref;
  download.download = downloadName;
  download.textContent = '下載保存';
  box.append(approve, download);
  return box;
}

function promptNeedsAction(beat, entry = {}, brief = null) {
  if (beat.type === '人物口播') {
    const base = entry.baseAsset || entry.asset;
    return !base || !brief || !entry.asset;
  }
  if (beat.type === 'B字卡') return !brief || !entry.asset;
  return !entry.asset;
}

function renderPrompts() {
  const list = $('#promptList');
  if (!list) return;
  const beats = state.english.beats || [];
  const production = state.production || { beats: {}, running: false };
  const entries = production.beats || {};
  const briefs = state.briefs || [];
  const filter = state.promptFilter || 'all';
  const briefFor = (beat) => briefs.find((item) => item.beatId === beat.id && !item.stale);
  const pendingBeats = beats.filter((beat) => promptNeedsAction(beat, entries[beat.id] || {}, briefFor(beat)));
  const order = { 人物口播: 0, 實操: 1 };
  const filtered = beats.filter((beat) => {
    if (filter === 'pending') return pendingBeats.some((item) => item.id === beat.id);
    if (filter === 'person') return beat.type === '人物口播';
    if (filter === 'screen') return beat.type === '實操';
    return true;
  }).sort((a, b) => (order[a.type] ?? 9) - (order[b.type] ?? 9));

  const counts = {
    all: beats.length,
    pending: pendingBeats.length,
    person: beats.filter((beat) => beat.type === '人物口播').length,
    screen: beats.filter((beat) => beat.type === '實操').length,
  };
  const personBeats = beats.filter((beat) => beat.type === '人物口播');
  const screenBeats = beats.filter((beat) => beat.type === '實操');
  const basePending = personBeats.filter((beat) => !(entries[beat.id]?.baseAsset || entries[beat.id]?.asset)).length;
  const arollPending = personBeats.filter((beat) => !briefFor(beat)).length;
  const personFinalPending = personBeats.filter((beat) => !entries[beat.id]?.asset).length;
  const screenPending = screenBeats.filter((beat) => !entries[beat.id]?.asset).length;
  const summary = $('#promptSummary');
  if (summary) {
    summary.innerHTML = `
      <div><b>人物口播 ${personBeats.length}</b><span>待 Base ${basePending} · 待指示詞 ${arollPending} · 待成片 ${personFinalPending}</span></div>
      <div><b>實操 ${screenBeats.length}</b><span>待錄屏 ${screenPending} · 不需要提示詞</span></div>`;
  }
  const filterBox = $('#promptFilters');
  if (filterBox) {
    for (const button of filterBox.querySelectorAll('button')) {
      const key = button.dataset.filter;
      button.classList.toggle('active', key === filter);
      const base = { all: '全部', pending: '待處理', person: '人物口播', screen: '實操' }[key];
      if (!base) continue;
      button.textContent = `${base} ${counts[key] || 0}`;
    }
  }
  const progressLabel = $('#promptProgress');
  if (progressLabel) {
    progressLabel.textContent = state.motionGenerating.size
      ? (state.motionMessage || '正在生成提示詞，最長 3 分鐘…')
      : production.running
        ? (production.progress?.message || '生成提示詞中…')
        : '';
  }

  list.innerHTML = '';
  if (!beats.length) {
    list.innerHTML = '<div class="prompt-empty">先完成英文分鏡，再進入提示詞。</div>';
    return;
  }
  if (!filtered.length) {
    list.innerHTML = '<div class="prompt-empty">這個分類目前沒有分鏡。</div>';
    return;
  }

  const fragment = document.createDocumentFragment();
  let lastType = '';
  filtered.forEach((beat) => {
    const index = beats.findIndex((item) => item.id === beat.id);
    const entry = entries[beat.id] || {};
    const brief = briefs.find((item) => item.beatId === beat.id && !item.stale);
    const staleBrief = briefs.find((item) => item.beatId === beat.id && item.stale);
    const isPerson = beat.type === '人物口播';
    const isBroll = beat.type === 'B字卡';

    if (beat.type !== lastType) {
      lastType = beat.type;
      const group = document.createElement('div');
      group.className = 'prompt-group-title';
      const title = document.createElement('b');
      title.textContent = `${typeLabel(beat.type)} · ${filtered.filter((item) => item.type === beat.type).length} 拍`;
      const hint = document.createElement('span');
      hint.textContent = beat.type === '實操'
        ? '不需要提示詞，直接上傳錄屏'
        : beat.type === 'B字卡'
          ? 'BROLL XML → Opus 製作'
          : 'FLOW 提示詞 → Base → 指示詞 → Opus';
      group.append(title, hint);
      fragment.appendChild(group);
    }

    if (beat.type === '實操') {
      const row = document.createElement('div');
      row.className = 'screen-row';
      row.dataset.beatId = beat.id;
      const num = document.createElement('span');
      num.className = 's-num';
      num.textContent = `#${String(index + 1).padStart(2, '0')}`;
      const type = document.createElement('span');
      type.className = 's-type';
      type.textContent = '實操';
      const vo = document.createElement('span');
      vo.className = 's-vo';
      vo.textContent = beat.vo;
      vo.title = beat.vo;
      const status = document.createElement('span');
      status.className = 's-status';
      status.textContent = entry.error ? '失敗' : entry.asset ? '已上傳' : '待錄屏';
      const actions = document.createElement('div');
      actions.className = 's-actions';
      const upload = document.createElement('button');
      upload.type = 'button';
      upload.className = 'btn small primary';
      upload.textContent = entry.asset ? '重新上傳' : '上傳錄屏';
      upload.addEventListener('click', () => {
        state.pendingAssetBeat = beat.id;
        state.pendingAssetKind = 'asset';
        $('#prodFileInput').click();
      });
      actions.appendChild(upload);
      if (entry.asset) {
        const view = document.createElement('a');
        view.className = 'btn small ghost';
        view.textContent = '預覽';
        view.target = '_blank';
        view.rel = 'noreferrer';
        view.href = `/api/jobs/${state.currentId}/production/asset/${beat.id}?v=${encodeURIComponent(entry.updatedAt || '')}`;
        actions.appendChild(view);
      }
      row.append(num, type, vo, status, actions);
      fragment.appendChild(row);
      return;
    }

    const base = entry.baseAsset || entry.asset;
    const baseIsDedicated = Boolean(entry.baseAsset);
    const flowPrompt = entry.videoPrompt || entry.spec?.videoPrompt || '';

    const card = document.createElement('article');
    card.className = 'prompt-card flow-card';
    card.dataset.beatId = beat.id;

    const head = document.createElement('div');
    head.className = 'prompt-head';
    const num = document.createElement('span');
    num.className = 'prompt-num';
    num.textContent = `#${String(index + 1).padStart(2, '0')}`;
    const type = document.createElement('span');
    type.className = `prompt-type ${isPerson ? 't1' : isBroll ? 't2' : 't3'}`;
    type.textContent = typeLabel(beat.type);
    const vo = document.createElement('span');
    vo.className = 'prompt-vo';
    vo.textContent = beat.vo;
    const stateBadge = document.createElement('span');
    stateBadge.className = 'prompt-state';
    if (isPerson && staleBrief && !brief) stateBadge.textContent = '指示詞已過期';
    else if (isPerson && !base) stateBadge.textContent = '待 Base 視頻';
    else if (isPerson && entry.asset) stateBadge.textContent = '成片已完成';
    else if (isPerson && brief) stateBadge.textContent = '指示詞已出';
    else if (isPerson) stateBadge.textContent = 'Base 就緒 · 待指示詞';
    else if (isBroll && brief) stateBadge.textContent = 'BROLL 已出';
    else if (isBroll) stateBadge.textContent = '待 BROLL';
    else stateBadge.textContent = entry.asset ? '錄屏已上傳' : '待錄屏';
    head.append(num, type, vo, stateBadge);
    head.style.cursor = 'pointer';
    head.title = '點擊展開／收起這一拍';
    head.addEventListener('click', (event) => {
      if (event.target.closest('button,a,details')) return;
      card.classList.toggle('collapsed');
    });
    if (!promptNeedsAction(beat, entry, brief)) card.classList.add('collapsed');

    const body = document.createElement('div');
    body.className = 'prompt-body';
    const visual = document.createElement('div');
    visual.className = 'prompt-visual';
    visual.textContent = `畫面：${beat.visual || '—'}`;
    body.appendChild(visual);
    if (entry.error) {
      const error = document.createElement('div');
      error.className = 'flow-error';
      error.textContent = entry.error;
      body.appendChild(error);
    }

    const makeStep = (label, statusText, nodes) => {
      const step = document.createElement('section');
      step.className = 'flow-step';
      const stepHead = document.createElement('div');
      stepHead.className = 'flow-step-head';
      const labelEl = document.createElement('b');
      labelEl.textContent = label;
      const statusEl = document.createElement('span');
      statusEl.textContent = statusText || '';
      stepHead.append(labelEl, statusEl);
      const content = document.createElement('div');
      content.className = 'flow-step-body';
      for (const node of nodes.filter(Boolean)) content.appendChild(node);
      step.append(stepHead, content);
      return step;
    };

    const button = (text, className, onClick, disabled = false, title = '') => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `btn small ${className}`;
      btn.textContent = text;
      btn.disabled = disabled;
      btn.title = title;
      if (onClick) btn.addEventListener('click', onClick);
      return btn;
    };

    const uploadButton = (kind, text) => button(text, 'primary', () => {
      state.pendingAssetBeat = beat.id;
      state.pendingAssetKind = kind;
      $('#prodFileInput').click();
    });

    const previewLink = (kind, label) => {
      const hasBase = Boolean(entry.baseAsset);
      const file = kind === 'base' ? (entry.baseAsset || entry.asset) : entry.asset;
      if (!file) return null;
      const routeKind = kind === 'base' && hasBase ? 'base' : 'asset';
      const a = document.createElement('a');
      a.className = 'btn small ghost';
      a.textContent = label;
      a.target = '_blank';
      a.rel = 'noreferrer';
      a.href = `/api/jobs/${state.currentId}/production/${routeKind}/${beat.id}?v=${encodeURIComponent(entry.updatedAt || '')}`;
      return a;
    };

    const xmlBlock = (mode) => {
      if (!brief?.raw) return null;
      const details = document.createElement('details');
      details.className = 'flow-xml';
      const summary = document.createElement('summary');
      summary.textContent = `查看 ${briefLabel(mode)} · PLATE ${brief.plate || '—'}`;
      const pre = document.createElement('pre');
      pre.textContent = brief.raw;
      details.append(summary, pre);
      return details;
    };

    const copyXml = (mode) => {
      if (!brief?.raw) return null;
      return button(mode === 'aroll' ? '複製指示詞' : '複製 XML', 'ghost', async () => {
        try {
          await navigator.clipboard.writeText(brief.raw);
          toast(`已複製 ${briefLabel(mode)}`);
        } catch {
          toast('浏览器不允许访问剪贴板', 'error');
        }
      });
    };

    const downloadXml = (mode) => {
      if (!brief?.raw) return null;
      return button(mode === 'aroll' ? '下載指示詞' : '下載 XML', 'ghost', () => downloadBriefXml(beat, brief, mode));
    };

    const regenMotion = (mode, label) => {
      const busy = state.motionGenerating.has(beat.id);
      return button(
        busy ? `${mode === 'broll' ? 'BROLL' : 'A-roll'} 生成中…` : label,
        'ghost',
        busy ? null : () => generateMotionForBeat(beat.id, mode),
        busy,
        busy ? '正在等待模型回傳，最長 3 分鐘' : '',
      );
    };

    if (isPerson) {
      // 1. FLOW prompt (the video prompt that will be sent to Flow)
      const flowActions = document.createElement('div');
      flowActions.className = 'flow-actions';
      flowActions.appendChild(button(flowPrompt ? '重新生成 FLOW 提示詞' : '生成 FLOW 提示詞', 'ghost', () => generateProduction([beat.id], 'prompt'), production.running));
      if (flowPrompt) {
        flowActions.appendChild(button('複製 FLOW 提示詞', 'ghost', async () => {
          try { await navigator.clipboard.writeText(flowPrompt); toast('已複製 FLOW 提示詞'); }
          catch { toast('浏览器不允许访问剪贴板', 'error'); }
        }));
      }
      const flowPre = document.createElement('pre');
      flowPre.className = 'flow-prompt-text';
      flowPre.textContent = flowPrompt || '尚未生成 FLOW 提示詞。';
      const flowNote = document.createElement('div');
      flowNote.className = 'flow-note';
      flowNote.textContent = '固定模板：鏡頭全程不動、無字幕、嘴型同步；文案已自動填入這一拍的 English VO。';
      body.appendChild(makeStep('1 · FLOW 提示詞', flowPrompt ? '固定模板 · 已填入 VO' : '尚未生成', [flowActions, flowPre, flowNote]));

      // 2. Two required reference images + Flow VO base video
      const refs = entry.refs || {};
      const refsReady = Boolean(refs.character && refs.scene);
      const refGrid = document.createElement('div');
      refGrid.className = 'flow-ref-grid';
      const addRef = (kind, label) => {
        const current = refs[kind];
        if (current) {
          const item = document.createElement('button');
          item.type = 'button';
          item.className = 'flow-ref';
          const img = document.createElement('img');
          img.src = `/api/jobs/${state.currentId}/production/reference/${beat.id}/${kind}?v=${encodeURIComponent(entry.updatedAt || '')}`;
          img.alt = label;
          const caption = document.createElement('span');
          caption.textContent = label;
          item.append(img, caption);
          item.title = '點擊查看大圖';
          item.addEventListener('click', () => openImagePreview(img.src, label));
          const replace = document.createElement('span');
          replace.className = 'flow-ref-replace';
          replace.textContent = '更換';
          replace.title = `更換${label}`;
          replace.addEventListener('click', (event) => {
            event.stopPropagation();
            chooseReference(beat.id, kind);
          });
          item.appendChild(replace);
          const remove = document.createElement('span');
          remove.className = 'flow-ref-remove';
          remove.textContent = '×';
          remove.title = `移除${label}`;
          remove.addEventListener('click', (event) => {
            event.stopPropagation();
            removeReference(beat.id, kind).catch((error) => toast(error.message, 'error'));
          });
          item.appendChild(remove);
          refGrid.appendChild(item);
        } else {
          const add = document.createElement('button');
          add.type = 'button';
          add.className = 'flow-ref flow-ref-add';
          add.innerHTML = `<strong>＋ ${esc(label)}</strong><span>必填</span>`;
          add.addEventListener('click', () => chooseReference(beat.id, kind));
          refGrid.appendChild(add);
        }
      };
      addRef('scene', '場景圖');
      addRef('character', '人物三視圖');

      const urlGrid = document.createElement('div');
      urlGrid.className = 'flow-url-grid';
      const addUrlField = (kind, label, placeholder) => {
        const wrap = document.createElement('label');
        wrap.className = 'flow-url-field';
        const caption = document.createElement('span');
        caption.textContent = `${label} 公開 URL`;
        const input = document.createElement('input');
        input.type = 'url';
        input.placeholder = placeholder;
        input.value = entry.refUrls?.[kind] || '';
        input.addEventListener('change', () => saveReferenceUrl(beat.id, kind, input.value.trim()));
        input.addEventListener('keydown', (event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            input.blur();
          }
        });
        wrap.append(caption, input);
        urlGrid.appendChild(wrap);
      };
      addUrlField('scene', '場景圖', 'https://.../scene.jpg');
      addUrlField('character', '人物三視圖', 'https://.../character.jpg');
      const apiModels = /apimodels\.app/i.test(state.settings?.video?.baseUrl || '');
      const missingUrlKinds = ['scene', 'character'].filter((kind) => !String(entry.refUrls?.[kind] || '').trim());
      const urlMissing = apiModels && Boolean(entry.refs?.scene || entry.refs?.character) && missingUrlKinds.length > 0;
      const urlHint = document.createElement('div');
      urlHint.className = urlMissing ? 'flow-note is-warn' : 'flow-note';
      urlHint.textContent = urlMissing
        ? `⚠ 目前用 APIMODELS 生成，它只接受 https 公開圖片 URL，本機上傳的圖會被拒絕。還缺：${missingUrlKinds.map((kind) => (kind === 'scene' ? '場景圖' : '人物三視圖')).join('、')} 的公開 URL。`
        : '用 APIMODELS 時必填公開圖片 URL；本機上傳只作預覽。URL 需可直接被外部讀取。';
      refGrid.after(urlGrid, urlHint);

      const baseActions = document.createElement('div');
      baseActions.className = 'flow-actions';
      const hasVideoKey = Boolean(state.settings?.video?.hasKey);
      const videoModel = state.settings?.video?.model || '';
      const videoLabel = /omni/i.test(videoModel)
        ? 'Omni 1.1 Flash'
        : videoModel || 'Veo／Omni';
      const canGenerateBase = refsReady && Boolean(flowPrompt) && hasVideoKey && !entry.approved && !urlMissing;
      const generateBase = button(
        `生成人物口播視頻${hasVideoKey ? `（${videoLabel}）` : ''}`,
        'primary',
        canGenerateBase ? () => generateProduction([beat.id], 'base') : null,
        !canGenerateBase,
        !refsReady
          ? '先上傳場景圖＋人物三視圖，按鈕才會啟用'
          : urlMissing
            ? 'APIMODELS 不接受本機圖片：請先填兩個 https 公開圖片 URL'
            : !flowPrompt
            ? '先產生 FLOW 提示詞，按鈕才會啟用'
            : !hasVideoKey
              ? '到設定配置 Veo／Omni API Key 後才能直接生成；也可以先上傳 Base'
              : entry.approved
                ? '這一拍已通過並鎖定，先取消通過才能重新生成'
                : `用 ${videoLabel} 生成無動效 Base`,
      );
      baseActions.appendChild(generateBase);
      const baseStatus = document.createElement('div');
      baseStatus.className = 'flow-note';
      baseStatus.textContent = !refsReady
        ? '按鈕已保留：先上傳場景圖＋人物三視圖，才會從「不可按」變成可用。'
        : urlMissing
          ? '參考圖與提示詞已就緒，但 APIMODELS 只吃公開 URL：把兩個 https 圖片 URL 填好就會解鎖。'
          : !flowPrompt
          ? '參考圖已就緒；先產生 FLOW 提示詞，生成按鈕才會啟用。'
          : !hasVideoKey
            ? '參考圖與提示詞已就緒；配置 Veo／Omni Key 後即可按「生成人物口播視頻」，或先上傳 Base。'
            : '已就緒：按「生成人物口播視頻」會用 FLOW 提示詞＋兩張參考圖生成無動效 Base。';
      baseActions.appendChild(uploadButton('base', base ? '重新上傳 Base 視頻' : '上傳 Base 視頻'));
      const basePreview = previewLink('base', '預覽 Base');
      if (basePreview) baseActions.appendChild(basePreview);
      const baseHint = document.createElement('div');
      baseHint.className = 'flow-note';
      baseHint.textContent = refsReady
        ? '生成時會用：FLOW 提示詞 + 場景圖 + 人物三視圖；產出沒有動效的 Base。'
        : '需要兩張圖：場景圖 + 人物三視圖。兩張都上傳後才會啟用生成。';
      const basePlayer = document.createElement('div');
      basePlayer.className = 'base-player';
      const baseFile = entry.baseAsset || entry.asset;
      if (entry.status === 'generating') {
        const progress = document.createElement('div');
        progress.className = 'base-progress';
        const started = Date.parse(entry.startedAt || entry.updatedAt || '') || Date.now();
        progress.dataset.start = String(started);
        const label = document.createElement('div');
        label.className = 'base-progress-label';
        const msg = document.createElement('span');
        msg.className = 'bp-msg';
        msg.textContent = entry.realtimeMessage || 'Omni 正在生成人物口播，請稍候…';
        const pctText = document.createElement('b');
        pctText.className = 'bp-pct';
        pctText.textContent = '0%';
        label.append(msg, pctText);
        const track = document.createElement('div');
        track.className = 'base-progress-track';
        const bar = document.createElement('i');
        bar.style.width = '0%';
        track.appendChild(bar);
        progress.append(label, track);
        basePlayer.appendChild(progress);
      } else if (baseFile) {
        const label = document.createElement('div');
        label.className = 'base-player-label';
        const done = document.createElement('b');
        done.textContent = entry.baseAsset ? 'Base 已完成' : 'Base 視頻';
        const meta = document.createElement('span');
        const seconds = entry.baseAssetDuration || entry.assetDuration;
        meta.textContent = seconds ? `${Number(seconds).toFixed(1)} 秒 · 可播放／拖動` : '可播放／拖動';
        label.append(done, meta, downloadControl(
          `/api/jobs/${state.currentId}/production/base/${beat.id}?v=${encodeURIComponent(entry.updatedAt || '')}`,
          `${String(index + 1).padStart(2, '0')}-base-${beat.id}.mp4`,
        ));
        const video = document.createElement('video');
        video.className = 'base-video';
        video.controls = true;
        video.preload = 'metadata';
        video.playsInline = true;
        video.src = entry.baseAsset
          ? `/api/jobs/${state.currentId}/production/base/${beat.id}?v=${encodeURIComponent(entry.updatedAt || '')}`
          : `/api/jobs/${state.currentId}/production/asset/${beat.id}?v=${encodeURIComponent(entry.updatedAt || '')}`;
        basePlayer.append(label, video);
      }
      const stepNodes = [refGrid, baseActions, baseStatus, baseHint];
      if (basePlayer.children.length) stepNodes.splice(1, 0, basePlayer);
      body.appendChild(makeStep('2 · 參考圖＋Base 人物視頻', base ? 'Base 已上傳' : refsReady ? '參考圖已就緒' : '缺參考圖', stepNodes));

      // 3. AROLL prompt after base
      const arollActions = document.createElement('div');
      arollActions.className = 'flow-actions';
      if (brief) {
        arollActions.append(regenMotion('aroll', '重新生成指示詞'), copyXml('aroll'), downloadXml('aroll'));
      } else if (base) {
        arollActions.appendChild(regenMotion('aroll', '生成 A-roll 指示詞'));
      }
      const arollStatus = brief ? `A-roll 指示詞 SKILL + DeepSeek · PLATE ${brief.plate || '—'}` : staleBrief ? '指示詞已過期，請重新生成' : base ? 'A-roll 指示詞 SKILL · 可生成' : '上傳 Base 後解鎖';
      const arollNodes = [arollActions];
      if (!base && !brief) {
        const locked = document.createElement('div');
        locked.className = 'flow-note';
        locked.textContent = '先上傳無動效 Base 人物視頻，A-roll 指示詞才會解鎖。';
        arollNodes.unshift(locked);
      }
      arollNodes.push(xmlBlock('aroll'));
      body.appendChild(makeStep('3 · A-roll 指示詞', arollStatus, arollNodes));

      // 4. Opus 5.5 handoff / direct API render / final upload
      const opusActions = document.createElement('div');
      opusActions.className = 'flow-actions';
      const opusReady = taskConfigured('opus');
      const opusBusy = entry.status === 'generating' || entry.approved;
      if (brief && base) {
        opusActions.appendChild(button(
          entry.approved ? '已通過並鎖定' : entry.status === 'generating' ? 'Opus 5.5 生成中…' : `用 Opus 5.5 生成最終視頻${opusReady ? '' : '（未配置 Key）'}`,
          'primary',
          opusReady && !opusBusy ? () => generateOpusVideo(beat.id) : null,
          !opusReady || opusBusy,
          opusReady ? 'Base＋指示詞直接送 Opus 5.5，完成後在下面播放' : '先到設定配置 Opus 5.5',
        ));
      }
      if (brief) {
        opusActions.appendChild(button('複製給 Opus 5.5 的交接', 'ghost', async () => {
          const text = `Base video: ${beat.id} (uploaded)\n\nA-roll 指示詞:\n${brief.raw}\n\n把 Base 視頻和這份指示詞交給 Opus 5.5 製作最終人物視頻。`;
          try { await navigator.clipboard.writeText(text); toast('已複製 A-roll 交接'); }
          catch { toast('浏览器不允许访问剪贴板', 'error'); }
        }));
        opusActions.appendChild(uploadButton('asset', entry.asset ? '重新上傳最終視頻' : '上傳 Opus 最終視頻'));
        const finalPreview = previewLink('asset', '預覽最終視頻');
        if (finalPreview) opusActions.appendChild(finalPreview);
        if (opusBusy) {
          const progress = document.createElement('div');
          progress.className = 'flow-progress';
          const pct = Number(production.progress?.pct) || 3;
          const bar = document.createElement('div');
          bar.className = 'flow-progress-bar';
          const fill = document.createElement('div');
          fill.style.width = `${Math.max(3, Math.min(100, pct))}%`;
          bar.appendChild(fill);
          const label = document.createElement('span');
          label.textContent = production.progress?.message || 'Opus 5.5 正在把指示詞疊加到 Base…';
          progress.append(bar, label);
          opusActions.appendChild(progress);
        }
      } else {
        const note = document.createElement('div');
        note.className = 'flow-note';
        note.textContent = '先出 A-roll 指示詞，才能把 Base＋指示詞交給 Opus 5.5。';
        opusActions.appendChild(note);
      }
      const opusNodes = [opusActions];
      if (entry.asset) {
        const finalLabel = document.createElement('div');
        finalLabel.className = 'base-player-label';
        const finalDone = document.createElement('b');
        finalDone.textContent = 'Opus 最終視頻已完成';
        const finalMeta = document.createElement('span');
        finalMeta.textContent = entry.assetDuration ? `${Number(entry.assetDuration).toFixed(1)} 秒 · 可播放` : '可播放';
        finalLabel.append(finalDone, finalMeta, approvalControls(
          beat.id,
          entry,
          `/api/jobs/${state.currentId}/production/asset/${beat.id}?v=${encodeURIComponent(entry.updatedAt || '')}`,
          `${String(index + 1).padStart(2, '0')}-final-${beat.id}.mp4`,
        ));
        const finalVideo = document.createElement('video');
        finalVideo.className = 'base-video';
        finalVideo.controls = true;
        finalVideo.preload = 'metadata';
        finalVideo.playsInline = true;
        finalVideo.src = `/api/jobs/${state.currentId}/production/asset/${beat.id}?v=${encodeURIComponent(entry.updatedAt || '')}`;
        opusNodes.push(finalLabel, finalVideo);
      }
      body.appendChild(makeStep('4 · Opus 5.5 製作', `Opus 5.5 · ${entry.asset ? '最終視頻已完成' : brief ? (opusReady ? '已配置 · 待生成' : '未配置 Key') : '等待指示詞'}`, opusNodes));
    } else if (isBroll) {
      // 1. BROLL from English VO
      const brollActions = document.createElement('div');
      brollActions.className = 'flow-actions';
      if (brief) {
        brollActions.append(regenMotion('broll', '重新生成 BROLL'), copyXml('broll'), downloadXml('broll'));
      } else {
        brollActions.appendChild(regenMotion('broll', '生成 BROLL 提示詞'));
      }
      const brollNodes = [brollActions];
      const brollNote = document.createElement('div');
      brollNote.className = 'flow-note';
      brollNote.textContent = 'BROLL 直接從這一拍的 English VO 出；Broll 不需要先做字卡 prompt。';
      brollNodes.push(brollNote, xmlBlock('broll'));
      body.appendChild(makeStep('1 · BROLL 提示詞', brief ? `BROLL SKILL + DeepSeek · PLATE ${brief.plate || '—'}` : 'BROLL SKILL + DeepSeek · 可生成', brollNodes));

      // 2. Opus handoff / final upload
      const opusActions = document.createElement('div');
      opusActions.className = 'flow-actions';
      if (brief) {
        const opusReady = taskConfigured('opus');
        const opusBusy = entry.status === 'generating' || entry.approved;
        opusActions.appendChild(button(
          entry.approved ? '已通過並鎖定' : entry.status === 'generating' ? 'Opus 5.5 製作中…' : `用 Opus 5.5 製作${opusReady ? '' : '（未配置 Key）'}`,
          'primary',
          opusReady && !opusBusy ? () => generateOpusVideo(beat.id) : null,
          !opusReady || opusBusy,
          opusReady ? '把 BROLL XML 直接交給 Opus 5.5 並取得影片' : '先到設定配置 Opus 5.5',
        ));
        opusActions.appendChild(button('複製 BROLL', 'ghost', async () => {
          try { await navigator.clipboard.writeText(brief.raw); toast('已複製 BROLL XML'); }
          catch { toast('浏览器不允许访问剪贴板', 'error'); }
        }));
        opusActions.appendChild(uploadButton('asset', entry.asset ? '重新上傳 B-roll 成片' : '上傳 B-roll 成片'));
        const finalPreview = previewLink('asset', '預覽成片');
        if (finalPreview) opusActions.appendChild(finalPreview);
        if (opusBusy) {
          const progress = document.createElement('div');
          progress.className = 'flow-progress';
          const pct = Number(production.progress?.pct) || 3;
          const bar = document.createElement('div');
          bar.className = 'flow-progress-bar';
          const fill = document.createElement('div');
          fill.style.width = `${Math.max(3, Math.min(100, pct))}%`;
          bar.appendChild(fill);
          const label = document.createElement('span');
          label.textContent = production.progress?.message || 'Opus 5.5 正在製作影片…';
          progress.append(bar, label);
          opusActions.appendChild(progress);
        }
      } else {
        const note = document.createElement('div');
        note.className = 'flow-note';
        note.textContent = '先出 BROLL XML，再交給 Opus 5.5 製作 B-roll。';
        opusActions.appendChild(note);
      }
      body.appendChild(makeStep('2 · Opus 5.5 製作', `Opus 5.5 · ${entry.status === 'generating' ? `生成中 ${Number(production.progress?.pct) || 3}%` : entry.asset ? 'B-roll 成片已上傳' : brief ? (taskConfigured('opus') ? '已配置 · 待製作' : '未配置') : '等待 BROLL'}`, [opusActions]));
    } else {
      const screenActions = document.createElement('div');
      screenActions.className = 'flow-actions';
      screenActions.appendChild(uploadButton('asset', entry.asset ? '重新上傳錄屏' : '上傳錄屏'));
      const preview = previewLink('asset', '預覽錄屏');
      if (preview) screenActions.appendChild(preview);
      const note = document.createElement('div');
      note.className = 'flow-note';
      note.textContent = '實操不需要提示詞；錄屏完成後直接上傳。';
      body.appendChild(makeStep('實操 · 不需要提示詞', `本機上傳 · ${entry.asset ? '錄屏已上傳' : '待錄屏'}`, [screenActions, note]));
    }

    card.append(head, body);
    fragment.appendChild(card);
  });
  list.appendChild(fragment);
}

function exportPromptsMarkdown() {
  const beats = state.english.beats || [];
  if (!beats.length) {
    toast('还没有英文分镜', 'error');
    return;
  }
  const entries = state.production?.beats || {};
  const briefs = state.briefs || [];
  const lines = [`# ${state.job?.title || '课程视频'} · 提示詞`, '', `導出時間：${new Date().toLocaleString('zh-CN')}`, ''];
  beats.forEach((beat, index) => {
    const entry = entries[beat.id] || {};
    const brief = briefs.find((item) => item.beatId === beat.id && !item.stale);
    const staleBrief = briefs.find((item) => item.beatId === beat.id && item.stale);
    const prompt = promptTextFor(beat, entry);
    const motionLabel = beat.type === '人物口播' ? 'A-roll 指示詞' : 'BROLL';
    lines.push(`## #${String(index + 1).padStart(2, '0')} ${typeLabel(beat.type)}`);
    lines.push('');
    lines.push(`- English VO：${beat.vo}`);
    lines.push(`- 畫面：${beat.visual || ''}`);
    lines.push('');
    if (beat.type === '人物口播') {
      lines.push('### FLOW 提示詞');
      lines.push('');
      lines.push(prompt || '（未生成）');
      lines.push('');
    }
    if (beat.type === '實操') {
      lines.push('### 錄屏步驟');
      lines.push('');
      lines.push(prompt || '（未生成）');
      lines.push('');
    }
    if (beat.type === '人物口播' || beat.type === 'B字卡') {
      lines.push(`### ${motionLabel} 指令`);
      lines.push('');
      lines.push(brief?.raw || '（未生成）');
      lines.push('');
    }
    lines.push('---');
    lines.push('');
  });
  const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${(state.job?.title || 'prompts').replace(/[\\/:*?"<>|]/g, ' ').slice(0, 60)}.prompts.md`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function renderEdit() {
  const list = $('#editList');
  if (!list) return;
  renderBriefs();
  const beats = state.english.beats || [];
  const production = state.production || { beats: {}, final: null, running: false };
  const entries = production.beats || {};
  $('#editCount').textContent = beats.length;
  if ($('#editSubtitles') && !state.editSubtitlesTouched) {
    $('#editSubtitles').checked = state.settings?.output?.subtitles !== false;
  }
  const voice = state.settings?.voice || { name: 'Samantha', rate: 165 };
  $('#editVoiceSpec').textContent = `TTS ${voice.name} · ${voice.rate} wpm`;

  let ready = 0;
  let errors = 0;
  let estimated = 0;
  for (const beat of beats) {
    const entry = entries[beat.id];
    estimated += Number(entry?.segmentDuration || beat.estSeconds) || 0;
    if (entry?.asset) ready += 1;
    if (entry?.status === 'error') errors += 1;
  }
  const missing = beats.length - ready;
  $('#editStats').innerHTML = `
    <div><b>${beats.length}</b><span>分鏡總數</span></div>
    <div><b>${ready}</b><span>已就緒素材</span></div>
    <div><b>${missing}</b><span>使用佔位卡</span></div>
    <div><b>${formatMinutes(estimated)}</b><span>預估成片</span></div>`;
  $('#editAssetNote').textContent = missing ? `缺 ${missing} 拍素材 → 佔位卡` : '全部素材已就緒';
  $('#editListHint').textContent = `素材 ${ready} / ${beats.length}${errors ? ` · ${errors} 拍失敗` : ''}`;

  const final = production.final;
  const finalBox = $('#editFinalBox');
  if (final?.file) {
    finalBox.classList.remove('hidden');
    const src = `/api/jobs/${state.currentId}/production/final?v=${encodeURIComponent(final.generatedAt || '')}`;
    const video = $('#editVideo');
    if (video.dataset.src !== src) {
      video.src = src;
      video.dataset.src = src;
      video.load();
    }
    $('#editDownload').href = src;
    $('#editFinalMeta').textContent = `${production.finalDirty ? '素材已更新，建議重新剪輯 · ' : ''}${Math.round(final.duration || 0)} 秒 · ${final.width || 1920}×${final.height || 1080} · ${final.subtitles ? '已燒錄英文字幕' : '無字幕'}`;
  } else {
    finalBox.classList.add('hidden');
  }

  const progress = production.progress;
  const progressBox = $('#editProgress');
  if (production.running) {
    progressBox.classList.remove('hidden');
    const pct = Number(progress?.pct) || 0;
    $('#editProgressBar').style.width = `${pct}%`;
    $('#editProgressMsg').textContent = progress?.message || (final ? '重新剪輯中…' : '剪輯中…');
  } else {
    progressBox.classList.add('hidden');
  }
  const renderButton = $('#editRenderBtn');
  renderButton.disabled = production.running || !beats.length;
  renderButton.textContent = production.running ? '剪輯中…' : final ? '重新剪輯' : '開始剪輯';

  if (!beats.length) {
    list.innerHTML = '<div class="edit-empty">先完成「英文分鏡」與「製作」，再來剪輯。</div>';
    return;
  }

  const briefKey = (state.briefs || []).map((brief) => `${brief.id}:${brief.beatId || ''}`).join(',');
  const key = `${beats.length}|${production.updatedAt || ''}|${production.final?.generatedAt || ''}|${briefKey}|${Object.values(entries)
    .map((entry) => `${entry.status || ''}${entry.asset || ''}${entry.segmentDuration || ''}`)
    .join(',')}`;
  if (state.renderedEdit === key && list.children.length === beats.length) return;
  state.renderedEdit = key;
  list.innerHTML = '';
  const fragment = document.createDocumentFragment();
  beats.forEach((beat, index) => {
    const entry = entries[beat.id] || {};
    const row = document.createElement('div');
    row.className = 'edit-row';
    const num = document.createElement('span');
    num.className = 'n';
    num.textContent = String(index + 1).padStart(2, '0');
    const type = document.createElement('span');
    type.className = 't';
    type.textContent = typeLabel(beat.type);
    const vo = document.createElement('span');
    vo.className = 'v';
    vo.textContent = beat.vo;
    vo.title = beat.vo;
    const stateEl = document.createElement('span');
    stateEl.className = 's';
    if (entry.asset) {
      stateEl.classList.add('ok');
      stateEl.textContent = '素材就緒';
    } else if (entry.status === 'error') {
      stateEl.classList.add('warn');
      stateEl.textContent = '失敗';
    } else if (entry.status === 'script') {
      stateEl.textContent = '待錄屏';
    } else if (entry.status === 'prompt') {
      stateEl.textContent = '提示詞';
    } else if (beat.type === '人物口播') {
      stateEl.classList.add('warn');
      stateEl.textContent = '缺人物素材';
    } else {
      stateEl.classList.add('warn');
      stateEl.textContent = '佔位卡';
    }
    if ((state.briefs || []).some((brief) => brief.beatId === beat.id)) {
      stateEl.textContent = `${stateEl.textContent} · Brief`;
    }
    const duration = document.createElement('span');
    duration.className = 'd';
    duration.textContent = `${Math.round(Number(entry.segmentDuration || beat.estSeconds) || 0)}s`;
    row.append(num, type, vo, stateEl, duration);
    fragment.appendChild(row);
  });
  list.appendChild(fragment);
}

function renderBriefs() {
  const list = $('#briefList');
  if (!list) return;
  const allBriefs = state.briefs || [];
  const briefs = allBriefs.filter((brief) => !brief.stale);
  const staleCount = allBriefs.length - briefs.length;
  const count = $('#briefCount');
  if (count) count.textContent = briefs.length ? `${briefs.length} 份${staleCount ? `（${staleCount} 份已過期）` : ''}` : '0';
  const box = $('#editBriefsBox');
  const firstRender = !state.briefsRenderedKey;
  if (box && briefs.length && firstRender) box.open = true;

  const key = JSON.stringify(briefs) + '|' + (state.english.beats || []).map((beat) => beat.id).join(',');
  if (state.briefsRenderedKey === key && list.dataset.rendered === '1') return;
  state.briefsRenderedKey = key;
  list.dataset.rendered = '1';
  list.innerHTML = '';

  if (!briefs.length) {
    list.innerHTML = staleCount
      ? `<div class="brief-empty">${staleCount} 份指示詞因為分鏡重生成、口播已改變而失效，已隱藏。重新生成 A-roll 指示詞後會出現在這裡。</div>`
      : '<div class="brief-empty">還沒有剪輯指令。把 Grok Bot 產生的 plate XML 匯入，就會在這裡顯示 timed beats、風格鎖與 banned 清單。</div>';
    return;
  }

  const beats = state.english.beats || [];
  const fragment = document.createDocumentFragment();

  for (const brief of briefs) {
    const card = document.createElement('article');
    card.className = 'brief-card';

    const head = document.createElement('div');
    head.className = 'brief-head';
    const plate = document.createElement('span');
    plate.className = 'brief-plate';
    plate.textContent = brief.plate ? `PLATE ${brief.plate}` : 'PLATE —';
    const part = document.createElement('span');
    part.className = 'brief-part';
    part.textContent = brief.part ? `PART ${brief.part}` : '';
    const file = document.createElement('span');
    file.className = 'brief-file';
    file.textContent = brief.filename || brief.id;
    file.title = brief.filename || brief.id;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'brief-remove';
    remove.dataset.briefId = brief.id;
    remove.title = '刪除這份剪輯指令';
    remove.textContent = '×';
    head.append(plate, part, file, remove);

    const title = document.createElement('div');
    title.className = 'brief-title';
    title.textContent = brief.title || '未命名剪輯指令';

    const mapping = document.createElement('label');
    mapping.className = 'brief-map';
    mapping.textContent = '套用到';
    const select = document.createElement('select');
    select.dataset.briefId = brief.id;
    const none = document.createElement('option');
    none.value = '';
    none.textContent = '未指定';
    select.appendChild(none);
    beats.forEach((beat, index) => {
      const option = document.createElement('option');
      option.value = beat.id;
      option.textContent = `#${String(index + 1).padStart(2, '0')} ${typeLabel(beat.type)} · ${String(beat.vo || '').slice(0, 28)}`;
      if (brief.beatId === beat.id) option.selected = true;
      select.appendChild(option);
    });
    mapping.appendChild(select);

    const vo = document.createElement('div');
    vo.className = 'brief-vo';
    const voLabel = document.createElement('b');
    voLabel.textContent = 'VO';
    const voText = document.createElement('span');
    voText.textContent = brief.vo || '（未解析到 VO）';
    vo.append(voLabel, voText);

    const timed = document.createElement('div');
    timed.className = 'brief-timed';
    (brief.timed || []).forEach((row) => {
      const line = document.createElement('div');
      line.className = 'brief-time';
      const time = document.createElement('b');
      time.textContent = `${Number(row.start).toFixed(2)}–${Number(row.end).toFixed(2)}`;
      const content = document.createElement('span');
      content.textContent = row.text;
      line.append(time, content);
      timed.appendChild(line);
    });

    const edit = document.createElement('div');
    edit.className = 'brief-edit';
    (brief.edit || []).forEach((row) => {
      const line = document.createElement('div');
      line.className = 'brief-edit-row';
      const label = document.createElement('b');
      label.textContent = `Beat ${row.label}`;
      const time = document.createElement('span');
      time.className = 'brief-edit-time';
      time.textContent = `${Number(row.start).toFixed(2)}–${Number(row.end).toFixed(2)}`;
      const content = document.createElement('span');
      content.textContent = [row.stage, row.elements].filter(Boolean).join(' · ');
      line.append(label, time, content);
      edit.appendChild(line);
    });

    const details = document.createElement('details');
    details.className = 'brief-raw';
    const summary = document.createElement('summary');
    summary.textContent = '完整指令 / 風格鎖 / banned';
    const pre = document.createElement('pre');
    pre.textContent = brief.raw || '';
    details.append(summary, pre);

    card.append(head, title, mapping, vo);
    if ((brief.timed || []).length) card.appendChild(timed);
    if ((brief.edit || []).length) card.appendChild(edit);
    card.appendChild(details);
    fragment.appendChild(card);
  }
  list.appendChild(fragment);
}

async function importBriefFiles(files) {
  if (!files.length || !state.currentId) return;
  const imported = [];
  for (const file of files) {
    const xml = await file.text();
    const data = await api(`/api/jobs/${state.currentId}/briefs`, {
      method: 'POST',
      body: JSON.stringify({ xml, filename: file.name }),
    });
    state.briefs = data.briefs || [];
    imported.push({ file, brief: data.brief, autoMatched: Boolean(data.autoMatched) });
  }
  state.briefsRenderedKey = '';
  renderBriefs();
  const matched = imported.filter((item) => item.autoMatched);
  if (imported.length === 1) {
    const item = imported[0];
    toast(
      item.autoMatched
        ? `已匯入 ${item.file.name}，自動對應 ${item.brief.beatId}`
        : `已匯入 ${item.file.name}，請手動選擇分鏡`,
      'ok',
    );
  } else {
    toast(
      `已匯入 ${imported.length} 份剪輯指令${matched.length ? `，${matched.length} 份已自動對應` : ''}`,
      'ok',
    );
  }
}

function buildProdCard(beat, index, entry) {
  const card = document.createElement('div');
  card.className = `prod-card ${entry.status || 'todo'}`;
  card.dataset.beatId = beat.id;
  const isTalking = beat.type === '人物口播';
  const refs = entry.refs || {};
  const refsReady = Boolean(refs.character && refs.scene);
  const attachedBrief = ['人物口播', 'B字卡'].includes(beat.type)
    ? (state.briefs || []).find((item) => item.beatId === beat.id)
    : null;

  const check = document.createElement('input');
  check.type = 'checkbox';
  check.className = 'prod-check';
  check.dataset.beatId = beat.id;
  check.addEventListener('change', updateProdSelectAll);

  const main = document.createElement('div');
  main.className = 'prod-main';
  const line = document.createElement('div');
  line.className = 'prod-line';
  const num = document.createElement('span');
  num.className = 'prod-num';
  num.textContent = `#${String(index + 1).padStart(2, '0')}`;
  const type = document.createElement('span');
  type.className = `prod-type ${beat.type === '人物口播' ? 't1' : beat.type === 'B字卡' ? 't2' : 't3'}`;
  type.textContent = beat.type;
  const route = document.createElement('span');
  route.className = 'prod-route';
  route.textContent = attachedBrief && beat.type === 'B字卡'
    ? 'Grok B-roll brief'
    : PROD_ROUTE[entry.route || (beat.type === '人物口播' ? 'veo' : beat.type === '實操' ? 'screen' : 'card')];
  const status = document.createElement('span');
  status.className = `prod-status ${entry.status || 'todo'}`;
  status.textContent = PROD_STATUS[entry.status || 'todo'] || entry.status;
  line.append(num, type, route, status);

  const vo = document.createElement('div');
  vo.className = 'prod-vo';
  vo.textContent = beat.vo;
  const visual = document.createElement('div');
  visual.className = 'prod-visual';
  visual.textContent = `畫面：${beat.visual}`;
  main.append(line, vo, visual);

  if (isTalking) {
    const refsBox = document.createElement('div');
    refsBox.className = 'prod-refs';
    const refsHead = document.createElement('div');
    refsHead.className = 'prod-refs-head';
    const refsTitle = document.createElement('b');
    refsTitle.textContent = '人物參考';
    const refsState = document.createElement('span');
    refsState.className = refsReady ? 'ok' : 'warn';
    refsState.textContent = refsReady ? '三視圖＋場景圖已就緒' : '需要三視圖＋場景圖';
    refsHead.append(refsTitle, refsState);

    const refsGrid = document.createElement('div');
    refsGrid.className = 'prod-ref-grid';
    const addSlot = (kind, label, required) => {
      const current = refs[kind];
      if (current) {
        const item = document.createElement('div');
        item.className = 'prod-ref';
        const image = document.createElement('img');
        image.src = `/api/jobs/${state.currentId}/production/reference/${beat.id}/${kind}?v=${encodeURIComponent(entry.updatedAt || '')}`;
        image.alt = label;
        image.loading = 'lazy';
        const caption = document.createElement('span');
        caption.className = 'prod-ref-label';
        caption.textContent = label;
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'prod-ref-remove';
        remove.textContent = '×';
        remove.title = `移除${label}`;
        remove.addEventListener('click', (event) => {
          event.stopPropagation();
          removeReference(beat.id, kind).catch((error) => toast(error.message, 'error'));
        });
        item.addEventListener('click', () => chooseReference(beat.id, kind));
        item.append(image, caption, remove);
        refsGrid.appendChild(item);
      } else {
        const add = document.createElement('button');
        add.type = 'button';
        add.className = 'prod-ref prod-ref-add';
        add.innerHTML = `<strong>＋ ${esc(label)}</strong><span>${required ? '必填' : '選填'}</span>`;
        add.addEventListener('click', () => chooseReference(beat.id, kind));
        refsGrid.appendChild(add);
      }
    };
    addSlot('character', '人物三視圖', true);
    addSlot('scene', '場景圖', true);
    addSlot('face', '臉部特寫', false);
    refsBox.append(refsHead, refsGrid);
    main.appendChild(refsBox);
  }

  let personBriefBox = null;
  if (beat.type === '人物口播') {
    const isAroll = true;
    const motionLabel = 'A-roll';
    const brief = attachedBrief;
    const briefBox = document.createElement('div');
    briefBox.className = 'prod-brief';
    const generating = (state.motionGenerating || new Set()).has(beat.id);

    const makeMotionButton = (label) => {
      const needsVideo = !entry.asset;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn small ghost';
      button.textContent = needsVideo ? '上傳人物視頻後生成指示詞' : generating ? '生成中…' : label;
      button.disabled = generating || state.production.running || needsVideo;
      button.title = needsVideo ? '先上傳這一拍的 Flow 人物視頻' : '';
      button.addEventListener('click', () => generateMotionForBeat(beat.id, 'aroll'));
      return button;
    };

    if (brief) {
      const head = document.createElement('div');
      head.className = 'prod-brief-head';
      const plate = document.createElement('span');
      plate.className = 'prod-brief-plate';
      plate.textContent = brief.plate ? `PLATE ${brief.plate}` : 'MOTION BRIEF';
      const title = document.createElement('span');
      title.className = 'prod-brief-title';
      title.textContent = brief.part ? `PART ${brief.part} · ${motionLabel} brief` : `${motionLabel} brief`;
      const open = document.createElement('button');
      open.type = 'button';
      open.className = 'btn small ghost';
      open.textContent = '查看';
      open.addEventListener('click', () => {
        setTab('edit');
        setTimeout(() => $('#editBriefsBox')?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 250);
      });
      const replace = document.createElement('button');
      replace.type = 'button';
      replace.className = 'btn small ghost';
      replace.textContent = '上傳 XML';
      replace.addEventListener('click', () => chooseBrief(beat.id));
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'btn small ghost';
      remove.textContent = '移除';
      remove.addEventListener('click', () => removeBriefFromBeat(brief.id).catch((error) => toast(error.message, 'error')));
      head.append(plate, title, makeMotionButton('AI 重新生成'), open, replace, remove);
      const body = document.createElement('div');
      body.className = 'prod-brief-body';
      body.textContent = brief.vo || brief.title || '';
      const note = document.createElement('div');
      note.className = 'prod-brief-note';
      note.textContent = 'A-roll brief 只描述疊字／版式，不會生成人物影片；人物影片用上面的 VIDEO PROMPT。';
      briefBox.append(head, body, note);
    } else {
      const actions = document.createElement('div');
      actions.className = 'prod-brief-actions';
      actions.append(makeMotionButton(`AI 生成 ${motionLabel} 指令`));
      const upload = document.createElement('button');
      upload.type = 'button';
      upload.className = 'btn small ghost';
      upload.textContent = '上傳 XML';
      upload.addEventListener('click', () => chooseBrief(beat.id));
      actions.appendChild(upload);
      const hint = document.createElement('div');
      hint.className = 'prod-brief-add-hint';
      hint.textContent = '動效指示詞（可選）：base 人物視頻生成後，再用 A-roll 指示詞 SKILL 產生彩色 SaaS 卡片風的版式與動效指示，交給 Opus 5.5 製作。';
      briefBox.append(actions, hint);
    }
    personBriefBox = briefBox;
  }

  const spec = entry.spec;
  if (spec && beat.type !== '人物口播') {
    const box = document.createElement('div');
    box.className = 'prod-spec';
    const title = document.createElement('strong');
    title.textContent = spec.title || '（未命名）';
    box.appendChild(title);
    if (spec.subtitle) {
      const sub = document.createElement('div');
      sub.style.cssText = 'color:var(--muted);font-size:10.5px';
      sub.textContent = spec.subtitle;
      box.appendChild(sub);
    }
    if (Array.isArray(spec.bullets) && spec.bullets.length) {
      const ul = document.createElement('ul');
      for (const bullet of spec.bullets) {
        const li = document.createElement('li');
        li.textContent = bullet;
        ul.appendChild(li);
      }
      box.appendChild(ul);
    }
    if (Array.isArray(spec.screenSteps) && spec.screenSteps.length) {
      const ol = document.createElement('ol');
      ol.style.cssText = 'margin:4px 0 0 15px;padding:0;font-size:10.5px';
      for (const step of spec.screenSteps) {
        const li = document.createElement('li');
        li.textContent = step;
        ol.appendChild(li);
      }
      box.appendChild(ol);
    }
    main.appendChild(box);
  }

  const savedPrompt = entry.videoPrompt || spec?.videoPrompt || '';
  const draftPrompt = state.promptDrafts.get(beat.id);
  const promptValue = draftPrompt !== undefined ? draftPrompt : savedPrompt;
  const promptText = promptValue || entry.prompt || spec?.brollPrompt || '';
  if (beat.type === '人物口播') {
    const promptLabel = document.createElement('div');
    promptLabel.className = 'prod-prompt-label';
    promptLabel.textContent = 'VIDEO PROMPT · 可自己寫';
    const promptBox = document.createElement('div');
    promptBox.className = 'prod-prompt-box';
    const textarea = document.createElement('textarea');
    textarea.className = 'prod-prompt-edit';
    textarea.rows = 4;
    textarea.value = promptValue;
    textarea.placeholder = '在這裡寫你的人物口播指示詞：鏡頭、人物、場景、動作、光線、不要出現什麼…';
    textarea.addEventListener('input', () => {
      state.promptDrafts.set(beat.id, textarea.value);
      saveButton.disabled = !textarea.value.trim();
    });
    const saveButton = document.createElement('button');
    saveButton.type = 'button';
    saveButton.className = 'btn small ghost';
    saveButton.textContent = '保存提示詞';
    saveButton.disabled = !textarea.value.trim();
    saveButton.addEventListener('click', () => {
      saveManualPrompt(beat.id, textarea.value).catch((error) => toast(error.message, 'error'));
    });
    promptBox.append(textarea, saveButton);
    main.append(promptLabel, promptBox);
  } else if (beat.type === 'B字卡') {
    const promptLabel = document.createElement('div');
    promptLabel.className = 'prod-prompt-label';
    promptLabel.textContent = 'BROLL XML';
    if (attachedBrief?.raw) {
      const prompt = document.createElement('pre');
      prompt.className = 'prod-prompt prod-prompt-xml';
      prompt.textContent = attachedBrief.raw;
      main.append(promptLabel, prompt);
    } else {
      const hint = document.createElement('div');
      hint.className = 'prod-hint';
      hint.textContent = '尚未生成 BROLL XML。按上方「AI 生成 B-roll 指令」，或上傳 Grok Bot 的 plate XML。';
      main.append(promptLabel, hint);
    }
  } else if (promptText) {
    const promptLabel = document.createElement('div');
    promptLabel.className = 'prod-prompt-label';
    promptLabel.textContent = 'SCREEN STEPS';
    const prompt = document.createElement('div');
    prompt.className = 'prod-prompt';
    prompt.textContent = promptText;
    main.append(promptLabel, prompt);
  }
  if (beat.type === '人物口播') {
    const hint = document.createElement('div');
    hint.className = 'prod-hint';
    hint.textContent = refsReady
      ? '這一頁只生成 VIDEO PROMPT 和 A-roll 指示詞；人物影片請在 Flow 做好後用「上傳 FLOW 視頻」放進來。'
      : '這一頁只生成提示詞。人物參考圖可留著做 Flow 對照；人物影片做好後上傳 FLOW 視頻。';
    main.appendChild(hint);
  }
  if (personBriefBox) main.appendChild(personBriefBox);
  if (entry.error) {
    const error = document.createElement('div');
    error.className = 'prod-error';
    error.textContent = entry.error;
    main.appendChild(error);
  }

  const side = document.createElement('div');
  side.className = 'prod-side';
  if (entry.asset) {
    const video = document.createElement('video');
    video.className = 'prod-preview';
    video.controls = true;
    video.preload = 'metadata';
    video.src = `/api/jobs/${state.currentId}/production/asset/${beat.id}?v=${encodeURIComponent(entry.updatedAt || '')}`;
    side.appendChild(video);
  }

  const actions = document.createElement('div');
  actions.className = 'prod-actions';
  const hasPrompt = Boolean(savedPrompt);
  const busy = state.production.running || entry.status === 'generating';
  if (beat.type === '實操') {
    const generate = document.createElement('button');
    generate.className = 'btn small ghost';
    generate.textContent = entry.status === 'ready' ? '重新生成腳本' : '生成腳本';
    generate.disabled = busy;
    generate.addEventListener('click', () => generateProduction([beat.id], 'prompt'));
    actions.appendChild(generate);
  }
  if (isTalking) {
    const promptButton = document.createElement('button');
    promptButton.className = 'btn small ghost';
    promptButton.textContent = hasPrompt ? 'AI 重寫提示詞' : '生成 VIDEO PROMPT';
    promptButton.disabled = busy;
    promptButton.title = '只生成 VIDEO PROMPT，不呼叫影片 API';
    promptButton.addEventListener('click', () => generateProduction([beat.id], 'prompt'));
    actions.appendChild(promptButton);
  }
  const upload = document.createElement('button');
  upload.className = 'btn small ghost';
  upload.textContent = isTalking ? '上傳 FLOW 視頻' : beat.type === 'B字卡' ? '上傳 B-roll MP4' : '上傳錄屏';
  upload.addEventListener('click', () => {
    state.pendingAssetBeat = beat.id;
    $('#prodFileInput').click();
  });
  actions.appendChild(upload);
  if (beat.type === 'B字卡' && attachedBrief?.raw) {
    const copy = document.createElement('button');
    copy.className = 'btn small ghost';
    copy.textContent = '複製 BROLL XML';
    copy.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(attachedBrief.raw);
        toast('已複製 BROLL XML');
      } catch {
        toast('浏览器不允许访问剪贴板', 'error');
      }
    });
    actions.appendChild(copy);
    const dl = document.createElement('button');
    dl.className = 'btn small ghost';
    dl.textContent = '下載 XML';
    dl.addEventListener('click', () => downloadBriefXml(beat, attachedBrief, 'broll'));
    actions.appendChild(dl);
  } else if (promptText) {
    const copy = document.createElement('button');
    copy.className = 'btn small ghost';
    copy.textContent = '複製提示詞';
    copy.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(state.promptDrafts.get(beat.id) || promptText);
        toast('已複製提示詞');
      } catch {
        toast('浏览器不允许访问剪贴板', 'error');
      }
    });
    actions.appendChild(copy);
  }
  if (entry.asset) {
    const download = document.createElement('a');
    download.className = 'btn small ghost';
    download.textContent = '下載';
    download.href = `/api/jobs/${state.currentId}/production/asset/${beat.id}?download=1`;
    download.download = `${beat.id}.mp4`;
    actions.appendChild(download);
  }
  side.appendChild(actions);
  card.append(check, main, side);
  return card;
}

function updateProdSelectAll() {
  const all = $$('#prodList .prod-check');
  const checked = all.filter((input) => input.checked);
  const master = $('#prodSelectAll');
  master.checked = all.length > 0 && checked.length === all.length;
  master.indeterminate = checked.length > 0 && checked.length < all.length;
}

async function generateProduction(beatIds, mode = 'auto') {
  if (!state.currentId || !beatIds.length) {
    toast('先勾選要製作的分鏡');
    return;
  }
  try {
    await api(`/api/jobs/${state.currentId}/production/generate`, {
      method: 'POST',
      body: JSON.stringify({ beatIds, mode }),
    });
    toast(mode === 'prompt' ? `開始生成 ${beatIds.length} 拍的提示詞` : mode === 'video' ? `開始生成 ${beatIds.length} 拍的視頻` : `開始製作 ${beatIds.length} 拍`);
    state.production.running = true;
    renderProduction();
    startPolling();
  } catch (error) {
    toast(error.message, 'error');
  }
}

async function renderProductionVideo() {
  if (!state.currentId) return;
  const readyBeats = (state.english.beats || []).filter((beat) => {
    const entry = state.production?.beats?.[beat.id] || {};
    return Boolean(entry.asset || entry.baseAsset);
  });
  if (!readyBeats.length) {
    toast('目前 0 拍有素材：直接剪輯只會得到整支佔位卡。先上傳 Base 人物影片或錄屏。', 'error');
    return;
  }
  try {
    await api(`/api/jobs/${state.currentId}/production/render`, {
      method: 'POST',
      body: JSON.stringify({ subtitles: $('#editSubtitles').checked }),
    });
    toast('開始剪輯成片，完成後會顯示預覽');
    state.production.running = true;
    state.production.progress = { pct: 0, message: '準備剪輯…' };
    renderProduction();
    renderEdit();
    startPolling();
  } catch (error) {
    toast(error.message, 'error');
  }
}

async function saveManualPrompt(beatId, videoPrompt) {
  if (!state.currentId) return;
  const data = await api(`/api/jobs/${state.currentId}/production/prompt/${beatId}`, {
    method: 'PATCH',
    body: JSON.stringify({ videoPrompt }),
  });
  state.production = data.production;
  state.promptDrafts.delete(beatId);
  renderProduction();
  toast('提示詞已保存', 'ok');
}

async function generateOpusVideo(beatId) {
  if (!state.currentId) return;
  try {
    const entry = state.production?.beats?.[beatId];
    const previousStatus = entry?.status;
    if (entry) {
      entry.status = 'generating';
      entry.error = '';
    }
    state.production.running = true;
    state.production.progress = { pct: 3, message: '正在把 Base＋A-roll 指示詞送給 Opus 5.5…' };
    renderPrompts();
    await api(`/api/jobs/${state.currentId}/production/opus/${beatId}`, { method: 'POST' });
    toast('Opus 5.5 正在製作影片…');
    state.production.progress = { pct: 5, message: 'Opus 5.5 正在製作影片…' };
    renderPrompts();
    startPolling();
  } catch (error) {
    const entry = state.production?.beats?.[beatId];
    if (entry) {
      entry.status = entry.asset ? 'ready' : 'prompt';
      entry.error = error.message;
    }
    state.production.running = false;
    state.production.progress = null;
    renderPrompts();
    toast(error.message, 'error');
  }
}

async function generateMotionForBeat(beatId, mode) {
  if (!state.currentId) return;
  if (state.motionGenerating.has(beatId)) {
    const started = state.motionStartedAt.get(beatId) || 0;
    if (Date.now() - started < 180000) return;
    state.motionGenerating.delete(beatId);
    state.motionStartedAt.delete(beatId);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 180000);
  state.motionGenerating.add(beatId);
  state.motionStartedAt.set(beatId, Date.now());
  state.motionMessage = mode === 'broll' ? '正在生成 BROLL 提示詞（最長 3 分鐘）…' : '正在生成 A-roll 指示詞（最長 3 分鐘）…';
  renderProduction();
  renderPrompts();
  try {
    const data = await api(`/api/jobs/${state.currentId}/motion`, {
      method: 'POST',
      body: JSON.stringify({ beatId, mode }),
      signal: controller.signal,
    });
    state.briefs = data.briefs || [];
    state.briefsRenderedKey = '';
    renderProduction();
    renderPrompts();
    renderBriefs();
    toast(
      `已生成 ${mode === 'aroll' ? 'A-roll' : 'B-roll'} 指令${data.fallback ? `（fallback ${data.model}）` : ''}`,
      'ok',
    );
  } catch (error) {
    toast(error.name === 'AbortError' ? '生成逾時（3 分鐘），請再按一次或檢查模型 API' : error.message, 'error');
  } finally {
    clearTimeout(timer);
    state.motionGenerating.delete(beatId);
    state.motionStartedAt.delete(beatId);
    state.motionMessage = '';
    renderProduction();
    renderPrompts();
  }
}

function chooseBrief(beatId) {
  state.pendingBriefBeat = beatId;
  $('#prodBriefInput').click();
}

async function uploadBriefForBeat(file) {
  if (!file || !state.currentId || !state.pendingBriefBeat) return;
  const beatId = state.pendingBriefBeat;
  state.pendingBriefBeat = null;
  const xml = await file.text();
  const data = await api(`/api/jobs/${state.currentId}/briefs`, {
    method: 'POST',
    body: JSON.stringify({ xml, filename: file.name, beatId }),
  });
  state.briefs = data.briefs || [];
  state.briefsRenderedKey = '';
  renderProduction();
  renderBriefs();
  toast(`已把 ${file.name} 掛到這一拍`, 'ok');
}

async function removeBriefFromBeat(briefId) {
  if (!state.currentId) return;
  const data = await api(`/api/jobs/${state.currentId}/briefs/${briefId}`, { method: 'DELETE' });
  state.briefs = data.briefs || [];
  state.briefsRenderedKey = '';
  renderProduction();
  renderPrompts();
  renderBriefs();
  toast('已移除這拍的 Grok brief', 'ok');
}

function openImagePreview(src, label = '') {
  const modal = $('#imageModal');
  const img = $('#imageModalImg');
  const caption = $('#imageModalCaption');
  if (!modal || !img) return;
  img.src = src;
  img.alt = label;
  if (caption) caption.textContent = label;
  modal.classList.remove('hidden');
}

function closeImagePreview() {
  $('#imageModal')?.classList.add('hidden');
}

function chooseReference(beatId, kind) {
  state.pendingRef = { beatId, kind };
  $('#refFileInput').click();
}

async function uploadReference(file) {
  if (!file || !state.currentId || !state.pendingRef) return;
  const { beatId, kind } = state.pendingRef;
  state.pendingRef = null;
  const form = new FormData();
  form.append('beatId', beatId);
  form.append('kind', kind);
  form.append('reference', file);
  try {
    toast('正在上傳參考圖…');
    const data = await api(`/api/jobs/${state.currentId}/production/reference`, {
      method: 'POST',
      body: form,
    });
    state.production = data.production;
    renderPrompts();
    if (state.tab === 'production') renderProduction();
    toast(kind === 'character' ? '人物三視圖已上傳' : kind === 'scene' ? '場景圖已上傳' : '臉部特寫已上傳', 'ok');
  } catch (error) {
    toast(error.message, 'error');
  }
}

async function removeReference(beatId, kind) {
  if (!state.currentId) return;
  const data = await api(`/api/jobs/${state.currentId}/production/reference/${beatId}/${kind}`, {
    method: 'DELETE',
  });
  state.production = data.production;
  renderPrompts();
  if (state.tab === 'production') renderProduction();
  toast('已移除參考圖', 'ok');
}

async function uploadProductionAsset(file) {
  if (!file || !state.currentId || !state.pendingAssetBeat) return;
  const beatId = state.pendingAssetBeat;
  const kind = state.pendingAssetKind || 'asset';
  state.pendingAssetBeat = null;
  state.pendingAssetKind = 'asset';
  const form = new FormData();
  form.append('beatId', beatId);
  form.append('kind', kind);
  form.append('asset', file);
  try {
    toast('正在上傳素材…');
    await api(`/api/jobs/${state.currentId}/production/upload`, { method: 'POST', body: form });
    const data = await api(`/api/jobs/${state.currentId}`);
    applyData(data);
    const beat = (state.english.beats || []).find((item) => item.id === beatId);
    if (beat?.type === '人物口播' && kind === 'base') {
      toast('Base 人物視頻已上傳，正在用 SKILL 生成 A-roll 指示詞…');
      await generateMotionForBeat(beatId, 'aroll');
    } else {
      toast(kind === 'base' ? 'Base 視頻已上傳' : '成片已上傳');
    }
  } catch (error) {
    toast(error.message, 'error');
  }
}

/* ------------------------------------------------------------------ export */
const EXPORT_TYPES = [
  { type: 'bundle', title: '交付包 ZIP', desc: 'final.mp4 ＋ 飛書可匯入 DOCX／HTML 分鏡表 ＋ 中英字幕 ＋ 文案 ＋ clips ＋ EDL', ext: '.zip', need: 'final' },
  { type: 'srt', title: '中文 SRT 字幕', desc: '每行自动断句，直接拖进剪映 / Premiere', ext: '.zh.srt', need: 'transcript' },
  { type: 'srt-bilingual', title: '中英双语 SRT', desc: '中文在上、英文在下，方便校对', ext: '.bilingual.srt', need: 'transcript' },
  { type: 'srt-en', title: '英文 SRT 字幕', desc: '原始英文时间轴，给剪辑师对轨', ext: '.en.srt', need: 'transcript' },
  { type: 'copy', title: '分段文案 Markdown', desc: '标题、时间码、口播正文、屏幕字', ext: '.md', need: 'copy' },
  { type: 'voice', title: '配音稿 TXT', desc: '按段落编号，带时长与字数估算', ext: '.txt', need: 'copy' },
  { type: 'vo', title: '英文分鏡表 Markdown', desc: '# / 畫面類型 / English VO / 畫面', ext: '.md', need: 'english' },
  { type: 'vo-json', title: '英文分鏡 JSON', desc: '分镜拍点、字数、预估时长与镜头类型', ext: '.json', need: 'english' },
  { type: 'json', title: '完整数据 JSON', desc: '字幕 + 分段 + 项目信息，便于二次加工', ext: '.json', need: 'transcript' },
];

function renderExportGrid() {
  const grid = $('#exportGrid');
  if (!grid) return;
  grid.innerHTML = '';
  const hasTranscript = state.transcript.segments.length > 0;
  const hasCopy = (state.copy.blocks || []).length > 0;
  const hasEnglish = (state.english.beats || []).length > 0;
  const hasFinal = Boolean(state.production?.final?.file);
  for (const item of EXPORT_TYPES) {
    const enabled =
      item.need === 'final'
        ? hasFinal
        : item.need === 'copy'
          ? hasCopy
          : item.need === 'english'
            ? hasEnglish
            : hasTranscript;
    const card = document.createElement('button');
    card.className = 'export-card';
    card.disabled = !enabled;
    card.style.opacity = enabled ? '' : '.45';
    card.style.cursor = enabled ? 'pointer' : 'not-allowed';
    card.innerHTML = `<strong>${item.title}</strong><span>${item.desc}</span><em>${item.ext}</em>`;
    if (enabled) {
      card.addEventListener('click', () => previewExport(item));
    }
    grid.appendChild(card);
  }
}

async function previewExport(item) {
  if (item.type === 'bundle') {
    toast('正在打包交付包，完成後會自動下載…');
    try {
      const res = await fetch(`/api/jobs/${state.currentId}/export/bundle`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast(data.error || `打包失敗（HTTP ${res.status}）`, 'error');
        return;
      }
      const blob = await res.blob();
      const disposition = res.headers.get('Content-Disposition') || '';
      const match = disposition.match(/filename\*=UTF-8''([^;]+)|filename="?([^";]+)"?/i);
      const name = decodeURIComponent(match?.[1] || match?.[2] || 'delivery.zip');
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast('交付包已下載');
    } catch (error) {
      toast(error.message || '打包失敗', 'error');
    }
    return;
  }
  $$('.export-card').forEach((card) => card.classList.remove('active'));
  const card = $$('.export-card').find((el) => el.querySelector('strong')?.textContent === item.title);
  card?.classList.add('active');
  const preview = $('#exportPreview');
  preview.innerHTML = '<div class="preview-empty">生成预览…</div>';
  try {
    const data = await api(`/api/jobs/${state.currentId}/preview/${item.type}`);
    preview.innerHTML = '';
    const head = document.createElement('div');
    head.className = 'export-preview-head';
    const name = document.createElement('strong');
    name.textContent = data.filename;
    const download = document.createElement('a');
    download.className = 'btn small primary';
    download.textContent = '下载';
    download.href = `/api/jobs/${state.currentId}/export/${item.type}?download=1`;
    head.append(name, download);
    const pre = document.createElement('pre');
    pre.textContent = data.content;
    preview.append(head, pre);
  } catch (error) {
    preview.innerHTML = `<div class="preview-empty">${esc(error.message)}</div>`;
  }
}

/* -------------------------------------------------------------------- logs */
function renderLogs() {
  const logs = state.job?.logs || [];
  const key = logs.map((log) => `${log.t}${log.message}`).join('|');
  if (key === state.renderedLogs) return;
  state.renderedLogs = key;
  const list = $('#logList');
  list.innerHTML = '';
  if (!logs.length) {
    list.innerHTML = '<div style="color:var(--faint)">还没有日志。</div>';
    return;
  }
  for (const log of logs) {
    const row = document.createElement('div');
    row.className = log.level === 'error' ? 'error' : log.level === 'warn' ? 'warn' : '';
    const time = document.createElement('span');
    time.className = 'lt';
    time.textContent = log.t;
    const message = document.createElement('span');
    message.textContent = log.message;
    row.append(time, message);
    list.appendChild(row);
  }
  list.scrollTop = list.scrollHeight;
}

/* -------------------------------------------------------------------- tabs */
function setFocus(focus) {
  const view = $('#jobView');
  if (!view) return;
  view.classList.toggle('focus', Boolean(focus));
  const button = $('#focusToggle');
  if (button) {
    button.textContent = focus ? '显示视频' : '全宽显示';
    button.title = focus ? '恢复左侧视频预览' : '隐藏视频，全宽显示当前内容';
    button.classList.toggle('active', !focus);
  }
}

function setTab(name) {
  state.tab = name;
  state.pipelineManual = null;
  $$('#tabs button').forEach((button) => button.classList.toggle('active', button.dataset.tab === name));
  $$('.panel').forEach((panel) => panel.classList.toggle('hidden', panel.dataset.panel !== name));
  if (name === 'export') renderExportGrid();
  if (name === 'subtitles') applyTranscriptFilter();
  if (name === 'copy') requestAnimationFrame(() => $$('.copy-text').forEach(autoGrow));
  if (name === 'english') requestAnimationFrame(() => $$('#voBody textarea').forEach(autoGrow));
  if (name === 'prompts') renderPrompts();
  if (name === 'production') renderProduction();
  if (name === 'edit') renderEdit();
  setFocus(false);
  updatePipelineActive(name);
}

/* ------------------------------------------------------------------- action */
async function runSteps(steps) {
  if (!state.currentId || !steps.length) return;
  await flushEdits().catch(() => {});
  try {
    $('#runBtn').disabled = true;
    const data = await api(`/api/jobs/${state.currentId}/run`, {
      method: 'POST',
      body: JSON.stringify({ steps }),
    });
    toast('已开始处理，页面会自动刷新进度');
    state.job.running = true;
    state.wasRunning = true;
    renderPipeline();
    renderPrimaryButton();
    startPolling();
    return data;
  } catch (error) {
    toast(error.message, 'error');
    renderPrimaryButton();
  }
}

async function cancelJob() {
  if (!state.currentId) return;
  try {
    await api(`/api/jobs/${state.currentId}/cancel`, { method: 'POST' });
    toast('正在停止…');
  } catch (error) {
    toast(error.message, 'error');
  }
}

function primaryAction() {
  const action = $('#runBtn').dataset.action;
  if (action === 'export') {
    setTab('export');
    return;
  }
  if (action === 'asr') return runSteps(['asr', 'translate', 'copy', 'english']);
  if (action === 'translate') return runSteps(['translate', 'copy', 'english']);
  if (action === 'copy') return runSteps(['copy', 'english']);
  if (action === 'english') return runSteps(['english']);
}

/* ------------------------------------------------------------------ upload */
function chooseFile() {
  $('#fileInput').click();
}

async function handleFile(file) {
  if (!file) return;
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  if (!['mp4', 'mov', 'm4v', 'mkv', 'webm', 'avi', 'mp3', 'm4a', 'wav', 'flac'].includes(ext)) {
    toast('请上传 mp4 / mov / mkv / webm 等视频文件', 'error');
    return;
  }
  if (file.size > 4 * 1024 ** 3) {
    toast('文件超过 4GB 上限', 'error');
    return;
  }
  $('#uploadOverlay').classList.remove('hidden');
  $('#uploadName').textContent = file.name;
  $('#uploadSub').textContent = `${fmtBytes(file.size)} · 正在上传`;
  setUploadPct(0);
  const form = new FormData();
  form.append('video', file);

  const xhr = new XMLHttpRequest();
  state.uploadXhr = xhr;
  xhr.open('POST', '/api/jobs');
  xhr.upload.onprogress = (event) => {
    if (!event.lengthComputable) return;
    const pct = Math.round((event.loaded / event.total) * 100);
    setUploadPct(pct);
    $('#uploadSub').textContent = `${fmtBytes(event.loaded)} / ${fmtBytes(event.total)}`;
  };
  xhr.onload = async () => {
    state.uploadXhr = null;
    $('#uploadOverlay').classList.add('hidden');
    if (xhr.status >= 200 && xhr.status < 300) {
      try {
        const data = JSON.parse(xhr.responseText);
        const job = data.job;
        toast('上传完成，开始转写…');
        await loadJobs();
        await openJob(job.id);
        const steps = hasKeyFor('translate') ? ['asr', 'translate', 'copy'] : ['asr'];
        if (
          hasKeyFor('translate') &&
          state.settings?.english?.autoRun !== false &&
          hasKeyFor('english')
        ) {
          steps.push('english');
        }
        runSteps(steps);
      } catch (error) {
        toast(`解析返回结果失败：${error.message}`, 'error');
      }
    } else {
      let message = `上传失败（HTTP ${xhr.status}）`;
      try {
        message = JSON.parse(xhr.responseText).error || message;
      } catch {
        /* ignore */
      }
      toast(message, 'error');
      $('#cancelUpload').classList.remove('hidden');
    }
  };
  xhr.onerror = () => {
    state.uploadXhr = null;
    $('#uploadOverlay').classList.add('hidden');
    toast('上传中断，请重试', 'error');
  };
  xhr.onabort = () => {
    state.uploadXhr = null;
    $('#uploadOverlay').classList.add('hidden');
    toast('已取消上传');
  };
  xhr.send(form);
}

function setUploadPct(pct) {
  const circumference = 2 * Math.PI * 19;
  const offset = circumference * (1 - clamp(pct, 0, 100) / 100);
  $('#ringFg').style.strokeDashoffset = String(offset);
  $('#uploadPct').textContent = `${pct}%`;
}

/* ----------------------------------------------------------------- settings */
function openSettings() {
  if (!state.settings) return;
  state.settingsDraft = JSON.parse(JSON.stringify(state.settings));
  renderSettings();
  $('#settingsMsg').textContent = '';
  $('#settingsModal').classList.remove('hidden');
}

function closeSettings() {
  $('#settingsModal').classList.add('hidden');
  state.settingsDraft = null;
}

function renderSimpleSettings(body) {
  const draft = state.settingsDraft;
  const section = document.createElement('section');
  section.className = 'settings-section';
  section.innerHTML = `<h4>固定流程</h4>
    <p>步驟固定；只有「Base 人物視頻」和「Opus 5.5」可以在下面配置。</p>
    <div class="fixed-pipeline">
      <div><span>英文轉寫</span><b>Whisper medium（本機）</b></div>
      <div><span>中文翻譯</span><b>DeepSeek Flash</b></div>
      <div><span>文案分段</span><b>DeepSeek Flash</b></div>
      <div><span>英文分鏡</span><b>內建 SKILL + DeepSeek Flash</b></div>
      <div><span>FLOW 提示詞</span><b>DeepSeek Flash</b></div>
      <div><span>A-roll 指示詞</span><b>A-roll SKILL + DeepSeek</b></div>
      <div><span>BROLL 提示詞</span><b>BROLL SKILL + DeepSeek</b></div>
      <div><span>Base 人物視頻</span><b>Flow／模型（未接入先上傳）</b></div>
      <div><span>Opus 5.5</span><b>外部交接</b></div>
      <div><span>Broll / 剪輯</span><b>本機 FFmpeg</b></div>
      <div><span>旁白</span><b>macOS Samantha</b></div>
    </div>
    <div class="settings-note">其他步驟（轉寫／文案／英文／A-roll 指示詞）維持固定，不開放切換。</div>`;
  body.appendChild(section);

  draft.tasks = draft.tasks || {};
  if (!draft.tasks.opus) {
    draft.tasks.opus = { providerId: 'aihubmix', model: 'claude-opus-5-5', temperature: 0.4, baseUrl: '' };
  }
  const providerById = new Map((draft.providers || []).map((provider) => [provider.id, provider]));
  const providerOptions = (selected) => (draft.providers || [])
    .map((provider) => `<option value="${esc(provider.id)}" ${provider.id === selected ? 'selected' : ''}>${esc(provider.name)}</option>`)
    .join('');
  const modelSection = document.createElement('section');
  modelSection.className = 'settings-section';
  modelSection.innerHTML = `<h4>模型接入</h4>
    <p>只開放這三個模型，其他流程仍然固定。</p>
    <div class="model-config-grid">
      <div class="model-config">
        <div class="model-config-head"><b>Base 人物視頻</b><span id="cfgBaseState">${draft.video?.hasKey ? '已保存 Key' : '未配置 Key'}</span></div>
        <div class="field"><label>平台</label><select id="cfgVideoProvider">
          <option value="google-omni" ${draft.video?.provider === 'google-omni' ? 'selected' : ''}>Google Gemini / Omni</option>
          <option value="google-veo" ${draft.video?.provider === 'google-veo' ? 'selected' : ''}>Google Veo</option>
        </select></div>
        <div class="field"><label>Model</label><input id="cfgVideoModel" value="${esc(draft.video?.model || '')}" placeholder="gemini-omni-1.1-flash 或 veo-3.1-generate-preview" /></div>
        <div class="field"><label>Base URL</label><input id="cfgVideoBaseUrl" value="${esc(draft.video?.baseUrl || '')}" placeholder="https://generativelanguage.googleapis.com/v1beta" /></div>
        <div class="field"><label>API Key</label><input id="cfgVideoKey" type="password" autocomplete="off" placeholder="${draft.video?.hasKey ? '已保存，留空不改' : '貼上 Google API Key'}" /></div>
        <div class="settings-note">Google 官方：<code>https://generativelanguage.googleapis.com/v1beta</code><br/>APIMODELS：<code>https://api.apimodels.app/v1</code>（影片端點 <code>/video/generations</code>）<br/>APIMODELS 目前不支援本地參考圖，場景圖／三視圖不會送出。</div>
      </div>
      <div class="model-config">
        <div class="model-config-head"><b>DeepSeek（文案／分鏡）</b><span id="cfgDeepSeekState">${providerById.get('deepseek')?.hasKey ? '已保存 Key' : '未配置 Key'}</span></div>
        <div class="field"><label>平台</label><input value="DeepSeek" disabled /></div>
        <div class="field"><label>Model</label><input id="cfgDeepSeekModel" value="${esc(draft.tasks.english?.model || 'deepseek-flash')}" placeholder="deepseek-flash" /></div>
        <div class="field"><label>Base URL</label><input id="cfgDeepSeekBaseUrl" value="${esc(providerById.get('deepseek')?.baseUrl || 'https://api.deepseek.com')}" placeholder="https://api.deepseek.com" /></div>
        <div class="field"><label>API Key</label><input id="cfgDeepSeekKey" type="password" autocomplete="off" placeholder="${providerById.get('deepseek')?.hasKey ? '已保存，留空不改' : '貼上 DeepSeek API Key'}" /></div>
        <div class="settings-note">用於：中文翻譯、文案分段、英文分鏡、AROLL／BROLL XML。<br/>同一個 DeepSeek Key 會套到這些步驟。</div>
        <div class="flow-actions"><button type="button" class="btn small ghost" id="cfgDeepSeekTest">測試 DeepSeek 連線</button><span class="test-result" id="cfgDeepSeekTestResult"></span></div>
      </div>
      <div class="model-config">
        <div class="model-config-head"><b>Opus 5.5</b><span id="cfgOpusState">${providerById.get(draft.tasks.opus.providerId)?.hasKey || draft.tasks.opus.hasKey ? '已保存 Key' : '未配置 Key'}</span></div>
        <div class="field"><label>平台</label><select id="cfgOpusProvider">${providerOptions(draft.tasks.opus.providerId)}</select></div>
        <div class="field"><label>Model</label><input id="cfgOpusModel" value="${esc(draft.tasks.opus.model || '')}" placeholder="claude-opus-5-5 或 anthropic/claude-opus-5.5" /></div>
        <div class="field"><label>Base URL（可選）</label><input id="cfgOpusBaseUrl" value="${esc(draft.tasks.opus.baseUrl || '')}" placeholder="留空沿用平台" /></div>
        <div class="field"><label>API Key（可選）</label><input id="cfgOpusKey" type="password" autocomplete="off" placeholder="${draft.tasks.opus.hasKey ? '已保存，留空不改' : '留空沿用平台 Key'}" /></div>
        <div class="settings-note">Opus 5.5 目前是外部交接；配置後狀態會顯示已配置。</div>
      </div>
    </div>`;
  body.appendChild(modelSection);
  const videoProvider = modelSection.querySelector('#cfgVideoProvider');
  const videoModel = modelSection.querySelector('#cfgVideoModel');
  const videoBaseUrl = modelSection.querySelector('#cfgVideoBaseUrl');
  const videoKey = modelSection.querySelector('#cfgVideoKey');
  const opusProvider = modelSection.querySelector('#cfgOpusProvider');
  const opusModel = modelSection.querySelector('#cfgOpusModel');
  const opusBaseUrl = modelSection.querySelector('#cfgOpusBaseUrl');
  const opusKey = modelSection.querySelector('#cfgOpusKey');
  const deepSeekModel = modelSection.querySelector('#cfgDeepSeekModel');
  const deepSeekBaseUrl = modelSection.querySelector('#cfgDeepSeekBaseUrl');
  const deepSeekKey = modelSection.querySelector('#cfgDeepSeekKey');
  videoProvider?.addEventListener('change', () => {
    draft.video = draft.video || {};
    draft.video.provider = videoProvider.value;
    const suggested = videoProvider.value === 'google-veo' ? 'veo-3.1-generate-preview' : 'gemini-omni-1.1-flash';
    if (!videoModel.value.trim() || /^(gemini-omni|veo-3\.1)/i.test(videoModel.value.trim())) videoModel.value = suggested;
    if (!videoBaseUrl.value.trim()) videoBaseUrl.value = 'https://generativelanguage.googleapis.com/v1beta';
  });
  videoModel?.addEventListener('input', () => { draft.video = draft.video || {}; draft.video.model = videoModel.value.trim(); });
  videoBaseUrl?.addEventListener('input', () => { draft.video = draft.video || {}; draft.video.baseUrl = videoBaseUrl.value.trim(); });
  videoKey?.addEventListener('input', () => { draft.video = draft.video || {}; draft.video._newKey = videoKey.value; });
  const applyDeepSeek = () => {
    const model = deepSeekModel?.value.trim() || 'deepseek-flash';
    const baseUrl = deepSeekBaseUrl?.value.trim() || 'https://api.deepseek.com';
    const provider = (draft.providers || []).find((item) => item.id === 'deepseek');
    if (provider) {
      provider.baseUrl = baseUrl;
      provider.models = Array.from(new Set([...(provider.models || []), model]));
    }
    for (const key of ['translate', 'copy', 'revise', 'english', 'production', 'motion']) {
      draft.tasks[key] = draft.tasks[key] || {};
      draft.tasks[key].providerId = 'deepseek';
      draft.tasks[key].model = model;
    }
  };
  deepSeekModel?.addEventListener('input', applyDeepSeek);
  deepSeekBaseUrl?.addEventListener('input', applyDeepSeek);
  deepSeekKey?.addEventListener('input', () => {
    const provider = (draft.providers || []).find((item) => item.id === 'deepseek');
    if (provider) provider._newKey = deepSeekKey.value;
    if (deepSeekKey.value) {
      const stateEl = modelSection.querySelector('#cfgDeepSeekState');
      if (stateEl) stateEl.textContent = '將保存新 Key';
    }
  });
  applyDeepSeek();
  const deepSeekTest = modelSection.querySelector('#cfgDeepSeekTest');
  deepSeekTest?.addEventListener('click', async () => {
    const resultEl = modelSection.querySelector('#cfgDeepSeekTestResult');
    if (resultEl) {
      resultEl.className = 'test-result';
      resultEl.textContent = '測試中…';
    }
    try {
      const result = await api('/api/settings/test', {
        method: 'POST',
        body: JSON.stringify({
          providerId: 'deepseek',
          baseUrl: deepSeekBaseUrl?.value.trim() || 'https://api.deepseek.com',
          apiKey: deepSeekKey?.value.trim() || '__KEEP__',
          model: deepSeekModel?.value.trim() || 'deepseek-flash',
        }),
      });
      if (resultEl) {
        resultEl.className = `test-result ${result.ok ? 'ok' : 'bad'}`;
        resultEl.textContent = result.ok ? `可用 · ${result.model} · ${result.latencyMs}ms` : result.error || '不可用';
      }
    } catch (error) {
      if (resultEl) {
        resultEl.className = 'test-result bad';
        resultEl.textContent = error.message;
      }
    }
  });

  opusProvider?.addEventListener('change', () => {
    draft.tasks.opus.providerId = opusProvider.value;
    if (!opusModel.value.trim() || /claude-opus/i.test(opusModel.value.trim())) {
      opusModel.value = opusProvider.value === 'openrouter' ? 'anthropic/claude-opus-5.5' : 'claude-opus-5-5';
    }
  });
  opusModel?.addEventListener('input', () => { draft.tasks.opus.model = opusModel.value.trim(); });
  opusBaseUrl?.addEventListener('input', () => { draft.tasks.opus.baseUrl = opusBaseUrl.value.trim(); });
  opusKey?.addEventListener('input', () => { draft.tasks.opus._newKey = opusKey.value; });

  const output = document.createElement('section');
  output.className = 'settings-section';
  output.innerHTML = `<h4>輸出</h4>
    <label class="check"><input type="checkbox" id="simpleSubtitles" ${draft.output?.subtitles !== false ? 'checked' : ''} /> 默認燒錄英文字幕</label>
    <div class="settings-note">人物口播請在 Flow 生成無動效 Base 後上傳；Broll 提示詞從 VO 出，最後剪輯在本機完成。</div>`;
  body.appendChild(output);
  const toggle = output.querySelector('#simpleSubtitles');
  toggle?.addEventListener('change', () => {
    draft.output = draft.output || {};
    draft.output.subtitles = toggle.checked;
  });
}

function renderSettings() {
  const body = $('#settingsBody');
  body.innerHTML = '';
  if (state.settingsSimple !== false) {
    renderSimpleSettings(body);
    return;
  }
  const draft = state.settingsDraft;

  const providersSection = document.createElement('section');
  providersSection.className = 'settings-section';
  providersSection.innerHTML = `<h4>模型服务</h4><p>填入 API Key 后会保存在本机。Claude / Grok 可以通过 AIHubMix 或各自的 OpenAI 兼容接口调用；FLOW 等视频工具留到下一阶段接入。</p>`;

  for (const provider of draft.providers) {
    const card = document.createElement('div');
    card.className = 'provider-card';
    card.dataset.provider = provider.id;
    const hasKey = Boolean(provider.hasKey || provider._newKey) && !provider._clearKey;
    card.innerHTML = `
      <div class="provider-head">
        <strong>${esc(provider.name)}</strong>
        <span class="status ${hasKey ? 'has' : 'missing'}">${hasKey ? `已保存 ${provider.keyHint || (provider.apiKey ? '••••' + provider.apiKey.slice(-4) : '')}` : '未配置'}</span>
        <span class="spacer"></span>
        <button class="btn small ghost" data-test="${esc(provider.id)}">测试连接</button>
      </div>
      <div class="field-grid">
        <div class="field"><label>API 地址</label><input data-field="baseUrl" value="${esc(provider.baseUrl)}" placeholder="https://…/v1" /></div>
        <div class="field"><label>API Key</label><input data-field="apiKey" type="password" autocomplete="off" placeholder="${hasKey ? '留空则不修改' : '粘贴 Key'}" /></div>
        <div class="field full"><label>可用模型（逗号分隔）</label><input data-field="models" value="${esc((provider.models || []).join(', '))}" placeholder="claude-sonnet-4-6, grok-4.7" /></div>
      </div>
      <div class="provider-actions">
        <button class="btn small ghost" data-clear="${esc(provider.id)}">清除 Key</button>
        <span class="test-result" data-result="${esc(provider.id)}"></span>
      </div>`;
    providersSection.appendChild(card);
  }
  body.appendChild(providersSection);

  const taskSection = document.createElement('section');
  taskSection.className = 'settings-section';
  taskSection.innerHTML = `<h4>任务分配</h4><p>每个步骤可以单独指定服务商／模型；展开「自訂 API」可填该步骤专用地址与 Key，优先于服务商设置。没有 Key 的模型会在运行时提示。</p>`;
  const tasks = [
    ['translate', '中文翻译'],
    ['copy', '文案分段'],
    ['revise', 'AI 改写'],
    ['english', '英文分鏡'],
    ['production', '製作方案'],
    ['motion', 'AROLL 指令'],
  ];
  for (const [key, label] of tasks) {
    const row = document.createElement('div');
    row.className = 'task-row';
    row.dataset.task = key;
    const binding = draft.tasks[key] || {};
    const select = document.createElement('select');
    select.dataset.field = 'providerId';
    for (const provider of draft.providers) {
      const option = document.createElement('option');
      option.value = provider.id;
      option.textContent = provider.name;
      option.selected = provider.id === binding.providerId;
      select.appendChild(option);
    }
    const modelWrap = document.createElement('div');
    const input = document.createElement('input');
    input.dataset.field = 'model';
    input.value = binding.model || '';
    input.placeholder = '模型名';
    input.setAttribute('list', `models-${key}`);
    const datalist = document.createElement('datalist');
    datalist.id = `models-${key}`;
    const provider = draft.providers.find((p) => p.id === binding.providerId);
    for (const model of provider?.models || []) {
      const option = document.createElement('option');
      option.value = model;
      datalist.appendChild(option);
    }
    modelWrap.append(input, datalist);
    const name = document.createElement('span');
    name.textContent = label;
    row.append(name, select, modelWrap);
    taskSection.appendChild(row);

    const advanced = document.createElement('details');
    advanced.className = 'task-advanced';
    const summary = document.createElement('summary');
    const custom = Boolean(binding.baseUrl || binding.hasKey);
    summary.innerHTML = `<span>自訂 API（可選）</span>${custom ? '<em>已設定</em>' : ''}`;
    const grid = document.createElement('div');
    grid.className = 'task-advanced-grid';
    const baseField = document.createElement('label');
    baseField.className = 'field';
    baseField.innerHTML = `<span>API 地址</span><input data-task-field="baseUrl" value="${esc(binding.baseUrl || '')}" placeholder="${esc(provider?.baseUrl || '留空沿用供應商')}" />`;
    const keyField = document.createElement('label');
    keyField.className = 'field';
    keyField.innerHTML = `<span>API Key</span><input data-task-field="apiKey" type="password" autocomplete="off" placeholder="${binding.hasKey ? `已保存 ${esc(binding.keyHint || '')}，留空沿用` : '留空沿用供應商 Key'}" />`;
    const clear = document.createElement('button');
    clear.type = 'button';
    clear.className = 'btn small ghost';
    clear.dataset.taskClear = key;
    clear.textContent = '清除步驟 Key';
    grid.append(baseField, keyField, clear);
    advanced.append(summary, grid);
    taskSection.appendChild(advanced);
  }
  body.appendChild(taskSection);

  const asrSection = document.createElement('section');
  asrSection.className = 'settings-section';
  asrSection.innerHTML = `<h4>本地转写</h4><p>Whisper 在本机运行。small 已缓存，速度最快；medium / large-v3 更准，但首次需要下载模型。</p>
    <div class="field-grid">
      <div class="field"><label>模型</label><select data-asr="model">
        ${['small', 'base', 'medium', 'large-v3'].map((m) => `<option value="${m}" ${draft.asr.model === m ? 'selected' : ''}>${m}</option>`).join('')}
      </select></div>
      <div class="field"><label>语言</label><select data-asr="language">
        <option value="en" ${draft.asr.language === 'en' ? 'selected' : ''}>英语</option>
        <option value="" ${!draft.asr.language ? 'selected' : ''}>自动检测</option>
      </select></div>
      <div class="field"><label>Beam size</label><input type="number" min="1" max="10" data-asr="beamSize" value="${draft.asr.beamSize || 5}" /></div>
      <div class="field"><label>VAD 静音过滤</label><select data-asr="vad"><option value="1" ${draft.asr.vad !== false ? 'selected' : ''}>开启（推荐）</option><option value="0" ${draft.asr.vad === false ? 'selected' : ''}>关闭</option></select></div>
    </div>
    <div class="settings-note">修改转写模型后，已完成的字幕不会自动重跑；可在项目右上角菜单选「重新转写」。</div>`;
  body.appendChild(asrSection);

  const englishSection = document.createElement('section');
  englishSection.className = 'settings-section';
  englishSection.innerHTML = `<h4>英文 YouTube 分鏡</h4><p>使用 SKILL「Chinese course to English YouTube VO shots」：把中文文案改写成英文口播，每个 beat 一个镜头，≤25 words，畫面類型只能是人物口播 / Broll / 實操。</p>
    <label class="check" style="margin-bottom:10px"><input type="checkbox" data-eng="autoRun" ${draft.english?.autoRun !== false ? 'checked' : ''} /> 中文文案完成后自动生成</label>
    <div class="field-grid">
      <div class="field"><label>镜头模式</label><select data-eng="mode">
        <option value="oncamera" ${draft.english?.mode === 'oncamera' ? 'selected' : ''}>真人出镜（默认配比）</option>
        <option value="faceless" ${draft.english?.mode === 'faceless' ? 'selected' : ''}>无露脸（只用實操錄屏）</option>
        <option value="auto" ${draft.english?.mode === 'auto' ? 'selected' : ''}>按内容自动</option>
      </select></div>
    </div>
    <div class="field" style="margin-top:8px"><label>补充要求（会拼进分镜提示词）</label><textarea data-eng="brief" placeholder="例如：面向北美 YouTube 观众；保留 Grok Bot / Lark 等品牌名；不要 CTA">${esc(draft.english?.brief || '')}</textarea></div>
    <div class="settings-note">每拍文字与镜头方向都可以在「英文分鏡」页直接改，保存后导出 Markdown 表格。</div>`;
  body.appendChild(englishSection);

  const videoSection = document.createElement('section');
  videoSection.className = 'settings-section';
  const video = draft.video || {};
  const videoHasKey = Boolean(video.hasKey || video._newKey) && !video._clearKey;
  videoSection.innerHTML = `<h4>製作與成片</h4><p>人物口播用 Google Gemini API（建議 Omni Flash；Veo 3.1 Preview 已於 2026-10-22 關閉）；B字卡由 Claude 出 VideoSpec、本機 FFmpeg 渲染；成片固定 16:9，字幕可選。</p>
    <div class="field-grid">
      <div class="field full"><label>Google Gemini API Key（Omni / Veo）</label><input data-video="apiKey" type="password" autocomplete="off" placeholder="${videoHasKey ? '已保存，留空則不修改' : '粘贴 API Key'}" /></div>
      <div class="field"><label>模型</label><input data-video="model" value="${esc(video.model || 'gemini-omni-1.1-flash')}" placeholder="gemini-omni-1.1-flash" /></div>
      <div class="field"><label>API 位址</label><input data-video="baseUrl" value="${esc(video.baseUrl || 'https://generativelanguage.googleapis.com/v1beta')}" /></div>
      <div class="field"><label>畫面比例</label><select data-video="aspectRatio"><option value="16:9" selected>16:9（YouTube）</option></select></div>
      <div class="field"><label>解析度</label><select data-video="resolution"><option value="1080p" ${video.resolution !== '720p' ? 'selected' : ''}>1080p</option><option value="720p" ${video.resolution === '720p' ? 'selected' : ''}>720p</option></select></div>
      <div class="field"><label>單拍時長（僅 Veo）</label><input type="number" min="4" max="15" data-video="durationSeconds" value="${video.durationSeconds || 8}" /></div>
      <div class="field"><label>TTS 英文語音</label><input data-voice="name" value="${esc(draft.voice?.name || 'Samantha')}" /></div>
      <div class="field"><label>TTS 語速</label><input type="number" min="100" max="220" data-voice="rate" value="${draft.voice?.rate || 165}" /></div>
    </div>
    <label class="check" style="margin-top:10px"><input type="checkbox" data-output="subtitles" ${draft.output?.subtitles !== false ? 'checked' : ''} /> 默認燒錄英文字幕</label>
    <div class="provider-actions"><button class="btn small ghost" data-clear-video>清除 Gemini Key</button><span class="settings-note">人物口播需要三視圖＋場景圖；有 Gemini Key 時按「生成視頻」呼叫 Omni/Veo，沒有 Key 時仍可上傳 FLOW 影片。</span></div>`;
  body.appendChild(videoSection);

  const copySection = document.createElement('section');
  copySection.className = 'settings-section';
  copySection.innerHTML = `<h4>文案偏好</h4><p>这些要求会拼进翻译和分段提示词，也会影响 AI 改写。</p>
    <div class="field"><label>翻译风格</label><textarea data-text="translateStyle" placeholder="例如：口语化、保留英文术语">${esc(draft.translateStyle || '')}</textarea></div>
    <div class="field" style="margin-top:8px"><label>项目要求（分段时使用）</label><textarea data-text="copyBrief" placeholder="例如：面向零基础学员；每段不超过 90 秒；保留讲师的第一人称">${esc(draft.copyBrief || '')}</textarea></div>
    <div class="field" style="margin-top:8px"><label>专有名词表（正确写法 = 错误写法，逗号分隔）</label><textarea data-text="glossary" placeholder="Grokbot = Grogobot&#10;Mobbin = Mobin">${esc(draft.glossary || '')}</textarea></div>
    <div class="field" style="margin-top:8px"><label>翻译并发数（1–6）</label><input type="number" min="1" max="6" data-num="concurrency" value="${draft.llm?.concurrency || 4}" /></div>`;
  body.appendChild(copySection);

  bindSettingsEvents(body);
}

function bindSettingsEvents(body) {
  const draft = state.settingsDraft;
  body.querySelectorAll('.provider-card').forEach((card) => {
    const provider = draft.providers.find((p) => p.id === card.dataset.provider);
    card.querySelectorAll('[data-field]').forEach((input) => {
      input.addEventListener('input', () => {
        const field = input.dataset.field;
        if (field === 'models') {
          provider.models = input.value.split(',').map((s) => s.trim()).filter(Boolean);
        } else if (field === 'apiKey') {
          provider.apiKey = input.value;
          provider._newKey = input.value;
        } else {
          provider[field] = input.value;
        }
      });
    });
    card.querySelector('[data-clear]')?.addEventListener('click', () => {
      provider.apiKey = '';
      provider._clearKey = true;
      provider._keepKey = false;
      card.querySelector('[data-field="apiKey"]').value = '';
      card.querySelector('.status').textContent = '未配置';
      card.querySelector('.status').className = 'status missing';
    });
    const testButton = card.querySelector('[data-test]');
    testButton?.addEventListener('click', async () => {
      const resultEl = card.querySelector(`[data-result="${provider.id}"]`);
      resultEl.className = 'test-result';
      resultEl.textContent = '测试中…';
      const model = provider.models?.[0] || '';
      try {
        const result = await api('/api/settings/test', {
          method: 'POST',
          body: JSON.stringify({
            providerId: provider.id,
            baseUrl: provider.baseUrl,
            apiKey: provider.apiKey || '__KEEP__',
            model,
          }),
        });
        if (result.ok) {
          resultEl.className = 'test-result ok';
          resultEl.textContent = `可用 · ${result.model} · ${result.latencyMs}ms${result.models ? ` · ${result.models.length} 个模型` : ''}`;
          if (result.models?.length && provider.models?.length === 0) provider.models = result.models.slice(0, 12);
        } else {
          resultEl.className = 'test-result bad';
          resultEl.textContent = result.error || '不可用';
        }
      } catch (error) {
        resultEl.className = 'test-result bad';
        resultEl.textContent = error.message;
      }
    });
  });

  body.querySelectorAll('.task-row').forEach((row) => {
    const task = draft.tasks[row.dataset.task];
    const select = row.querySelector('[data-field="providerId"]');
    const input = row.querySelector('[data-field="model"]');
    const datalist = row.querySelector('datalist');
    const refreshModels = () => {
      const provider = draft.providers.find((p) => p.id === select.value);
      datalist.innerHTML = '';
      for (const model of provider?.models || []) {
        const option = document.createElement('option');
        option.value = model;
        datalist.appendChild(option);
      }
      if (!input.value && provider?.models?.length) {
        input.value = provider.models[0];
        task.model = input.value;
      }
    };
    select.addEventListener('change', () => {
      task.providerId = select.value;
      refreshModels();
    });
    input.addEventListener('input', () => {
      task.model = input.value;
    });
    refreshModels();
    const advanced = row.nextElementSibling;
    if (advanced?.classList.contains('task-advanced')) {
      const base = advanced.querySelector('[data-task-field="baseUrl"]');
      const keyInput = advanced.querySelector('[data-task-field="apiKey"]');
      const clear = advanced.querySelector('[data-task-clear]');
      base?.addEventListener('input', () => {
        task.baseUrl = base.value.trim();
      });
      keyInput?.addEventListener('input', () => {
        task.apiKey = keyInput.value;
        task._newKey = keyInput.value;
        task._clearKey = false;
      });
      clear?.addEventListener('click', () => {
        task.apiKey = '__CLEAR__';
        task._clearKey = true;
        task._newKey = '';
        if (keyInput) keyInput.value = '';
      });
    }
  });

  body.querySelectorAll('[data-asr]').forEach((input) => {
    input.addEventListener('input', () => {
      const key = input.dataset.asr;
      if (key === 'beamSize') draft.asr.beamSize = Number(input.value) || 5;
      else if (key === 'vad') draft.asr.vad = input.value === '1';
      else draft.asr[key] = input.value;
    });
  });
  body.querySelectorAll('[data-eng]').forEach((input) => {
    const apply = () => {
      const key = input.dataset.eng;
      if (!draft.english) draft.english = { autoRun: true, mode: 'oncamera', brief: '' };
      if (key === 'autoRun') draft.english.autoRun = input.checked;
      else draft.english[key] = input.value;
    };
    input.addEventListener('input', apply);
    input.addEventListener('change', apply);
  });
  body.querySelectorAll('[data-video]').forEach((input) => {
    input.addEventListener('input', () => {
      if (!draft.video) draft.video = {};
      const key = input.dataset.video;
      if (key === 'apiKey') {
        draft.video.apiKey = input.value;
        draft.video._newKey = input.value;
      } else if (key === 'durationSeconds') {
        draft.video.durationSeconds = Number(input.value) || 8;
      } else {
        draft.video[key] = input.value;
      }
    });
  });
  body.querySelectorAll('[data-voice]').forEach((input) => {
    input.addEventListener('input', () => {
      if (!draft.voice) draft.voice = {};
      const key = input.dataset.voice;
      draft.voice[key] = key === 'rate' ? Number(input.value) || 165 : input.value;
    });
  });
  body.querySelectorAll('[data-output]').forEach((input) => {
    input.addEventListener('change', () => {
      if (!draft.output) draft.output = {};
      draft.output[input.dataset.output] = input.checked;
    });
  });
  body.querySelector('[data-clear-video]')?.addEventListener('click', () => {
    if (!draft.video) draft.video = {};
    draft.video._clearKey = true;
    draft.video.apiKey = '';
    const input = body.querySelector('[data-video="apiKey"]');
    if (input) {
      input.value = '';
      input.placeholder = '已清除，保存後生效';
    }
  });
  body.querySelectorAll('[data-text]').forEach((input) => {
    input.addEventListener('input', () => {
      draft[input.dataset.text] = input.value;
    });
  });
  body.querySelector('[data-num="concurrency"]')?.addEventListener('input', (event) => {
    draft.llm.concurrency = clamp(Number(event.target.value) || 4, 1, 6);
  });
}

async function saveSettings() {
  const draft = state.settingsDraft;
  const providers = draft.providers.map((provider) => {
    let apiKey;
    if (provider._clearKey) apiKey = '__CLEAR__';
    else if (provider._newKey) apiKey = provider._newKey;
    else apiKey = undefined;
    return {
      id: provider.id,
      name: provider.name,
      baseUrl: provider.baseUrl,
      models: provider.models,
      ...(apiKey !== undefined ? { apiKey } : {}),
    };
  });
  let videoKey;
  if (draft.video?._clearKey) videoKey = '__CLEAR__';
  else if (draft.video?._newKey) videoKey = draft.video._newKey;
  const videoPayload = {
    provider: draft.video?.provider,
    baseUrl: draft.video?.baseUrl,
    model: draft.video?.model,
    aspectRatio: draft.video?.aspectRatio,
    resolution: draft.video?.resolution,
    durationSeconds: draft.video?.durationSeconds,
    ...(videoKey !== undefined ? { apiKey: videoKey } : {}),
  };
  const taskPayload = Object.fromEntries(
    Object.entries(draft.tasks || {}).map(([task, binding]) => {
      let apiKey;
      if (binding._clearKey) apiKey = '__CLEAR__';
      else if (binding._newKey) apiKey = binding._newKey;
      return [task, {
        providerId: binding.providerId,
        model: binding.model,
        temperature: binding.temperature,
        baseUrl: binding.baseUrl || '',
        ...(apiKey !== undefined ? { apiKey } : {}),
      }];
    }),
  );
  const payload = {
    providers,
    tasks: taskPayload,
    asr: draft.asr,
    llm: draft.llm,
    english: draft.english,
    voice: draft.voice,
    output: draft.output,
    video: videoPayload,
    translateStyle: draft.translateStyle,
    copyBrief: draft.copyBrief,
  };
  try {
    $('#settingsSave').disabled = true;
    const data = await api('/api/settings', { method: 'PUT', body: JSON.stringify(payload) });
    state.settings = data.settings;
    toast('设置已保存', 'ok');
    closeSettings();
    if (state.job) {
      renderNotice();
      renderPrimaryButton();
      renderPrompts();
      renderModelMap();
      if (state.tab === 'production') renderProduction();
    }
    if ($('#editSubtitles') && !state.editSubtitlesTouched) $('#editSubtitles').checked = state.settings.output?.subtitles !== false;
    checkHealth();
  } catch (error) {
    $('#settingsMsg').textContent = error.message;
    $('#settingsMsg').classList.add('error');
  } finally {
    $('#settingsSave').disabled = false;
  }
}

/* ------------------------------------------------------------------- events */
function initColumnSplitter() {
  const view = $('#jobView');
  const splitter = $('#colSplitter');
  if (!view || !splitter) return;
  const saved = Number(localStorage.getItem('dshPlayerWidth') || 0);
  if (saved > 280) view.style.setProperty('--player-width', `${saved}px`);
  let dragging = false;
  const onMove = (event) => {
    if (!dragging) return;
    const rect = view.getBoundingClientRect();
    const width = Math.max(300, Math.min(rect.width * 0.48, event.clientX - rect.left));
    view.style.setProperty('--player-width', `${Math.round(width)}px`);
  };
  const stop = () => {
    if (!dragging) return;
    dragging = false;
    splitter.classList.remove('dragging');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    const value = parseInt(view.style.getPropertyValue('--player-width'), 10);
    if (value) localStorage.setItem('dshPlayerWidth', String(value));
  };
  splitter.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    dragging = true;
    splitter.classList.add('dragging');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    splitter.setPointerCapture?.(event.pointerId);
  });
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', stop);
  window.addEventListener('pointercancel', stop);
}

function bindStaticEvents() {
  $('#newProjectBtn').addEventListener('click', chooseFile);
  $('#dropzone').addEventListener('click', chooseFile);
  $('#dropzone').addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') chooseFile();
  });
  $('#fileInput').addEventListener('change', (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) handleFile(file);
  });

  ['dragenter', 'dragover'].forEach((name) => {
    window.addEventListener(name, (event) => {
      if (event.dataTransfer?.types?.includes('Files')) {
        event.preventDefault();
        $('#dropzone').classList.add('drag');
      }
    });
  });
  ['dragleave', 'drop'].forEach((name) => {
    window.addEventListener(name, (event) => {
      if (name === 'dragleave' && event.relatedTarget) return;
      $('#dropzone').classList.remove('drag');
      if (name === 'drop') {
        event.preventDefault();
        const file = event.dataTransfer?.files?.[0];
        if (file) handleFile(file);
      }
    });
  });

  $('#cancelUpload').addEventListener('click', () => state.uploadXhr?.abort());

  $('#runBtn').addEventListener('click', primaryAction);
  $('#cancelBtn').addEventListener('click', cancelJob);

  $('#moreBtn').addEventListener('click', (event) => {
    event.stopPropagation();
    $('#moreMenu').classList.toggle('hidden');
  });
  document.addEventListener('click', () => $('#moreMenu').classList.add('hidden'));
  $('#moreMenu').addEventListener('click', async (event) => {
    const action = event.target.closest('button')?.dataset.action;
    if (!action) return;
    $('#moreMenu').classList.add('hidden');
    if (action === 'rerun-asr') {
      if (await openDialog({ title: '重新转写？', text: '会覆盖现有英文字幕，已有中文翻译会尽量按句子保留。', okText: '重新转写' })) runSteps(['asr', 'translate', 'copy', 'english']);
    }
    if (action === 'rerun-translate') {
      if (await openDialog({ title: '重新翻译？', text: '会覆盖当前中文翻译，但分段文案需要重新生成。', okText: '重新翻译' })) runSteps(['translate', 'copy', 'english']);
    }
    if (action === 'rerun-copy') {
      if (await openDialog({ title: '重新分段？', text: '会覆盖当前文案分段，并清空已生成的英文分镜。手动改过的段落也会被替换。', okText: '重新分段' })) runSteps(['copy', 'english']);
    }
    if (action === 'rerun-english') {
      if (await openDialog({ title: '重新生成英文分镜？', text: '会覆盖当前英文 VO 分镜表。', okText: '重新生成' })) runSteps(['english']);
    }
    if (action === 'rename') {
      const title = await openDialog({ title: '重命名项目', input: true, value: state.job.title, okText: '保存' });
      if (title) {
        try {
          const data = await api(`/api/jobs/${state.currentId}`, { method: 'PATCH', body: JSON.stringify({ title }) });
          state.job.title = data.job.title;
          $('#jobTitle').textContent = data.job.title;
          await loadJobs();
        } catch (error) {
          toast(error.message, 'error');
        }
      }
    }
    if (action === 'delete') {
      if (!(await openDialog({ title: '删除项目？', text: '视频、字幕和文案都会从本机删除，无法恢复。', okText: '删除', danger: true }))) return;
      try {
        await api(`/api/jobs/${state.currentId}`, { method: 'DELETE' });
        toast('项目已删除');
        showEmpty();
        await loadJobs();
      } catch (error) {
        toast(error.message, 'error');
      }
    }
  });

  $('#tabs').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-tab]');
    if (button) setTab(button.dataset.tab);
  });

  $('#segList').addEventListener('input', onTranscriptInput);
  $('#segList').addEventListener('click', (event) => {
    const time = event.target.closest('.time');
    if (time) {
      const row = time.closest('.seg');
      const segment = state.transcript.segments.find((s) => s.id === row.dataset.id);
      if (segment) seekTo(segment.start);
      return;
    }
    if (event.target.closest('textarea,button,a,input,select')) return;
    const row = event.target.closest('.seg');
    if (!row) return;
    const segment = state.transcript.segments.find((s) => s.id === row.dataset.id);
    if (segment) seekTo(segment.start);
  });
  $('#voBody').addEventListener('click', (event) => {
    if (event.target.closest('textarea,select,button,a,input')) return;
    const row = event.target.closest('tr[data-start]');
    if (!row) return;
    const start = Number(row.dataset.start);
    if (Number.isFinite(start)) seekTo(start);
  });
  $('#segSearch').addEventListener('input', applyTranscriptFilter);
  $('#showEn').addEventListener('change', (event) => {
    $('#segList').classList.toggle('hide-en', !event.target.checked);
  });
  $('#followPlay').addEventListener('change', (event) => {
    $('#player').dataset.follow = event.target.checked ? '1' : '0';
  });

  $('#player').addEventListener('timeupdate', syncPlayback);
  $('#player').addEventListener('seeked', syncPlayback);
  $('#player').addEventListener('loadedmetadata', () => {
    $('#playerEmpty').classList.add('hidden');
    $('#playerMeta').dataset.duration = String($('#player').duration || 0);
  });

  $('#copyBriefBtn').addEventListener('click', async () => {
    const value = await openDialog({
      title: '项目要求',
      text: '写给分段模型的要求，会保存为全局偏好。',
      input: true,
      value: state.settings?.copyBrief || '',
      okText: '保存',
    });
    if (value === null) return;
    try {
      const data = await api('/api/settings', { method: 'PUT', body: JSON.stringify({ copyBrief: value }) });
      state.settings = data.settings;
      toast('项目要求已保存，下次重新分段生效');
    } catch (error) {
      toast(error.message, 'error');
    }
  });
  $('#regenerateCopyBtn').addEventListener('click', async () => {
    if (!state.transcript.segments.some((s) => s.zh)) {
      toast('还没有中文翻译，先生成中文', 'error');
      return;
    }
    if (await openDialog({ title: '重新分段？', text: '会覆盖当前文案段落和手动修改。', okText: '重新分段' })) runSteps(['copy', 'english']);
  });

  $('#pipeline').addEventListener('click', (event) => {
    const step = event.target.closest('.pipe-step');
    if (step) jumpToStep(step.dataset.step);
  });
  $('#pipeline').addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const step = event.target.closest('.pipe-step');
    if (!step) return;
    event.preventDefault();
    jumpToStep(step.dataset.step);
  });
  $('#sidebarToggle')?.addEventListener('click', () => applySidebarCollapsed(!$('#sidebar')?.classList.contains('collapsed')));
  $('#cinemaToggle')?.addEventListener('click', () => applyCinema(!$('#jobView').classList.contains('cinema')));
  $('#focusToggle').addEventListener('click', () => {
    setFocus(!$('#jobView').classList.contains('focus'));
  });
  $('#prodSelectAll').addEventListener('change', (event) => {
    for (const input of $$('#prodList .prod-check')) input.checked = event.target.checked;
    updateProdSelectAll();
  });
  $('#prodGenerateBtn').addEventListener('click', () => {
    const ids = prodCheckedIds();
    if (!ids.length) {
      toast('先勾選要製作的分鏡');
      return;
    }
    generateProduction(ids, 'prompt');
  });
  $('#goEditBtn').addEventListener('click', () => setTab('edit'));
  $('#editBackBtn').addEventListener('click', () => setTab('prompts'));
  $('#editRenderBtn').addEventListener('click', renderProductionVideo);
  $('#briefImportBtn').addEventListener('click', () => $('#briefFileInput').click());
  $('#briefFileInput').addEventListener('change', async (event) => {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    if (!files.length) return;
    try {
      await importBriefFiles(files);
    } catch (error) {
      toast(`匯入失敗：${error.message}`, 'error');
    }
  });
  $('#briefList').addEventListener('change', async (event) => {
    const select = event.target.closest('select[data-brief-id]');
    if (!select || !state.currentId) return;
    try {
      const data = await api(`/api/jobs/${state.currentId}/briefs/${select.dataset.briefId}`, {
        method: 'PATCH',
        body: JSON.stringify({ beatId: select.value || null }),
      });
      state.briefs = data.briefs || [];
      state.briefsRenderedKey = '';
      renderBriefs();
      toast('已更新剪輯指令對應', 'ok');
    } catch (error) {
      toast(`更新失敗：${error.message}`, 'error');
    }
  });
  $('#briefList').addEventListener('click', async (event) => {
    const button = event.target.closest('button[data-brief-id]');
    if (!button || !state.currentId) return;
    if (!window.confirm('刪除這份剪輯指令？')) return;
    try {
      const data = await api(`/api/jobs/${state.currentId}/briefs/${button.dataset.briefId}`, { method: 'DELETE' });
      state.briefs = data.briefs || [];
      state.briefsRenderedKey = '';
      renderBriefs();
      toast('已刪除剪輯指令', 'ok');
    } catch (error) {
      toast(`刪除失敗：${error.message}`, 'error');
    }
  });
  $('#editSubtitles').addEventListener('change', () => {
    state.editSubtitlesTouched = true;
  });
  $('#prodFileInput').addEventListener('change', (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) uploadProductionAsset(file);
  });
  $('#refFileInput').addEventListener('change', (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) uploadReference(file);
  });
  $('#prodBriefInput').addEventListener('change', (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) uploadBriefForBeat(file).catch((error) => toast(error.message, 'error'));
  });
  $('#voCopyBtn').addEventListener('click', copyVoTable);
  $('#voDownloadBtn').addEventListener('click', downloadVoTable);
  $('#promptExport')?.addEventListener('click', exportPromptsMarkdown);
  $('#promptFilters')?.addEventListener('click', (event) => {
    const target = event.target.closest('button[data-filter]');
    if (!target) return;
    state.promptFilter = target.dataset.filter;
    renderPrompts();
  });
  $('#goProductionBtn').addEventListener('click', () => {
    if (!state.english.beats?.length) {
      toast('先生成英文分鏡');
      return;
    }
    setTab('prompts');
  });
  $('#voRegenerateBtn').addEventListener('click', async () => {
    if (!state.copy.blocks?.length) {
      toast('先生成中文分段文案', 'error');
      return;
    }
    if (await openDialog({ title: '重新生成英文分镜？', text: '会覆盖当前英文 VO 分镜表。', okText: '重新生成' })) runSteps(['english']);
  });

  $('#settingsBtn').addEventListener('click', openSettings);
  $('#closeSettings').addEventListener('click', closeSettings);
  $('#settingsCancel').addEventListener('click', closeSettings);
  $('#settingsSave').addEventListener('click', saveSettings);
  $('#settingsModal').addEventListener('click', (event) => {
    if (event.target === $('#settingsModal')) closeSettings();
  });
  $('#imageModalClose')?.addEventListener('click', closeImagePreview);
  $('#imageModal')?.addEventListener('click', (event) => {
    if (event.target === $('#imageModal')) closeImagePreview();
  });

  $('#jobTitle').addEventListener('blur', async () => {
    const title = $('#jobTitle').textContent.trim();
    if (!title || !state.currentId || title === state.job?.title) return;
    try {
      await api(`/api/jobs/${state.currentId}`, { method: 'PATCH', body: JSON.stringify({ title }) });
      state.job.title = title;
      await loadJobs();
      toast('已重命名');
    } catch (error) {
      toast(error.message, 'error');
    }
  });
  $('#jobTitle').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      $('#jobTitle').blur();
    }
  });

  window.addEventListener('hashchange', () => {
    const match = /#\/job\/([a-zA-Z0-9-]+)/.exec(location.hash);
    if (match && match[1] !== state.currentId) openJob(match[1]);
  });
  window.addEventListener('resize', () => {
    $$('.copy-text').forEach(autoGrow);
    $$('#voBody textarea').forEach(autoGrow);
    $$('#segList textarea.zh').forEach(autoGrow);
  });
  window.addEventListener('beforeunload', (event) => {
    if (state.segDirty.size || state.copyDirty) {
      event.preventDefault();
      event.returnValue = '';
    }
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      $('#moreMenu').classList.add('hidden');
      if (!$('#settingsModal').classList.contains('hidden')) closeSettings();
      closeImagePreview();
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      $('#segSearch').focus();
    }
  });
}

init();


/** 影片生成 API 不给百分比，按已用时间估一条会走的进度：200 秒到 96%，完成时跳 100%。 */
function estimateBasePct(elapsedSec) {
  const expected = 200;
  return Math.min(96, (elapsedSec / expected) * 100);
}

function tickBaseProgress() {
  for (const box of document.querySelectorAll('.base-progress')) {
    const bar = box.querySelector('.base-progress-track i');
    const pctEl = box.querySelector('.bp-pct');
    if (!bar || !pctEl) continue;
    const start = Number(box.dataset.start) || Date.now();
    const elapsed = Math.max(0, (Date.now() - start) / 1000);
    const pct = estimateBasePct(elapsed);
    bar.style.width = `${pct.toFixed(1)}%`;
    pctEl.textContent = `${Math.round(pct)}% · ${Math.round(elapsed)}s`;
  }
}

setInterval(tickBaseProgress, 1000);
