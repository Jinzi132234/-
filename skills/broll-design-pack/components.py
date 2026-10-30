"""
broll-design-pack · components.py
All reusable Pillow drawing + motion helpers used by plates 179–184.
Canvas 1920×1080 · 30 fps · H.264 (libx264, crf 18, yuv420p) via ffmpeg pipe.

Every sprite helper returns an RGBA image padded by M px on each side (room for the soft drop shadow);
`place()` composites a sprite by its CENTER, with optional scale and alpha.
"""
import os, sys, math, subprocess, functools
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageEnhance

# ───────────────────────── canvas ─────────────────────────
W, H, FPS = 1920, 1080, 30
M = 90                      # sprite margin around every card (shadow room)

_HERE = os.path.dirname(os.path.abspath(__file__))
_FONT_DIRS = [os.path.join(_HERE, 'fonts'), '/usr/share/fonts/opentype/inter']

@functools.lru_cache(None)
def F(weight, size):
    """Inter font. weight: 'Black' | 'ExtraBold'."""
    for d in _FONT_DIRS:
        f = os.path.join(d, f'Inter-{weight}.otf')
        if os.path.exists(f): return ImageFont.truetype(f, size)
    raise FileNotFoundError(f'Inter-{weight}.otf not found in {_FONT_DIRS}')

# ───────────────────────── palette (RGB) ─────────────────────────
CREAM = (255, 249, 238); INK = (20, 20, 24); CORAL = (232, 56, 40); CHAR = (28, 30, 36); LINE = (222, 210, 192)
GREYT = (112, 102, 92); GREEN = (22, 160, 84); WHITE = (255, 255, 255)
TERRA = (204, 84, 48); EMER = (0, 150, 98); COBALT = (38, 88, 226)
BLUE = (52, 120, 246); PINK = (255, 92, 150); GOLD = (250, 184, 26); PURPLE = (138, 82, 236); ORANGE = (252, 128, 30)
STUB = (206, 196, 182)      # grey placeholder line inside cards
STUB_LIGHT = (214, 204, 190)
SHADOW_RGB = (12, 18, 40)

STAGES = {  # radial gradient: (centre colour, edge colour)
    'cream': ((255, 250, 240), (238, 226, 206)), 'peach': ((255, 178, 128), (240, 122, 74)),
    'terra': ((216, 100, 60), (156, 56, 30)), 'terra2': ((184, 76, 42), (120, 38, 18)),
    'emer': ((0, 158, 104), (0, 86, 58)), 'cobalt': ((46, 104, 240), (18, 46, 160)),
    'violet': ((140, 74, 236), (78, 30, 164)), 'mustard': ((248, 192, 44), (196, 128, 4)),
    'navy': ((40, 60, 146), (12, 20, 70)), 'hotpink': ((255, 90, 156), (204, 22, 104))}

# ───────────────────────── easing ─────────────────────────
def clamp(x, a=0., b=1.): return a if x < a else b if x > b else x
def p(t, t0, d):
    """normalised progress 0→1 of a tween that starts at t0 and lasts d seconds."""
    return clamp((t - t0) / d)
def lerp(a, b, x): return a + (b - a) * x
def eob(x, k=1.9):
    """ease-out-back (overshoot). k≈1.4 ≈ 4–5 %, k≈1.7 ≈ 6 %, k≈2.2 ≈ 10 %."""
    if x <= 0: return 0.
    if x >= 1: return 1.
    x -= 1; return x * x * ((k + 1) * x + k) + 1
def eoc(x): return 1 - (1 - x) ** 3                       # ease-out-cubic
def eio(x): x = clamp(x); return x * x * (3 - 2 * x)       # smoothstep ease-in-out
def spring(x): return eob(x, 1.7)                          # snappy spring, ~6 % overshoot
def mix(c1, c2, x): return tuple(int(lerp(a, b, clamp(x))) for a, b in zip(c1, c2))

def shake(t, t0, amp=2, dur=.12):
    """decaying xy jitter used for 'slam' impacts."""
    x = p(t, t0, dur)
    if x <= 0 or x >= 1: return 0, 0
    return amp * math.sin(t * 190) * (1 - x), amp * math.cos(t * 230) * (1 - x)

def jolt(fr, t, t0, amp, du):
    """apply shake() to the whole frame (whole-stage nudge; no camera move)."""
    a, b = shake(t, t0, amp, du)
    if a or b: fr = Image.fromarray(np.roll(np.asarray(fr), (int(round(b)), int(round(a))), (0, 1)))
    return fr

# ───────────────────────── compositing ─────────────────────────
def comp(fr, im, x, y):
    x, y = int(round(x)), int(round(y))
    l, t = max(0, x), max(0, y); r, b = min(W, x + im.width), min(H, y + im.height)
    if r <= l or b <= t: return
    fr.alpha_composite(im.crop((l - x, t - y, r - x, b - y)), (l, t))

def fade(im, a):
    if a >= 0.999: return im
    im = im.copy()
    A = (np.asarray(im.getchannel('A'), dtype=np.float32) * a).astype(np.uint8)
    im.putalpha(Image.fromarray(A)); return im

def place(fr, spr, cx, cy, s=1.0, a=1.0):
    """composite sprite centred at (cx, cy) with scale s and opacity a."""
    if a <= 0.01 or s <= 0.02: return
    im = spr
    if abs(s - 1) > 0.004:
        im = spr.resize((max(1, int(spr.width * s)), max(1, int(spr.height * s))), Image.BILINEAR)
    im = fade(im, a)
    comp(fr, im, cx - im.width / 2, cy - im.height / 2)

def dim(im, k):
    """darken an RGBA sprite (k<1) keeping alpha."""
    rgb = ImageEnhance.Brightness(im.convert('RGB')).enhance(k).convert('RGBA'); rgb.putalpha(im.getchannel('A')); return rgb

# ───────────────────────── stage ─────────────────────────
@functools.lru_cache(None)
def stage(name):
    a, b = STAGES[name]
    yy, xx = np.mgrid[0:H, 0:W]
    g = np.clip(np.hypot((xx - W * .45) / W, (yy - H * .4) / H) * 1.25, 0, 1)[..., None]
    return Image.fromarray((np.array(a) * (1 - g) + np.array(b) * g).astype(np.uint8)).convert('RGBA')

def bg(a, b=None, x=0.):
    if b is None or x <= 0: return stage(a).copy()
    if x >= 1: return stage(b).copy()
    return Image.blend(stage(a), stage(b), x)

# ───────────────────────── cards & text ─────────────────────────
def card(w, h, fill=CREAM, r=34, border=9, bcol=WHITE, shadow=0.32, off=20, blur=26):
    """thick rounded card with soft drop shadow. Content box = (M, M, M+w, M+h)."""
    im = Image.new('RGBA', (w + 2 * M, h + 2 * M), (0, 0, 0, 0))
    if shadow:
        m = Image.new('L', im.size, 0)
        ImageDraw.Draw(m).rounded_rectangle((M, M + off, M + w, M + h + off), r, fill=int(255 * shadow))
        m = m.filter(ImageFilter.GaussianBlur(blur))
        sh = Image.new('RGBA', im.size, SHADOW_RGB + (0,)); sh.putalpha(m)
        im = Image.alpha_composite(im, sh)
    d = ImageDraw.Draw(im)
    if border: d.rounded_rectangle((M, M, M + w, M + h), r, fill=bcol)
    d.rounded_rectangle((M + border, M + border, M + w - border, M + h - border), max(2, r - border), fill=fill)
    return im

def draw_parts(d, x, y, parts, fo, anchor='lm'):
    """draw multi-colour text runs: parts = [(text, rgb), ...]."""
    for t, c in parts: d.text((x, y), t, font=fo, fill=c, anchor=anchor); x += fo.getlength(t)

def plen(parts, fo): return sum(fo.getlength(t) for t, _ in parts)

@functools.lru_cache(None)
def plaque(parts, size, h=None, padx=56, sub=None, r=None):
    """cream pill/label. parts MUST be a tuple of (text, rgb) tuples (lru_cache key).
    height = 1.75 × font size, radius = min(h/2, 60), shadow .5 / off 26 / blur 30."""
    fo = F('Black', size); h = h or int(size * 1.75); tw = plen(parts, fo); w = int(tw + 2 * padx)
    hh = h + (int(size * .55) if sub else 0)
    im = card(w, hh, fill=CREAM, r=r if r is not None else min(hh // 2, 60), border=0, shadow=.5, off=26, blur=30)
    d = ImageDraw.Draw(im); o = M
    if sub: d.text((o + w / 2, o + size * .5), sub, font=F('ExtraBold', int(size * .42)), fill=GREYT, anchor='mm')
    draw_parts(d, o + padx, o + hh - h / 2 + 2, parts, fo); return im

def stubcard(w, h, lines=(.8, .55), fill=CREAM):
    """blank card with grey placeholder lines (never real text)."""
    im = card(w, h, fill=fill, r=26, border=0, shadow=.45, off=16, blur=20); d = ImageDraw.Draw(im); o = M
    for k, wf in enumerate(lines): d.rounded_rectangle((o + 26, o + 30 + k * 30, o + 26 + (w - 52) * wf, o + 44 + k * 30), 7, fill=STUB)
    return im

def darkpanel(w, h, parts):
    """near-black chat/app panel with a cream title bar."""
    im = card(w, h, fill=CHAR, r=40, border=0, shadow=.6, off=30, blur=36); d = ImageDraw.Draw(im); o = M
    d.rounded_rectangle((o + 16, o + 16, o + w - 16, o + 110), 28, fill=CREAM)
    draw_parts(d, o + 46, o + 64, parts, F('Black', 44)); return im

def mac(w, h, title_parts=None):
    """near-black mac-style window with traffic lights and optional centred title."""
    im = card(w, h, fill=CHAR, r=34, border=0, shadow=.6, off=30, blur=36); d = ImageDraw.Draw(im); o = M
    for k, c in enumerate(((232, 88, 70), (240, 180, 50), (60, 190, 100))): d.ellipse((o + 28 + k * 32, o + 26, o + 46 + k * 32, o + 44), fill=c)
    if title_parts: draw_parts(d, o + w / 2 - plen(title_parts, F('Black', 32)) / 2, o + 36, title_parts, F('Black', 32))
    return im

def bot(w=200, h=150, g=0.):
    """generic blank bot card (antenna + visor). No character, no name."""
    im = card(w, h, fill=mix(CREAM, (200, 192, 182), g), r=30, border=0, shadow=.45, off=16, blur=20); d = ImageDraw.Draw(im); o = M
    cx = o + w / 2; d.line((cx, o + 14, cx, o + 34), fill=(180, 170, 156), width=5); d.ellipse((cx - 8, o + 6, cx + 8, o + 22), fill=(180, 170, 156))
    d.rounded_rectangle((o + 40, o + 40, o + w - 40, o + 100), 20, fill=(226, 214, 196))
    for dx in (-26, 26): d.ellipse((cx + dx - 9, o + 61, cx + dx + 9, o + 79), fill=(150, 140, 128))
    d.rounded_rectangle((o + 50, o + 116, o + w - 50, o + 128), 6, fill=STUB_LIGHT); return im

def disc(txt, s=110, col=None):
    """round node / member disc with short label (e.g. 01, T1, AI)."""
    im = Image.new('RGBA', (s + 40, s + 40), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    d.ellipse((20, 26, 20 + s, 26 + s), fill=(0, 0, 0, 60)); d.ellipse((20, 20, 20 + s, 20 + s), fill=col or CREAM)
    d.text((20 + s / 2, 20 + s / 2 + 2), txt, font=F('Black', int(s * .36)), fill=INK, anchor='mm'); return im

# ───────────────────────── lines, arrows, nodes ─────────────────────────
def dashed(d, pts, col=CREAM, w=6, dash=18, gap=14):
    """dashed polyline through pts."""
    acc = 0; on = True
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        L = math.dist((x0, y0), (x1, y1)); s = 0
        while s < L:
            seg = min((dash if on else gap) - acc, L - s)
            if on:
                a, b = s / L, (s + seg) / L
                d.line((lerp(x0, x1, a), lerp(y0, y1, a), lerp(x0, x1, b), lerp(y0, y1, b)), fill=col, width=w)
            s += seg; acc += seg
            if acc >= (dash if on else gap): acc = 0; on = not on

def partial(pts, f):
    """first fraction f (0..1) of a polyline, by arc length — use for 'line draws on'."""
    L = [0]
    for a, b in zip(pts, pts[1:]): L.append(L[-1] + math.dist(a, b))
    tgt = f * L[-1]; out = [pts[0]]
    for i in range(len(pts) - 1):
        if L[i + 1] <= tgt: out.append(pts[i + 1])
        else:
            u = (tgt - L[i]) / max(1e-6, L[i + 1] - L[i]); out.append((lerp(pts[i][0], pts[i + 1][0], u), lerp(pts[i][1], pts[i + 1][1], u))); break
    return out

def arrowhead(d, tip, direction=(1, 0), size=24, col=CREAM):
    """filled triangle arrow head pointing along `direction` with its tip at `tip`."""
    dx, dy = direction; n = math.hypot(dx, dy) or 1; dx, dy = dx / n, dy / n
    bx, by = tip[0] - dx * size, tip[1] - dy * size; px, py = -dy * size * .66, dx * size * .66
    d.polygon([tip, (bx + px, by + py), (bx - px, by - py)], fill=col)

def dashed_arrow(d, pts, f, col=CREAM, w=6, head=24):
    """draws a dashed polyline up to fraction f; head appears once f ≥ .95."""
    if f <= 0: return
    dashed(d, partial(pts, f), col=col, w=w)
    if f > .95:
        (x0, y0), (x1, y1) = pts[-2], pts[-1]; arrowhead(d, (x1, y1), (x1 - x0, y1 - y0), head, col)

def check(fr, cx, cy, k, r=26):
    """green tick badge (accept)."""
    if k <= 0: return
    d = ImageDraw.Draw(fr); d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=EMER)
    d.line((cx - 12, cy, cx - 3, cy + 10, cx + 14, cy - 10), fill=CREAM, width=6, joint='curve')

def alpha_layer(fr, draw_fn, a):
    """draw on a transparent overlay then composite at opacity a (ImageDraw has no global alpha)."""
    if a <= 0: return
    ov = Image.new('RGBA', (W, H), (0, 0, 0, 0)); draw_fn(ImageDraw.Draw(ov))
    if a < 1: ov.putalpha(ov.getchannel('A').point(lambda v: int(v * a)))
    fr.alpha_composite(ov)

# ───────────────────────── stitching tabs (six-pack handoff) ─────────────────────────
TAB = (330, 1000, .8)      # peek tab rest position (x, y, scale)
@functools.lru_cache(None)
def tabs(label): return plaque(((label, INK),), 36)
def peek(fr, t, t0, label):
    """E-beat soft handoff: label tab slides in from the left edge."""
    pk = eoc(p(t, t0, .6))
    if pk > 0: place(fr, tabs(label), lerp(-260, TAB[0], pk), TAB[1], TAB[2], 1)
def tab_out(fr, t, label, to=(960, 540)):
    """match-cut IN: previous plate's peek tab flies to `to` and fades; returns expand progress e (0..1)."""
    e = eio(p(t, .05, .3))
    if e < 1: place(fr, tabs(label), lerp(TAB[0], to[0], e), lerp(TAB[1], to[1], e), TAB[2], 1 - e)
    return e

# ───────────────────────── runner ─────────────────────────
def run(frame, total, build=None):
    """CLI:  plate.py video out.mp4        → H.264 1920×1080 30 fps
             plate.py still 1.0,2.5 out_X.png  → PNG per time (X replaced by time)"""
    if build: build()
    if len(sys.argv) < 3: print(run.__doc__); sys.exit(1)
    if sys.argv[1] == 'still':
        for T in sys.argv[2].split(','): frame(float(T)).convert('RGB').save(sys.argv[3].replace('X', T))
        return
    ff = subprocess.Popen(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{W}x{H}',
                           '-r', str(FPS), '-i', '-', '-c:v', 'libx264', '-preset', 'medium', '-crf', '18',
                           '-pix_fmt', 'yuv420p', sys.argv[2]], stdin=subprocess.PIPE)
    for i in range(int(round(total * FPS))): ff.stdin.write(frame(i / FPS).convert('RGB').tobytes())
    ff.stdin.close(); ff.wait()
