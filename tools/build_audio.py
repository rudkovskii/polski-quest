#!/usr/bin/env python3
"""Предгенерация озвучки в билд.

Берёт польские строки из `content/audio.json` (`{"phrases": [{"id": "lx.maly", "pl": "mały", "slow": true}, …]}`),
озвучивает их и пишет public/audio/<sha1[:12]>.m4a + public/audio/manifest.json. Список строк дают F-02 и F-03
(слова и фразы A1, примеры); в F-01 он пуст, манифест пустой.

    npm run audio                         # = python3 tools/build_audio.py (голос по умолчанию DEFAULT_VOICE, только Mac)
    npm run audio:check                   # = --check: всё ли озвучено; ничего не генерирует, работает в CI (Linux)
    python3 tools/build_audio.py --voice say:Zosia      # системный голос macOS (say + afconvert, --jobs 6)
    PQ_TTS_PY=<venv mlx-audio>/bin/python caffeinate -i python3 tools/build_audio.py --voice omni:ania
                                          # OmniVoice: референс ../research/voices/refs/ania.{wav,txt}, воркер tools/tts_omni_worker.py
    python3 tools/build_audio.py --prune  # удалить файлы, на которые больше не ссылается манифест
    python3 tools/build_audio.py --dry-run  # показать, что будет сгенерировано

Фраза: `pl` обязателен, `voice` необязателен (иначе --voice), `slow: true` добавляет медленную версию, `ex` — пример
(строка `<id>#ex`), `spoken` — что произносить вместо `pl` (числа словами); ключ манифеста остаётся по `pl`.
Ключ файла: sha1(engine|voice|rateTag|text[|spoken]), существующие файлы заново не генерируются.
Звук вслух на проверках не играть: эта утилита только пишет файлы.

Голос `omni:<имя>-<хэш8>` (OmniVoice k2-fsa, MLX): хэш — sha1 референса (wav + текст), поменяли референс — новые ключи и файлы.
Генерация идёт одним воркером (модель грузится один раз), медленная версия = длительность × OMNI_SLOW, постобработка:
обрезка тишины, громкость −18 LUFS, AAC 64 кбит/с. QA и повторы с другим seed — `tools/audio_qa.py` (→ content/audio_qa.json);
строка, которая не прошла QA и после повторов, в манифесте ведёт на файл запасного голоса (FALLBACK_VOICE, say:Zosia).

Манифест (детерминированный, без дат):
  { "v": 1, "default": "omni:ania-1a2b3c4d",
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
DEFAULT_VOICE = 'omni:hela-4b1ad1bd'  # OmniVoice, придуманный голос «hela» (research/voices/refs/hela.*), этап 2 20.10.2026
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
# omni (OmniVoice): референсы `<имя>.wav` + `<имя>.txt` (8–10 с, 24 кГц, моно), кеш токенов референса, Python с mlx-audio.
OMNI_REFS = Path(os.environ.get('PQ_OMNI_REFS', ROOT.parent / 'research' / 'voices' / 'refs'))
OMNI_CACHE = Path.home() / '.cache' / 'pq-voices' / 'omni'
OMNI_SLOW = 1.35  # медленная версия: длительность × 1.35 (OmniVoice растягивает речь под заданную длину)
OMNI_SEED = 42
LUFS = -18.0
FALLBACK_VOICE = 'say:Zosia'
QA_FILE = 'audio_qa.json'


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
    # Своё написание для голоса (заимствования, числа словами); ключ манифеста — по `text`.
    spoken: str | None = None
    # Порядок генерации (меньше — раньше): прерванный прогон уже озвучил главное.
    prio: int = 9
    # Запасной файл (FALLBACK_VOICE), если строка не прошла QA или ещё не озвучена этим голосом.
    fallback: 'Item | None' = None

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

    def add(text: str | None, voice: str, rates: tuple[str, ...], id_: str | None, spoken: str | None = None, prio: int = 9) -> None:
        t = norm(text or '')
        if not t:
            return
        sp = norm(spoken) if spoken and norm(spoken) != t else None
        for r in rates:
            it = c.items.setdefault(f'{voice}|{r}|{t}', Item(t, voice, r, ready=True, spoken=sp, prio=prio))
            it.prio = min(it.prio, prio)
            it.src.add(f.name)
            if id_:
                it.ids.add(id_)
        if id_ and id_ not in c.ids:
            c.ids[id_] = {'text': t, 'voice': voice, 'slow': SLOW in rates}

    for p in phrases:
        voice = voice_str(p.get('voice'), default_voice)
        add(p['pl'], voice, both if p.get('slow') else one, p.get('id'), p.get('spoken'), int(p.get('prio', 9)))
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


def ref_hash(wav: Path, text: str) -> str:
    """Тот же хэш, что у воркера: sha1(wav-байты + текст)[:8]."""
    h = hashlib.sha1(wav.read_bytes())
    h.update(text.strip().encode('utf-8'))
    return h.hexdigest()[:8]


def omni_ref(vid: str) -> tuple[Path, str, str]:
    """`ania-1a2b3c4d` или `ania` → (wav, текст, хэш). Хэш в имени голоса обязан совпасть с файлом референса."""
    name, _, want = vid.rpartition('-') if re.search(r'-[0-9a-f]{8}$', vid) else (vid, '', '')
    wav, txt = OMNI_REFS / f'{name}.wav', OMNI_REFS / f'{name}.txt'
    if not wav.exists() or not txt.exists():
        raise RuntimeError(f'нет референса {wav} / {txt} (PQ_OMNI_REFS)')
    text = txt.read_text(encoding='utf-8').strip()
    h = ref_hash(wav, text)
    if want and want != h:
        raise RuntimeError(f'референс {name} изменился: в голосе {want}, у файла {h}. Передай --voice omni:{name}, чтобы пересобрать')
    return wav, text, h


def omni_voice(v: str) -> str:
    """`omni:ania` → `omni:ania-<хэш>` (ключ файла различает референсы)."""
    engine, _, vid = v.partition(':')
    if engine != 'omni' or re.search(r'-[0-9a-f]{8}$', vid):
        return v
    _, _, h = omni_ref(vid)
    return f'omni:{vid}-{h}'


class OmniWorker:
    """Клиент воркера `tools/tts_omni_worker.py` (JSONL). Python берётся из PQ_TTS_PY, запуск с -I."""

    def __init__(self, vid: str, steps: int = 32):
        wav, text, self.hash = omni_ref(vid)
        py = os.environ.get('PQ_TTS_PY')
        if not py or not Path(py).exists():
            raise RuntimeError('PQ_TTS_PY: путь к Python с mlx-audio 0.5.8 (например, «Озвучка Новая версия/models/voxcpm2/.venv/bin/python»)')
        cmd = [py, '-I', str(ROOT / 'tools' / 'tts_omni_worker.py'), '--ref-audio', str(wav), '--ref-text', text,
               '--cache', str(OMNI_CACHE), '--steps', str(steps)]
        self.proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, encoding='utf-8', bufsize=1)
        hello = self._read()
        if not hello.get('ready') or hello.get('ref') != self.hash:
            raise RuntimeError(f'omni: воркер не поднялся: {hello}')
        self.n = 0

    def _read(self) -> dict:
        assert self.proc.stdout
        line = self.proc.stdout.readline()
        if not line:
            raise RuntimeError(f'omni: воркер завершился (код {self.proc.poll()})')
        return json.loads(line)

    def synth(self, text: str, out: Path, seed: int = OMNI_SEED, slow: bool = False) -> dict:
        self.n += 1
        msg = {'id': str(self.n), 'text': text, 'out_path': str(out.resolve()), 'seed': seed, 'dur_mult': OMNI_SLOW if slow else 1.0}
        assert self.proc.stdin
        self.proc.stdin.write(json.dumps(msg, ensure_ascii=False) + '\n')
        self.proc.stdin.flush()
        r = self._read()
        if not r.get('ok'):
            raise RuntimeError(f"omni: {r.get('error')}")
        return r

    def close(self) -> None:
        if self.proc.poll() is None:
            assert self.proc.stdin
            self.proc.stdin.close()
            try:
                self.proc.wait(timeout=30)
            except subprocess.TimeoutExpired:
                self.proc.kill()


_omni: dict[str, OmniWorker] = {}


def omni_worker(vid: str) -> OmniWorker:
    if vid not in _omni:
        _omni[vid] = OmniWorker(vid)
    return _omni[vid]


def _ff(*a: str) -> str:
    return subprocess.run(['ffmpeg', '-hide_banner', '-nostats', '-y', *a], capture_output=True, text=True, check=True).stderr


def post_process(raw: Path, out_wav: Path, lufs: float = LUFS) -> float:
    """Обрезка тишины по краям (порог −50 дБ, поля 50/120 мс) и линейная громкость к `lufs` (пик ≤ −1.5 dBTP). → длительность, с."""
    trim = out_wav.with_suffix('.trim.wav')
    edge = ('silenceremove=start_periods=1:start_silence=0.05:start_threshold=-50dB,areverse,'
            'silenceremove=start_periods=1:start_silence=0.12:start_threshold=-50dB,areverse')
    _ff('-i', str(raw), '-af', edge, '-ac', '1', '-ar', '24000', str(trim))
    if probe_dur(trim) < 0.05:
        # Обрезка съела всё (почти тишина): берём как есть, QA поймает.
        _ff('-i', str(raw), '-ac', '1', '-ar', '24000', str(trim))
    st = _ff('-i', str(trim), '-af', f'loudnorm=I={lufs}:TP=-1.5:LRA=11:print_format=json', '-f', 'null', '-')
    m = re.search(r'\{[^{}]*"input_i"[^{}]*\}', st)
    gain = None
    if m:
        j = json.loads(m.group(0))
        try:
            i, tp = float(j['input_i']), float(j['input_tp'])
            if i > -70:
                gain = min(lufs - i, -1.5 - tp)
        except (ValueError, KeyError):
            gain = None
    if gain is None:
        # Короче 0.4 с интегральной громкости нет: по средней громкости (речь ≈ LUFS − 3 дБ RMS).
        vd = _ff('-i', str(trim), '-af', 'volumedetect', '-f', 'null', '-')
        mv = re.search(r'mean_volume:\s*(-?[\d.]+)', vd)
        mx_ = re.search(r'max_volume:\s*(-?[\d.]+)', vd)
        gain = min((lufs - 3) - float(mv.group(1)), -1.5 - float(mx_.group(1))) if mv and mx_ else 0.0
    gain = min(gain, 30.0)  # тишину не раздуваем в шум
    _ff('-i', str(trim), '-af', f'volume={gain:.2f}dB', '-ac', '1', '-ar', '24000', '-c:a', 'pcm_s16le', str(out_wav))
    trim.unlink(missing_ok=True)
    return probe_dur(out_wav)


def probe_dur(p: Path) -> float:
    out = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', str(p)], capture_output=True, text=True).stdout.strip()
    try:
        return float(out)
    except ValueError:
        return 0.0


def to_m4a(wav: Path, out: Path) -> None:
    part = out.with_suffix('.part.m4a')
    subprocess.run(['afconvert', '-f', 'm4af', '-d', 'aac', '-b', str(BITRATE), str(wav), str(part)], check=True)
    part.replace(out)


def synth_omni(item: Item, out: Path, tmp: Path, seed: int = OMNI_SEED) -> dict:
    """Озвучить строку голосом omni в `out` (.m4a). → ответ воркера + `trim` (длительность после обрезки)."""
    _, _, vid = item.voice.partition(':')
    raw, wav = tmp / 'raw.wav', tmp / 'post.wav'
    r = omni_worker(vid).synth(item.spoken or item.text, raw, seed=seed, slow=item.rate == SLOW)
    r['trim'] = post_process(raw, wav)
    to_m4a(wav, out)
    return r


def synth(item: Item, out: Path, tmp: Path) -> None:
    engine, _, vid = item.voice.partition(':')
    if engine == 'omni':
        synth_omni(item, out, tmp)
        return
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


def build_manifest(c: Collected, default_voice: str, durs: dict[str, float | None], chosen: dict[str, Item] | None = None) -> dict:
    """`chosen`: ключ → чей файл стоит в манифесте (свой или запасного голоса)."""
    use = {k: (chosen or {}).get(k, it) for k, it in c.items.items()}
    entries = {k: use[k].file for k in sorted(c.items)}
    files = {}
    for it in sorted({u.file: u for u in use.values()}.values(), key=lambda i: i.file):
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
    ap.add_argument('--fallback-missing', action='store_true', help='omni: не генерировать недостающее, а взять файл запасного голоса')
    a = ap.parse_args()

    default_voice = voice_str(a.voice, DEFAULT_VOICE)
    if not a.check:
        default_voice = omni_voice(default_voice)
    c = collect(a.root, default_voice)
    out: Path = a.out
    mpath = out / 'manifest.json'
    old = load_json(mpath) if mpath.exists() else {}
    items = sorted(c.items.values(), key=lambda i: i.key)
    todo_note = f'; todo-реплик пропущено: {len(c.skipped_todo)}' if c.skipped_todo else ''
    head = f'audio: {len(items)} записей ({sum(1 for i in items if i.rate == SLOW)} медленных), голос по умолчанию {default_voice}{todo_note}'

    if a.check:
        entries = old.get('entries', {}) if isinstance(old, dict) else {}
        qa_p = a.root / QA_FILE
        qa = load_json(qa_p) if qa_p.exists() else {}
        # Строка не прошла QA голоса omni и старого файла нет: звучит через Web Speech, это решение, а не ошибка.
        qa_fail = {k for k, v in (qa.get('entries') or {}).items() if v.get('status') == 'fail'} if qa.get('voice') == default_voice else set()
        if not mpath.exists():
            print(f'audio:check: нет {mpath.relative_to(ROOT) if mpath.is_relative_to(ROOT) else mpath}', file=sys.stderr)
        errors, warns = [], []
        for it in items:
            f = entries.get(it.key)
            if f is None and it.key in qa_fail:
                continue
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
    # QA голоса omni (tools/audio_qa.py): строки со статусом fail идут запасным голосом.
    qa_p = a.root / QA_FILE
    qa = load_json(qa_p) if qa_p.exists() else {}
    failed_keys = {k for k, v in (qa.get('entries') or {}).items() if v.get('status') == 'fail'} if qa.get('voice') == default_voice else set()
    for it in items:
        if it.voice.startswith('omni:') and (it.key in failed_keys or (a.fallback_missing and not (out / it.file).exists())):
            it.fallback = Item(it.text, FALLBACK_VOICE, it.rate, ready=True, spoken=None, prio=it.prio)
    # Запасной файл не генерируется: старый Zosia есть — он, нет — строки нет в манифесте (Web Speech, как раньше).
    todo = sorted((it for it in items if not it.fallback and (a.force or not (out / it.file).exists())), key=lambda i: (i.prio, i.key))
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
            except (RuntimeError, subprocess.CalledProcessError, OSError, ValueError) as e:
                print(f'  ! {it.text} [{it.voice}|{it.rate}]: {e}', file=sys.stderr)
                return False
            finally:
                shutil.rmtree(tmp, ignore_errors=True)
            print(f'  [{n}/{len(todo)}] {it.file} {it.rate:6} {it.text}', flush=True)
            return True

        # omni — один воркер (GPU один), строго по очереди; say/piper — параллельно.
        serial = [x for x in enumerate(todo, 1) if x[1].voice.startswith('omni:')]
        para = [x for x in enumerate(todo, 1) if not x[1].voice.startswith('omni:')]
        with ThreadPoolExecutor(max_workers=max(1, a.jobs)) as pool:
            failed = sum(1 for ok in pool.map(lambda x: job(*x), para) if not ok)
        try:
            failed += sum(1 for x in serial if not job(*x))
        finally:
            for w in _omni.values():
                w.close()
    chosen: dict[str, Item] = {}
    for it in items:
        use = it.fallback or it
        if (out / use.file).exists():
            chosen[it.key] = use
    for use in chosen.values():
        if use.file in durs:
            continue
        prev = None if a.force else old_files.get(use.file, {}).get('dur')
        durs[use.file] = prev if prev is not None else duration(out / use.file)

    present = [it for it in items if it.key in chosen]
    ok = Collected(items={it.key: it for it in present}, ids={k: v for k, v in c.ids.items() if any(k in it.ids for it in present)})
    manifest = build_manifest(ok, default_voice, durs, chosen)
    text = json.dumps(manifest, ensure_ascii=False, indent=1, sort_keys=False) + '\n'
    if not mpath.exists() or mpath.read_text(encoding='utf-8') != text:
        mpath.write_text(text, encoding='utf-8')
    nfb = sum(1 for k, u in chosen.items() if u.voice != c.items[k].voice)
    if nfb:
        print(f'audio: запасным голосом {FALLBACK_VOICE}: {nfb} строк (QA fail или ещё не озвучены)')

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
