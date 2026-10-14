#!/usr/bin/env python3
"""Сравнение голосов для озвучки (ТЗ §7.3, I-09). Не входит в бандл игры.

20 эталонных фраз (phrases.json) голосами Zosia (macOS say) и Piper (gosia, darkman, mc_speech),
обычная и медленная версия, страница index.html для прослушивания (открыть файлом в браузере).

    python3 tools/voice_compare/build.py            # что установлено, то и озвучит; остальные голоса пропустит
    python3 tools/voice_compare/build.py --force    # перегенерировать

Piper (бесплатно, локально, без аккаунтов; ~60 МБ на голос):
    python3 -m venv ~/.venvs/piper && ~/.venvs/piper/bin/pip install piper-tts
    mkdir -p ~/.cache/piper && cd ~/.cache/piper
    for v in gosia darkman mc_speech; do
      u=https://huggingface.co/rhasspy/piper-voices/resolve/main/pl/pl_PL/$v/medium
      curl -L -o pl_PL-$v-medium.onnx $u/pl_PL-$v-medium.onnx
      curl -L -o pl_PL-$v-medium.onnx.json $u/pl_PL-$v-medium.onnx.json
      curl -L -o pl_PL-$v-medium.MODEL_CARD $u/MODEL_CARD
    done
    PATH=~/.venvs/piper/bin:$PATH python3 tools/voice_compare/build.py

Лицензию каждого голоса берём из его MODEL_CARD (скрипт выводит её на страницу) и переносим в CREDITS.md.
"""
from __future__ import annotations

import argparse
import html
import json
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
from build_audio import NORMAL, PIPER_MODELS, SLOW, Item, duration, norm, piper_cli, synth  # noqa: E402

VOICES = [
    ('say:Zosia', 'Zosia (macOS say)', 'Apple, голос macOS; аудио для личного некоммерческого использования (лицензия macOS)'),
    ('piper:pl_PL-gosia-medium', 'Piper gosia (жен.)', None),
    ('piper:pl_PL-darkman-medium', 'Piper darkman (муж.)', None),
    ('piper:pl_PL-mc_speech-medium', 'Piper mc_speech (муж.)', None),
]
OUT = HERE / 'out'


def available(voice: str) -> tuple[bool, str]:
    engine, _, vid = voice.partition(':')
    if engine == 'say':
        import shutil

        return (shutil.which('say') is not None and shutil.which('afconvert') is not None, 'нужен macOS')
    if piper_cli() is None:
        return False, 'piper не установлен (инструкция в tools/voice_compare/build.py)'
    if not (PIPER_MODELS / f'{vid}.onnx').exists():
        return False, f'нет модели ~/.cache/piper/{vid}.onnx'
    return True, ''


def model_card(voice: str) -> str | None:
    engine, _, vid = voice.partition(':')
    if engine != 'piper':
        return None
    card = PIPER_MODELS / f'{vid}.MODEL_CARD'
    if not card.exists():
        return None
    text = card.read_text(encoding='utf-8', errors='replace')
    lic = [ln.strip('* -') for ln in text.splitlines() if 'icense' in ln]
    return '; '.join(lic) or text[:300]


def slug(voice: str) -> str:
    return voice.replace(':', '_')


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--force', action='store_true')
    a = ap.parse_args()
    phrases = json.loads((HERE / 'phrases.json').read_text(encoding='utf-8'))['phrases']
    status: dict[str, str] = {}
    made: dict[str, dict[tuple[int, str], tuple[str, float | None]]] = {}
    with tempfile.TemporaryDirectory(prefix='pq-voices-') as td:
        tmp = Path(td)
        for voice, _, _ in VOICES:
            ok, why = available(voice)
            d = OUT / slug(voice)
            files: dict[tuple[int, str], tuple[str, float | None]] = {}
            for i, ph in enumerate(phrases):
                for rate in (NORMAL, SLOW):
                    f = d / f'{i + 1:02d}_{rate}.m4a'
                    if ok and (a.force or not f.exists()):
                        d.mkdir(parents=True, exist_ok=True)
                        try:
                            synth(Item(norm(ph['pl']), voice, rate), f, tmp)
                        except Exception as e:  # noqa: BLE001 — один сбой не валит остальные голоса
                            print(f'  ! {voice} {ph["pl"]} {rate}: {e}', file=sys.stderr)
                            continue
                    if f.exists():
                        files[(i, rate)] = (f.relative_to(HERE).as_posix(), duration(f))
            made[voice] = files
            status[voice] = f'{len(files)} файлов' if files else f'пропущен: {why}'
            print(f'{voice}: {status[voice]}')

    rows = []
    for i, ph in enumerate(phrases):
        cells = []
        for voice, _, _ in VOICES:
            parts = []
            for rate, label in ((NORMAL, '▶'), (SLOW, 'медленно')):
                got = made[voice].get((i, rate))
                if got:
                    src, dur = got
                    parts.append(f'<button data-src="{html.escape(src)}" title="{dur or "?"} с">{label}</button>')
            cells.append(f'<td>{" ".join(parts) or "<span class=no>—</span>"}</td>')
        rows.append(f'<tr><th lang="pl">{html.escape(ph["pl"])}</th><td class=note>{html.escape(ph["note"])}</td>{"".join(cells)}</tr>')
    heads = ''.join(
        f'<th>{html.escape(name)}<small>{html.escape(status[v])}</small><small>{html.escape(model_card(v) or lic or "лицензия: см. MODEL_CARD после установки")}</small></th>'
        for v, name, lic in VOICES
    )
    page = f"""<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Сравнение голосов</title>
<style>
body {{ font: 15px/1.4 -apple-system, BlinkMacSystemFont, sans-serif; margin: 16px; background: #1a1c2c; color: #f4f4f4; }}
h1 {{ font-size: 18px; color: #ffcd75; }} p {{ max-width: 760px; color: #94b0c2; }}
table {{ border-collapse: collapse; }} th, td {{ border: 1px solid #333c57; padding: 6px 8px; vertical-align: top; text-align: left; }}
thead th {{ max-width: 200px; font-weight: 600; }} small {{ display: block; font-weight: 400; font-size: 11px; color: #94b0c2; }}
tbody th {{ font-size: 17px; }} .note {{ font-size: 12px; color: #94b0c2; }} .no {{ color: #566c86; }}
button {{ font: inherit; padding: 6px 10px; margin: 2px; border: 1px solid #f4f4f4; border-radius: 4px; background: #3b5dc9; color: #f4f4f4; cursor: pointer; }}
button.on {{ background: #38b764; }}
</style></head><body>
<h1>Pierogi i Przypadki: какой голос берём на этап 2</h1>
<p>20 фраз из ТЗ §7.3. «▶» — обычная скорость, «медленно» — отдельный медленный прогон (Zosia: say -r 40 и паузы между словами,
она медленнее не умеет; Piper: length_scale 1.35). Послушай строки с носовыми (proszę, ręka, są), шипящими (kasza, szczęście, chrząszcz)
и мягким рядом (Kasia, źle, ciasto). Выбор запиши одной строкой: какой голос для слов и минимальных пар, какие для NPC.</p>
<table><thead><tr><th>Фраза</th><th>Что слушать</th>{heads}</tr></thead><tbody>
{''.join(rows)}
</tbody></table>
<script>
const a = new Audio();
let on = null;
document.addEventListener('click', (e) => {{
  const b = e.target.closest('button[data-src]');
  if (!b) return;
  on?.classList.remove('on'); on = b; b.classList.add('on');
  a.src = b.dataset.src; a.play();
}});
a.addEventListener('ended', () => on?.classList.remove('on'));
</script>
</body></html>
"""
    (HERE / 'index.html').write_text(page, encoding='utf-8')
    print(f'страница: {HERE / "index.html"}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
