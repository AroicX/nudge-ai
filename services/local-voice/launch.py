import os
from pathlib import Path
import runpy

root = Path(__file__).resolve().parents[2]
if not os.environ.get('NUDGE_PAIRING_SECRET'):
    for path in [root / 'apps/server/.env', root / '.env']:
        if path.exists():
            for line in path.read_text().splitlines():
                key, separator, value = line.partition('=')
                if separator and key.strip() == 'NUDGE_PAIRING_SECRET':
                    os.environ[key.strip()] = value.strip().strip('"\'')
                    break
        if os.environ.get('NUDGE_PAIRING_SECRET'):
            break
if not os.environ.get('NUDGE_PAIRING_SECRET'):
    raise SystemExit('Set NUDGE_PAIRING_SECRET to the same value as the Nudge backend.')
os.environ['HF_HOME'] = str(Path(__file__).resolve().parent / '.cache/huggingface')
runpy.run_path(str(Path(__file__).with_name('server.py')), run_name='__main__')
