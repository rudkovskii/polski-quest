#!/usr/bin/env python3
"""Воркер OmniVoice (k2-fsa, MLX через mlx-audio): модель грузится один раз, токены референса кешируются.

Запускает `tools/build_audio.py` (движок `omni`) и `tools/audio_qa.py` (повторы с другим seed) Python'ом из `PQ_TTS_PY`
(venv с mlx-audio 0.5.8, например `Озвучка Новая версия/models/voxcpm2/.venv`), всегда с `-I`:

    $PQ_TTS_PY -I tools/tts_omni_worker.py --ref-audio ref.wav --ref-text "..."

Протокол JSONL, stdin → stdout (одна строка JSON на сообщение, всё прочее — в stderr):
  старт:   {"ready": true, "model": "...", "sr": 24000, "ref": "<sha1[:8] референса>"}
  запрос:  {"id": "...", "text": "...", "out_path": "/abs/x.wav", "seed": 42, "dur_mult": 1.0,
            "duration_s": null, "instruct": null, "ref_audio": null, "ref_text": null}
           dur_mult — множитель длительности от оценки модели (медленная версия: 1.35; одно-два слова ещё × WORD_MULT);
           в конец текста без знака препинания для синтеза ставится точка (короткое слово без неё клон глотает);
           duration_s — явная длительность (перебивает оценку); instruct — голос «по описанию» (только без референса);
           ref_audio/ref_text — другой референс для этого запроса (иначе стартовый; "" — без референса).
  ответ:   {"id": "...", "ok": true, "path": "...", "dur": 1.23, "est": 0.98, "sec": 1.4}
           {"id": "...", "ok": false, "error": "..."}
Только пишет wav (24 кГц, PCM 16), ничего не воспроизводит.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
import sys
import time
from pathlib import Path

MODEL = 'mlx-community/OmniVoice-bfloat16'
WORD_MULT = 1.2


def log(*a: object) -> None:
    print(*a, file=sys.stderr, flush=True)


def ref_hash(audio: str | Path, text: str) -> str:
    h = hashlib.sha1(Path(audio).read_bytes())
    h.update(text.strip().encode('utf-8'))
    return h.hexdigest()[:8]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--model', default=MODEL)
    ap.add_argument('--ref-audio', default='')
    ap.add_argument('--ref-text', default='')
    ap.add_argument('--steps', type=int, default=32)
    ap.add_argument('--guidance', type=float, default=2.0)
    ap.add_argument('--cache', default='', help='папка для кеша токенов референса (.npy)')
    a = ap.parse_args()

    import mlx.core as mx
    import numpy as np
    import soundfile as sf
    from mlx_audio.tts.models.omnivoice.duration import RuleDurationEstimator
    from mlx_audio.tts.models.omnivoice.utils import create_voice_clone_prompt
    from mlx_audio.tts.utils import load_model

    t0 = time.time()
    model = load_model(a.model)
    sr = int(model.sample_rate)
    est = RuleDurationEstimator()
    cache_dir = Path(a.cache) if a.cache else None
    refs: dict[str, tuple[object, str]] = {}

    def ref_tokens(audio: str, text: str):
        """Токены референса: в памяти, потом в .npy по хэшу (файл + текст)."""
        if not audio:
            return None, None
        h = ref_hash(audio, text)
        if h in refs:
            return refs[h][0], text
        tok = None
        npy = cache_dir / f'omni_ref_{h}.npy' if cache_dir else None
        if npy and npy.exists():
            tok = mx.array(np.load(npy))
        else:
            tok = create_voice_clone_prompt(audio, tokenizer=model.audio_tokenizer, ref_text=text)
            mx.eval(tok)
            if npy:
                npy.parent.mkdir(parents=True, exist_ok=True)
                np.save(npy, np.array(tok))
        refs[h] = (tok, text)
        return tok, text

    default_ref = ref_tokens(a.ref_audio, a.ref_text) if a.ref_audio else (None, None)
    rh = ref_hash(a.ref_audio, a.ref_text) if a.ref_audio else ''
    # прогрев
    mx.random.seed(0)
    for _ in model.generate(text='Dzień dobry.', language='pl', num_steps=8, ref_tokens=default_ref[0], ref_text=default_ref[1]):
        pass
    log(f'omni: {a.model} готов за {time.time() - t0:.1f} с, ref {rh or "—"}')
    print(json.dumps({'ready': True, 'model': a.model, 'sr': sr, 'ref': rh}), flush=True)

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        req: dict = {}
        try:
            req = json.loads(line)
            text = str(req['text']).strip()
            # Без точки в конце клон на коротком слове молчит или бормочет (этап 2: CER слов 0.38 → 0.06 с точкой).
            if not re.search(r'[.!?…]$', text):
                text += '.'
            # Одно-два слова — чуть длиннее оценки модели (×1.2): иначе «chrząszcz» глотается.
            word_mult = WORD_MULT if len(text.split()) <= 2 else 1.0
            out = Path(req['out_path'])
            if 'ref_audio' in req and req['ref_audio'] is not None:
                tok, rtext = ref_tokens(req['ref_audio'], req.get('ref_text') or '')
            else:
                tok, rtext = default_ref
            # Оценка длительности как в mlx-audio (≈ 25 токенов/с), медленная версия — растянуть.
            raw = est.estimate_duration(text, 'Nice to meet you.', 25)
            est_s = max(10, int(raw * 1.15)) / 25
            dur = req.get('duration_s') or est_s * word_mult * float(req.get('dur_mult') or 1.0)
            kw = dict(text=text, language='pl', num_steps=a.steps, guidance_scale=a.guidance, duration_s=math.ceil(dur * 25) / 25)
            if tok is not None:
                kw.update(ref_tokens=tok, ref_text=rtext)
            elif req.get('instruct'):
                kw['instruct'] = req['instruct']
            mx.random.seed(int(req.get('seed', 42)))
            t1 = time.time()
            parts = [np.array(r.audio, dtype=np.float32) for r in model.generate(**kw)]
            audio = np.concatenate(parts) if parts else np.zeros(1, dtype=np.float32)
            out.parent.mkdir(parents=True, exist_ok=True)
            sf.write(str(out), np.clip(audio, -1, 1), sr, subtype='PCM_16')
            resp = {'id': req.get('id'), 'ok': True, 'path': str(out), 'dur': round(audio.shape[0] / sr, 3),
                    'est': round(est_s, 3), 'sec': round(time.time() - t1, 3)}
        except Exception as e:  # noqa: BLE001 — воркер не падает на одной строке
            resp = {'id': req.get('id'), 'ok': False, 'error': f'{type(e).__name__}: {e}'}
        print(json.dumps(resp, ensure_ascii=False), flush=True)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
