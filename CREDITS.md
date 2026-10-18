# CREDITS

| Что | Автор / источник | Лицензия | Где |
|---|---|---|---|
| Все спрайты и тайлы (герой, кот, дом, мебель, деревья, земля) | нарисовано для проекта кодом: `tools/art_*.py` → `art/sprites/*.sprite.json`; палитра и свет по подходу жаб на дашборде Шэфа | CC0 1.0 | `public/atlas/` |
| Pillow | Python Imaging Library | MIT-CMU | инструмент сборки (`tools/sprites_build.py`), в бандл не попадает |
| Голос Zosia (pl-PL), озвучка `public/audio/*.m4a` | Apple, системный голос macOS, `say -v Zosia` → `afconvert` | лицензия macOS: системные голоса для личных некоммерческих проектов; игра личная | слова и фразы (F-02, F-03) |
| Piper TTS (движок, необязателен) | rhasspy/piper / OHF-Voice piper1-gpl | инструмент сборки, в бандл не попадает | `tools/build_audio.py` (engine `piper`) |
| Радио (спрайт `radio`) | нарисовано для проекта кодом: `tools/art_props.py` | CC0 1.0 | `public/atlas/` |
| Музыка «Poranek» (`public/music/poranek.m4a`) | «Sunrise over Clear Skies», Sudocolon, https://opengameart.org/content/sunrise | CC0 1.0 | скачано 18.10.2026, перекодировано в AAC 64 кбит/с |
| Музыка «Na farmie» (`farma.m4a`) | «Etirwer (Looped)», Kistol, https://opengameart.org/content/etirwer | CC0 1.0 | скачано 18.10.2026, AAC 56 кбит/с |
| Музыка «Dzień» (`dzien.m4a`) | «School Day» (из набора «School day / Rain / Sun / Loop»), KiluaBoy, https://opengameart.org/content/school-day-rain-sun-loop | CC0 1.0 | скачано 18.10.2026, AAC 56 кбит/с |
| Музыка «Łąki» (`laki.m4a`) | «Sunset Plains», Yoiyami, https://opengameart.org/content/sunset-plains | CC0 1.0 | скачано 18.10.2026, AAC 48 кбит/с |
| Музыка «Wieczór» (`wieczor.m4a`) | «A Small Fire Will Do (Calming Loop)», Cal McEachern (загрузил Trex0n), https://opengameart.org/content/a-small-fire-will-do-calming-loop | CC0 1.0 (автор просит упомянуть, обязательства нет) | скачано 18.10.2026, AAC 56 кбит/с |
| Музыка «Deszcz» (`deszcz.m4a`) | «School Day Rain» (из набора «School day / Rain / Sun / Loop»), KiluaBoy, https://opengameart.org/content/school-day-rain-sun-loop | CC0 1.0 | скачано 18.10.2026, AAC 56 кбит/с |
| Карта Польши `public/maps-art/poland.png`, `poland.json`, `poland_cities.png`, контур `art/geo/poland_outline.json` | Natural Earth 1:10m (admin_0_countries, admin_1_states_provinces, rivers_lake_centerlines, rivers_europe, lakes), https://www.naturalearthdata.com/, копия GeoJSON https://github.com/nvkelso/natural-earth-vector; обработано `tools/art_map.py` (проекция равнопромежуточная с cos 52°) | Public Domain (Natural Earth) | скачано 18.10.2026, 6 слоёв в отдельную папку вне репозитория; координаты городов вне Natural Earth (Toruń, Radom, Częstochowa, Sopot, Zakopane, Płock) — общеизвестные |
| Арт v2: Zagroda, мачта, календарь, настенная карта, сезонная доска, яблоня, улей, подсолнух, клумба, украшения, мини-герой, кот и флажок карты | нарисовано для проекта кодом: `tools/art_world2.py`, `tools/art_map.py` | CC0 1.0 | `public/atlas/`, `public/maps-art/` |
