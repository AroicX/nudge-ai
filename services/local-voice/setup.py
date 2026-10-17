"""Explicit, restartable model download; never run during a conversation."""
from pathlib import Path
from urllib.request import urlopen
import shutil
from huggingface_hub import snapshot_download

root = Path(__file__).resolve().parent / 'models'
root.mkdir(exist_ok=True)
snapshot_download('mlx-community/whisper-small.en-mlx', local_dir=root / 'whisper-small.en', allow_patterns=['config.json', 'weights.npz'])
for name in ['kokoro-v1.0.onnx', 'voices-v1.0.bin']:
    target = root / name
    if target.exists():
        continue
    temporary = target.with_suffix('.download')
    with urlopen(f'https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/{name}', timeout=120) as source, temporary.open('wb') as output:
        shutil.copyfileobj(source, output)
    temporary.replace(target)
print('Local speech models downloaded.')
