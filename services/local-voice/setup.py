"""Explicit, restartable model download; never run during a conversation."""
from pathlib import Path
from urllib.request import urlopen
import shutil
import hashlib
from huggingface_hub import snapshot_download

root = Path(__file__).resolve().parent / 'models'
root.mkdir(exist_ok=True)
snapshot_download('mlx-community/whisper-small.en-mlx', local_dir=root / 'whisper-small.en', allow_patterns=['config.json', 'weights.npz'], revision='52a88bf')
checksums = {
    'kokoro-v1.0.onnx': '7d5df8ecf7d4b1878015a32686053fd0eebe2bc377234608764cc0ef3636a6c5',
    'voices-v1.0.bin': 'bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d',
}
for name, expected in checksums.items():
    target = root / name
    if target.exists():
        with target.open('rb') as existing:
            if hashlib.file_digest(existing, 'sha256').hexdigest() == expected:
                continue
    temporary = target.with_suffix('.download')
    with urlopen(f'https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/{name}', timeout=120) as source, temporary.open('wb') as output:
        shutil.copyfileobj(source, output)
    with temporary.open('rb') as downloaded:
        if hashlib.file_digest(downloaded, 'sha256').hexdigest() != expected:
            raise SystemExit(f'Checksum mismatch for {name}; do not use this download.')
    temporary.replace(target)
print('Local speech models downloaded.')
