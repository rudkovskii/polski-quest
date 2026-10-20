#!/usr/bin/env python3
"""QA озвучки голосом omni без прослушивания: Whisper large-v3-turbo распознаёт каждый файл, CER против текста → content/audio_qa.json.

Запуск Python'ом с mlx_whisper и jiwer (например, venv «Озвучка Новая версия/.venv»), всегда с -I:
    $PQ_QA_PY -I tools/audio_qa.py                 # проверить новые файлы (уже проверенные с тем же размером пропускаются)
    PQ_TTS_PY=... $PQ_QA_PY -I tools/audio_qa.py --retry   # провалы: seed 43, 44, 45 → лучший CER; не прошло — статус fail
Потом `python3 tools/build_audio.py`: строки со статусом fail в манифесте ведут на старый файл Zosia (если он есть), иначе
не попадают в манифест и звучат через Web Speech, как раньше. Ничего не воспроизводит.

Пороги (research/voices/README.md, этап 2):
  фраза (3+ слова) CER ≤ 0.10, слово или пара слов CER ≤ 0.34 (Whisper плохо узнаёт слова без контекста);
  длительность после обрезки тишины в [0.04·символы + 0.15; 0.25·символы + 1.5] с (медленная версия — верх × 1.4):
  ловит тишину, обрыв и бормотание. CER считается против текста на экране и против `spoken` (числа словами), берётся меньший.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import re
import shutil
import subprocess
import sys
import tempfile
import time
import unicodedata
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
spec = importlib.util.spec_from_file_location('build_audio', HERE / 'build_audio.py')
BA = importlib.util.module_from_spec(spec)
sys.modules['build_audio'] = BA
spec.loader.exec_module(BA)

MODEL = 'mlx-community/whisper-large-v3-turbo'
TH_PHRASE, TH_WORD = 0.10, 0.34
RETRY_SEEDS = (43, 44, 45)


def norm(s: str) -> str:
    s = unicodedata.normalize('NFC', s).lower()
    s = re.sub(r'[^\w\s]', ' ', s)
    return ' '.join(s.split())


def kind_of(text: str) -> str:
    return 'phrase' if len(norm(text).split()) >= 3 else 'word'


def bounds(it) -> tuple[float, float]:
    n = len(it.spoken or it.text)
    hi = 0.25 * n + 1.5
    return 0.04 * n + 0.15, hi * (1.4 if it.rate == BA.SLOW else 1.0)


def transcribe(path: Path) -> str:
    import mlx_whisper
    try:
        r = mlx_whisper.transcribe(str(path), path_or_hf_repo=MODEL, language='pl', temperature=0.0,
                                   condition_on_previous_text=False, verbose=None)
    except Exception as e:  # noqa: BLE001 — пустой/битый файл = провал, а не падение
        print(f'  whisper: {path.name}: {e}', file=sys.stderr)
        return ''
    return r.get('text', '').strip()


spec_al = importlib.util.spec_from_file_location('audio_list', HERE / 'audio_list.py')
AL = importlib.util.module_from_spec(spec_al)
sys.modules['audio_list'] = AL
spec_al.loader.exec_module(AL)
ABBR = {'zł': 'złotych', 'gr': 'groszy', 'r': 'roku', 'proc': 'procent', '%': 'procent'}


def _num_words() -> set[str]:
    """Все слова числительных (количественные и порядковые во всех нужных формах) — для сравнения «число как угодно»."""
    out: set[str] = set()
    for n in range(1, 2101):
        for w in AL.cardinal(n).split():
            out.add(w)
        for case in ('nom', 'gen', 'loc'):
            for w in AL.ordinal(n, case).split():
                out.add(w)
                if w.endswith(('y', 'i')):
                    out.update({w[:-1] + e for e in ('a', 'ej', 'ą', 'e', 'ych', 'ymi', 'emu')} | {w[:-1] + 'iej'})
    out.update('zero dwóch dwu dwiema dwoma trzech trzema czterech czterema pięciu sześciu siedmiu ośmiu dziewięciu dziesięciu jedenastu '
               'dwunastu trzynastu czternastu piętnastu szesnastu siedemnastu osiemnastu dziewiętnastu dwudziestu trzydziestu czterdziestu '
               'pięćdziesięciu sześćdziesięciu siedemdziesięciu osiemdziesięciu dziewięćdziesięciu stu dwustu trzystu czterystu pięciuset '
               'jednego jednej jedną jedna jedno tysiąca tysięcy tysiące'.split())
    return out


NUMW = _num_words()
ROMAN = {'ii', 'iii', 'iv', 'vi', 'vii', 'viii', 'ix', 'xi', 'xii'}  # «II wojna» — Whisper пишет порядковое римскими


def _mask(s: str, digits: bool) -> str:
    """Число (цифрами или словами подряд) → «#»: Whisper пишет «500 zł» на верное «pięćset złotych»."""
    toks = norm(s).split()
    out: list[str] = []
    for t in toks:
        isnum = (t.isdigit() or t in ROMAN) if digits else (t in NUMW or t.isdigit())
        if isnum:
            if not out or out[-1] != '#':
                out.append('#')
        else:
            out.append(ABBR.get(t, t))
    return ' '.join(out)


def score(it, hyp: str, dur: float) -> dict:
    import jiwer
    h = norm(hyp)
    refs = [it.text] + ([it.spoken] if it.spoken else [])
    hyps = [h, norm(AL.numbers_to_words(hyp))]
    cer = min((min(1.0, jiwer.cer(norm(r), x)) if x else 1.0) for r in refs for x in hyps)
    if (re.search(r'\d', hyp) or set(norm(hyp).split()) & ROMAN) and cer > 0:
        # Число в распознанном: сравниваем без самих чисел (как прочитано число, проверено на этапе 2 по годам и датам).
        mh = _mask(hyp, True)
        cer = min(cer, *((min(1.0, jiwer.cer(_mask(r, False), mh)) if mh else 1.0) for r in refs))
    lo, hi = bounds(it)
    th = TH_PHRASE if kind_of(it.text) == 'phrase' else TH_WORD
    ok = cer <= th and lo <= dur <= hi
    why = [] if ok else ([f'CER {cer:.2f} > {th}'] if cer > th else []) + ([f'длительность {dur:.2f} вне [{lo:.2f}; {hi:.2f}]'] if not lo <= dur <= hi else [])
    return {'cer': round(cer, 4), 'dur': round(dur, 3), 'ok': ok, 'why': '; '.join(why), 'hyp': hyp}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--voice', help='голос omni (по умолчанию — из манифеста)')
    ap.add_argument('--retry', action='store_true', help='перегенерировать провалы с seed 43, 44, 45')
    ap.add_argument('--root', type=Path, default=ROOT / 'content')
    ap.add_argument('--out', type=Path, default=ROOT / 'public' / 'audio')
    a = ap.parse_args()

    manifest = BA.load_json(a.out / 'manifest.json') if (a.out / 'manifest.json').exists() else {}
    voice = BA.omni_voice(a.voice) if a.voice else manifest.get('default', BA.DEFAULT_VOICE)
    if not voice.startswith('omni:'):
        print(f'audio_qa: голос {voice} не omni — проверять нечего', file=sys.stderr)
        return 1
    c = BA.collect(a.root, voice)
    items = sorted((it for it in c.items.values() if it.voice == voice), key=lambda i: (i.prio, i.key))
    qp = a.root / BA.QA_FILE
    qa = BA.load_json(qp) if qp.exists() else {}
    if qa.get('voice') != voice:
        qa = {}
    ent: dict[str, dict] = qa.get('entries', {})

    def save() -> None:
        okn = [e for e in ent.values() if e['status'] != 'fail']
        summ = {'n': len(ent), 'ok': sum(1 for e in ent.values() if e['status'] == 'ok'),
                'retry_ok': sum(1 for e in ent.values() if e['status'] == 'retry_ok'),
                'fail': sum(1 for e in ent.values() if e['status'] == 'fail')}
        for k in ('word', 'phrase'):
            v = [e['cer'] for e in ent.values() if e['kind'] == k]
            summ[f'cer_{k}'] = round(sum(v) / len(v), 4) if v else None
            v2 = [e['cer'] for e in okn if e['kind'] == k]
            summ[f'cer_{k}_final'] = round(sum(v2) / len(v2), 4) if v2 else None
        doc = {'v': 1, 'voice': voice, 'model': MODEL,
               'thresholds': {'phrase': TH_PHRASE, 'word': TH_WORD, 'dur': '0.04·n+0.15 … 0.25·n+1.5 (slow ×1.4)', 'retry_seeds': list(RETRY_SEEDS)},
               'summary': summ, 'entries': {k: ent[k] for k in sorted(ent)}}
        body = ',\n'.join(f' {json.dumps(k, ensure_ascii=False)}: {json.dumps(v, ensure_ascii=False)}' for k, v in doc.pop('entries').items())
        head = json.dumps(doc, ensure_ascii=False, indent=1)[:-2]
        qp.write_text(head + ',\n "entries": {\n' + body + '\n }\n}\n', encoding='utf-8')

    # 1. Новые файлы.
    t0, n = time.time(), 0
    for it in items:
        f = a.out / it.file
        if not f.exists():
            continue
        sig = f.stat().st_size
        e = ent.get(it.key)
        if e and e.get('sig') == sig:
            if e['status'] == 'fail' and 'hyp' in e and e.get('seed') == BA.OMNI_SEED:
                # Перепроверка по сохранённому распознаванию (правила сравнения могли смягчиться), без Whisper.
                s = score(it, e['hyp'], e['dur'])
                if s['ok']:
                    e.update(status='ok', cer=s['cer'])
                    e.pop('why', None)
            continue
        s = score(it, transcribe(f), BA.probe_dur(f))
        ent[it.key] = {'file': it.file, 'sig': sig, 'kind': kind_of(it.text), 'cer': s['cer'], 'dur': s['dur'], 'seed': BA.OMNI_SEED,
                       'status': 'ok' if s['ok'] else 'fail', **({'hyp': s['hyp']} if s['cer'] > 0 else {}), **({'why': s['why']} if s['why'] else {})}
        n += 1
        if not s['ok']:
            print(f"  ✗ {it.rate:6} {it.text!r} → {s['hyp']!r} ({s['why']})", flush=True)
        if n % 200 == 0:
            save()
            print(f'audio_qa: {n} проверено, {time.time() - t0:.0f} с', flush=True)
    save()
    print(f'audio_qa: проверено новых {n} за {time.time() - t0:.0f} с')

    # 2. Повторы провалов: seed 43, 44, 45, берём лучший CER.
    if a.retry:
        fails = [it for it in items if ent.get(it.key, {}).get('status') == 'fail' and not ent[it.key].get('retried')]
        print(f'audio_qa: повторов {len(fails)}')
        with tempfile.TemporaryDirectory(prefix='pq-qa-') as td:
            for i, it in enumerate(fails, 1):
                best = None
                for seed in RETRY_SEEDS:
                    tmp = Path(td) / f'{i}_{seed}'
                    tmp.mkdir()
                    cand = tmp / 'x.m4a'
                    try:
                        BA.synth_omni(it, cand, tmp, seed=seed)
                    except (RuntimeError, subprocess.CalledProcessError, OSError) as err:
                        print(f'  ! {it.text}: {err}', file=sys.stderr)
                        continue
                    s = score(it, transcribe(cand), BA.probe_dur(cand))
                    if best is None or (s['ok'], -s['cer']) > (best[1]['ok'], -best[1]['cer']):
                        best = (seed, s, cand)
                    if s['ok'] and s['cer'] == 0:
                        break
                e = ent[it.key]
                e['retried'] = [s for s in RETRY_SEEDS]
                if best and best[1]['ok']:
                    seed, s, cand = best
                    shutil.copyfile(cand, a.out / it.file)
                    e.update(sig=(a.out / it.file).stat().st_size, cer=s['cer'], dur=s['dur'], seed=seed, status='retry_ok')
                    e.pop('why', None)
                    e.pop('hyp', None)
                    if s['cer'] > 0:
                        e['hyp'] = s['hyp']
                    print(f"  ✓ seed {seed}: {it.text!r} CER {s['cer']:.2f}", flush=True)
                else:
                    if best:
                        e['best'] = {'seed': best[0], 'cer': best[1]['cer'], 'hyp': best[1]['hyp'], 'why': best[1]['why']}
                    print(f"  ✗✗ {it.text!r}: после трёх seed провал ({best[1]['why'] if best else 'нет файла'})", flush=True)
                if i % 20 == 0:
                    save()
        for w in BA._omni.values():
            w.close()
        save()
    s = BA.load_json(qp)['summary']
    print(f"audio_qa: {s}")
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
