import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { chat } from './llm.mjs';
import { addBrief, readBriefs } from './briefs.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKILL_PATH = path.join(ROOT, 'skills', 'aroll-motion-prompts', 'SKILL.md');
const TRISTEN_PATH = path.join(ROOT, 'skills', 'tristen-b-roll-motion-prompts', 'SKILL.md');
const USED_STATE_PATH = path.join(ROOT, 'data', 'motion-used.json');
const RULES = {
  aroll: {
    root: path.join(ROOT, 'skills', 'aroll-rules'),
    examples: [
      path.join(ROOT, 'skills', 'aroll-rules', 'examples', 'plate-177-facebook-page-not-profile-aroll.xml'),
      path.join(ROOT, 'skills', 'aroll-rules', 'examples', 'plate-174-capabilities-see-you-next-lesson-aroll.xml'),
    ],
  },
  broll: {
    root: path.join(ROOT, 'skills', 'broll-rules'),
    examples: [
      path.join(ROOT, 'skills', 'broll-rules', 'examples', 'plate-172-ai-teaching-assistant-discord-slack-broll.xml'),
      path.join(ROOT, 'skills', 'broll-rules', 'examples', 'plate-178-one-manager-no-collide-broll.xml'),
    ],
  },
};

function read(file, fallback = '') {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return fallback;
  }
}

function extractXml(text) {
  let clean = String(text || '').trim();
  clean = clean.replace(/^```(?:xml)?\s*/i, '').replace(/```\s*$/i, '').trim();
  const start = clean.search(/<role\b/i);
  if (start < 0) return clean;
  const end = clean.lastIndexOf('</deliver>');
  if (end > start) return clean.slice(start, end + '</deliver>'.length).trim();
  const last = clean.lastIndexOf('>');
  return clean.slice(start, last + 1).trim();
}

function codesFrom(raw) {
  const line = String(raw || '')
    .split('\n')
    .find((item) => /NEW this cut/i.test(item)) || '';
  return [...new Set(line.match(/\b[M|I|E]\d{1,4}\b/g) || [])];
}

function parseCodeMax(text = '') {
  const maxOf = (prefix) => {
    let max = 0;
    const re = new RegExp(`\\b${prefix}(\\d{1,4})\\b`, 'g');
    let match;
    while ((match = re.exec(text))) max = Math.max(max, Number(match[1]));
    return max;
  };
  let plate = 0;
  const re = /plate[-_ ]?(\d{1,3})/gi;
  let match;
  while ((match = re.exec(text))) plate = Math.max(plate, Number(match[1]));
  return { plate, M: maxOf('M'), I: maxOf('I'), E: maxOf('E') };
}

function readUsedState(mode, briefs) {
  const rules = RULES[mode] || RULES.broll;
  const log = read(path.join(rules.root, 'logs', 'USED-MIE.txt'));
  let state = [];
  try {
    state = JSON.parse(read(USED_STATE_PATH, '[]'));
    if (!Array.isArray(state)) state = [];
  } catch {
    state = [];
  }
  const jobCodes = briefs.flatMap((brief) => brief.codes || codesFrom(brief.role));
  const jobText = jobCodes.join(' ');
  const jobPlate = Math.max(0, ...briefs.map((brief) => Number(brief.plate) || 0));
  const fromLog = parseCodeMax(log);
  const fromState = parseCodeMax(state.map((item) => `${item.codes?.join(' ') || ''} ${item.plate || ''}`).join('\n'));
  const fromJob = parseCodeMax(jobText);
  const max = {
    plate: Math.max(fromLog.plate, fromState.plate, jobPlate),
    M: Math.max(fromLog.M, fromState.M, fromJob.M),
    I: Math.max(fromLog.I, fromState.I, fromJob.I),
    E: Math.max(fromLog.E, fromState.E, fromJob.E),
  };
  return {
    max,
    next: { plate: max.plate + 1, M: `M${max.M + 1}`, I: `I${max.I + 1}`, E: `E${max.E + 1}` },
    used: {
      M: `M01–M${max.M}`,
      I: `I01–I${max.I}`,
      E: `E01–E${max.E}`,
    },
    state,
  };
}

function rememberUsed(mode, plate, codes, beatId, jobId) {
  let state = [];
  try {
    state = JSON.parse(read(USED_STATE_PATH, '[]'));
    if (!Array.isArray(state)) state = [];
  } catch {
    state = [];
  }
  state.push({ mode, plate, codes, beatId, jobId, at: new Date().toISOString() });
  const trimmed = state.slice(-500);
  fs.mkdirSync(path.dirname(USED_STATE_PATH), { recursive: true });
  fs.writeFileSync(USED_STATE_PATH, JSON.stringify(trimmed, null, 1));
}

function previousPlates(briefs) {
  return [...briefs]
    .sort((a, b) => String(b.importedAt || '').localeCompare(String(a.importedAt || '')))
    .slice(0, 3)
    .map((brief) => ({
      plate: brief.plate,
      part: brief.part,
      codes: brief.codes || codesFrom(brief.role),
      role: String(brief.role || '').slice(0, 500),
      style: String(brief.style || '').slice(0, 500),
    }));
}

function ensureArollGuard(raw) {
  const guard =
    'This is A-roll: do not build or insert B-roll scenes; overlays are type/UI cards on the talking-head layout.';
  if (/This is A-roll/i.test(raw)) return raw;
  if (/<\/role>/i.test(raw)) return raw.replace(/<\/role>/i, `\n${guard}\n</role>`);
  return `<role>\n${guard}\n</role>\n${raw}`;
}

function ensureCardTextInSource(raw, cardSpec) {
  if (!cardSpec) return raw;
  const title = String(cardSpec.title || '').trim();
  const subtitle = String(cardSpec.subtitle || '').trim();
  const bullets = (cardSpec.bullets || []).map((item) => String(item || '').trim()).filter(Boolean);
  const values = [title, subtitle, ...bullets].filter(Boolean);
  if (!values.length) return raw;
  const missing = values.filter((value) => !String(raw).includes(value));
  if (!missing.length) return raw;
  const block = [
    'Fixed B字卡 text (verbatim — render every line as actual text):',
    title ? `Title: ${title}` : '',
    subtitle ? `Subtitle: ${subtitle}` : '',
    bullets.length ? 'Bullets:' : '',
    ...bullets.map((item) => `- ${item}`),
  ].filter(Boolean).join('\n');
  return /<\/source>/i.test(raw)
    ? raw.replace(/<\/source>/i, `\n${block}\n</source>`)
    : `${raw}\n<source>\n${block}\n</source>`;
}

function stripDocFence(text = '') {
  let clean = String(text || '').trim();
  clean = clean.replace(/^```(?:markdown|md)?\s*\n/i, '').replace(/\n```\s*$/i, '');
  return clean.trim();
}

/** A-roll: follow skills/aroll-motion-prompts/SKILL.md and return a Markdown 指示词 document. */
async function generateArollInstructions({ meta, beat, provider, model, clip = {}, signal }) {
  const skill = read(SKILL_PATH);
  if (!skill) throw new Error('找不到 A-roll 提示詞 SKILL.md。');
  const briefs = readBriefs(meta.id);
  const usedState = readUsedState('aroll', briefs);
  const plate = usedState.next.plate;
  const seconds = Math.max(3, Number(beat.estSeconds) || Math.round((beat.words || 0) / 2.5) || 8);
  const clipNote = clip.hasVideoClip
    ? `已上傳這一拍的無動效 Base 人物視頻，時長 ${Number(clip.duration || 0).toFixed(2)} 秒；鏡頭時間軸以這個長度為準。`
    : `這一拍還沒有 Base 人物視頻；鏡頭時間軸按 ${seconds} 秒估算。`;

  const system = `你是 A-roll 指示詞生成器，嚴格按照下面的 SKILL 寫作。

<SKILL>
${skill}
</SKILL>

<WORKBENCH_CONTRACT>
你現在在工作台裡生成，沒有 shell、ffprobe、ffmpeg、whisper，也讀不到視頻檔。

這份 SKILL 是一份「API 段」的成品範例：它的鏡頭內容（API、Claude Code、Codex…）只是格式示範，
不要照抄內容，要按本次輸入的 vo 重新設計鏡頭。

必須遵守：
- 【人物画面硬性约束】那 5 條（single continuous shot / no cuts / no laptop close-up / 固定機位 / 只用原片）
  是最高優先級，要原樣寫進你這份文件的第 0 部分，一條都不能省。
- 人臉平移量沿用範例已量好的值：A2 left -781 top 0、A4 960×540 left -336 top -10、A3 left 496。
  只有當輸入明確說這一拍的臉不在 x≈1040 時，才改成佔位符並在文件末尾列「需要實測後填寫」。
- 時間軸：鏡頭從 0 秒開始連續排，總長等於給定秒數，切點放在句子開始前約 0.3 秒。
  版式輪換：A2 和 A4 交替，不要連續兩個鏡頭同一版式；每換一個鏡頭換一個舞台主色。
- 只做 A-roll，每個鏡頭都有人臉，不寫任何 B-roll 鏡頭。
- 直接輸出 Markdown 文件本體：不要用代碼圍欄把整份文件包起來，不要開場白、不要解釋。
  文件內部該用代碼塊的地方（模板 0、鏡頭模塊）照範例用代碼塊。
- 文件順序：使用方法與硬性約束 → 素材表 → 鏡頭總表 → 第 0 部分（模板 0）→ 每個鏡頭一個代碼塊 → 最後拼接步驟。
- 屏幕上的字用口播的語言（通常是英文），其餘用中文。
</WORKBENCH_CONTRACT>`;

  const user = JSON.stringify(
    {
      mode: 'aroll',
      plate,
      beatId: beat.id,
      vo: beat.vo,
      visual: beat.visual,
      seconds,
      words: beat.words,
      clip: clipNote,
      previous: previousPlates(briefs).map((item) => ({ title: item.role || '', plate: item.plate })),
    },
    null,
    1,
  );

  const call = (messages) => chat(provider, {
    model,
    messages,
    temperature: 0.6,
    maxTokens: 12000,
    jsonMode: false,
    signal,
    retries: 2,
  });

  let result = await call([
    { role: 'system', content: system },
    { role: 'user', content: user },
  ]);
  let doc = stripDocFence(result.text);
  if (!doc || doc.length < 300) {
    result = await chat(provider, {
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
        { role: 'assistant', content: doc || '（空）' },
        { role: 'user', content: '這份不完整。請重新輸出完整指示詞文件，直接從標題開始，不要任何解釋。' },
      ],
      temperature: 0.4,
      maxTokens: 12000,
      jsonMode: false,
      signal,
      retries: 2,
    });
    doc = stripDocFence(result.text);
  }
  if (!doc || doc.length < 300) {
    throw new Error('模型沒有產出可用的 A-roll 指示詞（內容太短）。請再按一次生成。');
  }
  if (!/【镜头】|【鏡頭】|镜头总表|鏡頭總表/.test(doc)) {
    throw new Error('模型輸出缺少鏡頭段落（沒找到【镜头】或鏡頭總表）。請再按一次生成。');
  }

  const saved = addBrief(meta.id, {
    xml: doc,
    filename: `aroll-${plate}.md`,
    beatId: beat.id,
    format: 'md',
  });
  rememberUsed('aroll', plate, [], beat.id, meta.id);
  saved.brief.codes = [];
  return {
    brief: saved.brief,
    briefs: saved.briefs,
    usage: result.usage || null,
    model: result.model,
  };
}

export async function generateMotionBrief({
  meta,
  beat,
  mode = 'broll',
  settings,
  provider,
  model,
  clip = {},
  cardSpec = null,
  cardPrompt = '',
  signal,
}) {
  if (mode === 'aroll') {
    return generateArollInstructions({ meta, beat, provider, model, clip, signal });
  }
  const skill = read(SKILL_PATH);
  if (!skill) throw new Error('找不到 AROLL motion prompts SKILL.md。');
  const tristen = read(TRISTEN_PATH);
  const rulesConfig = RULES[mode] || RULES.broll;
  const quick = read(path.join(rulesConfig.root, '00-QUICK-RULES-zh.md'));
  const fullRules = read(path.join(rulesConfig.root, '01-AROLL-BROLL-MOTION-RULES.md'));
  const calibration = read(path.join(rulesConfig.root, '03-CALIBRATION-NOTES.md'));
  const example = (rulesConfig.examples || [])
    .map((file) => read(file))
    .filter(Boolean)
    .join('\n\n--- EXAMPLE ---\n\n');
  const briefs = readBriefs(meta.id);
  const usedState = readUsedState(mode, briefs);
  const plate = usedState.next.plate;
  const kind = mode === 'aroll' ? 'A-roll（talking head）' : 'B-roll（faceless）';
  const guard =
    mode === 'aroll'
      ? 'This is A-roll: do not build or insert B-roll scenes; overlays are type/UI cards on the talking-head layout.'
      : '';

  const system = `You are the AROLL motion prompt generator. Follow the SKILL below exactly.

<SKILL>
${skill}
</SKILL>

${tristen ? `<TRISTEN_BROLL_SKILL>\n${tristen}\n</TRISTEN_BROLL_SKILL>\n` : ''}
<QUICK_RULES>
${quick}
</QUICK_RULES>

<FULL_MOTION_RULES>
${fullRules}
</FULL_MOTION_RULES>

<CALIBRATION>
${calibration}
</CALIBRATION>

<FORMAT_REFERENCE>
This is a ${mode === 'aroll' ? 'A-roll' : 'B-roll'} example from the same series. Use it only for XML structure, tag order, timing style, and specificity. Do NOT copy its content, plate number, motifs, icons, or end treatment.
${example}
</FORMAT_REFERENCE>

Rules for this generation:
- Output exactly ONE XML document, no Markdown fences, no commentary.
- Include: role, source, script_timed, style_lock, icons, end, edit, banned, self_check, deliver.
- Use the requested plate number. Do not reuse any used M/I/E code; start from the next unused codes (${usedState.next.M} / ${usedState.next.I} / ${usedState.next.E}) and describe them.
- ${mode === 'aroll' ? guard : 'Faceless B-roll only. No face, no talking head. Use blank cards/chips instead of invented names, prices, IDs, or ad copy.'}
- Keep VO verbatim; timing is ESTIMATED from the given seconds unless a clip/timestamp is provided.
- Make every design choice yourself; do not leave pick-one options.
- For B-roll that has an existing B字卡 card: the card's title/subtitle/bullets/layout/theme/accent are FIXED. Animate THAT card; do not invent a different scene, stage hue, or text. BROLL may add motion, icons, and end treatment only, while preserving the card design. If the card prompt is dark/blue, the motion plate must stay dark/blue.
- If bCard is present: copy its exact title, subtitle, and every bullet into <source> verbatim. Never write "four bullets verbatim" or similar without listing the actual text. Missing text makes the renderer draw blank bars.
- Full-stage composition: the main card should occupy roughly 55–70% of frame width. Avoid a tiny corner card with a large empty area; use 4–8 meaningful visual elements.
- Plate ${plate} must rotate away from the previous plates in layout, primary motion axis, and end treatment.`;

  const user = JSON.stringify(
    {
      mode,
      kind,
      plate,
      beatId: beat.id,
      vo: beat.vo,
      visual: beat.visual,
      estSeconds: beat.estSeconds || 8,
      words: beat.words,
      hasVideoClip: Boolean(clip.hasVideoClip),
      clipDuration: clip.duration || null,
      source: clip.hasVideoClip
        ? `uploaded person video (${Number(clip.duration || 0).toFixed(2)}s); re-lock timing to this take`
        : 'course copy + beat metadata; timing ESTIMATED; no per-beat clip supplied',
      usedCodes: usedState.used,
      nextCodes: usedState.next,
      previousPlates: previousPlates(briefs),
      bCard: cardSpec
        ? {
            prompt: cardPrompt,
            title: cardSpec.title || '',
            subtitle: cardSpec.subtitle || '',
            bullets: cardSpec.bullets || [],
            layout: cardSpec.layout || '',
            theme: cardSpec.theme || '',
            accent: cardSpec.accent || '',
            motion: cardSpec.motion || '',
            brollPrompt: cardSpec.brollPrompt || '',
          }
        : null,
      requirements: [
        'A-roll: face is hero; overlays are type/UI only; rotate layout family; include the guard line.',
        'B-roll: full-stage MODS empty frames; no face required; blank fields.',
        'One plate per output; PART 1/1 unless previousPlates indicates a multi-part handoff.',
        'Use exact stage hues from the SKILL; no logos.',
      ],
    },
    null,
    1,
  );

  const messages = [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
  let result = await chat(provider, {
    model,
    messages,
    temperature: 0.75,
    maxTokens: 8000,
    jsonMode: false,
    signal,
    retries: 2,
  });

  let raw = extractXml(result.text);
  if (!/<role\b/i.test(raw) || !/<deliver\b/i.test(raw)) {
    // Full rules + examples can be too much context; retry once with the
    // compact rules (quick rules + format example only) and a lower temperature.
    const compactSystem = system
      .replace(/<FULL_MOTION_RULES>[\s\S]*?<\/FULL_MOTION_RULES>/i, '')
      .replace(/<CALIBRATION>[\s\S]*?<\/CALIBRATION>/i, '');
    result = await chat(provider, {
      model,
      messages: [
        { role: 'system', content: compactSystem },
        { role: 'user', content: user },
      ],
      temperature: 0.55,
      maxTokens: 8000,
      jsonMode: false,
      signal,
      retries: 2,
    });
    raw = extractXml(result.text);
  }
  if (/<role\b/i.test(raw) && !/<\/role>/i.test(raw)) {
    raw = raw.replace(/(<source\b)/i, '</role>\n$1');
  }
  if (mode === 'aroll') raw = ensureArollGuard(raw);
  if (!/<role\b/i.test(raw) || !/<deliver\b/i.test(raw)) {
    throw new Error('模型没有返回完整的 XML（缺少 role/deliver）。已重試壓縮規則版仍失敗，請再按一次生成。');
  }
  // Keep plate numbering deterministic even if the model forgets it.
  raw = raw.replace(/Plate\s+\d+/i, `Plate ${plate}`);
  if (mode === 'broll') raw = ensureCardTextInSource(raw, cardSpec);

  const brief = addBrief(meta.id, {
    xml: raw,
    filename: `plate-${plate}-${mode}.xml`,
    beatId: beat.id,
  });
  brief.brief.codes = codesFrom(brief.brief.role);
  rememberUsed(mode, plate, brief.brief.codes, beat.id, meta.id);
  return {
    brief: brief.brief,
    briefs: brief.briefs,
    usage: result.usage || null,
    model: result.model,
  };
}
