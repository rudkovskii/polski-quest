#!/usr/bin/env python3
"""Список строк для озвучки (`content/audio.json`) из базы A1 (`content/a1/words.json`, `phrases.json`).

Слово: id `w.*`, обычная и медленная версия. Фраза: id `p.*`, обычная. Потом `npm run audio` пишет файлы
(ничего не воспроизводит). Чего нет в манифесте, рантайм говорит через Web Speech.

    python3 tools/audio_list.py              # все слова и фразы
    python3 tools/audio_list.py --band 1 --level 1   # только полоса 1 слов и уровень 1 фраз
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--band', type=int, default=3, help='слова с band ≤ N')
    ap.add_argument('--level', type=int, default=3, help='фразы с level ≤ N')
    a = ap.parse_args()
    words = json.loads((ROOT / 'content/a1/words.json').read_text(encoding='utf-8'))
    phrases = json.loads((ROOT / 'content/a1/phrases.json').read_text(encoding='utf-8'))
    out = [{'id': w['id'], 'pl': w['pl'], 'slow': True} for w in words if w['band'] <= a.band]
    out += [{'id': p['id'], 'pl': p['pl']} for p in phrases if p['level'] <= a.level]
    text = json.dumps({'phrases': out}, ensure_ascii=False, indent=0) + '\n'
    (ROOT / 'content/audio.json').write_text(text, encoding='utf-8')
    print(f'audio.json: {len(out)} строк (band ≤ {a.band}, level ≤ {a.level})')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
