"""Local speech-to-text sidecar (faster-whisper on GPU). Listens on localhost only.

Run: voice/run_stt.sh   (venv lives outside the repo in ~/pdm-cnc-voice)
POST /transcribe  multipart: file=<audio>, prompt=<optional vocabulary hint>
"""
import os
import tempfile
import time

import io
import wave

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel
from faster_whisper import WhisperModel

MODEL = os.environ.get("WHISPER_MODEL", "large-v3-turbo")
DEVICE = os.environ.get("WHISPER_DEVICE", "cuda")
DEBUG_DIR = os.environ.get("STT_DEBUG_DIR")  # if set, keep clips + log transcripts
MAX_BYTES = 5 * 1024 * 1024  # a spoken question is a few seconds; reject anything huge

app = FastAPI()
model = WhisperModel(
    MODEL,
    device=DEVICE,
    compute_type="float16" if DEVICE == "cuda" else "int8",
)


VOICE_HOME = os.environ.get("PDM_VOICE_HOME", os.path.expanduser("~/pdm-cnc-voice"))
PIPER_MODEL = os.environ.get("PIPER_MODEL", os.path.join(VOICE_HOME, "dl", "piper", "en_US-lessac-medium.onnx"))
_tts = None


def tts_voice():
    """Piper voice, loaded on first use (CPU). None if piper or the model is missing."""
    global _tts
    if _tts is None:
        try:
            from piper import PiperVoice

            _tts = PiperVoice.load(PIPER_MODEL)
        except Exception as e:  # not installed / model missing
            print(f"TTS unavailable: {e}", flush=True)
            _tts = False
    return _tts or None


@app.get("/health")
def health():
    return {"ok": True, "model": MODEL, "tts": os.path.exists(PIPER_MODEL)}


class SpeakIn(BaseModel):
    text: str


@app.post("/speak")
def speak(body: SpeakIn):
    """Text -> WAV (Piper). For devices without a speech engine of their own (e.g. Android TV)."""
    text = body.text.strip()[:600]
    if not text:
        raise HTTPException(400, "empty text")
    voice = tts_voice()
    if voice is None:
        raise HTTPException(503, "text-to-speech not available")
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        voice.synthesize_wav(text, w)
    return Response(buf.getvalue(), media_type="audio/wav")


@app.post("/transcribe")
async def transcribe(file: UploadFile = File(...), prompt: str = Form("")):
    data = await file.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise HTTPException(413, "audio too large")
    if not data:
        raise HTTPException(400, "empty audio")
    t0 = time.time()
    if DEBUG_DIR:
        os.makedirs(DEBUG_DIR, exist_ok=True)
        clip = os.path.join(DEBUG_DIR, f"clip-{int(t0)}-{file.content_type or 'unknown'}".replace("/", "_"))
        with open(clip, "wb") as f:
            f.write(data)
    with tempfile.NamedTemporaryFile(suffix=".webm") as tmp:
        tmp.write(data)
        tmp.flush()
        try:
            segments, info = model.transcribe(
                tmp.name,
                language="en",
                initial_prompt=prompt[:600] or None,
                vad_filter=True,
                beam_size=5,
                condition_on_previous_text=False,
            )
            text = " ".join(s.text.strip() for s in segments).strip()
        except Exception as e:  # undecodable audio etc.
            raise HTTPException(422, f"could not transcribe: {e}")
    if DEBUG_DIR:
        print(f"STT {len(data)}B type={file.content_type} dur={info.duration:.2f}s -> {text!r}", flush=True)
    return {"text": text, "duration": info.duration, "seconds": round(time.time() - t0, 2)}
