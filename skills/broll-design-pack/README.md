# broll-design-pack

The complete rendering system for the faceless B-roll six-pack, plates 179 → 184. It is the same code used for delivery: frames rendered from these scripts were checked against the original renders and match pixel for pixel.

- Output: **1920×1080 · 30 fps · H.264** (libx264, preset medium, CRF 18, yuv420p, MP4)
- Stack: **Python + Pillow + NumPy**. Each frame is piped as raw RGB into ffmpeg. Remotion is not used.

## Dependencies

| Item | Version tested | Notes |
|---|---|---|
| Python | 3.13 (3.9+ works) | |
| Pillow | 12.3 (10+ works) | `pip install pillow` |
| NumPy | 2.5 (1.24+ works) | `pip install numpy` |
| ffmpeg | 6.1 | must be on `PATH`, built with libx264 |
| Font | Inter Black / ExtraBold | bundled in `fonts/` (SIL OFL, see `fonts/LICENSE-Inter.txt`) |

```bash
pip install pillow numpy        # add --break-system-packages on Debian/Ubuntu system Python
```

## How to run

```bash
# one plate → MP4
python3 plates/plate-184.py video plate-184.mp4

# key frames at given times (X is replaced by the time)
python3 plates/plate-184.py still 1.0,4.9,10.5 frame_X.png

# all six plates, plus the stitched 179→184 master in out/
scripts/render_all.sh

# rebuild references/ (start / mid / end of every beat)
python3 scripts/make_references.py

# rebuild the JSON specs from the code values
python3 scripts/build_specs.py
```

Rendering all six plates in parallel takes about 50 s on 2 cores.

## Contents

| Path | What it is |
|---|---|
| `components.py` | All reusable drawing and motion code, described in the next section. |
| `plates/plate-179.py` … `plate-184.py` | The full render scripts. Each one defines `build()` (pre-renders sprites) and `frame(t)` (draws one frame at time t), then calls `run()`. |
| `design.json` | Canvas, safe areas, card sizes and radii, shadow parameters, strokes, per-plate component sizes. |
| `motion.json` | Every layer of every beat: layer name, in time, duration, easing, from/to, out. |
| `palette.json` | Every hex value, including the 10 stage gradients and which stage each plate uses. |
| `typography.json` | Font, weights, every font size per plate, line-height and anchor rules. |
| `references/` | 54 PNGs: start, mid and end frame of each beat (6 plates × 3 beats × 3). Filenames look like `plate-184_C_mid_09.75s.png`. |
| `scripts/` | `render_all.sh`, `make_references.py`, `build_specs.py`. |
| `fonts/` | Inter-Black.otf, Inter-ExtraBold.otf and the licence. |

### What is in `components.py`

- **Canvas:** `W, H, FPS`, the sprite margin `M = 90`, and the font loader `F(weight, size)`.
- **Easing:** `p` (progress), `lerp`, `eob` (back/overshoot), `eoc` (out-cubic), `eio` (smoothstep), `spring`, `shake`, `jolt`.
- **Compositing:** `place` (by centre, with scale and alpha), `comp`, `fade`, `dim`, `alpha_layer`.
- **Stage:** `stage` and `bg` (radial gradient stages).
- **Cards and text:** `card`, `plaque`, `stubcard`, `darkpanel`, `mac` (mac window), `bot`, `disc` (node), `draw_parts` (multi-colour text), `plen`.
- **Lines and arrows:** `dashed`, `partial` (draw-on), `arrowhead`, `dashed_arrow`, `check`.
- **Handoff tabs:** `peek` and `tab_out` (the six-pack stitching tabs).
- **Runner:** `run` (the CLI and the ffmpeg pipe).

## Durations per plate and beat

All timings are **ESTIMATED** (about 2.6 words per second). Re-time with Whisper once the real VO exists.

| Plate | Stage | Total | Beat A | Beat B | Beat C (incl. end) |
|---|---|---|---|---|---|
| 179 | terracotta | 12.0 s | 0.0–3.2 MARKETING TEAM BUILT | 3.2–6.4 BEFORE · EACH BOT | 6.4–12.0 MANAGER PLANS · HIRED → peek GROUP CHAT @11.0 |
| 180 | emerald | 7.5 s | 0.0–1.8 GROUP CHAT | 1.8–3.8 ASSIGN · ONE PLACE | 3.8–7.5 PROGRESS · SAME CHAT → peek @6.4 |
| 181 | cobalt | 7.5 s | 0.0–2.2 FIVE EMPLOYEES | 2.2–4.8 SHARED MEMORY ring | 4.8–7.5 EVERYONE SEES PROGRESS → peek @6.4 |
| 182 | violet | 8.0 s | 0.0–2.2 RESEARCH · FINDINGS | 2.2–4.4 FINDINGS → POSTS flip | 4.4–8.0 HAND OFF → CONTENT → peek @6.9 |
| 183 | hot pink | 7.5 s | 0.0–1.6 MANAGER ASSIGNS | 1.6–3.2 STAFF EXECUTE | 3.2–7.5 GROUP CHAT SYNCS · PROGRESS → peek @6.4 |
| 184 | navy | 12.5 s | 0.0–3.2 LEAD · EVERY STATUS | 3.2–7.0 MANAGER ACCEPT → YOU | 7.0–12.5 FAILS REVIEW → SEND BACK → FIX (soft-strong close) |
| **Stitched** | | **55.0 s** | | | |

## Stitching convention

Each plate ends with a small cream tab sliding in at the lower-left, at (330, 1000) and scale 0.8; this is `peek()`. The next plate opens with that same tab flying to its hero position and fading out (`tab_out()`), while the hero element springs in. The stage colour changes at the cut.

## Design rules this pack follows

- **Faceless:** no people illustrations and no logos. Brand or role names appear as text only.
- **Blank fields:** placeholders are grey stub lines only. Never invent names, numbers or copy.
- **Coral:** at most one coral keyword per beat, and coral text always sits on cream, never directly on a coloured stage.
- **No camera moves:** impacts use a 2–4 px whole-frame `jolt()` lasting 0.10–0.20 s.
- **No CTA:** no "Subscribe" or "next lesson". Plate 184 ends on a soft-strong UI lock.
