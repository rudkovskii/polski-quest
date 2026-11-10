#!/usr/bin/env python3
"""Выкладка лент с мака сама (10.11, ТЗ-лента-прогресса Р2). Запускает LaunchAgent `com.rudkovskiid.polski-feed`
(`npm run feed:install`): по изменению источников и раз в 5 минут.

Источники → что выкладывается на ветку `slowa`:
  Игра/data/moje_slowa.json                         → npm run words      (moje_slowa.json)
  ПМЖ/Собес/Miso-baza-voprosov.md, drill/progress.md → npm run sobes:feed (sobes.json)

Пауза: источник менялся меньше 60 с назад — ждём, чтобы не выкладывать файл посреди записи.
Часть выкладывается, только если её источники изменились с последней удачной выкладки (или прошлая упала).
Итог — `Игра/data/feed-status.json`: время, что выложено, хеш коммита, ошибка проверки дословно. Агент чата читает его в конце занятия.

python3 tools/feed_watch.py          один прогон
python3 tools/feed_watch.py --force  выложить обе части, даже если источники не менялись
"""
import hashlib
import json
import os
import re
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

APP = Path(__file__).resolve().parent.parent
GAME = APP.parent
SOBES = Path(os.environ.get('SOBES_DIR', GAME.parent.parent / 'ПМЖ' / 'Собес'))
STATUS = GAME / 'data' / 'feed-status.json'
QUIET_S = 60
MAX_WAIT_S = 600
PARTS = {
    'words': {'sources': [GAME / 'data' / 'moje_slowa.json'], 'cmd': ['python3', 'tools/words_push.py']},
    'sobes': {'sources': [SOBES / 'Miso-baza-voprosov.md', SOBES / 'drill' / 'progress.md'], 'cmd': ['npx', 'tsx', 'tools/sobes_import.ts', '--feed']},
}


def now_iso() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat(timespec='seconds')


def digest(paths) -> str:
    h = hashlib.sha256()
    for p in paths:
        h.update(p.read_bytes() if p.exists() else b'<missing>')
        h.update(b'\0')
    return h.hexdigest()[:16]


def wait_quiet(paths) -> None:
    """Ждать, пока все источники не простоят QUIET_S секунд без изменений (не дольше MAX_WAIT_S)."""
    start = time.time()
    while time.time() - start < MAX_WAIT_S:
        last = max((p.stat().st_mtime for p in paths if p.exists()), default=0)
        left = QUIET_S - (time.time() - last)
        if left <= 0:
            return
        time.sleep(min(left + 1, 30))


def load_status() -> dict:
    try:
        return json.loads(STATUS.read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return {}


def run_part(name: str, part: dict) -> dict:
    r = subprocess.run(part['cmd'], cwd=APP, capture_output=True, text=True, timeout=300)
    out = (r.stdout + r.stderr).strip()
    m = re.search(r'выложено на slowa: ([0-9a-f]{7,})', out)
    res = {'ok': r.returncode == 0, 'at': now_iso(), 'output': out[-2000:]}
    if r.returncode == 0:
        res['pushed'] = bool(m)
        if m:
            res['commit'] = m.group(1)
    else:
        res['error'] = out[-2000:] or f'код выхода {r.returncode}'
    return res


def main() -> None:
    force = '--force' in sys.argv
    wait_quiet([p for part in PARTS.values() for p in part['sources']])
    status = load_status()
    parts = status.get('parts', {})
    ran = []
    for name, part in PARTS.items():
        d = digest(part['sources'])
        prev = parts.get(name, {})
        if not force and prev.get('ok') and prev.get('sources') == d:
            continue
        res = run_part(name, part)
        res['sources'] = d
        parts[name] = res
        ran.append(name)
    if not ran:
        return
    errors = {n: parts[n]['error'] for n in ran if not parts[n]['ok']}
    status = {
        'at': now_iso(),
        'ok': not errors,
        'ran': ran,
        'pushed': {n: parts[n]['commit'] for n in ran if parts[n].get('commit')},
        **({'errors': errors} if errors else {}),
        'parts': parts,
        'about': 'Итог автовыкладки лент на ветку slowa (tools/feed_watch.py, LaunchAgent com.rudkovskiid.polski-feed). ok=false — ошибка проверки в errors дословно, игра работает на прошлой ленте.',
    }
    STATUS.write_text(json.dumps(status, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    print(json.dumps({k: status[k] for k in ('at', 'ok', 'ran', 'pushed')}, ensure_ascii=False))


if __name__ == '__main__':
    main()
