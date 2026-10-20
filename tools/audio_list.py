#!/usr/bin/env python3
"""Список строк для озвучки (`content/audio.json`): база A1, игры v2 и всё фиксированное, что игра произносит.

Ничего не воспроизводит. Потом `npm run audio` пишет файлы; чего нет в манифесте, рантайм говорит через Web Speech.

Что входит (prio — порядок генерации: меньше — раньше, прерванный прогон уже озвучил главное):
  0  слова A1 (`w.*`, обычно и медленно), фразы A1 (`p.*`), слова темы «Święta» (`sw.*`, обычно и медленно);
  1  всё, что произносят игры v2 (🔊 вопроса и вариантов, плитки, флаг/герб, озвучка после ответа, карточки) —
     собирает `tools/audio_harvest.spec.ts` в content/audio_harvest.json (`npx vitest run --config tools/audio_harvest.config.ts`);
     плюс «Brawo! Poziom N.» и «Bóbr»;
  2  тексты v2 из данных, которых нет в сборе (справки `about.pl`, `intro.pl`, `history.pl`, обычаи, пожелания, факты…),
     примеры слов A1 и «Święta» (`<id>#ex`);
  3  плитки фраз A1 (`tiles_pl`, `distract_pl`) и любая дата словами («trzeciego maja», барабаны Daty).
Своё слово Шэфа, лемма из словаря в поповере и даты конкретного года («28.03.2027») не входят: это не фиксированный текст игры.

Числа: для голоса цифры переписываются словами (`spoken`, ключ манифеста — по тексту на экране): даты — порядковое
в родительном («3 maja» → «trzeciego maja», «1.06» → «pierwszego czerwca»), годы — «w 1999 roku» → «w tysiąc dziewięćset
dziewięćdziesiątym dziewiątym roku», «od 1918 roku» → «od tysiąc dziewięćset osiemnastego roku», «artykuł 28» → «artykuł
dwudziesty ósmy», «Poziom 7» → «Poziom siedem», «Mieszko I» → «Mieszko Pierwszy».

    python3 tools/audio_list.py              # всё
    python3 tools/audio_list.py --a1-only    # только слова и фразы A1 (как раньше)
"""
from __future__ import annotations

import argparse
import json
import re
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CYR = re.compile('[а-яё]', re.I)


def nfc(s: str) -> str:
    return unicodedata.normalize('NFC', s).strip()


def spoken_text(text: str) -> str:
    """Порт `spokenText` из src/ui/sayButton.ts: пропуски и многоточия → пауза, края без многоточий."""
    s = re.sub(r'\s*(?:_{2,}|\.{3}|…)\s*', ', ', text)
    s = re.sub(r'\s+', ' ', s)
    s = re.sub(r'\s+([,.;:!?])', r'\1', s)
    s = re.sub(r',(\s*,)+', ',', s)
    s = re.sub(r'^[\s,.;:]+|[\s,;:]+$', '', s)
    return s.strip()


def speakable(s: str) -> bool:
    return bool(s) and not CYR.search(s) and bool(re.search(r'[^\W\d_]{2,}', s))


# ───────────────────────────── числа словами ─────────────────────────────

MONTHS_GEN = ['stycznia', 'lutego', 'marca', 'kwietnia', 'maja', 'czerwca', 'lipca', 'sierpnia', 'września', 'października',
              'listopada', 'grudnia']
_CARD = {0: '', 1: 'jeden', 2: 'dwa', 3: 'trzy', 4: 'cztery', 5: 'pięć', 6: 'sześć', 7: 'siedem', 8: 'osiem', 9: 'dziewięć', 10: 'dziesięć',
         11: 'jedenaście', 12: 'dwanaście', 13: 'trzynaście', 14: 'czternaście', 15: 'piętnaście', 16: 'szesnaście', 17: 'siedemnaście',
         18: 'osiemnaście', 19: 'dziewiętnaście'}
_CARD_TENS = {2: 'dwadzieścia', 3: 'trzydzieści', 4: 'czterdzieści', 5: 'pięćdziesiąt', 6: 'sześćdziesiąt', 7: 'siedemdziesiąt',
              8: 'osiemdziesiąt', 9: 'dziewięćdziesiąt'}
_CARD_HUND = {1: 'sto', 2: 'dwieście', 3: 'trzysta', 4: 'czterysta', 5: 'pięćset', 6: 'sześćset', 7: 'siedemset', 8: 'osiemset', 9: 'dziewięćset'}
_ORD = {1: 'pierwszy', 2: 'drugi', 3: 'trzeci', 4: 'czwarty', 5: 'piąty', 6: 'szósty', 7: 'siódmy', 8: 'ósmy', 9: 'dziewiąty', 10: 'dziesiąty',
        11: 'jedenasty', 12: 'dwunasty', 13: 'trzynasty', 14: 'czternasty', 15: 'piętnasty', 16: 'szesnasty', 17: 'siedemnasty',
        18: 'osiemnasty', 19: 'dziewiętnasty'}
_ORD_TENS = {2: 'dwudziesty', 3: 'trzydziesty', 4: 'czterdziesty', 5: 'pięćdziesiąty', 6: 'sześćdziesiąty', 7: 'siedemdziesiąty',
             8: 'osiemdziesiąty', 9: 'dziewięćdziesiąty'}
_ORD_HUND = {1: 'setny', 2: 'dwusetny', 3: 'trzechsetny', 4: 'czterechsetny', 5: 'pięćsetny', 6: 'sześćsetny', 7: 'siedemsetny',
             8: 'osiemsetny', 9: 'dziewięćsetny'}


def cardinal(n: int) -> str:
    """Количественное, именительный (0 < n < 10000)."""
    out = []
    th, n = divmod(n, 1000)
    if th:
        out.append('tysiąc' if th == 1 else f"{_CARD[th]} {'tysiące' if th in (2, 3, 4) else 'tysięcy'}")
    h, n = divmod(n, 100)
    if h:
        out.append(_CARD_HUND[h])
    if n >= 20:
        t, u = divmod(n, 10)
        out.append(_CARD_TENS[t])
        if u:
            out.append(_CARD[u])
    elif n:
        out.append(_CARD[n])
    return ' '.join(out)


def _case(word: str, case: str) -> str:
    """Порядковое мужского рода: им. → род. (-ego/-iego) или предл. (-ym/-im)."""
    if case == 'nom':
        return word
    if word.endswith('i'):  # drugi, trzeci
        return word[:-1] + ('iego' if case == 'gen' else 'im')
    return word[:-1] + ('ego' if case == 'gen' else 'ym')


def ordinal(n: int, case: str = 'nom') -> str:
    """Порядковое (год, номер): в составном склоняются только последние разряды, тысячи и сотни — количественные."""
    th, rest = divmod(n, 1000)
    h, r = divmod(rest, 100)
    parts: list[str] = []
    if th and not rest:
        return _case({1: 'tysięczny', 2: 'dwutysięczny'}.get(th, 'tysięczny'), case)
    if th:
        parts.append('tysiąc' if th == 1 else f"{_CARD[th]} {'tysiące' if th in (2, 3, 4) else 'tysięcy'}")
    if h and not r:
        parts.append(_case(_ORD_HUND[h], case))
        return ' '.join(parts)
    if h:
        parts.append(_CARD_HUND[h])
    if r >= 20:
        t, u = divmod(r, 10)
        parts.append(_case(_ORD_TENS[t], case))
        if u:
            parts.append(_case(_ORD[u], case))
    else:
        parts.append(_case(_ORD[r], case))
    return ' '.join(parts)


_M = '|'.join(MONTHS_GEN)


def numbers_to_words(text: str) -> str:
    """Цифры → слова для голоса (см. докстринг модуля). Текст без цифр и «Mieszko I» возвращается как есть."""
    s = text
    s = re.sub(r'\bMieszko I\b', 'Mieszko Pierwszy', s)
    s = re.sub(r'\bK\+M\+B\b', 'K, M, B', s)
    s = re.sub(r'\bA1\b', 'A jeden', s)

    def dm(d: str, m: str, y: str | None = None) -> str:
        out = f'{ordinal(int(d), "gen")} {MONTHS_GEN[int(m) - 1]}'
        return out + (f' {ordinal(int(y), "gen")} roku' if y else '')

    # 31.12–1.01, 21–22.01, 1–3.05
    s = re.sub(r'\b(\d{1,2})\.(\d{2})\s*[–-]\s*(\d{1,2})\.(\d{2})\b', lambda m: f'od {dm(m[1], m[2])} do {dm(m[3], m[4])}', s)
    s = re.sub(r'\b(\d{1,2})\s*[–-]\s*(\d{1,2})\.(\d{2})\b',
               lambda m: f'od {ordinal(int(m[1]), "gen")} do {dm(m[2], m[3])}', s)
    # 16.05.2027, 1.06
    s = re.sub(r'\b(\d{1,2})\.(\d{2})\.(\d{4})\b', lambda m: dm(m[1], m[2], m[3]), s)
    s = re.sub(r'\b(\d{1,2})\.(\d{2})\b', lambda m: dm(m[1], m[2]), s)
    # 1 września 1939, 3 maja, 1 i 3 maja, Święto Konstytucji 3 Maja
    s = re.sub(rf'\b(\d{{1,2}}) ((?i:{_M}))(?: (\d{{3,4}})\b(?! roku))?',
               lambda m: f"{ordinal(int(m[1]), 'gen')} {m[2]}" + (f" {ordinal(int(m[3]), 'gen')} roku" if m[3] else ''), s)
    s = re.sub(rf'\b(\d{{1,2}})(?= i (?:\d{{1,2}}|[a-ząćęłńóśźż]+) (?i:{_M}))', lambda m: ordinal(int(m[1]), 'gen'), s)
    # w 1999 roku → предложный; прочие «1999 roku» (od, z, w czerwcu …) → родительный
    s = re.sub(r'\b([wW]) (\d{3,4}) roku\b', lambda m: f"{m[1]} {ordinal(int(m[2]), 'loc')} roku", s)
    s = re.sub(r'\b(\d{3,4}) roku\b', lambda m: f"{ordinal(int(m[1]), 'gen')} roku", s)
    s = re.sub(r'\b([Aa]rtykuł) (\d{1,3})\b', lambda m: f"{m[1]} {ordinal(int(m[2]))}", s)
    s = re.sub(r'\b(Poziom) (\d{1,2})\b', lambda m: f'{m[1]} {cardinal(int(m[2]))}', s)
    # остаток: голое число — количественным
    s = re.sub(r'\b\d{1,4}\b', lambda m: cardinal(int(m[0])) or 'zero', s)
    return s


# ───────────────────────────── сбор ─────────────────────────────

V2_SKIP_KEYS = {'id', 'kind', 'type', 'role', 't', 'slot', 'hit', 'src', 'icon', 'tone', 'harvest', 'sprite', 'where', 'rule', 'class',
                'class2', 'img', 'credit', 'meta', 'projection', 'melody', 'uses', 'for', 'seat', 'orchard', 'region', 'regions', 'cities',
                'capital', 'water', 'flows_into', 'mountain', 'link', 'pic', 'decor', 'distract', 'clue', 'words', 'in', 'out', 'answer_ids',
                'phrase', 'wrong_ids', 'gender', 'pos', 'topic', 'author', 'law', 'place', 'drillNext', 'drillSeed', 'order', 'status',
                'authored_by', 'game', 'templates', 'unit', 'item', 'checked', 'tr', 'tr_src', 'text_src', 'title_ru', 'official',
                'season', 'shops', 'compass', 'notes', 'pitch', 'unit', 'key_ru', 'ru', 'forms', 'months', 'to_verify', 'easter', 'tasks'}
ID_LIKE = re.compile(r'^[a-z][a-z0-9_]*(\.[\w-]+)+$')


def v2_texts(doc, skip_forms: bool) -> list[str]:
    """Польские строки данных v2 (справки, обычаи, факты, вопросы, ответы), без служебных полей и id."""
    out: list[str] = []

    def walk(o, key: str | None) -> None:
        if isinstance(o, dict):
            for k, v in o.items():
                if k in V2_SKIP_KEYS and not (k == 'forms' and not skip_forms):
                    continue
                walk(v, k)
        elif isinstance(o, list):
            for v in o:
                walk(v, key)
        elif isinstance(o, str):
            s = nfc(o)
            if '{' in s or ID_LIKE.match(s) or not speakable(s) or re.search(r'https?://', s):
                return
            out.append(s)
    walk(doc, None)
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--a1-only', action='store_true', help='только слова и фразы A1')
    a = ap.parse_args()
    words = json.loads((ROOT / 'content/a1/words.json').read_text(encoding='utf-8'))
    phrases = json.loads((ROOT / 'content/a1/phrases.json').read_text(encoding='utf-8'))
    out: list[dict] = []
    seen: dict[str, dict] = {}

    def add(text: str, prio: int, id_: str | None = None, slow: bool = False) -> None:
        t = nfc(text)
        if not t:
            return
        sp = numbers_to_words(t)
        row = seen.get(t)
        if row is None:
            row = {'pl': t}
            if id_:
                row['id'] = id_
            seen[t] = row
            out.append(row)
        elif id_ and 'id' not in row:
            row['id'] = id_
        if slow:
            row['slow'] = True
        if sp != t:
            row['spoken'] = sp
        row['prio'] = min(row.get('prio', 9), prio)

    for w in words:
        add(w['pl'], 0, w['id'], slow=True)
    for p in phrases:
        add(p['pl'], 0, p['id'])
    if not a.a1_only:
        sw = json.loads((ROOT / 'content/v2/words_swieta.json').read_text(encoding='utf-8'))
        for w in sw:
            add(w['pl'], 0, w['id'], slow=True)
        hp = ROOT / 'content' / 'audio_harvest.json'
        if not hp.exists():
            raise SystemExit('нет content/audio_harvest.json: npx vitest run --config tools/audio_harvest.config.ts')
        for r in json.loads(hp.read_text(encoding='utf-8'))['rows']:
            t = r['text']
            if re.search(r'\b\d{1,2}\.\d{2}\.20\d\d\b', t):  # дата конкретного года (Пасха 2027) — не фиксированный текст
                continue
            add(t, 1)
        for f in ('hymn', 'daty', 'swieta', 'geografia'):
            doc = json.loads((ROOT / f'content/v2/{f}.json').read_text(encoding='utf-8'))
            for t in v2_texts(doc, skip_forms=f != 'geografia'):
                add(spoken_text(t), 2)
        for w in words:
            if (w.get('ex') or {}).get('pl'):
                add(w['ex']['pl'], 2, f"{w['id']}#ex")
        for w in sw:
            if (w.get('ex') or {}).get('pl'):
                add(w['ex']['pl'], 2, f"{w['id']}#ex")
        for p in phrases:
            for t in p.get('tiles_pl', []) + p.get('distract_pl', []):
                add(t, 3)
        daty = json.loads((ROOT / 'content/v2/daty.json').read_text(encoding='utf-8'))
        for m in daty['months']:
            for o in daty['ordinals']:
                if o['n'] <= 31:
                    add(f"{o['gen']} {m['gen']}", 3)
    text = json.dumps({'phrases': out}, ensure_ascii=False, indent=0) + '\n'
    (ROOT / 'content/audio.json').write_text(text, encoding='utf-8')
    by = {}
    for r in out:
        by[r.get('prio', 9)] = by.get(r.get('prio', 9), 0) + 1
    print(f"audio.json: {len(out)} строк ({sum(1 for r in out if r.get('slow'))} с медленной версией, "
          f"{sum(1 for r in out if 'spoken' in r)} с числами словами); по prio: {dict(sorted(by.items()))}")
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
