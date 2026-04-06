#!/bin/bash
# Setup script for Yeshivish Shiur Transcriber
# Run once: bash setup.sh

set -e

echo "=== Yeshivish Shiur Transcriber Setup ==="
echo ""

# Check Python
python3 --version || { echo "Python 3 required"; exit 1; }

# Install ffmpeg (required by whisper for audio decoding)
if ! command -v ffmpeg &>/dev/null; then
  echo "Installing ffmpeg..."
  if command -v apt-get &>/dev/null; then
    sudo apt-get install -y ffmpeg
  elif command -v brew &>/dev/null; then
    brew install ffmpeg
  elif command -v dnf &>/dev/null; then
    sudo dnf install -y ffmpeg
  else
    echo "Please install ffmpeg manually: https://ffmpeg.org/download.html"
    exit 1
  fi
else
  echo "ffmpeg: ok"
fi

echo ""
echo "Installing Python packages..."

# faster-whisper is significantly faster than original whisper (4-8x)
# and more memory efficient — important for hour-long files
pip3 install --upgrade \
  faster-whisper \
  flask \
  flask-cors

echo ""
echo "=== Setup complete! ==="
echo ""
echo "Run the app:  python3 app.py"
echo "Then open:    http://localhost:5050"
echo ""
echo "First transcription will download the Whisper large-v3 model (~3 GB)."
echo "Subsequent runs use the cached model."
