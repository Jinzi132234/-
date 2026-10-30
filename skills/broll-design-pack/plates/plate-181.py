#!/usr/bin/env python3
"""Plate 181 — build five employees · all five share memory in that group · everyone sees progress.
SIX 3/6. 7.5 s (ESTIMATED)  M541 five discs | M542 shared-memory ring | M543 everyone-sees-progress | I540 I541 I542 | E183."""
import os, sys; sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from components import *
TOTAL = 7.5; SP = {}
HUB = (960, 540); R = 340
ROW = [560 + k * 200 for k in range(5)]
def ring_pos(k): a = math.radians(-90 + k * 72); return HUB[0] + R * math.cos(a), HUB[1] + R * .82 * math.sin(a)
def build():
    SP['head'] = plaque((('BUILD ', INK), ('FIVE', CORAL), (' EMPLOYEES', INK)), 56)
    SP['d'] = [disc(f'0{k+1}') for k in range(5)]
    SP['hub'] = plaque((('SHARED ', INK), ('MEMORY', CORAL)), 40); SP['grp'] = plaque((('GROUP', INK),), 26)
    SP['prog'] = plaque((('EVERYONE SEES ', INK), ('PROGRESS', CORAL)), 50)
def frame(t):
    fr = bg('cobalt')
    e = tab_out(fr, t, 'FIVE EMPLOYEES', (960, 140))
    place(fr, SP['head'], 960, 140, lerp(.5, 1, eob(e, 1.4)), clamp(e * 2))
    rg = eio(p(t, 2.2, .45))
    f = eio(p(t, 2.6, .4))
    if f > 0:
        d = ImageDraw.Draw(fr)
        d.arc((HUB[0] - R, HUB[1] - R * .82, HUB[0] + R, HUB[1] + R * .82), -90, -90 + 360 * f, fill=(160, 190, 255), width=6)
        for k in range(5):
            x, y = ring_pos(k); dashed(d, partial([HUB, (x, y)], f), col=CREAM, w=4)
    x = p(t, 2.5, .25)
    if x > 0:
        place(fr, SP['hub'], HUB[0], HUB[1], lerp(.6, 1, spring(x)), clamp(x * 4))
        place(fr, SP['grp'], HUB[0], HUB[1] + 66, 1, clamp(x * 4))
    pf = eio(p(t, 5.0, .8))
    for k in range(5):
        u = p(t, .4 + k * .18, .2)
        if u <= 0: continue
        rx, ry = ring_pos(k); x, y = lerp(ROW[k], rx, rg), lerp(540, ry, rg)
        place(fr, SP['d'][k], x, y, lerp(.4, 1, eob(u, 2.2)), clamp(u * 5))
        if pf > 0:
            d = ImageDraw.Draw(fr); w2 = 60
            d.rounded_rectangle((x - w2, y + 70, x + w2, y + 84), 7, fill=(236, 226, 210))
            d.rounded_rectangle((x - w2, y + 70, x - w2 + 2 * w2 * pf * (.5 + .1 * k), y + 84), 7, fill=CORAL)
    x = p(t, 4.8, .25)
    if x > 0: place(fr, SP['prog'], 960, 975, lerp(1.25, 1, eob(x, 1.6)), clamp(x * 5))
    peek(fr, t, 6.4, 'RESEARCH → CONTENT')
    return fr
if __name__ == '__main__': run(frame, TOTAL, build)
