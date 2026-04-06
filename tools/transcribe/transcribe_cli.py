#!/usr/bin/env python3
"""
Yeshivish Shiur Transcriber — CLI
Usage:
  python3 transcribe_cli.py audio.mp3
  python3 transcribe_cli.py audio.mp3 --model large-v3 --timestamps
  python3 transcribe_cli.py audio.mp3 --output my_transcript.txt
"""

import argparse
import sys
from pathlib import Path

YESHIVISH_PROMPT = (
    "This is a Torah shiur delivered in Yeshivish English. "
    "Common terms include: Torah, Gemara, Mishnah, Talmud, halacha, machloket, "
    "psak, teshuvah, chiddush, kushya, teretz, diyuk, sevara, kula, chumra, "
    "lechatchila, bedieved, patur, chayav, assur, mutar, taamei, geder, tzad, "
    "Rashi, Tosfos, Rambam, Ramban, Rashba, Ritva, Shulchan Aruch, Mishnah Berurah, "
    "Rav, Rebbe, Rebbi, Rosh Yeshiva, posek, talmid, chavrusa, beis medrash, "
    "mamesh, takeh, b'pashtus, lemaaseh, b'emes, davka, nebech, shver, "
    "klal, prat, tzad, ikkar, tofel, mehalech, shita, shitos, "
    "aseh, lo taaseh, d'oraisa, d'rabbanan, miderabanan, min hatorah, "
    "Shabbos, Yom Tov, Pesach, Sukkos, Rosh Hashana, Yom Kippur, "
    "issur, heter, metzius, din, dina, hilchos, sefer, sugya, inyan, "
    "v'chazara, v'harei, v'hachi nami, teku, kashya, meikil, machmir."
)

def fmt_time(seconds: float) -> str:
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = int(seconds % 60)
    return f"{h}:{m:02d}:{s:02d}" if h else f"{m}:{s:02d}"


def transcribe(audio_path: str, model_size: str, timestamps: bool, language: str | None):
    from faster_whisper import WhisperModel

    try:
        import torch
        device = "cuda" if torch.cuda.is_available() else "cpu"
    except ImportError:
        device = "cpu"

    compute_type = "float16" if device == "cuda" else "int8"

    print(f"  Model:   {model_size}  |  Device: {device}  |  Compute: {compute_type}", flush=True)
    print("  Loading model...", flush=True)
    model = WhisperModel(model_size, device=device, compute_type=compute_type)

    print("  Transcribing...", flush=True)
    segments_gen, info = model.transcribe(
        audio_path,
        language=language or None,
        initial_prompt=YESHIVISH_PROMPT,
        beam_size=5,
        best_of=5,
        temperature=0.0,
        vad_filter=True,
        vad_parameters={"min_silence_duration_ms": 500},
        word_timestamps=timestamps,
        condition_on_previous_text=True,
    )

    total = info.duration or 1
    lines = []
    for seg in segments_gen:
        text = seg.text.strip()
        if not text:
            continue
        if timestamps:
            lines.append(f"[{fmt_time(seg.start)} → {fmt_time(seg.end)}]  {text}")
        else:
            lines.append(text)
        pct = min(99, int(seg.end / total * 100))
        print(f"\r  Progress: {pct}%   ", end="", flush=True)

    print("\r  Progress: 100%  ", flush=True)
    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(description="Yeshivish shiur transcriber (CLI)")
    parser.add_argument("audio", help="Path to audio file (mp3/wav/aac/3gp/m4a)")
    parser.add_argument("--model", default="large-v3",
                        choices=["large-v3", "large-v3-turbo", "medium", "small", "tiny"],
                        help="Whisper model size (default: large-v3)")
    parser.add_argument("--timestamps", action="store_true", help="Include timestamps")
    parser.add_argument("--language", default="en", help="Language code (default: en)")
    parser.add_argument("--output", "-o", default=None, help="Output .txt file path")
    args = parser.parse_args()

    audio = Path(args.audio)
    if not audio.exists():
        print(f"Error: file not found: {audio}", file=sys.stderr)
        sys.exit(1)

    print(f"\nTranscribing: {audio.name}")
    transcript = transcribe(str(audio), args.model, args.timestamps, args.language)

    out_path = Path(args.output) if args.output else audio.with_suffix(".txt")
    out_path.write_text(transcript, encoding="utf-8")
    print(f"\n  Saved → {out_path}")
    print(f"  Words: ~{len(transcript.split())}")


if __name__ == "__main__":
    main()
