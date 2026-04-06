"""
Yeshivish Shiur Transcriber
Local Flask app — run with: python3 app.py
Then open: http://localhost:5050
"""

import os
import sys
import json
import time
import uuid
import threading
from pathlib import Path
from flask import Flask, request, jsonify, send_from_directory, Response

# ── Paths ────────────────────────────────────────────────────────────────────
BASE_DIR     = Path(__file__).parent
UPLOAD_DIR   = BASE_DIR / "uploads"
TRANSCRIPT_DIR = BASE_DIR / "transcripts"
UPLOAD_DIR.mkdir(exist_ok=True)
TRANSCRIPT_DIR.mkdir(exist_ok=True)

ALLOWED_EXT = {".mp3", ".wav", ".aac", ".3gp", ".m4a", ".ogg", ".flac"}

# ── Yeshivish prompt ─────────────────────────────────────────────────────────
# Feeding common Yeshivish vocabulary to Whisper dramatically improves accuracy
# for Torah-lecture speech patterns, Hebrew/Aramaic terms, and Yeshivish idioms.
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

# ── Job store (in-memory) ────────────────────────────────────────────────────
jobs: dict[str, dict] = {}  # job_id → {status, progress, result, error}

# ── Flask app ─────────────────────────────────────────────────────────────────
app = Flask(__name__, static_folder=str(BASE_DIR), static_url_path="")

@app.route("/")
def index():
    return send_from_directory(BASE_DIR, "index.html")

@app.route("/upload", methods=["POST"])
def upload():
    f = request.files.get("audio")
    if not f or not f.filename:
        return jsonify(error="No file provided"), 400

    ext = Path(f.filename).suffix.lower()
    if ext not in ALLOWED_EXT:
        return jsonify(error=f"Unsupported format: {ext}. Use MP3, WAV, AAC, 3GP, M4A."), 400

    job_id   = str(uuid.uuid4())
    filename = f"{job_id}{ext}"
    filepath = UPLOAD_DIR / filename
    f.save(filepath)

    options = {
        "model_size":  request.form.get("model", "large-v3"),
        "timestamps":  request.form.get("timestamps", "false") == "true",
        "language":    request.form.get("language", "en") or None,
    }

    jobs[job_id] = {"status": "queued", "progress": 0, "result": None, "error": None, "filename": f.filename}
    thread = threading.Thread(target=_transcribe_worker, args=(job_id, filepath, options), daemon=True)
    thread.start()

    return jsonify(job_id=job_id)

@app.route("/status/<job_id>")
def status(job_id):
    job = jobs.get(job_id)
    if not job:
        return jsonify(error="Unknown job"), 404
    return jsonify(job)

@app.route("/stream/<job_id>")
def stream(job_id):
    """Server-Sent Events stream for real-time progress."""
    def generate():
        while True:
            job = jobs.get(job_id)
            if not job:
                yield f"data: {json.dumps({'error': 'unknown job'})}\n\n"
                break
            yield f"data: {json.dumps(job)}\n\n"
            if job["status"] in ("done", "error"):
                break
            time.sleep(0.8)
    return Response(generate(), mimetype="text/event-stream",
                    headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

@app.route("/download/<job_id>")
def download(job_id):
    job = jobs.get(job_id)
    if not job or job["status"] != "done":
        return jsonify(error="Not ready"), 404
    txt_path = TRANSCRIPT_DIR / f"{job_id}.txt"
    if not txt_path.exists():
        return jsonify(error="File missing"), 404
    original_name = Path(job.get("filename", job_id)).stem
    return send_from_directory(TRANSCRIPT_DIR, f"{job_id}.txt",
                               as_attachment=True,
                               download_name=f"{original_name}_transcript.txt")

# ── Worker ────────────────────────────────────────────────────────────────────
def _transcribe_worker(job_id: str, audio_path: Path, options: dict):
    job = jobs[job_id]
    try:
        job["status"] = "loading_model"
        job["progress"] = 5

        from faster_whisper import WhisperModel

        model_size = options["model_size"]
        # Use GPU (cuda) if available, else CPU with int8 quantization for speed
        try:
            import torch
            device = "cuda" if torch.cuda.is_available() else "cpu"
        except ImportError:
            device = "cpu"

        compute_type = "float16" if device == "cuda" else "int8"

        job["status"] = f"loading_model ({model_size})"
        model = WhisperModel(model_size, device=device, compute_type=compute_type)

        job["status"] = "transcribing"
        job["progress"] = 15

        # Transcribe with Yeshivish-optimized settings
        segments_gen, info = model.transcribe(
            str(audio_path),
            language=options.get("language") or None,
            initial_prompt=YESHIVISH_PROMPT,
            beam_size=5,            # higher beam = more accurate (slower)
            best_of=5,
            temperature=0.0,        # deterministic; falls back automatically if needed
            vad_filter=True,        # skip silence — big win for ~1hr files
            vad_parameters={
                "min_silence_duration_ms": 500,
            },
            word_timestamps=options.get("timestamps", False),
            condition_on_previous_text=True,  # better coherence across segments
        )

        # Consume generator, updating progress as we go
        # We estimate progress from detected duration
        total_duration = info.duration or 1
        segments = []
        for seg in segments_gen:
            segments.append(seg)
            pct = min(95, 15 + int((seg.end / total_duration) * 80))
            job["progress"] = pct

        # Build transcript text
        lines = _format_transcript(segments, options["timestamps"])
        transcript = "\n".join(lines)

        # Save to disk
        txt_path = TRANSCRIPT_DIR / f"{job_id}.txt"
        txt_path.write_text(transcript, encoding="utf-8")

        job["result"]   = transcript
        job["status"]   = "done"
        job["progress"] = 100

    except Exception as exc:
        job["status"] = "error"
        job["error"]  = str(exc)
        import traceback; traceback.print_exc()
    finally:
        # Clean up the uploaded audio file
        try:
            audio_path.unlink(missing_ok=True)
        except Exception:
            pass


def _format_transcript(segments, include_timestamps: bool) -> list[str]:
    lines = []
    for seg in segments:
        text = seg.text.strip()
        if not text:
            continue
        if include_timestamps:
            start = _fmt_time(seg.start)
            end   = _fmt_time(seg.end)
            lines.append(f"[{start} → {end}]  {text}")
        else:
            lines.append(text)
    return lines


def _fmt_time(seconds: float) -> str:
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = int(seconds % 60)
    if h:
        return f"{h}:{m:02d}:{s:02d}"
    return f"{m}:{s:02d}"


# ── Main ──────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5050))
    print(f"\n  Yeshivish Shiur Transcriber")
    print(f"  Open → http://localhost:{port}\n")
    app.run(host="0.0.0.0", port=port, debug=False, threaded=True)
