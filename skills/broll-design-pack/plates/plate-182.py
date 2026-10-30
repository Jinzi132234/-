#!/usr/bin/env python3
"""Plate 182 — tell research to turn findings into posts · it can hand that off to content for you.
SIX 4/6. 8.0 s (ESTIMATED)  M544 research chip | M545 findings → posts relabel | M546 hand-off to content | I543 I544 I545 | E184."""
import os, sys; sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from components import *
TOTAL = 8.0; SP = {}
RS = (500, 300); CT = (1420, 300); STK = [(500, 520), (500, 650), (500, 780)]; DST = [(1420, 520), (1420, 650), (1420, 780)]
REL = 3.2; HO = 4.6
def finding():
    return stubcard(420, 100, (.75, .5))
def post():
    w, h = 420, 100; im = card(w, h, fill=CREAM, r=26, border=0, shadow=.45, off=16, blur=20); d = ImageDraw.Draw(im); o = M
    d.rounded_rectangle((o + 18, o + 16, o + 108, o + h - 16), 14, fill=(226, 214, 196))
    for k, wf in enumerate((.8, .55)): d.rounded_rectangle((o + 128, o + 30 + k * 30, o + 128 + (w - 160) * wf, o + 44 + k * 30), 7, fill=(206, 196, 182))
    return im
def build():
    SP['rs'] = plaque((('RESEARCH', CORAL),), 56); SP['ct'] = plaque((('CONTENT', CORAL),), 56)
    SP['f'] = finding(); SP['p'] = post()
    SP['fl'] = plaque((('FINDINGS', INK),), 32); SP['pl'] = plaque((('POSTS', CORAL),), 32)
    SP['ho'] = plaque((('HAND OFF', INK),), 30)
def frame(t):
    fr = bg('violet')
    e = tab_out(fr, t, 'RESEARCH → CONTENT', RS)
    place(fr, SP['rs'], RS[0], RS[1], lerp(.5, 1, eob(e, 1.4)), clamp(e * 2))
    rl = p(t, REL, .35); ho = eio(p(t, HO + .4, .6))
    for k in range(3):
        u = p(t, 1.4 + k * .15, .25)
        if u <= 0: continue
        sq = abs(1 - 2 * clamp((rl - k * .1) / .7)) if rl > 0 else 1
        im = SP['f'] if rl - k * .1 < .35 else SP['p']
        im = im.resize((im.width, max(2, int(im.height * max(.05, sq)))), Image.BILINEAR)
        hk = eio(p(t, HO + .4 + k * .12, .5))
        cx, cy = lerp(STK[k][0], DST[k][0], hk), lerp(STK[k][1], DST[k][1], hk) - 60 * math.sin(math.pi * hk)
        place(fr, im, cx, cy, lerp(.5, 1, eob(u, 2)), clamp(u * 5))
    x = p(t, 1.5, .2)
    lab_pos = lerp(STK[0][0], DST[0][0], ho)
    if x > 0:
        if rl < .5: place(fr, SP['fl'], lab_pos - 140, 440, 1, clamp(x * 5) * (1 - clamp(rl * 3)))
        else: place(fr, SP['pl'], lab_pos - 160, 440, lerp(1.3, 1, eob(clamp((rl - .5) * 2), 1.6)), 1)
    f = eio(p(t, HO, .4))
    if f > 0:
        d = ImageDraw.Draw(fr); dashed(d, partial([(RS[0] + 200, RS[1]), (CT[0] - 200, CT[1])], f), w=6)
        if f > .95: d.polygon([(CT[0] - 190, CT[1]), (CT[0] - 214, CT[1] - 16), (CT[0] - 214, CT[1] + 16)], fill=CREAM)
    x = p(t, HO + .2, .2)
    if x > 0: place(fr, SP['ho'], 960, RS[1] - 56, 1, clamp(x * 5))
    x = p(t, HO + .3, .25)
    if x > 0: place(fr, SP['ct'], CT[0], CT[1], lerp(1.3, 1, eob(x, 1.6)), clamp(x * 5))
    peek(fr, t, 6.9, 'MANAGER ASSIGNS')
    return fr
if __name__ == '__main__': run(frame, TOTAL, build)
