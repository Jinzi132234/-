#!/usr/bin/env python3
"""Plate 183 — manager assigns · staff execute · group chat syncs full task progress for the whole team.
SIX 5/6. 7.5 s (ESTIMATED)  M547 manager assigns | M548 staff execute lanes | M549 group-chat progress sync | I546 I547 I548 | E185."""
import os, sys; sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from components import *
TOTAL = 7.5; SP = {}
MG = (420, 230); LN = [430, 530, 630]; LX0, LX1 = 260, 1060; ST = (420, 800)
PC = (1480, 540); PW_, PH_ = 640, 620
def lane_tok(): return stubcard(150, 60, (.55,))
def build():
    SP['mg'] = plaque((('MANAGER ', INK), ('ASSIGNS', CORAL)), 46)
    SP['st'] = plaque((('STAFF ', INK), ('EXECUTE', CORAL)), 46)
    SP['tok'] = lane_tok(); SP['panel'] = darkpanel(PW_, PH_, [('GROUP CHAT', INK)])
    SP['sync'] = plaque((('SYNCS', CORAL),), 36)
    SP['cap'] = plaque((('FULL TASK ', INK), ('PROGRESS', CORAL), (' · WHOLE TEAM', INK)), 44)
def frame(t):
    fr = bg('hotpink')
    e = tab_out(fr, t, 'MANAGER ASSIGNS', MG)
    place(fr, SP['mg'], MG[0], MG[1], lerp(.5, 1, eob(e, 1.4)), clamp(e * 2))
    d = ImageDraw.Draw(fr)
    lf = eio(p(t, .5, .4))
    for y in LN:
        if lf > 0: d.rounded_rectangle((LX0, y - 6, lerp(LX0, LX1, lf), y + 6), 6, fill=(255, 200, 220))
    x = p(t, 1.6, .22)
    if x > 0: place(fr, SP['st'], ST[0], ST[1], lerp(1.3, 1, eob(x, 1.6)), clamp(x * 5))
    for k, y in enumerate(LN):
        a = p(t, .8 + k * .12, .3)
        if a <= 0: continue
        run_ = eio(p(t, 1.8 + k * .15, 1.2))
        x0 = lerp(MG[0], LX0 + 90, eoc(a)); y0 = lerp(MG[1], y, eoc(a))
        place(fr, SP['tok'], lerp(x0, LX1 - 90, run_), y0, 1, clamp(a * 5))
    x = p(t, 3.0, .25)
    if x > 0: place(fr, SP['panel'], PC[0], PC[1] + 60 * (1 - eoc(x)), lerp(.7, 1, spring(x)), clamp(x * 4))
    x = p(t, 3.3, .2)
    if x > 0: place(fr, SP['sync'], PC[0] + PW_ / 2 - 90, PC[1] - PH_ / 2 - 10, lerp(1.3, 1, eob(x, 1.6)), clamp(x * 5))
    f = eio(p(t, 3.2, .4))
    if f > 0:
        d = ImageDraw.Draw(fr)
        for y in LN: dashed(d, partial([(LX1, y), (PC[0] - PW_ / 2 - 10, y)], f), w=5)
    if t > 3.4:
        d = ImageDraw.Draw(fr)
        for k in range(4):
            y = PC[1] - 120 + k * 90; x0, x1 = PC[0] - PW_ / 2 + 50, PC[0] + PW_ / 2 - 50
            d.rounded_rectangle((x0, y - 12, x1, y + 12), 12, fill=(70, 72, 80))
            fl = eio(p(t, 3.6 + k * .15, .7)) * (.9, .7, .8, .6)[k]
            if fl > 0: d.rounded_rectangle((x0, y - 12, lerp(x0 + 24, x1, fl), y + 12), 12, fill=CORAL)
    x = p(t, 4.6, .25)
    if x > 0: place(fr, SP['cap'], 960, 975, lerp(1.2, 1, spring(x)), clamp(x * 4))
    peek(fr, t, 6.4, 'LEAD · ACCEPT · FIX')
    return fr
if __name__ == '__main__': run(frame, TOTAL, build)
