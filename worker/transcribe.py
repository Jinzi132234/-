#!/usr/bin/env python3
"""English course video -> timestamped transcript.

Reads a video/audio file with PyAV, resamples to 16 kHz mono, runs
faster-whisper, and streams JSONL progress events on stdout.

Events:
  {"type":"info","duration":...,"language":...}
  {"type":"phase","phase":"decode"|"transcribe","message":...}
  {"type":"progress","pct":0-100,"processed":...,"duration":...}
  {"type":"done","output":"...","segments":N,"language":"en"}
  {"type":"error","message":"..."}
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time

import numpy as np


def emit(obj):
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def fail(message, code=1):
    emit({"type": "error", "message": str(message)})
    sys.exit(code)


def decode_audio(path, sample_rate=16000):
    """Decode any container PyAV understands to mono float32 at 16 kHz."""
    import av

    container = av.open(path)
    if not container.streams.audio:
        fail("这个文件没有音轨，无法转写。")

    stream = container.streams.audio[0]
    duration = float(container.duration / av.time_base) if container.duration else 0.0
    resampler = av.AudioResampler(format="s16", layout="mono", rate=sample_rate)

    chunks = []
    decoded_seconds = 0.0
    last_emit = 0.0
    for frame in container.decode(audio=0):
        for out_frame in resampler.resample(frame):
            chunks.append(out_frame.to_ndarray().reshape(-1))
        decoded_seconds += frame.samples / float(frame.sample_rate or stream.rate or 1)
        now = time.time()
        if duration and now - last_emit > 0.6:
            last_emit = now
            pct = min(4.0, decoded_seconds / duration * 4.0)
            emit({"type": "progress", "pct": round(pct, 1), "phase": "decode"})
    for out_frame in resampler.resample(None):
        chunks.append(out_frame.to_ndarray().reshape(-1))

    container.close()
    if not chunks:
        fail("解码不出音频数据。")
    audio = np.concatenate(chunks).astype(np.float32) / 32768.0
    return audio, decoded_seconds or duration


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", required=True)
    ap.add_argument("--output", required=True)
    ap.add_argument("--model", default="small")
    ap.add_argument("--language", default="en")
    ap.add_argument("--device", default="cpu")
    ap.add_argument("--compute-type", default="int8")
    ap.add_argument("--beam-size", type=int, default=5)
    ap.add_argument("--model-dir", default=None)
    ap.add_argument("--no-vad", action="store_true")
    args = ap.parse_args()

    if not os.path.exists(args.input):
        fail(f"找不到文件：{args.input}")

    t0 = time.time()
    emit({"type": "phase", "phase": "decode", "message": "正在解码音频…"})
    audio, duration = decode_audio(args.input)
    emit({
        "type": "info",
        "duration": round(float(duration), 2),
        "audio_seconds": round(len(audio) / 16000.0, 2),
        "decode_seconds": round(time.time() - t0, 1),
    })

    emit({"type": "phase", "phase": "transcribe", "message": "正在识别英文语音…"})
    try:
        from faster_whisper import WhisperModel
    except Exception as exc:  # pragma: no cover
        fail(f"faster-whisper 未安装：{exc}")

    model_kwargs = {"device": args.device, "compute_type": args.compute_type}
    if args.model_dir:
        model_kwargs["download_root"] = args.model_dir
    try:
        model = WhisperModel(args.model, **model_kwargs)
    except Exception as exc:
        fail(f"加载 Whisper 模型失败（{args.model}）：{exc}")

    t1 = time.time()
    segments_iter, info = model.transcribe(
        audio,
        language=args.language or None,
        beam_size=args.beam_size,
        vad_filter=not args.no_vad,
        vad_parameters={"min_silence_duration_ms": 400} if not args.no_vad else None,
        condition_on_previous_text=True,
        word_timestamps=False,
    )
    emit({"type": "info", "language": info.language, "language_probability": round(info.language_probability or 0, 3)})

    segments = []
    last_pct = -1
    for idx, seg in enumerate(segments_iter, start=1):
        text = (seg.text or "").strip()
        if not text:
            continue
        item = {
            "id": f"s{len(segments) + 1}",
            "start": round(float(seg.start), 2),
            "end": round(float(seg.end), 2),
            "text": text,
        }
        segments.append(item)
        if duration:
            pct = 5.0 + min(94.0, float(seg.end) / duration * 94.0)
        else:
            pct = 5.0
        if pct - last_pct >= 0.8:
            last_pct = pct
            emit({"type": "progress", "pct": round(pct, 1), "phase": "transcribe", "segments": len(segments)})

    if not segments:
        fail("没有识别到任何语音，请确认视频里有英文人声。")

    payload = {
        "language": info.language,
        "duration": round(float(duration), 2),
        "model": args.model,
        "segments": segments,
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "elapsed_seconds": round(time.time() - t1, 1),
    }
    os.makedirs(os.path.dirname(os.path.abspath(args.output)), exist_ok=True)
    with open(args.output, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, indent=1)

    emit({"type": "done", "output": args.output, "segments": len(segments),
          "language": info.language, "elapsed_seconds": round(time.time() - t1, 1)})


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception as exc:  # pragma: no cover
        fail(f"转写失败：{exc}")
