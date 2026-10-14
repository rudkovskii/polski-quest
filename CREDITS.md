# CREDITS

Ассеты, лицензии, голоса TTS и инструменты. В публичный репозиторий попадает только CC0 (ТЗ §8.2).

| Что | Автор / источник | Лицензия | Где используется |
|---|---|---|---|
| Ninja Adventure - Asset Pack: тайлы (Floor, Nature, Water, Element, InteriorFloor), палитра, статисты OldMan и Inspector | Pixel-boy и AAA, https://pixel-boy.itch.io/ninja-adventure-asset-pack | CC0 1.0 | `art/vendor/ninja-adventure/` → `public/atlas/ninja16.png`, `custom.png`; список файлов и sha256 архива в `art/vendor/ninja-adventure/SOURCE.txt` |
| Палитра игры (`art/palette.json`) | цвета Ninja Adventure + польские акценты (ТЗ §8.1) | CC0 1.0 | все атласы |
| Дима, бобр Kazik, турникет, табличка «выход», забор, альтанка (черновики sprite-as-data, `art/sprites/*.sprite.json`) | нарисовано для проекта (I-07) | CC0 1.0 | `public/atlas/custom.png`, `ninja16.png` |
| Pillow | Python Imaging Library | MIT-CMU | инструмент сборки (`tools/sprites_build.py`, `tools/palette_extract.py`), в бандл не попадает |
| Голос Zosia (pl-PL), озвучка `public/audio/*.m4a` и `tools/voice_compare/out/say_Zosia/` | Apple, системный голос macOS, генерация `say -v Zosia` → `afconvert` (I-09) | лицензия macOS: системные голоса можно использовать для своих личных некоммерческих проектов; игра личная и некоммерческая | озвучка слов, шагов и реплик NPC в срезе |
| Piper TTS (движок) | rhasspy/piper (MIT, архив) / OHF-Voice piper1-gpl (`pip install piper-tts`, GPL-3.0) | инструмент сборки, в бандл не попадает; лицензия движка на сгенерированное аудио не распространяется | `tools/build_audio.py` (engine `piper`), `tools/voice_compare/` — с этапа 2 (I-24) |
| Голоса Piper `pl_PL-gosia-medium`, `pl_PL-darkman-medium`, `pl_PL-mc_speech-medium` | rhasspy/piper-voices (Hugging Face) | **не проверено**: в I-09 модели не скачивались; лицензию каждого голоса взять из его MODEL_CARD (`tools/voice_compare/build.py` выводит её на страницу) до генерации в I-24 | пока нигде |
