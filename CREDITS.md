# CREDITS

| Что | Автор / источник | Лицензия | Где |
|---|---|---|---|
| Все спрайты и тайлы (герой, кот, дом, мебель, деревья, земля) | нарисовано для проекта кодом: `tools/art_*.py` → `art/sprites/*.sprite.json`; палитра и свет по подходу жаб на дашборде Шэфа | CC0 1.0 | `public/atlas/` |
| Pillow | Python Imaging Library | MIT-CMU | инструмент сборки (`tools/sprites_build.py`), в бандл не попадает |
| Голос Zosia (pl-PL), озвучка `public/audio/*.m4a` | Apple, системный голос macOS, `say -v Zosia` → `afconvert` | лицензия macOS: системные голоса для личных некоммерческих проектов; игра личная | слова и фразы (F-02, F-03) |
| Piper TTS (движок, необязателен) | rhasspy/piper / OHF-Voice piper1-gpl | инструмент сборки, в бандл не попадает | `tools/build_audio.py` (engine `piper`) |
