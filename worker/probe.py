#!/usr/bin/env python3
"""Print container metadata as one JSON object."""
import json
import sys

import av


def main(path):
    c = av.open(path)
    video = c.streams.video[0] if c.streams.video else None
    audio = c.streams.audio[0] if c.streams.audio else None
    out = {
        "duration": round(float(c.duration / av.time_base), 2) if c.duration else 0,
        "format": c.format.name if c.format else None,
        "width": int(video.codec_context.width) if video else 0,
        "height": int(video.codec_context.height) if video else 0,
        "fps": round(float(video.average_rate), 3) if video and video.average_rate else 0,
        "hasAudio": bool(audio),
        "audioRate": int(audio.rate) if audio else 0,
        "audioChannels": int(audio.channels) if audio else 0,
    }
    c.close()
    print(json.dumps(out))


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print(json.dumps({"error": "usage: probe.py <file>"}))
        sys.exit(1)
    try:
        main(sys.argv[1])
    except Exception as exc:
        print(json.dumps({"error": str(exc)}))
        sys.exit(1)
