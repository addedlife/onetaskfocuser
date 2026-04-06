# Yeshivish Shiur Transcriber

Local transcription tool for Torah shiurim, powered by [faster-whisper](https://github.com/SYSTRAN/faster-whisper) (OpenAI Whisper large-v3).

Optimized for Yeshivish English — pre-loaded with Torah vocabulary, Yeshivish idioms, and Hebrew/Aramaic terms to maximize accuracy.

## Setup (one time)

```bash
cd tools/transcribe
bash setup.sh
```

This installs: `faster-whisper`, `flask`, `flask-cors`, and `ffmpeg`.

## Web UI

```bash
python3 app.py
# → open http://localhost:5050
```

Drop in an MP3/WAV/AAC/3GP/M4A file, pick a model, and click **Transcribe Shiur**.  
The transcript appears in the browser and can be downloaded as `.txt`.

## CLI

```bash
# Basic
python3 transcribe_cli.py shiur.mp3

# With timestamps
python3 transcribe_cli.py shiur.mp3 --timestamps

# Faster model (less accurate)
python3 transcribe_cli.py shiur.mp3 --model large-v3-turbo

# Custom output path
python3 transcribe_cli.py shiur.mp3 -o ~/Desktop/transcript.txt
```

## Model comparison

| Model | Accuracy | Speed (CPU) | First download |
|-------|----------|-------------|----------------|
| `large-v3` | ⭐⭐⭐⭐⭐ | ~10–20 min/hr | ~3 GB |
| `large-v3-turbo` | ⭐⭐⭐⭐½ | ~5–10 min/hr | ~1.6 GB |
| `medium` | ⭐⭐⭐⭐ | ~3–5 min/hr | ~1.5 GB |
| `small` | ⭐⭐⭐ | ~1–2 min/hr | ~500 MB |

With a GPU (CUDA), all models run 4–8× faster.

## Supported formats

MP3, WAV, AAC, 3GP, M4A, OGG, FLAC

## Accuracy tips

- `large-v3` is the gold standard — use it when accuracy matters
- For Hebrew/Aramaic sections, keep **language = English (Yeshivish)** — the prompt handles mixed vocabulary better than switching language detection
- Files with clear audio (minimal background noise) transcribe much more accurately
- The Yeshivish initial prompt is in `app.py` / `transcribe_cli.py` — you can extend it with names of specific speakers or topics for even better results
