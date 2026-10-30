---
name: Chinese course to English YouTube VO shots
description: >-
  Use when the user pastes or attaches a Chinese course script and wants it
  rewritten into segmented English YouTube teaching voiceover with one shot
  label per beat (talking head / B-roll card / screen demo), roughly one
  sentence per shot, and a Markdown table deliverable.
---
# Chinese course to English YouTube VO shots

Turn a Chinese course script into spoken English YouTube teaching VO, split into short beats with one visual label each. Preserve meaning and facts. Do not invent new topics, modules, or claims.

## When this applies

- User pastes Chinese course稿 / transcript / lesson outline, or attaches a `.docx` / `.md` / `.txt` of the same.
- Goal is English long-form teaching voiceover for YouTube (or similar), not a literal translation dump.
- If they paste one English VO line (or a few) and ask to rewrite / shorten: treat as a beat edit on the current lesson files, not a new lesson.

## Shot labels (exactly one per beat)

Use Traditional Chinese labels unless the user asks for English equivalents:

| Label | Use when |
|-------|----------|
| `人物口播` | Host on camera (face). Face + on-screen card in the same frame (hybrid) also counts as `人物口播`. |
| `B字卡` | Faceless concept card / title / diagram / text board. No live UI demo. |
| `實操` | Live product UI, screen recording, click-through, or typed demo. |

Default mix for a ~10-minute on-camera lesson (adjust if the user names a different style):

- `人物口播` ≈ 30–35%
- `B字卡` ≈ 25–30%
- `實操` ≈ 35–40%

Faceless-first lessons may be mostly `B字卡` + `實操` with little or no `人物口播`. Prefer rebalancing labels over padding empty beats.

Typical rhythm: Hook → definition card → objection / good news (talking head + card) → mechanism card → hands-on proof → short close.

## English VO standards

Act as a professional YouTube long-form script editor / education content strategist.

- Keep original intent, key facts, and teaching sequence.
- Sound like a senior YouTube educator talking to viewers: confident, insightful, friendly, engaging.
- Easy to GET by ear. Conversational. Not academic, not corporate deck, not ad copy, not AI-flavored filler.
- One idea per beat. Prefer short spoken paragraphs over bullet lists in the VO itself.
- Opening beat: clear value hook.
- Use open loops, questions, examples, and smooth transitions sparingly (e.g. “Here’s why this matters”, “But there’s an important detail”, “Let’s break this down”, “Now you might be wondering”). Do not repeat the same transition phrase.
- Split long explanations into digestible beats. Add a concrete example or analogy only when it clarifies the source idea.
- Cut repetition, filler, empty praise, and needless jargon.
- No unfounded clickbait.
- Closing: brief recap + clear takeaway + natural CTA when the source ends that way.

### Hard length rule

Every beat must stay under **~10 seconds spoken**, about **≤25 English words**. If one idea is longer, **split into two (or more) beats** rather than truncating meaning. Re-check word count before delivery.

### Spoken punctuation

Do **not** use hyphens or em dashes as spoken pauses. Split with commas, periods, or short sentences so it reads like real speech.

### Product / brand names

Normalize names from the source for English viewers (examples): Grok Bot (not GroboBot), Feishu also known as Lark when helpful, LINE in caps. Follow the user’s established product names when they already set them.

## Deliverable format

Primary delivery: a Markdown **table file** attachment (not only chat paste). Columns:

```markdown
| # | 畫面類型 | English VO | 畫面/字卡 |
|---|----------|------------|-----------|
| 1 | 人物口播 | ... | ... |
```

- `#`: sequential beat number starting at 1.
- `畫面類型`: exactly one of `人物口播` / `B字卡` / `實操`.
- `English VO`: the spoken line only (no stage directions inside this cell).
- `畫面/字卡`: concise on-screen / shot direction for that beat (what the viewer should see: card text, UI step, host framing).

Also keep a parallel working copy on the box under a lesson folder, e.g.:

- `zh-source.txt` — original Chinese
- `en-vo-shots.md` — numbered beats (optional prose form)
- `en-vo-shots-table.md` — the table file you attach

If the user cannot copy the attachment, paste the full table in chat as fallback.

After delivery, briefly report beat count and the three label counts. Offer to relabel (e.g. some rule-explanation `實操` → `B字卡`) if the mix drifted from their target.

## Workflow

1. **Ingest** the Chinese source (paste or extract from attachment). Save `zh-source.txt`.
2. **Map structure**: sections, demos, definitions, objections, close. Decide shot labels per beat from the content, not from equal slicing.
3. **Rewrite** into English YouTube teaching VO: one beat ≈ one shot, ≤25 words, no hyphen pauses, preserve facts.
4. **Self-check**: meaning intact; no invented topics; length; label mix; spoken rhythm; table columns complete.
5. **Deliver** the table `.md` attachment + one short status line (counts + any mix note). Communicate with the user in Traditional Chinese unless they write in another language.
6. **Beat edits**: when they paste a line or say “短一些，但是保證表達內容” / rewrite #N, update that beat in both working files, return the rewritten line, and invite the next number.

## Out of scope

- Do not expand into a new lesson outline the source never taught.
- Do not write motion/B-roll XML here (use the motion-prompt skill if asked).
- Do not send email or post scripts unless the user explicitly asks for that send path.


## 實操優先規則（2026-10 更新）

- 當段落正在演示產品 UI、畫面操作、點擊、輸入或螢幕錄製時，口播即使是在解釋概念，也優先標為 `實操`，用當前操作畫面承載。
- 不要把「可以被操作畫面覆蓋的概念」硬拆成 `B字卡`；`B字卡` 只用於沒有可用操作畫面、或需要獨立概念圖的情況。
- 同一段連續操作／同一界面解說合併成一個較長的 `實操` beat（建議 15–36 秒，最多 80 words），不要每個點擊拆一拍。
- `人物口播` 主要用於 opening、章節轉場、結尾。
- 如果模型把概念段標成 `B字卡`，但該段其實有可用操作畫面，應改標為 `實操`。
- 操作型章節的目標配比：`實操` **70–80%**，人物口播主要 opening／轉場／結尾，`B字卡` 只留給無法用操作畫面承載的概念。
- 概念型章節（幾乎沒有可用 UI）可以 `B字卡`／人物 為主，**不要硬湊 70% 實操**；先判斷這一章是操作型還是概念型。
