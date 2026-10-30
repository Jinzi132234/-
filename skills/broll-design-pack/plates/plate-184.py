#!/usr/bin/env python3
"""Plate 184 — as lead you see every status · manager accepts before it comes to you · fails review → sent back to the right employee to fix.
SIX 6/6 FINAL. 12.5 s (ESTIMATED)  M550 status board | M551 manager-accept gate | M552 fail-review send-back fix | I549 I550 I551 | E186."""
import os, sys; sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from components import *
TOTAL = 12.5; SP = {}
BD = (470, 520); BW, BH = 560, 560
GATE = (1130, 400); YOU = (1610, 400); EMP = (1130, 800); FIX = (1500, 800)
TOK1 = 4.3; TOK2 = 7.2; FAIL = 7.9; BACK = 8.6
def board():
    im = card(BW, BH, fill=CREAM, r=40, border=0, shadow=.55, off=28, blur=34); d = ImageDraw.Draw(im); o = M
    draw_parts(d, o + 40, o + 60, [('EVERY ', INK), ('STATUS', CORAL)], F('Black', 46)); d.line((o + 36, o + 110, o + BW - 36, o + 110), fill=LINE, width=3)
    cols = [(60, 190, 100), (240, 180, 50), CORAL, (60, 190, 100), (190, 180, 166)]
    for k in range(5):
        y = o + 150 + k * 78; d.rounded_rectangle((o + 36, y, o + BW - 36, y + 56), 28, fill=(246, 238, 226))
        d.ellipse((o + 56, y + 16, o + 80, y + 40), fill=cols[k]); d.rounded_rectangle((o + 100, y + 22, o + 100 + (BW - 200) * (.7, .5, .62, .44, .56)[k], y + 34), 6, fill=(206, 196, 182))
    return im
def tok(): return stubcard(150, 64, (.55,))
def you():
    w, h = 240, 150; im = card(w, h, fill=CREAM, r=32, border=0, shadow=.5, off=20, blur=24); d = ImageDraw.Draw(im)
    d.text((M + w / 2, M + h / 2 + 2), 'YOU', font=F('Black', 56), fill=INK, anchor='mm'); return im
def emp():
    w, h = 300, 120; im = card(w, h, fill=CREAM, r=30, border=0, shadow=.5, off=20, blur=24); d = ImageDraw.Draw(im); o = M
    d.ellipse((o + 24, o + 30, o + 84, o + 90), fill=(214, 200, 178)); d.text((o + 104, o + 44), 'RIGHT EMPLOYEE', font=F('Black', 22), fill=INK, anchor='lm')
    d.rounded_rectangle((o + 104, o + 70, o + 240, o + 82), 6, fill=(214, 204, 190)); return im
def build():
    SP['lead'] = plaque((('LEAD', INK),), 36); SP['board'] = board()
    SP['gate'] = plaque((('MANAGER ', INK), ('ACCEPT', CORAL)), 40); SP['you'] = you()
    SP['before'] = plaque((('BEFORE IT COMES TO YOU', INK),), 28); SP['tok'] = tok()
    SP['fail'] = plaque((('FAILS REVIEW', CORAL),), 40).rotate(-6, Image.BICUBIC, expand=True)
    SP['back'] = plaque((('SEND BACK', INK),), 28); SP['emp'] = emp()
    SP['fix'] = plaque((('FIX', CORAL),), 72)
def check(fr, cx, cy, k):
    if k <= 0: return
    d = ImageDraw.Draw(fr); r = 26; d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=EMER)
    d.line((cx - 12, cy, cx - 3, cy + 10, cx + 14, cy - 10), fill=CREAM, width=6, joint='curve')
def frame(t):
    fr = bg('navy')
    e = tab_out(fr, t, 'LEAD · ACCEPT · FIX', BD)
    place(fr, SP['board'], BD[0], BD[1] + 60 * (1 - eoc(e)), lerp(.6, 1, spring(e)), clamp(e * 2))
    x = p(t, .6, .2)
    if x > 0: place(fr, SP['lead'], BD[0], BD[1] - BH / 2 - 40, 1, clamp(x * 5))
    f = eio(p(t, 3.4, .4))
    d = ImageDraw.Draw(fr)
    if f > 0:
        dashed(d, partial([(BD[0] + BW / 2 + 10, GATE[1]), (GATE[0] - 170, GATE[1])], f), w=5)
        f2 = eio(p(t, 3.7, .4)); dashed(d, partial([(GATE[0] + 170, GATE[1]), (YOU[0] - 130, YOU[1])], f2), w=5)
    x = p(t, 3.5, .25)
    if x > 0: place(fr, SP['gate'], GATE[0], GATE[1], lerp(1.3, 1, eob(x, 1.6)), clamp(x * 5))
    x = p(t, 3.8, .25)
    if x > 0: place(fr, SP['you'], YOU[0], YOU[1], lerp(.7, 1, eob(x, 1.8)), clamp(x * 4))
    x = p(t, 4.1, .22)
    if x > 0: place(fr, SP['before'], (GATE[0] + YOU[0]) / 2 + 60, GATE[1] + 110, 1, clamp(x * 5))
    # token 1: accepted, delivered to YOU
    a = eio(p(t, TOK1, .6)); b = eio(p(t, TOK1 + 1.0, .6))
    if a > 0:
        if b <= 0: cx = lerp(BD[0] + BW / 2, GATE[0], a); cy = GATE[1] - 80
        else: cx = lerp(GATE[0], YOU[0], b); cy = lerp(GATE[1] - 80, YOU[1], b)
        place(fr, SP['tok'], cx, cy, lerp(1, .6, b), 1 - clamp((b - .7) * 3.3))
        check(fr, GATE[0] + 200, GATE[1] - 80, clamp(p(t, TOK1 + .65, .2) * 5) * (1 - b))
    # token 2: fails review, dashed send-back to the right employee, FIX
    a = eio(p(t, TOK2, .6)); bk = eio(p(t, BACK + .2, .7))
    if a > 0:
        cx, cy = lerp(BD[0] + BW / 2, GATE[0], a), GATE[1] - 80
        if bk > 0: cx, cy = GATE[0], lerp(GATE[1] - 80, EMP[1] - 110, bk)
        place(fr, SP['tok'], cx, cy, 1, 1)
    x = p(t, FAIL, .22)
    if x > 0: place(fr, SP['fail'], GATE[0], GATE[1] - 175, lerp(1.4, 1, eob(x, 1.5)), clamp(x * 5))
    f = eio(p(t, BACK, .4))
    if f > 0: dashed(ImageDraw.Draw(fr), partial([(GATE[0], GATE[1] + 50), (GATE[0], EMP[1] - 70)], f), col=CORAL, w=6)
    x = p(t, BACK + .2, .2)
    if x > 0: place(fr, SP['back'], GATE[0] + 120, (GATE[1] + EMP[1]) / 2 + 20, 1, clamp(x * 5))
    x = p(t, BACK + .5, .25)
    if x > 0: place(fr, SP['emp'], EMP[0], EMP[1], lerp(.7, 1, eob(x, 1.8)), clamp(x * 4))
    x = p(t, 10.0, .22)
    if x > 0: place(fr, SP['fix'], FIX[0], FIX[1], lerp(1.4, 1, eob(x, 1.5)), clamp(x * 5))
    fr = jolt(fr, t, FAIL + .15, 3, .12); fr = jolt(fr, t, 10.18, 4, .16)
    return fr
if __name__ == '__main__': run(frame, TOTAL, build)
