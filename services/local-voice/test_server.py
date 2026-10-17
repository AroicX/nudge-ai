import io
import unittest
import wave
from fastapi.testclient import TestClient
from server import create_app

class Engine:
    def ready(self): return True
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
    def test_no_cors(self):
        response = self.client.options('/speech', headers={'Origin':'https://example.com', 'Access-Control-Request-Method':'POST'})
        self.assertNotIn('access-control-allow-origin', response.headers)

if __name__ == '__main__': unittest.main()
