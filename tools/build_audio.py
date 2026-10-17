#!/usr/bin/env python3
"""Предгенерация озвучки в билд.

Берёт польские строки из `content/audio.json` (`{"phrases": [{"id": "lx.maly", "pl": "mały", "slow": true}, …]}`),
озвучивает их и пишет public/audio/<sha1[:12]>.m4a + public/audio/manifest.json. Список строк дают F-02 и F-03
(слова и фразы A1, примеры); в F-01 он пуст, манифест пустой.

    npm run audio                         # = python3 tools/build_audio.py (только Mac: say + afconvert; --jobs 6 параллельно)
    npm run audio:check                   # = --check: всё ли озвучено; ничего не генерирует, работает в CI (Linux)
    python3 tools/build_audio.py --voice say:Zosia      # голос по умолчанию
    python3 tools/build_audio.py --prune  # удалить файлы, на которые больше не ссылается манифест
    python3 tools/build_audio.py --dry-run  # показать, что будет сгенерировано

Фраза: `pl` обязателен, `voice` необязателен (иначе --voice), `slow: true` добавляет медленную версию, `ex` — пример
(строка `<id>#ex`). Ключ файла: sha1(engine|voice|rateTag|text), существующие файлы заново не генерируются.
Звук вслух на проверках не играть: эта утилита только пишет файлы.

Манифест (детерминированный, без дат):
  { "v": 1, "default": "say:Zosia",
    "entries": { "<voice>|<rateTag>|<text>": "a1b2c3d4e5f6.m4a" },
    "files":   { "a1b2c3d4e5f6.m4a": { "dur": 0.62, "voice": "say:Zosia", "rate": "normal" } },
    "ids":     { "lx.maly": { "text": "mały", "voice": "say:Zosia", "slow": true } } }

--check: фразы без записи или файла = ошибка (exit 1).
"""
from __future__ import annotations

import argparse
import functools
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import unicodedata
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_VOICE = 'say:Zosia'
NORMAL, SLOW = 'normal', 'slow'
# say: слова в минуту. ТЗ §7.1 п. 4 даёт 150/110, но компактная Zosia квантует скорость: -r 110 и -r 150
# дают одинаковый файл (замер 14.10.2026: «Mała kawa, proszę.» 1.75 с в обоих случаях). Медленнее -r 40 она
# не умеет (+27 %), поэтому медленная версия = -r 40 и пауза 250 мс между словами (SAY_SLOW_GAP).
SAY_RATE = {NORMAL: 150, SLOW: 40}
SAY_SLOW_GAP = ' [[slnc 250]] '
# piper: length_scale (больше = медленнее).
PIPER_SCALE = {NORMAL: 1.0, SLOW: 1.35}
PIPER_MODELS = Path.home() / '.cache' / 'piper'
BITRATE = 64000


def norm(text: str) -> str:
    """NFC + trim: так же нормализует рантайм (src/systems/platform/audio.ts)."""
    return unicodedata.normalize('NFC', text).strip()


@dataclass
class Item:
    text: str
    voice: str
    rate: str
    ready: bool = False
    ids: set[str] = field(default_factory=set)
    src: set[str] = field(default_factory=set)
    # Своё написание для голоса (заимствования); ключ манифеста — по `text`.
    spoken: str | None = None

    @property
    def key(self) -> str:
        return f'{self.voice}|{self.rate}|{self.text}'

    @property
    def file(self) -> str:
        engine, _, vid = self.voice.partition(':')
        base = f'{engine}|{vid}|{self.rate}|{self.text}'
        # Своё написание входит в хэш: поправил написание — файл пересоберётся. Без него хэш прежний.
        if self.spoken and self.spoken != self.text:
            base += f'|{self.spoken}'
        h = hashlib.sha1(base.encode('utf-8')).hexdigest()
        return f'{h[:12]}.m4a'


def respell(text: str, spoken: dict[str, str]) -> str:
    """Заимствования → написание для польского голоса (длинные ключи первыми, по границам слов)."""
    out = text
    for k in sorted(spoken, key=len, reverse=True):
        out = re.sub(rf'(?<![\wąćęłńóśźżĄĆĘŁŃÓŚŹŻ]){re.escape(k)}(?![\wąćęłńóśźżĄĆĘŁŃÓŚŹŻ])', spoken[k], out)
    return out


@dataclass
class Collected:
    items: dict[str, Item] = field(default_factory=dict)
    ids: dict[str, dict] = field(default_factory=dict)
    skipped_todo: list[str] = field(default_factory=list)


def voice_str(v: str | None, default: str) -> str:
    if not v:
        return default
    return v if ':' in v else f'say:{v}'


def load_json(p: Path):
    with p.open(encoding='utf-8') as f:
        return json.load(f)


def collect(content: Path, default_voice: str) -> Collected:
    c = Collected()
    f = content / 'audio.json'
    phrases = load_json(f).get('phrases', []) if f.exists() else []
    both = (NORMAL, SLOW)
    one = (NORMAL,)

    def add(text: str | None, voice: str, rates: tuple[str, ...], id_: str | None) -> None:
        t = norm(text or '')
        if not t:
            return
        for r in rates:
            it = c.items.setdefault(f'{voice}|{r}|{t}', Item(t, voice, r, ready=True))
            it.src.add(f.name)
            if id_:
                it.ids.add(id_)
        if id_ and id_ not in c.ids:
            c.ids[id_] = {'text': t, 'voice': voice, 'slow': SLOW in rates}

    for p in phrases:
        voice = voice_str(p.get('voice'), default_voice)
        add(p['pl'], voice, both if p.get('slow') else one, p.get('id'))
        ex = p.get('ex')
        if ex:
            add(ex, voice, one, f"{p['id']}#ex" if p.get('id') else None)
    return c


# ───────────────────────────── генерация ─────────────────────────────


def duration(path: Path) -> float | None:
    try:
        out = subprocess.run(['afinfo', str(path)], capture_output=True, text=True, check=True).stdout
    except (OSError, subprocess.CalledProcessError):
        return None
    m = re.search(r'estimated duration:\s*([\d.]+)', out)
    return round(float(m.group(1)), 2) if m else None


@functools.lru_cache(maxsize=1)
def piper_cli() -> tuple[list[str], dict[str, str]] | None:
    """Команда Piper и имена флагов: rhasspy/piper (MIT, `--length_scale`) или piper1-gpl (`--length-scale`)."""
    for cmd in (['piper'], [sys.executable, '-m', 'piper']):
        try:
            h = subprocess.run([*cmd, '--help'], capture_output=True, text=True, timeout=30)
        except (OSError, subprocess.TimeoutExpired):
            continue
        txt = h.stdout + h.stderr
        if h.returncode != 0 or '--model' not in txt and '-m' not in txt:
            continue
        dash = '--length-scale' in txt
        return cmd, {
            'model': '--model',
            'out': '--output-file' if '--output-file' in txt else '--output_file',
            'scale': '--length-scale' if dash else '--length_scale',
        }
    return None


def synth(item: Item, out: Path, tmp: Path) -> None:
    engine, _, vid = item.voice.partition(':')
    vid, _, mult = vid.partition('@')
    k = float(mult) if mult else 1.0
    txt = tmp / 'text.txt'
    # «[[» в тексте say принял бы за свою команду: разбиваем. Свои команды добавляем после.
    spoken = (item.spoken or item.text).replace('[[', '[ [')
    if engine == 'say' and item.rate == SLOW:
        spoken = SAY_SLOW_GAP.join(spoken.split())
    txt.write_text(spoken, encoding='utf-8')
    if engine == 'say':
        raw = tmp / 'x.aiff'
        rate = str(round(SAY_RATE[item.rate] * k))
        # -f: текст из файла, чтобы строки с «-» в начале не читались как флаги.
        subprocess.run(['say', '-v', vid, '-r', rate, '-o', str(raw), '-f', str(txt)], check=True)
    elif engine == 'piper':
        cli = piper_cli()
        if cli is None:
            raise RuntimeError('piper не найден: pip install piper-tts (см. tools/voice_compare/build.py)')
        cmd, fl = cli
        model = PIPER_MODELS / f'{vid}.onnx'
        if not model.exists():
            raise RuntimeError(f'нет модели {model}')
        raw = tmp / 'x.wav'
        scale = str(PIPER_SCALE[item.rate] / k)
        subprocess.run([*cmd, fl['model'], str(model), fl['scale'], scale, fl['out'], str(raw)], input=item.text, text=True, check=True, capture_output=True)
    else:
        raise RuntimeError(f'неизвестный движок {engine!r} у голоса {item.voice}')
    part = out.with_suffix('.part.m4a')
    subprocess.run(['afconvert', '-f', 'm4af', '-d', 'aac', '-b', str(BITRATE), str(raw), str(part)], check=True)
    part.replace(out)


# ───────────────────────────── main ─────────────────────────────


def build_manifest(c: Collected, default_voice: str, durs: dict[str, float | None]) -> dict:
    entries = {k: c.items[k].file for k in sorted(c.items)}
    files = {}
    for it in sorted(c.items.values(), key=lambda i: i.file):
        meta = {'voice': it.voice, 'rate': it.rate}
        d = durs.get(it.file)
        if d is not None:
            meta = {'dur': d, **meta}
        files[it.file] = meta
    return {'v': 1, 'default': default_voice, 'entries': entries, 'files': files, 'ids': {k: c.ids[k] for k in sorted(c.ids)}}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--check', action='store_true', help='только проверить, что всё озвучено (CI)')
    ap.add_argument('--voice', default=DEFAULT_VOICE, help=f'голос по умолчанию, engine:id (по умолчанию {DEFAULT_VOICE})')
    ap.add_argument('--prune', action='store_true', help='удалить файлы, которых нет в манифесте')
    ap.add_argument('--force', action='store_true', help='перегенерировать все файлы (после смены параметров голоса)')
    ap.add_argument('--dry-run', action='store_true', help='показать, что будет сгенерировано')
    ap.add_argument('--jobs', type=int, default=6, help='сколько строк озвучивать параллельно (say и afconvert — отдельные процессы)')
    ap.add_argument('--root', type=Path, default=ROOT / 'content', help='папка content/ (там audio.json)')
    ap.add_argument('--out', type=Path, default=ROOT / 'public' / 'audio', help='папка public/audio/')
    a = ap.parse_args()

    default_voice = voice_str(a.voice, DEFAULT_VOICE)
    c = collect(a.root, default_voice)
    out: Path = a.out
    mpath = out / 'manifest.json'
    old = load_json(mpath) if mpath.exists() else {}
    items = sorted(c.items.values(), key=lambda i: i.key)
    todo_note = f'; todo-реплик пропущено: {len(c.skipped_todo)}' if c.skipped_todo else ''
    head = f'audio: {len(items)} записей ({sum(1 for i in items if i.rate == SLOW)} медленных), голос по умолчанию {default_voice}{todo_note}'

    if a.check:
        entries = old.get('entries', {}) if isinstance(old, dict) else {}
        if not mpath.exists():
            print(f'audio:check: нет {mpath.relative_to(ROOT) if mpath.is_relative_to(ROOT) else mpath}', file=sys.stderr)
        errors, warns = [], []
        for it in items:
            f = entries.get(it.key)
            problem = 'нет в манифесте' if f is None else (None if (out / f).exists() else f'нет файла {f}')
            if not problem:
                continue
            msg = f'{sorted(it.src)[0]}: "{it.text}" [{it.voice}|{it.rate}] {problem}'
            (errors if it.ready else warns).append(msg)
        print(head)
        for w in warns[:5]:
            print(f'  warn  {w}')
        if len(warns) > 5:
            print(f'  warn  … ещё {len(warns) - 5}')
        for e in errors:
            print(f'  error {e}', file=sys.stderr)
        if warns:
            print(f'audio:check: {len(warns)} строк без озвучки (draft/глобальные, предупреждение). Запусти npm run audio на Mac.')
        if errors:
            print(f'audio:check: {len(errors)} строк модулей status: ready без озвучки', file=sys.stderr)
            return 1
        if not warns:
            print('audio:check: ok')
        return 0

    print(head)
    out.mkdir(parents=True, exist_ok=True)
    todo = [it for it in items if a.force or not (out / it.file).exists()]
    if a.dry_run:
        for it in todo:
            print(f'  + {it.file} [{it.voice}|{it.rate}] {it.text}')
        print(f'audio: сгенерировать {len(todo)}')
        return 0
    if todo and (shutil.which('afconvert') is None):
        print('audio: нужен macOS (say, afconvert). В CI используй --check.', file=sys.stderr)
        return 1
    old_files = old.get('files', {}) if isinstance(old, dict) else {}
    durs: dict[str, float | None] = {}
    failed = 0
    with tempfile.TemporaryDirectory(prefix='pq-audio-') as td:

        def job(n: int, it: Item) -> bool:
            # Своя временная папка на задачу: параллельные say не пишут в один файл.
            tmp = Path(td) / str(n)
            tmp.mkdir()
            try:
                synth(it, out / it.file, tmp)
            except (RuntimeError, subprocess.CalledProcessError) as e:
                print(f'  ! {it.text} [{it.voice}|{it.rate}]: {e}', file=sys.stderr)
                return False
            print(f'  [{n}/{len(todo)}] {it.file} {it.rate:6} {it.text}', flush=True)
            return True

        with ThreadPoolExecutor(max_workers=max(1, a.jobs)) as pool:
            failed = sum(1 for ok in pool.map(lambda x: job(*x), enumerate(todo, 1)) if not ok)
    for it in items:
        if not (out / it.file).exists():
            continue
        prev = None if a.force else old_files.get(it.file, {}).get('dur')
        durs[it.file] = prev if prev is not None else duration(out / it.file)

    present = [it for it in items if (out / it.file).exists()]
    ok = Collected(items={it.key: it for it in present}, ids={k: v for k, v in c.ids.items() if any(k in it.ids for it in present)})
    manifest = build_manifest(ok, default_voice, durs)
    text = json.dumps(manifest, ensure_ascii=False, indent=1, sort_keys=False) + '\n'
    if not mpath.exists() or mpath.read_text(encoding='utf-8') != text:
        mpath.write_text(text, encoding='utf-8')

    referenced = set(manifest['entries'].values())
    orphans = [p for p in out.glob('*.m4a') if p.name not in referenced]
    if a.prune:
        for p in orphans:
            p.unlink()
        if orphans:
            print(f'audio: удалено сиротских файлов: {len(orphans)}')
    elif orphans:
        print(f'audio: сиротских файлов {len(orphans)} (удалить: --prune)')
    size = sum((out / f).stat().st_size for f in referenced)
    print(f'audio: сгенерировано {len(todo) - failed}, в манифесте {len(referenced)} файлов, {size / 1024:.0f} КБ')
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
