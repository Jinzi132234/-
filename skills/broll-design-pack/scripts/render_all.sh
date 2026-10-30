#!/usr/bin/env bash
# Renders plates 179–184 to out/ and stitches them (179→184) into one silent master.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p out
for n in 179 180 181 182 183 184; do
  python3 plates/plate-$n.py video out/plate-$n.mp4 &
done
wait
: > out/list.txt
for n in 179 180 181 182 183 184; do echo "file 'plate-$n.mp4'" >> out/list.txt; done
ffmpeg -y -loglevel error -f concat -safe 0 -i out/list.txt -c copy out/plates179-184_silent.mp4
ffprobe -v error -show_entries format=duration -of csv=p=0 out/plates179-184_silent.mp4
