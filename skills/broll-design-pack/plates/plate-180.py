#!/usr/bin/env python3
"""Plate 180 — in group chat you assign work in one place · progress reports stay in that same chat.
SIX 2/6. 7.5 s (ESTIMATED)  M538 group chat chrome | M539 assign into one tray | M540 progress pins same chat | I537 I538 I539 | E182."""
import os, sys; sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from components import *
TOTAL = 7.5; SP = {}
PC = (720, 560); PW_, PH_ = 900, 660
TRAY_Y = PC[1] - 130
def tray():
    w, h = 780, 150; im = Image.new('RGBA', (w + 20, h + 20), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    d.rounded_rectangle((10, 10, 10 + w, 10 + h), 26, fill=(56, 58, 66)); d.text((40, 36), 'ONE PLACE', font=F('Black', 26), fill=CORAL, anchor='lm'); return im
def prog():
    w, h = 560, 110; im = card(w, h, fill=CREAM, r=26, border=0, shadow=.4, off=12, blur=16); d = ImageDraw.Draw(im); o = M
    d.rounded_rectangle((o + 26, o + 26, o + 300, o + 40), 7, fill=(206, 196, 182))
    d.rounded_rectangle((o + 26, o + 64, o + w - 26, o + 80), 8, fill=(236, 226, 210)); d.rounded_rectangle((o + 26, o + 64, o + 26 + (w - 52) * .6, o + 80), 8, fill=EMER)
    return im
def build():
    SP['panel'] = darkpanel(PW_, PH_, [('GROUP CHAT', CORAL)]); SP['tray'] = tray()
    SP['task'] = stubcard(200, 70, (.6,)); SP['prog'] = prog()
    SP['assign'] = plaque((('ASSIGN WORK', INK),), 40)
    SP['pr'] = plaque((('PROGRESS', CORAL), (' REPORTS', INK)), 42); SP['same'] = plaque((('SAME CHAT', CORAL),), 46)
def frame(t):
    fr = bg('emer')
    e = tab_out(fr, t, 'GROUP CHAT', PC)
    place(fr, SP['panel'], PC[0], PC[1] + 60 * (1 - eoc(e)), lerp(.6, 1, spring(e)), clamp(e * 2))
    x = p(t, 1.6, .25)
    if x > 0: place(fr, SP['tray'], PC[0], TRAY_Y, 1, clamp(x * 4))
    x = p(t, 1.8, .22)
    if x > 0: place(fr, SP['assign'], 1500, 330, lerp(1.2, 1, spring(x)), clamp(x * 5))
    for k in range(3):
        u = p(t, 2.0 + k * .2, .3)
        if u > 0: place(fr, SP['task'], lerp(1800, PC[0] - 230 + k * 230, eoc(u)), TRAY_Y + 14 - 120 * math.sin(math.pi * u), 1, clamp(u * 4))
    for k in range(2):
        u = p(t, 4.0 + k * .4, .25)
        if u > 0: place(fr, SP['prog'], PC[0], PC[1] + 70 + k * 130 - 30 * (1 - eob(u, 2.2)), 1, clamp(u * 5))
    x = p(t, 4.1, .25)
    if x > 0: place(fr, SP['pr'], 1500, 560, lerp(1.2, 1, spring(x)), clamp(x * 4))
    x = p(t, 5.0, .22)
    if x > 0: place(fr, SP['same'], 1500, 700, lerp(1.3, 1, eob(x, 1.6)), clamp(x * 5))
    peek(fr, t, 6.4, 'FIVE EMPLOYEES')
    return fr
if __name__ == '__main__': run(frame, TOTAL, build)
