#!/usr/bin/env python3
"""Предгенерация озвучки в билд (ТЗ §7.1, I-09).

Собирает польские строки из content/ (слова, примеры, шаги уроков, реплики NPC в диалогах,
таблички, минимальные пары, реплики story/lines.json без todo), озвучивает их и пишет
public/audio/<sha1[:12]>.m4a + public/audio/manifest.json.

    npm run audio                         # = python3 tools/build_audio.py (только Mac: say + afconvert)
    npm run audio:check                   # = --check: всё ли озвучено; ничего не генерирует, работает в CI (Linux)
    python3 tools/build_audio.py --voice say:Zosia      # голос по умолчанию (с этапа 2: piper:pl_PL-gosia-medium)
    python3 tools/build_audio.py --prune  # удалить файлы, на которые больше не ссылается манифест
    python3 tools/build_audio.py --dry-run  # показать, что будет сгенерировано

Голос строки: characters[who].voice для реплик (engine "none" = не озвучиваем, так у Димы),
vocab.voice если задан, иначе --voice. Ключ файла: sha1(engine|voice|rateTag|text), уже
существующие файлы не генерируются заново. Медленная версия (rateTag "slow") — для vocab.pl
и шагов listen, dictation, shadow, minimal_pair, а также пар из phonetics.json.

Манифест (детерминированный, без дат, чтобы повторный прогон не давал диффа):
  { "v": 1, "default": "say:Zosia",
    "entries": { "<voice>|<rateTag>|<text>": "a1b2c3d4e5f6.m4a" },        # контракт ТЗ §7.1 п. 6
    "files":   { "a1b2c3d4e5f6.m4a": { "dur": 0.62, "voice": "say:Zosia", "rate": "normal" } },
    "ids":     { "lx.maly": { "text": "mały", "voice": "say:Zosia", "slow": true } } }

--check: строки модулей status: ready без записи или файла = ошибка (exit 1);
для draft и глобальных строк (lines, phonetics) — предупреждение.
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

    @property
    def key(self) -> str:
        return f'{self.voice}|{self.rate}|{self.text}'

    @property
    def file(self) -> str:
        engine, _, vid = self.voice.partition(':')
        h = hashlib.sha1(f'{engine}|{vid}|{self.rate}|{self.text}'.encode('utf-8')).hexdigest()
        return f'{h[:12]}.m4a'


@dataclass
class Collected:
    items: dict[str, Item] = field(default_factory=dict)
    ids: dict[str, dict] = field(default_factory=dict)
    skipped_todo: list[str] = field(default_factory=list)
    unvoiced: int = 0


def voice_of_char(ch: dict | None) -> str | None:
    """`characters[].voice` → "say:Zosia" (или "say:Zosia@0.9" при rate ≠ 1); None = не озвучивать."""
    if not ch:
        return None
    v = ch.get('voice') or {}
    if v.get('engine') in (None, 'none'):
        return None
    s = f"{v['engine']}:{v['id']}"
    rate = v.get('rate')
    if rate is not None and float(rate) != 1.0:
        s += f'@{float(rate):g}'
    return s


def voice_str(v: str | None, default: str) -> str:
    if not v:
        return default
    return v if ':' in v else f'say:{v}'


def load_json(p: Path):
    with p.open(encoding='utf-8') as f:
        return json.load(f)


def collect(content: Path, default_voice: str) -> Collected:
    c = Collected()
    chars = {ch['id']: ch for ch in load_json(content / 'characters.json')}

    def add(text: str | None, voice: str | None, rates: tuple[str, ...], *, ready: bool, id_: str | None, src: str) -> None:
        if not text:
            return
        if voice is None:
            c.unvoiced += 1
            return
        t = norm(text)
        if not t:
            return
        for r in rates:
            it = c.items.setdefault(f'{voice}|{r}|{t}', Item(t, voice, r))
            it.ready = it.ready or ready
            it.src.add(src)
            if id_:
                it.ids.add(id_)
        if id_ and id_ not in c.ids:
            c.ids[id_] = {'text': t, 'voice': voice, 'slow': SLOW in rates}

    def say_voice(who: str | None) -> str | None:
        if who is None:
            return default_voice
        return voice_of_char(chars.get(who))

    both = (NORMAL, SLOW)
    one = (NORMAL,)
    for mdir in sorted((content / 'modules').glob('*/')):
        mfile = mdir / 'module.json'
        if not mfile.exists():
            continue
        mod = load_json(mfile)
        ready = mod.get('status') == 'ready'
        rel = lambda p: str(p.relative_to(content))  # noqa: E731

        vf = mdir / 'vocab.json'
        for v in load_json(vf) if vf.exists() else []:
            voice = voice_str(v.get('voice'), default_voice)
            add(v['pl'], voice, both, ready=ready, id_=v['id'], src=rel(vf))
            if v.get('ex'):
                add(v['ex'].get('pl'), voice, one, ready=ready, id_=f"{v['id']}#ex", src=rel(vf))

        lf = mdir / 'lessons.json'
        for lesson in load_json(lf) if lf.exists() else []:
            groups: list[tuple[str, list]] = []
            if lesson.get('steps'):
                groups.append(('', lesson['steps']))
            for part in lesson.get('parts') or []:
                groups.append((f"{part['id']}.", part['steps']))
            for prefix, steps in groups:
                for i, s in enumerate(steps):
                    sid = s.get('id') or f"{lesson['id']}#{prefix}{i}"
                    t = s['t']
                    src = rel(lf)
                    if t == 'say':
                        if s.get('audio') is False:
                            continue
                        add(s['pl'], say_voice(s.get('who')), one, ready=ready, id_=sid, src=src)
                    elif t == 'shadow':
                        add(s['pl'], default_voice, both, ready=ready, id_=sid, src=src)
                    elif t in ('listen', 'dictation'):
                        add(s.get('say'), default_voice, both, ready=ready, id_=sid, src=src)
                    elif t in ('order', 'type', 'gap'):
                        add(s.get('say'), default_voice, one, ready=ready, id_=sid, src=src)
                    elif t == 'minimal_pair':
                        for j, w in enumerate(s['pair']):
                            add(w, default_voice, both, ready=ready, id_=f'{sid}.{j}', src=src)
                    elif t == 'stress':
                        add(s.get('say') or s['word'], default_voice, both, ready=ready, id_=sid, src=src)

        df = mdir / 'dialogues.json'
        for d in load_json(df) if df.exists() else []:
            for nid, n in d['nodes'].items():
                if n.get('pl'):
                    add(n['pl'], say_voice(n['who']), one, ready=ready, id_=f"{d['id']}#{nid}", src=rel(df))

        for mf in sorted((mdir / 'maps').glob('*.json')):
            m = load_json(mf)
            for o in m.get('objects', []):
                if o.get('type') == 'sign' and o.get('pl'):
                    x, y = o['at']
                    add(o['pl'], default_voice, one, ready=ready, id_=f"{m['id']}#sign.{x}_{y}", src=rel(mf))

    # Глобальные строки: в --check только предупреждения.
    lines = content / 'story' / 'lines.json'
    for line in load_json(lines) if lines.exists() else []:
        if line.get('todo'):
            c.skipped_todo.append(line['id'])
            continue
        add(line.get('pl'), voice_of_char(chars.get(line['who'])), one, ready=False, id_=line['id'], src='story/lines.json')
    ph = content / 'phonetics.json'
    if ph.exists():
        for p in load_json(ph).get('pairs', []):
            add(p['a'], default_voice, both, ready=False, id_=f"{p['id']}#a", src='phonetics.json')
            add(p['b'], default_voice, both, ready=False, id_=f"{p['id']}#b", src='phonetics.json')
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
    spoken = item.text.replace('[[', '[ [')
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
    ap.add_argument('--root', type=Path, default=ROOT / 'content', help='папка content/')
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
        tmp = Path(td)
        for n, it in enumerate(todo, 1):
            target = out / it.file
            try:
                synth(it, target, tmp)
            except (RuntimeError, subprocess.CalledProcessError) as e:
                failed += 1
                print(f'  ! {it.text} [{it.voice}|{it.rate}]: {e}', file=sys.stderr)
                continue
            print(f'  [{n}/{len(todo)}] {it.file} {it.rate:6} {it.text}')
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
