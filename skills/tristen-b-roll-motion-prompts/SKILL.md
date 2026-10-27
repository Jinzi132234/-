---
name: Tristen B-roll motion prompts
description: >-
  Use when writing or rewriting motion/B-roll XML prompts for course or
  explainer videos that must match the Tristen O’Brien MODS reference feel, keep
  a locked cream/black/coral/yellow/teal/purple palette, rotate unique motion
  axes, icon/mark designs, AND end-card treatments per beat, and never cover the
  talking-head face.
---
# Tristen B-roll motion prompts

Write speech-locked motion XML for talking-head + B-roll (or faceless empty B-roll) that matches the Tristen O’Brien *Claude Code Just Dropped MODS* feel, keeps a locked palette, and uses a **new motion axis**, a **new icon/mark design**, and a **new end treatment** every cut.

## Canonical refs (always self-check)

1. Primary style: [Claude Code Just Dropped MODS](https://www.youtube.com/watch?v=LDn7rQKIFro) — thick floating cards, black pills, gradient stages, macOS/UI windows, in-shot spring motion, mixed layouts.
2. Edit-grammar feel (user-locked sample): full-face sparse black pill → hard-cut full gradient stage (floating macOS window + logos + corner PiP) → 50/50 split (color board | live face) → full-face close with a **varied** end treatment (not the same dual pills every time).
3. Before every deliverable: if it looks like PPT, thin subtitles, the same triple colored dots, or the **same stacked dual lower pills** (small accent + black capsule) as the last cut, rewrite.

## Locked palette (no new theme colors)

| Role | Colors |
|------|--------|
| Cards / panels | Cream / off-white, warm radial fill, heavy soft shadow |
| Labels | Black capsules (white text) |
| Accents | Coral, warm yellow, teal, **purple** |
| Stages | Soft peach, soft teal, or soft purple (one hue lead per beat) |
| UI windows | Light cream or dark charcoal macOS (traffic lights) |
| Type | Inter / SF, bold caps on pills |

Colors may repeat; **icon shapes, mark treatments, and end cards must not** copy the previous cut.

## Icon / mark library (rotate every cut)

| ID | Mark design |
|----|-------------|
| I01 | Product logo lockup |
| I02 | Filled rounded-square glyph |
| I03 | Stroke-only line icon |
| I04 | Numbered black disc 01/02/03 |
| I05 | Letter badge A/B/C |
| I06 | Progress ring / arc |
| I07 | Check-ring |
| I08 | Mini macOS favicon |
| I09 | Hex or diamond node |
| I10 | Chat-bubble glyph |
| I11 | Lock / stamp badge |
| I12 | Live-dot + capsule only (sparse) |
| I13 | Wide color bar + end-cap icon |
| I14 | Stacked document / layer glyph |
| I15 | Scissors / clapper / waveform |

**Ban:** identical triple coral/yellow/teal dots or three same rounded squares as the hero pattern every cut; meaningless dots; copying the previous cut’s icon set.

Name I-codes + exact glyphs in `<icons>` every time.

## End-treatment library (rotate every cut — critical)

The closing 1–3s on full face must pick an **E-code different from the last cut**. Do **not** default to “small purple/coral pill over black pill” every time.

| ID | End treatment |
|----|---------------|
| E01 | Dual lower pills (accent + black) — **use at most once per lesson** |
| E02 | Single wide cream lower-third bar with one logo + title |
| E03 | One oversized black stamp / wax-seal style capsule only |
| E04 | Brief kinetic word slam on half-second stage flash, then back to clean face |
| E05 | Single chat-bubble type-on under chin |
| E06 | Thin top-right breadcrumb only (no lower stack) |
| E07 | Mini connected-node lockup (hex/diamond) bottom-right |
| E08 | One thick floating card (single idea) shoulder-right |
| E09 | Window title-bar strip peeks bottom edge only |
| E10 | Handwritten-style underline under one on-screen word, then fade |

**Hard ban:** repeating E01 (stacked GROUP + YOUTUBE TEAM style dual pills) on consecutive cuts or as the default close.

## Hard constraints

- Speech-locked; re-transcribe; never invent VO.
- Face clearance always; overlays only in negative space.
- Anti-PPT; layout variety (full face / stage / PiP / split).
- Product logos when named.
- Course outro: Thanks / LESSON COMPLETE only — no Comment/Like/Subscribe unless YTB CTA asked.
- A = sparse; 實操 = UI XML; B = faceless unless talking-head asked.

## Motion library

Track **used M-IDs, I-IDs, and E-IDs** per lesson. Rotate all three.

### Layout rhythms

1. Sparse → Stage+PiP → Split → **varied end (E02–E10 preferred)**
2. Face → Kinetic type board → Face + one thick card
3. Face → Dark UI stage → Face + chat bubble
4. Faceless: stage → window grow → bars → logo lockup
5. Outro: face → remember stage → face + card → Thanks + LESSON COMPLETE

### Motion axes M01–M15

M01 shelf · M02 path · M03 flip · M04 bars · M05 window scale · M06 in-window checks · M07 pill stamp · M08 tab compress · M09 chat type-on · M10 logo orbit · M11 split wipe · M12 progress fill · M13 command chips · M14 word slam · M15 PiP resize

**Banned as primary:** full-frame checklist cascade; same three cream tiles every time; flat labels; decorative rainbow ①②③; static page-flips.

## XML shape

```xml
<role>… NEW M-IDs + I-IDs + E-ID …</role>
<source>…</source>
<script_timed>…</script_timed>
<style_lock>…</style_lock>
<icons>…</icons>
<end>… E-code + description (must ≠ last cut)</end>
<edit>…</edit>
<banned>… reuse of last end dual-pills …</banned>
<self_check>… new motion? new icons? new end? face? palette?</self_check>
<deliver>…</deliver>
```

## Workflow

1. Ingest plate/script.
2. Check refs.
3. Pick unused M + I + **E**.
4. Lock palette.
5. Write XML.
6. Self-check including **end ≠ last cut**.
7. Remember used M/I/E for the lesson.

## Quick failure → fix

| User says | Fix |
|-----------|-----|
| 像 PPT | Stage + in-shot spring |
| 不像对标 | Pills + macOS + layout mix |
| 颜色花了 | Locked set only |
| 动效重复 | New M-IDs |
| 图标/点都一样 | New I-IDs + noun glyphs |
| 收尾和上次一样 | New E-ID; ban E01 repeat |
| 遮脸 | Negative space only |

## Out of scope

No invented VO, no extra CTA, no colors outside the set, no reused M/I/E on back-to-back prompts.
