import io
import unittest
import wave
import threading
from concurrent.futures import ThreadPoolExecutor
from fastapi.testclient import TestClient
from server import create_app, SpeechEngine

class Engine:
    def ready(self): return True
    def warmup(self): pass
    def transcribe(self, audio): return 'Open my calendar'
    def speech(self, text):
        output = io.BytesIO()
        with wave.open(output, 'wb') as wav:
            wav.setparams((1, 2, 24000, 0, 'NONE', 'not compressed'))
            wav.writeframes(b'\0\0' * 240)
        return output.getvalue()

class ServerTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(create_app(Engine(), 'test-secret'))
        self.auth = {'x-nudge-pairing-secret': 'test-secret'}
    def test_warmup_requires_pairing(self):
        self.assertEqual(self.client.post('/warmup').status_code, 401)
        self.assertEqual(self.client.post('/warmup', headers=self.auth).status_code, 200)

    def test_health(self):
        self.assertTrue(self.client.get('/health').json()['ready'])
    def test_auth_required(self):
        self.assertEqual(self.client.post('/speech', json={'text':'hi'}).status_code, 401)
        self.assertEqual(self.client.post('/transcribe', files={'audio':('a.webm', b'fake')}).status_code, 401)
    def test_transcription(self):
        response = self.client.post('/transcribe', headers=self.auth, files={'audio':('a.webm', b'fake', 'audio/webm')})
        self.assertEqual(response.json(), {'text':'Open my calendar'})
    def test_wav(self):
        response = self.client.post('/speech', headers=self.auth, json={'text':'Hello'})
        self.assertEqual(response.headers['content-type'], 'audio/wav')
        self.assertEqual(response.content[:4], b'RIFF')
    def test_invalid_requests(self):
        for text in ['', '  ', 'a' * 2001]:
            self.assertEqual(self.client.post('/speech', headers=self.auth, json={'text':text}).status_code, 422)
        self.assertEqual(self.client.post('/transcribe', headers=self.auth, files={'audio':('a.webm', b'')}).status_code, 422)
    def test_upload_bound(self):
        self.assertEqual(self.client.post('/transcribe', headers=self.auth, files={'audio':('a.webm', b'x' * (8 * 1024 * 1024 + 1))}).status_code, 413)
    def test_not_ready(self):
        engine = Engine()
        engine.ready = lambda: False
        client = TestClient(create_app(engine, 'test-secret'))
        self.assertFalse(client.get('/health').json()['ready'])
        self.assertEqual(client.post('/speech', headers=self.auth, json={'text':'hello'}).status_code, 503)
    def test_fail_closed_without_secret(self):
        client = TestClient(create_app(Engine(), ''))
        self.assertEqual(client.post('/speech', json={'text':'hi'}).status_code, 503)
    def test_busy_request_does_not_overlap_inference(self):
        entered, release = threading.Event(), threading.Event()
        engine = Engine()
        def blocked(text):
            entered.set()
            release.wait(3)
            return b'RIFF'
        engine.speech = blocked
        client = TestClient(create_app(engine, 'test-secret'))
        with ThreadPoolExecutor() as pool:
            first = pool.submit(lambda: client.post('/speech', headers=self.auth, json={'text':'first'}))
            self.assertTrue(entered.wait(2))
            try:
                self.assertEqual(client.post('/speech', headers=self.auth, json={'text':'second'}).status_code, 429)
            finally:
                release.set()
            self.assertEqual(first.result().status_code, 200)
    def test_failure_releases_inference_slot(self):
        engine = Engine()
        def fail(text): raise ValueError('Invalid speech')
        engine.speech = fail
        client = TestClient(create_app(engine, 'test-secret'))
        self.assertEqual(client.post('/speech', headers=self.auth, json={'text':'hello'}).status_code, 422)
        engine.speech = Engine().speech
        self.assertEqual(client.post('/speech', headers=self.auth, json={'text':'hello'}).status_code, 200)
    def test_malformed_json(self):
        self.assertEqual(self.client.post('/speech', headers=self.auth, content='{').status_code, 422)
    def test_no_cors(self):
        response = self.client.options('/speech', headers={'Origin':'https://example.com', 'Access-Control-Request-Method':'POST'})
        self.assertNotIn('access-control-allow-origin', response.headers)

class DecoderTests(unittest.TestCase):
    def test_silence_does_not_hallucinate_prompt_words(self):
        output = io.BytesIO()
        with wave.open(output, 'wb') as wav:
            wav.setparams((1, 2, 16000, 0, 'NONE', 'not compressed'))
            wav.writeframes(b'\0\0' * 16000)
        self.assertEqual(SpeechEngine().transcribe(output.getvalue()), '')

    def test_pcm_and_nigerian_vocabulary_reach_whisper(self):
        from unittest.mock import patch, Mock
        import numpy as np
        output = io.BytesIO()
        with wave.open(output, 'wb') as wav:
            wav.setparams((1, 2, 16000, 0, 'NONE', 'not compressed'))
            wav.writeframes(b'\x00\x10' * 16000)
        transcribe = Mock(return_value={'text': ' Open YouTube '})
        with patch.dict('sys.modules', {'mlx_whisper': Mock(transcribe=transcribe)}):
            self.assertEqual(SpeechEngine().transcribe(output.getvalue()), 'Open YouTube')
            args, kwargs = transcribe.call_args
            self.assertIsInstance(args[0], np.ndarray)
            self.assertEqual(kwargs['language'], 'en')
            self.assertIn('Nigerian English', kwargs['initial_prompt'])
            self.assertFalse(kwargs['condition_on_previous_text'])

    def test_rejects_invalid_audio_before_loading_model(self):
        with self.assertRaisesRegex(ValueError, 'could not be decoded'):
            SpeechEngine().transcribe(b'not audio')

    def test_rejects_overlong_audio_before_loading_model(self):
        output = io.BytesIO()
        with wave.open(output, 'wb') as wav:
            wav.setparams((1, 2, 16000, 0, 'NONE', 'not compressed'))
            wav.writeframes(b'\0\0' * (16000 * 31))
        with self.assertRaisesRegex(ValueError, '30 seconds'):
            SpeechEngine().transcribe(output.getvalue())

if __name__ == '__main__': unittest.main()
