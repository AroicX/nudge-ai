"""Offline end-to-end speech check (requires setup); writes no persistent audio."""
import os
os.environ['HF_HUB_OFFLINE'] = '1'
import time
from server import SpeechEngine

engine = SpeechEngine()
if not engine.ready():
    raise SystemExit('Run setup.sh first; local model files or ffmpeg are missing.')
start = time.monotonic()
audio = engine.speech('Hello, I am Nudge. Please open my calendar.')
speech_seconds = time.monotonic() - start
start = time.monotonic()
transcript = engine.transcribe(audio)
transcribe_seconds = time.monotonic() - start
assert 'calendar' in transcript.lower(), f'Unexpected transcription: {transcript!r}'
print(f'Kokoro WAV: {len(audio)} bytes in {speech_seconds:.2f}s')
print(f'Whisper transcript ({transcribe_seconds:.2f}s): {transcript}')
start = time.monotonic()
engine.speech('Your local voice is ready.')
print(f'Warm Kokoro reply: {time.monotonic() - start:.2f}s')

start = time.monotonic()
engine.transcribe(audio)
print(f'Warm Whisper transcription: {time.monotonic() - start:.2f}s')
