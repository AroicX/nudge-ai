"""Loopback-only speech service. Model downloads are an explicit setup step."""
import asyncio
import hmac
import io
import logging
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import threading
import wave

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import Response

ROOT = Path(__file__).resolve().parent
MAX_UPLOAD = 8 * 1024 * 1024
MAX_SECONDS = 30
TRANSCRIPTION_CONTEXT = "Nigerian English conversation. Nudge, YouTube, naira, Lagos, Abuja."


def create_app(engine, secret):
    app = FastAPI()
    lock = threading.Lock()

    @app.middleware('http')
    async def protect(request, call_next):
        if request.method == 'POST':
            if not secret:
                return Response('Pairing secret is not configured', status_code=503)
            if not hmac.compare_digest(request.headers.get('x-nudge-pairing-secret', ''), secret):
                return Response('Unauthorized', status_code=401)
            # Bound even chunked requests before multipart parsing allocates storage.
            body = bytearray()
            async for chunk in request.stream():
                body.extend(chunk)
                if len(body) > MAX_UPLOAD + 65536:
                    return Response('Audio upload too large', status_code=413)
            request._body = bytes(body)
        return await call_next(request)

    @app.get('/health')
    def health():
        ready = bool(secret) and engine.ready()
        result = {'available': ready, 'ready': ready, 'whisper': 'small.en', 'tts': 'kokoro', 'maxAudioSeconds': MAX_SECONDS}
        if not ready:
            result['error'] = 'Set NUDGE_PAIRING_SECRET.' if not secret else 'Run services/local-voice/setup.sh to install speech models and ffmpeg.'
        return result

    async def run(operation):
        if not engine.ready():
            raise HTTPException(503, 'Local speech models are missing. Run services/local-voice/setup.sh.')
        if not lock.acquire(blocking=False):
            raise HTTPException(429, 'Local speech is busy. Please try again.')
        # Release inside the worker: cancelling an HTTP request must not allow
        # a second MLX inference while the first is still using the GPU.
        def work():
            try:
                return operation()
            finally:
                lock.release()
        try:
            return await asyncio.to_thread(work)
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc
        except Exception as exc:
            logging.exception('Local speech inference failed')
            raise HTTPException(503, 'Local speech failed. Check the speech service terminal.') from exc

    @app.post('/warmup')
    async def warmup():
        await run(engine.warmup)
        return {'ready': True}

    @app.post('/transcribe')
    async def transcribe(request: Request):
        async with request.form(max_files=1, max_fields=0) as form:
            audio = form.get('audio')
            if audio is None or not hasattr(audio, 'read'):
                raise HTTPException(422, 'An audio file is required')
            data = await audio.read(MAX_UPLOAD + 1)
        if not data:
            raise HTTPException(422, 'Audio is empty')
        if len(data) > MAX_UPLOAD:
            raise HTTPException(413, 'Audio upload too large')
        return {'text': await run(lambda: engine.transcribe(data))}

    @app.post('/speech')
    async def speech(request: Request):
        try:
            payload = await request.json()
        except Exception:
            raise HTTPException(422, 'A JSON text field is required')
        text = payload.get('text') if isinstance(payload, dict) else None
        if not isinstance(text, str) or not text.strip() or len(text) > 2000:
            raise HTTPException(422, 'Text must contain 1 to 2000 characters')
        return Response(await run(lambda: engine.speech(text.strip())), media_type='audio/wav', headers={'Cache-Control':'no-store'})
    return app


class SpeechEngine:
    def __init__(self, model_dir=ROOT / 'models'):
        self.models = Path(model_dir)
        self.kokoro = None
        self.warmed = False

    def ready(self):
        return bool(shutil.which('ffmpeg')) and all((self.models / name).exists() for name in (
            'whisper-small.en/config.json', 'whisper-small.en/weights.npz', 'kokoro-v1.0.onnx', 'voices-v1.0.bin'))

    def warmup(self):
        if self.warmed:
            return
        # Do the one-time imports/model loading before opening the microphone.
        import numpy as np
        import mlx_whisper
        mlx_whisper.transcribe(np.zeros(16000, dtype=np.float32), path_or_hf_repo=str(self.models / 'whisper-small.en'), language='en', temperature=0, condition_on_previous_text=False, verbose=None)
        self.speech('Ready.')
        self.warmed = True

    def transcribe(self, data):
        with tempfile.TemporaryDirectory(prefix='nudge-speech-') as directory:
            source, target = Path(directory) / 'input', Path(directory) / 'audio.wav'
            source.write_bytes(data)
            try:
                subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-threads', '2', '-protocol_whitelist', 'file,pipe', '-format_whitelist', 'matroska,webm,wav,mp3,ogg,flac,aac,mov', '-i', str(source), '-t', str(MAX_SECONDS + 1), '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', str(target)], check=True, capture_output=True, timeout=15)
            except (subprocess.CalledProcessError, subprocess.TimeoutExpired):
                raise ValueError('Audio could not be decoded')
            with wave.open(str(target)) as wav:
                if wav.getnframes() / wav.getframerate() > MAX_SECONDS:
                    raise ValueError('Recordings must be 30 seconds or shorter')
                import numpy as np
                samples = np.frombuffer(wav.readframes(wav.getnframes()), dtype='<i2').astype(np.float32) / 32768.0
            # Empty/near-silent clips must not turn vocabulary hints into invented speech.
            if not len(samples) or float(np.max(np.abs(samples))) < 0.005:
                return ''
            import mlx_whisper
            # Pass decoded PCM directly: Whisper otherwise launches ffmpeg a second time.
            result = mlx_whisper.transcribe(samples, path_or_hf_repo=str(self.models / 'whisper-small.en'), language='en', temperature=0, initial_prompt=TRANSCRIPTION_CONTEXT, condition_on_previous_text=False, verbose=None)
        return result['text'].strip()

    def speech(self, text):
        import soundfile
        if self.kokoro is None:
            import onnxruntime as ort
            from kokoro_onnx import Kokoro
            options = ort.SessionOptions()
            options.intra_op_num_threads = 2
            options.inter_op_num_threads = 1
            session = ort.InferenceSession(str(self.models / 'kokoro-v1.0.onnx'), sess_options=options, providers=['CPUExecutionProvider'])
            self.kokoro = Kokoro.from_session(session, str(self.models / 'voices-v1.0.bin'))
        samples, rate = self.kokoro.create(text, voice='af_heart', speed=1.0, lang='en-us')
        output = io.BytesIO()
        soundfile.write(output, samples, rate, format='WAV', subtype='PCM_16')
        return output.getvalue()


if __name__ == '__main__':
    import uvicorn
    # Inference is offline; setup.py is the only downloader.
    os.environ['HF_HUB_OFFLINE'] = '1'
    uvicorn.run(create_app(SpeechEngine(), os.environ.get('NUDGE_PAIRING_SECRET', '')), host='127.0.0.1', port=4318, workers=1)
