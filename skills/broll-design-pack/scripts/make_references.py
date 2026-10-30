"""Renders start / mid / end key frames for every beat of plates 179–184 into references/."""
import os, subprocess, sys
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
BEATS = {179: [('A', 0, 3.2), ('B', 3.2, 6.4), ('C', 6.4, 12.0)], 180: [('A', 0, 1.8), ('B', 1.8, 3.8), ('C', 3.8, 7.5)],
         181: [('A', 0, 2.2), ('B', 2.2, 4.8), ('C', 4.8, 7.5)], 182: [('A', 0, 2.2), ('B', 2.2, 4.4), ('C', 4.4, 8.0)],
         183: [('A', 0, 1.6), ('B', 1.6, 3.2), ('C', 3.2, 7.5)], 184: [('A', 0, 3.2), ('B', 3.2, 7.0), ('C', 7.0, 12.5)]}
os.makedirs(os.path.join(ROOT, 'references'), exist_ok=True)
for n, beats in BEATS.items():
    for b, t0, t1 in beats:
        for tag, t in (('start', t0 + .35), ('mid', (t0 + t1) / 2), ('end', t1 - .04)):
            t = round(t, 2); out = os.path.join(ROOT, 'references', f'plate-{n}_{b}_{tag}_X.png')
            subprocess.run([sys.executable, os.path.join(ROOT, 'plates', f'plate-{n}.py'), 'still', str(t), out], check=True)
            os.rename(out.replace('X', str(t)), out.replace('_X', f'_{t:05.2f}s'))
print('references done')
