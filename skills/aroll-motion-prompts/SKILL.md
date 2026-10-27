---
name: AROLL motion prompts
description: >-
  Use when writing Claude-ready MODS A-roll or faceless B-roll motion XML from
  course copy and/or talking-head clips — rotate layouts, M/I/E codes, keep face
  as hero on A-roll, and deliver speech-locked prompts.
---
# AROLL motion prompts

Turn course copy and/or talking-head clips into Claude-ready MODS-style motion XML. Deliver A-roll (talking head) or faceless B-roll prompts that rotate layout, motion, icons, and end treatments so consecutive plates do not look the same.

Also read [Tristen B-roll motion prompts](sand-workflow:tristen-b-roll-motion-prompts) for the locked palette, icon library, and end-treatment codes.

## When this applies

- Owner pastes English (or other) VO and says AROLL / BROLL, or attaches talking-head clips with matching copy.
- Owner asks for Claude motion prompts, plate XML, or a re-time of an existing plate to a new take.
- Not for editing the final video file, inventing VO, or building illustrated scenes inside A-roll.

## Inputs

| Input | What to do |
|-------|------------|
| Copy only | Faceless B-roll unless they said AROLL; estimate timing (~2.6 words/s); mark ESTIMATED — re-time when a clip arrives. |
| Video + copy | A-roll (or B-roll if tagged). Whisper-lock word timestamps; SHA1-check for duplicate/retake vs prior sources. |
| Multi clips + multi paragraphs | Order by Whisper text, not upload filename. PART n/N stitch with soft handoffs; only the last part is the strong close. |
| Same copy, new files | Compare SHA1 to existing plate sources. Identical → keep. Different retake → re-time only (keep design/codes). |

## A-roll vs B-roll

**A-roll (talking head)**
- Face is the hero. Overlays are **type and UI cards only**.
- Never build or insert illustrated B-roll scenes, props, or illustrated people inside the talking-head plate.
- Every A-roll file includes a guard line: *This is A-roll: do not build or insert B-roll scenes; overlays are type/UI cards on the talking-head layout.*
- Rotate layout families: Lesson+PiP, sparse full-face, Stage+corner PiP (vary corner), Split. Do **not** default every plate to half-screen Split.

**B-roll (faceless)**
- Full-stage MODS empty frames. No face required.
- Still type/UI language; blank fields instead of invented names, prices, or IDs.

## Style lock

- Reference feel: Tristen O'Brien MODS / Claude Code Just Dropped.
- Stage hues (exact, not softened): terracotta, emerald, cobalt, violet, hot pink, cream, navy, peach, mustard-gold.
- Cream cards + near-black windows; sticker accents blue/pink/gold/green/purple/orange.
- Black capsules/pills sparingly — rotate thick cream cards, mac windows, numbered discs, chat bubbles, stamps.
- Tool and product names as **text only**, never logos (e.g. Grok Bot, Notion, Feishu, Ad Library).

## Non-repetition

- Every new plate: unused **M** (motion axis) + **I** (icon/mark, with full `<icons>` spec) + **E** (end treatment).
- Dual lower pills at most once per lesson body.
- Consecutive plates: different primary motion axis and end treatment; prefer a different layout family when the idea changes.
- Keep a lesson log of used M/I/E codes; never reuse on back-to-back prompts.

## Content rules

- Keep VO verbatim. Never invent numbers, prices, names, headers, or ad copy.
- Use blank cards, chips, and placeholders when the VO does not name a value.
- VO words that are already labels (e.g. "eight a.m.", "Type A", "Client A") may appear on screen as written.
- Flag unscripted tails and ASR doubles; suggest a cut point; freeze or hold clean text over the bad span when needed.
- Make every design choice yourself — no pick-one options left for the renderer.

## Workflow

1. Confirm A-roll vs B-roll (tag, video presence, or prior series).
2. Ingest clips: Whisper + duration + SHA1; map to copy parts in speech order.
3. Read the motion rules and used-code log; pick next free M/I/E and a layout/hue that rotates away from the previous plate.
4. Design beats that match VO meaning with type/UI only (A-roll) or faceless stage (B-roll).
5. Write one XML file per plate under the plate prompts folder; include `<stitch>` for multi-part series.
6. Self-check: face clear (A-roll)? new M/I/E? palette exact? no invented facts? guard line present on A-roll?
7. Update the used-code log. Deliver the XML file(s) plus a short summary in the owner's chat language (duration, layout, hue, beat sequence, codes, ASR/cut flags).

## Deliverable shape

Claude-ready XML per plate, typically including: role (with M/I/E), source, script_timed, style_lock, icons, end, edit/stitch, banned, self_check, deliver. A-roll always carries the face-hero guard line.

## Out of scope

Inventing VO, editing final mp4s, illustrated A-roll inserts, defaulting every cut to Split or black pills, reusing M/I/E on consecutive plates, packing secrets or personal plate logs into shared templates.
