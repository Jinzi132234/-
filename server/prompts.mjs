export const TRANSLATE_SYSTEM = `你是一位资深的中英字幕译者，专门把英文 AI、编程、商业课程翻译成简体中文。
规则：
1. 只翻译，不解释，不总结，不添加原文没有的信息。
2. 用自然、口语化的简体中文，像中文老师在讲课；避免翻译腔和书面腔。
3. 保留英文品牌名、产品名、专有名词和技术术语（例如 Grokbot、Mobbin、Canva、Claude Code、prompt），必要时可在括号里保留英文。
4. 数字、单位、价格、时间、网址必须准确。
5. 每条字幕独立成句，不要换行；尽量不超过 42 个汉字。
6. 原文是口头表达，可以修掉明显口误和 ASR 识别错误，但不得改变意思。
7. 严格输出 JSON：{"items":[{"id":"s1","zh":"译文"}]}。id 必须与输入一一对应、顺序一致、不得遗漏。不要输出任何 JSON 以外的文字。`;

export function buildTranslateMessages(items, { contextBefore = [], style = '', glossary = '' } = {}) {
  const lines = items.map((item) => ({
    id: item.id,
    text: item.text,
  }));
  const context = contextBefore.length
    ? `上文（仅帮助理解语境，不要翻译）：\n${contextBefore.map((s) => `- ${s.text}`).join('\n')}\n\n`
    : '';
  const styleNote = style ? `\n翻译风格补充：${style}` : '';
  const glossaryNote = glossary ? `\n专有名词必须使用以下写法（不要翻译、不要改写）：${glossary}` : '';
  return [
    { role: 'system', content: TRANSLATE_SYSTEM + styleNote + glossaryNote },
    {
      role: 'user',
      content: `${context}把下面每一条英文字幕翻译成简体中文，返回 {"items":[{"id":"…","zh":"…"}]}：\n${JSON.stringify(lines, null, 0)}`,
    },
  ];
}

export const COPY_SYSTEM = `你是中文知识付费课程的文案编导，负责把课程字幕整理成可以直接录制或配音的文案。
要求：
1. 按语义把内容分成若干段（每段约 45–120 秒），每段主题清晰，不要按固定时间硬切。
2. 每段输出字段：
   - title：8–16 字的段落标题，具体、有信息量，不要标题党。
   - copy：该段可直接口播的简体中文文案。合并零散字幕，去掉口头禅、重复和语气词，修正识别错误，保留讲师原意与信息密度，不得编造。
   - screenText：8–14 字的屏幕大字或章节字，可以留空。
   - summary：20–40 字的内容摘要。
   - startId / endId：该段起止字幕的 id，必须是输入中真实存在的 id。
3. 各段首尾相接、覆盖全部内容，不重叠、不遗漏。
4. copy 要口语化、逻辑连贯。除非原文有，不要出现“大家好”“我们下期再见”等模板句。
5. 长度参考：中文口播约 4.2 字/秒，copy 字数控制在段落时长的 3.5–4.8 倍。
6. 严格输出 JSON：{"blocks":[{...}]}。不要输出任何 JSON 以外的文字。`;

export function buildCopyMessages(segments, { brief = '', partIndex = 0, partCount = 1, glossary = '' } = {}) {
  const payload = segments.map((s) => ({
    id: s.id,
    t: `${formatClock(s.start)}-${formatClock(s.end)}`,
    zh: s.zh || s.text,
  }));
  const briefNote = brief ? `\n本项目额外要求：${brief}` : '';
  const glossaryNote = glossary ? `\n专有名词必须使用以下写法：${glossary}` : '';
  const partNote =
    partCount > 1
      ? `\n注意：这是整节课的第 ${partIndex + 1}/${partCount} 部分，只处理给出的字幕，不要补写前后内容。`
      : '';
  return [
    { role: 'system', content: COPY_SYSTEM + briefNote + glossaryNote + partNote },
    {
      role: 'user',
      content: `把下面这段课程字幕整理成分段文案，返回 {"blocks":[…]}: \n${JSON.stringify(payload, null, 0)}`,
    },
  ];
}

export const REVISE_SYSTEM = `你是资深中文课程文案编辑。根据用户要求改写给定文案。
规则：
1. 只输出改写后的正文，不要解释、不要加引号、不要输出 Markdown 标题或列表符号。
2. 保持原意与事实准确，不编造原文没有的内容。
3. 简体中文，口语化，适合直接口播。
4. 如果用户要求“缩短”，优先删重复和铺垫，保留信息点；如果要求“展开”，只做语言上的展开，不新增事实。`;

export function buildReviseMessages(text, instruction, extra = '') {
  return [
    { role: 'system', content: REVISE_SYSTEM },
    {
      role: 'user',
      content: `改写要求：${instruction}\n${extra ? `补充说明：${extra}\n` : ''}\n原文：\n${text}`,
    },
  ];
}

export function formatClock(seconds) {
  const s = Math.max(0, Number(seconds) || 0);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
    : `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}
