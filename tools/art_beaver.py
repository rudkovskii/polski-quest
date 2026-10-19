"""Бобёр (`beaver`, 16×16): ходит в 4 стороны, сидит, умывается, грызёт веточку, плавает, выглядывает из воды, ныряет, бежит.
Плюс постройки: хатка-żeremie (`beaver_lodge`, 32×32) и пруд (`beaver_pond`, 32×48, 2 кадра: рябь).

Материалы только существующие (палитра не растёт): мех `wood_dark`, светлое брюхо и мордочка `loose`, хвост `soil`,
резцы `cream`, ветки `wood`/`trunk`/`plank`, вода `water`/`glass`, берег `dirt`/`grass`/`stone`.
Свет сверху-слева, как у кота (art_cat.py). Спрайт смотрит вправо, влево — зеркало (`flip`).
"""
from __future__ import annotations

from art_core import Cv, Sheet, P, emit, single

PARTS = {
    'body': P('loose', r=3, g='fur'), 'head': P('loose', r=2, g='fur'), 'ear': P('wood_dark', r=1, g='fur'),
    'belly': P('sack', r=2, g='fur'), 'muzzle': P('sack', r=1, g='fur'),
    'leg': P('loose', r=1, g='fur'), 'paw': P('wood_dark', r=1, g='fur'), 'foot': P('wood_dark', r=1, g='fur'),
    'tail': P('soil', r=2, g='tail'),
    'stick': P('wood', r=1, g='stick'),
}
TOOTH = 'cream.3'
SCALE = 'soil_wet.2'  # чешуйки хвоста
RIP = 'water.3'
RIP2 = 'water.4'


# ───────────────────────────── ходьба ─────────────────────────────

def tail_down(c: Cv, y: float = 14.3) -> None:
    """Плоский хвост-лопата виден из-под зада (вид спереди — выглядывает сзади-снизу)."""
    c.ell(8, y, 3.6, 1.1, 'tail')
    c.dots([6, y - 0.2, 8, y + 0.4, 10, y - 0.2], SCALE)


def beaver_down(step: int) -> Cv:
    c = Cv(16, 16, PARTS)
    tail_down(c)
    for s in (-1, 1):
        lift = 1.0 if step == s else 0
        c.ell(8 + s * 3.0, 14.2 - lift, 1.7, 1.1, 'foot')
    c.ell(8, 10.8, 4.0, 3.6, 'body')
    c.ell(8, 11.6, 2.4, 2.4, 'belly')
    for s in (-1, 1):
        c.ell(8 + s * 3.9, 10.6, 0.9, 1.5, 'leg')
    for s in (-1, 1):
        c.ell(8 + s * 4.0, 3.6, 1.2, 1.2, 'ear')
    c.ell(8, 6.4, 4.5, 3.3, 'head')
    c.ell(8, 8.0, 2.3, 1.5, 'muzzle')
    c.dots([5, 5, 10, 5], 'ink')
    c.dots([7, 7, 8, 7], 'ink')
    c.dots([7, 9, 8, 9, 7, 8, 8, 8], TOOTH)
    return c


def beaver_up(step: int) -> Cv:
    c = Cv(16, 16, PARTS)
    for s in (-1, 1):
        lift = 1.0 if step == s else 0
        c.ell(8 + s * 3.0, 14.4 - lift, 1.7, 1.0, 'foot')
    c.ell(8, 10.2, 4.6, 4.2, 'body')
    for s in (-1, 1):
        c.ell(8 + s * 3.7, 3.7, 1.15, 1.15, 'ear')
    c.ell(8, 6.2, 4.0, 3.3, 'head')
    c.ell(8, 12.4, 3.5, 2.5, 'tail')
    c.dots([6, 11, 8, 11, 10, 11, 7, 13, 9, 13, 8, 14], SCALE)
    return c


def side_body(c: Cv, bob: float = 0.0, run: bool = False) -> None:
    """Корпус, голова, мордочка, хвост (смотрит вправо)."""
    c.ell(2.2, 12.6 + bob, 3.0, 1.9, 'tail')  # хвост-лопата, торчит назад-вниз
    c.dots([1, 12 + bob, 3, 12 + bob, 2, 13 + bob, 1, 14 + bob], SCALE)
    c.ell(7.4, 10.2 + bob, 5.7, 3.9, 'body')
    c.ell(8.6, 12.0 + bob, 3.5, 1.7, 'belly')


def side_head(c: Cv, dx: float = 0.0, dy: float = 0.0, eye: bool = True) -> None:
    c.ell(10.6 + dx, 4.4 + dy, 1.2, 1.2, 'ear')
    c.ell(11.8 + dx, 7.0 + dy, 3.3, 2.9, 'head')
    c.ell(14.1 + dx, 8.4 + dy, 1.7, 1.4, 'muzzle')
    if eye:
        c.dot(12.4 + dx, 6.0 + dy, 'ink')
    c.dot(15.4 + dx, 7.4 + dy, 'ink')
    c.dot(14.0 + dx, 9.8 + dy, TOOTH)


def beaver_side(step: int) -> Cv:
    c = Cv(16, 16, PARTS)
    bob = -0.6 if step else 0.0
    for k, lx in enumerate((4.0, 6.2, 9.0, 11.2)):
        off = step * (1 if k % 2 == 0 else -1) * 1.2
        lift = 0.8 if (step and off > 0) else 0
        c.ell(lx + off, 14.2 - lift, 1.6, 1.0, 'foot' if k < 2 else 'paw')
    side_body(c, bob)
    side_head(c, 0, bob)
    return c


def beaver_run(step: int) -> Cv:
    """Бежит, пригнувшись: корпус вытянут, лапы разлетаются."""
    c = Cv(16, 16, PARTS)
    a = 1.6 if step == 0 else -1.6
    c.ell(2.2, 11.0, 2.8, 1.4, 'tail')
    c.dots([1, 11, 3, 11], SCALE)
    c.ell(5.0 - a, 14.2, 2.0, 1.0, 'foot')
    c.ell(7.4 + a, 14.4, 1.9, 1.0, 'foot')
    c.ell(10.8 - a, 14.2, 1.6, 1.0, 'paw')
    c.ell(13.2 + a * 0.8, 14.2, 1.6, 1.0, 'paw')
    c.ell(7.4, 10.6, 6.2, 3.3, 'body')
    c.ell(8.8, 12.0, 3.6, 1.4, 'belly')
    c.ell(11.0, 5.6, 1.1, 1.1, 'ear')
    c.ell(12.0, 7.7, 3.3, 2.7, 'head')
    c.ell(14.4, 9.0, 1.6, 1.3, 'muzzle')
    c.dot(12.6, 6.8, 'ink'); c.dot(15.5, 8.1, 'ink'); c.dot(14.2, 10.3, TOOTH)
    return c


# ───────────────────────────── на месте ─────────────────────────────

def beaver_sit(side: bool = False) -> Cv:
    """Сидит столбиком, лапки на пузе. Вид спереди (смотрит на героя) или сбоку."""
    c = Cv(16, 16, PARTS)
    if not side:
        c.ell(8, 14.6, 3.8, 1.0, 'tail')
        c.dots([6, 14.4, 8, 14.8, 10, 14.4], SCALE)
        c.ell(8, 10.8, 4.4, 4.2, 'body')
        c.ell(8, 11.8, 2.6, 2.7, 'belly')
        for s in (-1, 1):
            c.ell(8 + s * 3.0, 14.2, 1.6, 1.0, 'foot')
        for s in (-1, 1):
            c.ell(8 + s * 1.4, 10.2, 1.1, 1.0, 'paw')
        for s in (-1, 1):
            c.ell(8 + s * 3.6, 2.8, 1.15, 1.15, 'ear')
        c.ell(8, 5.4, 4.0, 3.3, 'head')
        c.ell(8, 7.0, 2.3, 1.5, 'muzzle')
        c.dots([5, 4, 10, 4, 7, 6, 8, 6], 'ink')
        c.dots([7, 8, 8, 8], TOOTH)
    else:
        c.ell(2.6, 13.6, 2.8, 1.2, 'tail')
        c.dots([1, 13, 3, 13.4], SCALE)
        c.ell(6.6, 10.6, 4.4, 4.4, 'body')
        c.ell(8.2, 11.6, 2.4, 2.8, 'belly')
        c.ell(5.0, 14.4, 2.2, 1.0, 'foot')
        c.ell(9.6, 14.4, 1.8, 1.0, 'paw')
        c.ell(10.0, 9.8, 1.0, 1.1, 'paw')
        side_head(c, -1.0, -1.6)
    return c


def beaver_wash(frame: int) -> Cv:
    c = Cv(16, 16, PARTS)
    dy = 0.6 if frame else 0.0
    c.ell(8, 14.6, 3.8, 1.0, 'tail')
    c.dots([6, 14.4, 8, 14.8, 10, 14.4], SCALE)
    c.ell(8, 10.8 + dy * 0.4, 4.4, 4.2 - dy * 0.3, 'body')
    c.ell(8, 11.8, 2.6, 2.6, 'belly')
    for s in (-1, 1):
        c.ell(8 + s * 3.0, 14.2, 1.6, 1.0, 'foot')
    for s in (-1, 1):
        c.ell(8 + s * 3.6, 2.8 + dy, 1.15, 1.15, 'ear')
    c.ell(8, 5.4 + dy, 4.0, 3.3, 'head')
    c.ell(8, 7.0 + dy, 2.3, 1.5, 'muzzle')
    c.dots([5, 4 + dy, 10, 4 + dy], 'ink')
    c.cap(5.6, 11.0, 6.4 + frame * 0.8, 7.0 + dy, 1.0, 'paw')  # лапка у мордочки
    c.ell(9.8, 10.2, 1.1, 1.0, 'paw')
    return c


def beaver_gnaw(frame: int) -> Cv:
    """Сидит боком, держит веточку обеими лапками и грызёт; кадры: голова вверх-вниз, ветка качнулась."""
    c = Cv(16, 16, PARTS)
    c.ell(2.6, 13.8, 2.8, 1.2, 'tail')
    c.dots([1, 13, 3, 13.4], SCALE)
    c.ell(6.4, 10.6, 4.4, 4.4, 'body')
    c.ell(8.0, 11.8, 2.3, 2.7, 'belly')
    c.ell(4.8, 14.4, 2.2, 1.0, 'foot')
    c.ell(9.4, 14.4, 1.8, 1.0, 'paw')
    dy = 0.8 if frame else 0.0
    side_head(c, -1.2, -0.6 + dy)
    # веточка поперёк мордочки: правый конец с острым скосом, левый торчит за лапками
    y = 9.0 + dy * 0.6 - (0.6 if frame else 0)
    c.cap(8.6, y + 1.2, 14.8, y - 0.2, 0.75, 'stick')
    c.dots([10, y - 0.6, 12, y - 0.9], 'wood.4')
    c.ell(9.4, 10.2, 1.2, 1.0, 'paw')
    c.ell(11.6, 9.8, 1.1, 1.0, 'paw')
    if frame:
        c.dots([15, 8.4 + dy, 14, 11.6], 'wood.3')  # щепки
    return c


# ───────────────────────────── вода ─────────────────────────────

def ripples(c: Cv, y: float, wide: float = 6.0, phase: int = 0) -> None:
    for x0, x1 in ((8 - wide, 8 - wide + 3), (8 + wide - 3, 8 + wide)):
        c.hline(x0 + (1 if phase else 0), x1 + (1 if phase else 0), int(y), RIP2)
    c.hline(8 - wide + 2, 8 + wide - 2, int(y) + 1, RIP)


def beaver_swim(frame: int) -> Cv:
    """Плывёт вправо: над водой голова и спина, ниже ватерлинии рябь."""
    c = Cv(16, 16, PARTS)
    bob = 0.5 if frame else 0.0
    c.ell(6.6, 12.0 + bob, 4.6, 2.0, 'body')
    c.cap(2.4, 12.6, 3.6, 12.6, 0.9, 'tail')
    c.ell(10.6, 7.8 + bob, 1.1, 1.1, 'ear')
    c.ell(11.6, 9.6 + bob, 3.0, 2.6, 'head')
    c.ell(14.0, 10.8 + bob, 1.7, 1.3, 'muzzle')
    c.dot(12.2, 8.8 + bob, 'ink'); c.dot(15.4, 9.8 + bob, 'ink')
    c.clear(lambda x, y: y > 13.2)
    ripples(c, 13, 6.6, frame)
    return c


def beaver_peek(frame: int) -> Cv:
    """Выглядывает: над водой только глаза, нос и ушки."""
    c = Cv(16, 16, PARTS)
    dy = 0.0 if frame == 0 else 0.7
    for s in (-1, 1):
        c.ell(8 + s * 3.7, 8.6 + dy, 1.15, 1.15, 'ear')
    c.ell(8, 11.0 + dy, 4.0, 3.2, 'head')
    c.ell(8, 12.2 + dy, 2.3, 1.2, 'muzzle')
    c.dots([5, 10 + dy, 10, 10 + dy], 'ink')
    c.dots([7, 11.5 + dy, 8, 11.5 + dy], 'ink')
    c.clear(lambda x, y: y > 12.6 + dy * 0.0)
    ripples(c, 13, 5.2, frame)
    return c


def beaver_dive() -> Cv:
    """Нырнул: круги по воде и хвост-лопата шлёпает над ними."""
    c = Cv(16, 16, PARTS)
    c.cap(7.6, 10.4, 8.4, 8.2, 2.0, 'tail')
    c.ell(8.4, 8.4, 2.6, 2.0, 'tail')
    c.dots([7, 8, 9, 8, 8, 9], SCALE)
    c.clear(lambda x, y: y > 11.2)
    c.hline(4, 12, 12, RIP2)
    c.hline(2, 5, 13, RIP); c.hline(11, 14, 13, RIP)
    c.hline(6, 10, 13, RIP2)
    c.dots([5, 10, 11, 9, 13, 11], RIP2)
    return c


def flipped(sh: Sheet, i: int) -> int:
    return sh.flip_of(i)


def build_beaver() -> None:
    sh = Sheet('beaver', 16, 16, anchor=[8, 15])
    f = sh.add
    f(beaver_down(0).render()); f(beaver_down(-1).render()); f(beaver_down(1).render())  # 0 1 2
    f(beaver_up(0).render()); f(beaver_up(-1).render()); f(beaver_up(1).render())  # 3 4 5
    f(beaver_side(0).render()); f(beaver_side(1).render()); f(beaver_side(-1).render())  # 6 7 8 вправо
    for i in (6, 7, 8):
        sh.flip_of(i)  # 9 10 11 влево
    f(beaver_sit().render())  # 12
    f(beaver_wash(0).render()); f(beaver_wash(1).render())  # 13 14
    f(beaver_gnaw(0).render()); f(beaver_gnaw(1).render())  # 15 16
    sh.flip_of(15); sh.flip_of(16)  # 17 18
    f(beaver_swim(0).render()); f(beaver_swim(1).render())  # 19 20
    sh.flip_of(19); sh.flip_of(20)  # 21 22
    f(beaver_peek(0).render()); f(beaver_peek(1).render())  # 23 24
    f(beaver_dive().render())  # 25
    f(beaver_run(0).render()); f(beaver_run(1).render())  # 26 27
    sh.flip_of(26); sh.flip_of(27)  # 28 29
    f(beaver_sit(True).render())  # 30
    sh.flip_of(30)  # 31
    sh.anims = {
        'idle_down': [0], 'walk_down': [1, 0, 2, 0], 'idle_up': [3], 'walk_up': [4, 3, 5, 3],
        'idle_right': [6], 'walk_right': [7, 6, 8, 6], 'idle_left': [9], 'walk_left': [10, 9, 11, 9],
        'sit': [12], 'wash': [13, 14], 'gnaw_right': [15, 16], 'gnaw_left': [17, 18],
        'swim_right': [19, 20], 'swim_left': [21, 22], 'peek': [23, 24], 'dive': [25],
        'run_right': [26, 27], 'run_left': [28, 29], 'sit_right': [30], 'sit_left': [31],
    }
    emit(sh)


# ───────────────────────────── хатка и пруд ─────────────────────────────

LODGE_PARTS = {
    'twig': P('wood', r=2, g='twig'), 'twig2': P('wood_dark', r=2, g='twig'), 'twig3': P('plank', r=2, g='twig'),
    'mud': P('dirt', r=3, g='mud'), 'hole': P('shade', flat=0, noline=True),
}


def lodge() -> None:
    """Кучка веток 2×2 клетки: купол из палочек, сверху глина, низ — тёмный лаз, у лаза ветки лежат внахлёст."""
    c = Cv(32, 32, LODGE_PARTS)
    c.ell(16, 21.5, 15.2, 10.4, 'mud')
    c.rect(1, 21, 30, 10, 'mud')
    c.clear(lambda x, y: y < 21.5 and ((x - 16) / 15.2) ** 2 + ((y - 21.5) / 10.4) ** 2 > 1)
    # палочки по куполу: короткие отрезки разного наклона и тона
    sticks = [
        (4, 24, 11, 21, 'twig'), (9, 20, 17, 18, 'twig2'), (14, 17, 22, 17, 'twig'), (19, 19, 27, 22, 'twig3'),
        (6, 17, 12, 15, 'twig3'), (12, 13, 19, 14, 'twig2'), (17, 11, 24, 14, 'twig3'), (21, 15, 28, 17, 'twig'),
        (3, 28, 9, 26, 'twig2'), (10, 25, 17, 23, 'twig3'), (18, 24, 25, 26, 'twig2'), (23, 27, 29, 25, 'twig'),
        (8, 15, 14, 11, 'twig'), (13, 9, 19, 8, 'twig'), (5, 21, 8, 18, 'twig2'), (24, 20, 28, 20, 'twig3'),
    ]
    for x1, y1, x2, y2, p in sticks:
        c.cap(x1, y1, x2, y2, 1.1, p, only=('mud', 'twig', 'twig2', 'twig3'))
    # торчащие концы наверху
    for x1, y1, x2, y2, p in ((11, 8, 14, 5, 'twig2'), (16, 7, 17, 3, 'twig'), (20, 8, 24, 6, 'twig3'), (7, 12, 5, 9, 'twig')):
        c.cap(x1, y1, x2, y2, 0.9, p)
    # лаз
    c.ell(19, 28.2, 4.2, 3.2, 'hole')
    c.rect(14.8, 28, 8.4, 3.6, 'hole')
    c.clear(lambda x, y: y >= 31.5)
    g = c.render()
    # глина по макушке и щелям: светлые пятна света
    for x, y in ((9, 19), (15, 15), (21, 13), (13, 22), (7, 25)):
        if g[y][x]:
            g[y][x] = 'dirt.3'
    single('beaver_lodge', g, anchor=[16, 31])


POND_PARTS = {
    'bank': P('dirt', r=2, g='bank'), 'water': P('water', r=3, g='w', noline=True),
    'rock': P('stone', r=1, g='rock'), 'grass': P('grass', r=1, g='gr'),
}


def pond_frame(phase: int) -> list:
    """Пруд 2×3 клетки: овал воды, глиняный бережок, камушки, осока. phase двигает блики на воде."""
    c = Cv(32, 48, POND_PARTS)
    c.ell(16, 25, 15.4, 22.6, 'bank')
    c.ell(16, 25, 13.2, 20.4, 'water')
    g = c.render(ring=True)
    # свет и рябь: у воды рампа не строится (noline), поэтому тона раскладываем сами по расстоянию от берега
    for y in range(48):
        for x in range(32):
            if c.m[y * 32 + x] == 'water':
                d = ((x + 0.5 - 16) / 13.2) ** 2 + ((y + 0.5 - 25) / 20.4) ** 2
                tone = 'water.1' if d > 0.78 else 'water.2'
                if x + y < 22 and d > 0.5:
                    tone = 'water.3'
                g[y][x] = tone
    # блики
    marks = ([(9, 14), (10, 14), (20, 22), (21, 22), (12, 33), (13, 33), (22, 36)] if phase == 0 else [(10, 16), (11, 16), (19, 20), (20, 20), (13, 31), (14, 31), (21, 37)])
    for x, y in marks:
        g[y][x] = 'water.4'
    for x, y in ((14, 24), (15, 24), (16, 24), (17, 45)) if phase == 0 else ((15, 25), (16, 25), (17, 25), (16, 46)):
        if g[y][x] and g[y][x].startswith('water'):
            g[y][x] = 'water.3'
    # камушки и осока по берегу
    for cx, cy, r in ((3.5, 10, 1.7), (28.5, 16, 1.5), (27, 40, 1.9), (5, 38, 1.5)):
        for y in range(48):
            for x in range(32):
                if (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r:
                    g[y][x] = 'stone.3' if (x + y) % 2 == 0 else 'stone.2'
    for x, y in ((5, 8), (6, 7), (6, 9), (26, 18), (27, 17), (25, 20), (24, 42), (25, 41), (8, 42), (9, 41)):
        g[y][x] = 'leaf.3'
    for x, y in ((6, 8), (26, 19), (25, 42), (9, 42)):
        g[y][x] = 'leaf.2'
    return g


def pond() -> None:
    sh = Sheet('beaver_pond', 32, 48, anchor=[16, 47])
    sh.add(pond_frame(0))
    sh.add(pond_frame(1))
    sh.anims = {'ripple': [0, 1]}
    emit(sh)


def build() -> None:
    build_beaver()
    lodge()
    pond()


if __name__ == '__main__':
    import sys
    from pathlib import Path
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from PIL import Image
    from sprites_build import load_palette
    from art_core import SHEETS
    build()
    pal = load_palette()
    sc = 12
    out = Path(sys.argv[1] if len(sys.argv) > 1 else 'beaver_preview.png')
    bg = (186, 214, 140, 255)
    sheets = [SHEETS['beaver'], SHEETS['beaver_lodge'], SHEETS['beaver_pond']]
    cells = [(g, 'b') for g in sheets[0].grids()] + [(g, 'x') for s in sheets[1:] for g in s.grids()]
    W = 1500
    x = y = row = 0
    placed = []
    for g, _ in cells:
        w, h = len(g[0]), len(g)
        sw, sh_ = w * sc, h * sc
        if x + sw + 8 > W:
            x, y, row = 0, y + row + 8, 0
        placed.append((g, x, y))
        x += sw + 8
        row = max(row, sh_)
    img = Image.new('RGBA', (W, y + row + 8), bg)
    px = img.load()
    for g, ox, oy in placed:
        for yy, r in enumerate(g):
            for xx, ch in enumerate(r):
                if not ch:
                    continue
                rgb = pal.names[ch]
                for dy in range(sc):
                    for dx in range(sc):
                        px[ox + xx * sc + dx, oy + yy * sc + dy] = (*rgb, 255)
    img.save(out)
    print(out)
