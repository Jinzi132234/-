#!/usr/bin/env python3
"""Plate 179 — we want this marketing team built · before we created each bot · now the manager plans the team and who still must be hired.
SIX 1/6. 12.0 s (ESTIMATED)  M535 team-built card | M536 before-DIY bot stack | M537 manager plan board | I534 I535 I536 | E181."""
import os, sys; sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from components import *
TOTAL = 12.0; SP = {}
BOTS = [430, 750, 1070, 1390]
def teamcard():
    w, h = 820, 360; im = card(w, h, fill=CREAM, r=44, border=0, shadow=.55, off=28, blur=34); d = ImageDraw.Draw(im); o = M
    draw_parts(d, o + w / 2 - plen([('MARKETING TEAM ', 0), ('BUILT', 0)], F('Black', 60)) / 2, o + 66, [('MARKETING TEAM ', INK), ('BUILT', CORAL)], F('Black', 60))
    cx = o + w / 2; d.rounded_rectangle((cx - 60, o + 130, cx + 60, o + 180), 16, fill=(226, 214, 196))
    d.line((cx, o + 180, cx, o + 210), fill=(200, 188, 170), width=4); d.line((cx - 220, o + 210, cx + 220, o + 210), fill=(200, 188, 170), width=4)
    for dx in (-220, 0, 220):
        d.line((cx + dx, o + 210, cx + dx, o + 240), fill=(200, 188, 170), width=4); d.rounded_rectangle((cx + dx - 60, o + 240, cx + dx + 60, o + 290), 16, fill=(236, 226, 210))
    return im
def slot(dashed_=False):
    w, h = 280, 84
    if not dashed_: return stubcard(w, h, (.6,))
    im = Image.new('RGBA', (w + 2 * M, h + 2 * M), (0, 0, 0, 0)); d = ImageDraw.Draw(im); o = M
    dashed(d, [(o, o), (o + w, o), (o + w, o + h), (o, o + h), (o, o)], col=CREAM, w=5)
    d.text((o + w / 2, o + h / 2 + 2), '+', font=F('Black', 50), fill=CREAM, anchor='mm'); return im
def build():
    SP['team'] = teamcard(); SP['bot'] = bot(240, 170)
    SP['before'] = plaque((('BEFORE', CORAL),), 52); SP['each'] = plaque((('EACH BOT', INK),), 34)
    SP['mgr'] = plaque((('MANAGER', CORAL),), 56); SP['plan'] = plaque((('PLANS', INK),), 30)
    SP['need'] = plaque((('TEAM YOU NEED', INK),), 34); SP['hire'] = plaque((('STILL MUST BE ', INK), ('HIRED', CORAL)), 34)
    SP['s'] = slot(); SP['sd'] = slot(True)
def frame(t):
    fr = bg('terra')
    up = eio(p(t, 3.1, .4)); gone = eio(p(t, 6.2, .4))
    x = p(t, .3, .25)
    if x > 0: place(fr, SP['team'], 960, lerp(500, 210, up) + 60 * (1 - eoc(x)), lerp(1, .62, up) * lerp(.7, 1, spring(x)), clamp(x * 4) * (1 - gone))
    # BEFORE: DIY bots built one by one, then stacked and struck
    st = eio(p(t, 5.0, .45))
    for i, bx in enumerate(BOTS):
        u = p(t, 3.5 + i * .25, .25)
        if u <= 0: continue
        cx, cy = lerp(bx, 960 + i * 14, st), lerp(560, 560 - i * 14, st)
        place(fr, SP['bot'], cx, cy + 40 * (1 - eoc(u)), lerp(.5, 1, eob(u, 2)), clamp(u * 5) * (1 - gone))
    x = p(t, 3.4, .22)
    if x > 0: place(fr, SP['before'], 960, 790, lerp(1.3, 1, eob(x, 1.6)), clamp(x * 5) * (1 - gone))
    x = p(t, 4.0, .22)
    if x > 0: place(fr, SP['each'], 960, 880, 1, clamp(x * 5) * (1 - gone))
    sk = eio(p(t, 5.6, .25))
    if sk > 0 and gone < 1:
        ov = Image.new('RGBA', (W, H), (0, 0, 0, 0)); x0, y0, x1, y1 = 780, 680, 1180, 440
        ImageDraw.Draw(ov).line((x0, y0, lerp(x0, x1, sk), lerp(y0, y1, sk)), fill=CORAL, width=14)
        ov.putalpha(ov.getchannel('A').point(lambda v: int(v * (1 - gone)))); fr.alpha_composite(ov)
    # manager plan board
    x = p(t, 6.6, .25)
    if x > 0:
        place(fr, SP['mgr'], 960, 330, lerp(1.3, 1, eob(x, 1.6)), clamp(x * 5))
        place(fr, SP['plan'], 960, 410, 1, clamp(p(t, 6.9, .2) * 5))
    f = eio(p(t, 7.1, .4))
    if f > 0:
        d = ImageDraw.Draw(fr)
        for tx in (600, 1320): dashed(d, partial([(960, 450), (960, 500), (tx, 500), (tx, 560)], f), w=5)
    x = p(t, 7.5, .22)
    if x > 0: place(fr, SP['need'], 600, 590, 1, clamp(x * 5))
    for k in range(3):
        u = p(t, 7.8 + k * .15, .2)
        if u > 0: place(fr, SP['s'], 600, 690 + k * 100, lerp(.5, 1, eob(u, 2)), clamp(u * 5))
    x = p(t, 9.3, .22)
    if x > 0: place(fr, SP['hire'], 1320, 590, lerp(1.25, 1, eob(x, 1.6)), clamp(x * 5))
    for k in range(2):
        u = p(t, 9.6 + k * .2, .2)
        if u > 0: place(fr, SP['sd'], 1320, 690 + k * 100, lerp(.5, 1, eob(u, 2)), clamp(u * 5))
    peek(fr, t, 11.0, 'GROUP CHAT')
    return fr
if __name__ == '__main__': run(frame, TOTAL, build)
