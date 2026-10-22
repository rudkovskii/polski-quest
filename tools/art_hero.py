"""Героиня по фото Оли: 16×32, 4 стороны × 3 кадра, портрет 32×32.

Очень длинные прямые тёмно-каштановые волосы с карамельными прядями и пробором по центру, карие глаза, розовые губы.
Тёмно-шоколадный приталенный жилет до бёдер с пуговицами, голые руки (золотые часы), кремовые широкие брюки, светлая обувь.
Голова — одна группа (без швов), руки отдельной группой, обувь отдельной. Волосы за спиной рисуются первым слоем.
Профиль (left, right = зеркало) нарисован вручную тонами палитры (HEAD_SIDE, TORSO_SIDE, ARM_SIDE, LEGS_SIDE):
рука против ближней ноги, в шаге корпус опускается на 1 px.
"""
from __future__ import annotations

from art_core import Cv, Sheet, P, emit, single

PARTS = {
    'hair': P('hair', r=3, g='head'), 'skin': P('skin', r=2, g='head'), 'hairb': P('hair', r=3, g='hairb'), 'neck': P('skin', flat=3, g='head'),
    'vest': P('vest', r=3, g='torso'), 'sleeve': P('skin', flat=2, g='arm'), 'hand': P('skin', flat=2, g='arm'),
    'pants': P('pants', r=2, g='legs'), 'shoe': P('shoe', r=1, g='shoe'),
    'handf': P('skin', flat=2, g='arm'), 'can': P('tin', r=2, g='can'), 'sack': P('sack', r=2, g='sack'),
}


def strands(c: Cv, runs) -> None:
    """Карамельные пряди: (x, y0, y1, тон) вертикальными отрезками."""
    for x, y0, y1, t in runs:
        for y in range(y0, y1):
            if c.m[y * c.w + x] in ('hair', 'hairb'):
                c.dot(x, y, f'caramel.{t}')


def legs_front(c: Cv, step: int, cx: float = 8.0) -> None:
    """Широкие брюки и обувь спереди/сзади. step: -1 левая нога приподнята, +1 правая, 0 стоит."""
    for side in (-1, 1):
        lift = 1.2 if step == side else 0
        yb = 29.9 - lift
        o = cx + side * 0.15
        c.poly([[o, 23.0], [o + side * 3.1, 23.0], [o + side * 4.2, yb], [o, yb]], 'pants')
        c.ell(cx + side * 2.6, 30.3 - lift, 2.2, 1.3, 'shoe')
    c.vline(8, 26, 30, 'pants.1')


def arms_front(c: Cv, step: int) -> None:
    for side in (-1, 1):
        sw = -0.9 if step == -side else (0.6 if step == side else 0)
        x = 8 + side * 4.8
        c.cap(x, 16.4, x + side * 0.1, 21.4 + sw, 1.3, 'sleeve')
        c.ell(x + side * 0.1, 22.8 + sw, 1.2, 1.2, 'hand')
        if side == -1:
            c.dot(x, 21.4 + sw, 'gold.3')   # золотые часы


def hair_back_front(c: Cv) -> None:
    """Волосы за плечами, видны по бокам фигуры (первым слоем)."""
    c.poly([[2.6, 8.0], [13.4, 8.0], [13.9, 18.0], [13.2, 22.4], [10.0, 22.9], [6.0, 22.9], [2.8, 22.4], [2.1, 18.0]], 'hairb')


VEST = [[4.5, 16.2], [6.0, 14.8], [10.0, 14.8], [11.5, 16.2], [11.0, 20.4], [11.9, 25.3], [4.1, 25.3], [5.0, 20.4]]


def head_front(c: Cv) -> None:
    c.ell(8, 9.4, 4.7, 5.0, 'skin')
    c.ell(8, 5.4, 5.3, 4.4, 'hair')
    c.ell(8, 3.8, 4.2, 2.6, 'hair')
    # лоб с прямым пробором: волосы расходятся от центра вниз по сторонам
    c.fill(lambda x, y: ((x - 8) / 4.7) ** 2 + ((y - 9.4) / 5.0) ** 2 <= 1 and y > 5.2 + abs(x - 8) * 0.55 and 5.2 < x < 10.8, 'skin', only=['hair'])
    # пряди по бокам лица спадают на грудь
    for s in (-1, 1):
        c.cap(8 + s * 4.2, 11.0, 8 + s * 4.5, 18.6, 1.0, 'hair')
    c.dots([8, 3, 8, 4], 'hair.1')                         # пробор
    c.dots([4, 8, 5, 8, 10, 8, 11, 8], 'hair.0')           # брови
    c.dots([5, 9, 5, 10, 10, 9, 10, 10], 'ink')            # карие глаза
    c.dots([4, 11, 11, 11], 'cheek')
    c.dots([7, 12, 8, 12], 'mouth')
    strands(c, [(4, 5, 8, 2), (11, 5, 8, 2), (4, 12, 17, 2), (11, 13, 18, 2), (3, 8, 11, 3)])


def hero_down(step: int, arms=None, post=None) -> Cv:
    c = Cv(16, 32, PARTS)
    hair_back_front(c)
    legs_front(c, step)
    c.poly(VEST, 'vest')
    c.poly([[6.4, 14.8], [9.6, 14.8], [8.0, 18.6]], 'skin')   # V-вырез
    c.dots([8, 19, 8, 21, 8, 23], 'vest.4')
    (arms or arms_front)(c, step)
    c.rect(6.8, 13.2, 2.4, 2.2, 'skin')
    head_front(c)
    if post:
        post(c)
    return c


def hero_up(step: int, arms=None, post=None) -> Cv:
    c = Cv(16, 32, PARTS)
    legs_front(c, step)
    c.poly(VEST, 'vest')
    (arms or arms_front)(c, step)
    c.rect(6.8, 13.2, 2.4, 2.2, 'skin')
    c.ell(8, 9.4, 4.7, 5.0, 'skin')
    # волосы закрывают голову и спину почти до пояса
    c.ell(8, 7.4, 5.3, 6.2, 'hair')
    c.ell(8, 3.8, 4.2, 2.6, 'hair')
    c.poly([[3.5, 9.0], [12.5, 9.0], [12.9, 17.0], [12.3, 22.0], [10.4, 23.6], [8.6, 22.6], [7.2, 23.8], [5.4, 22.4], [3.7, 22.0], [3.1, 17.0]], 'hair')
    c.vline(8, 4, 21, 'hair.1')
    strands(c, [(5, 6, 12, 2), (11, 8, 14, 2), (6, 13, 20, 2), (10, 14, 21, 2), (4, 11, 17, 3), (12, 12, 19, 3), (8, 15, 20, 3)])
    if post:
        post(c)
    return c


class HCv(Cv):
    """Холст профиля: фигура, нарисованная поверх, снимает ручные тона (накладки) под собой."""

    def fill(self, test, part, only=None):
        for y in range(self.h):
            for x in range(self.w):
                i = y * self.w + x
                if test(x + 0.5, y + 0.5) and (only is None or self.m[i] in only):
                    self.m[i] = part
                    self.ov[i] = None
        return self


# Ручная раскладка тонов (профиль рисуется как пиксель-арт): буква → (часть для контура, тон палитры). '.' пусто.
TONES = {
    'k': ('hair', 'hair.4'), 'K': ('hair', 'hair.3'), 'H': ('hair', 'hair.2'), 'h': ('hair', 'hair.1'), 'D': ('hair', 'hair.0'),
    'a': ('hair', 'caramel.3'), 'A': ('hair', 'caramel.2'), 'z': ('hair', 'caramel.1'),
    'l': ('skin', 'skin.4'), 'L': ('skin', 'skin.3'), 'S': ('skin', 'skin.2'), 's': ('skin', 'skin.1'), 'x': ('skin', 'skin.0'),
    'C': ('skin', 'cheek'), 'E': ('skin', 'ink'), 'W': ('skin', 'eye_white'), 'M': ('skin', 'mouth'),
    't': ('vest', 'vest.4'), 'r': ('vest', 'vest.3'), 'e': ('vest', 'vest.2'), 'w': ('vest', 'vest.1'), 'q': ('vest', 'vest.0'),
    'P': ('pants', 'pants.4'), 'p': ('pants', 'pants.3'), 'o': ('pants', 'pants.2'), 'i': ('pants', 'pants.1'), 'u': ('pants', 'pants.0'),
    'G': ('shoe', 'shoe.3'), 'J': ('shoe', 'shoe.2'), 'j': ('shoe', 'shoe.1'), 'Y': ('shoe', 'shoe.0'),
    'Q': ('skin', 'gold.3'),
}


def paint(c: Cv, rows: list[str], ox: int = 0, oy: int = 0) -> None:
    for y, row in enumerate(rows):
        assert len(row) == 16, row
        for x, ch in enumerate(row):
            if ch == '.':
                continue
            X, Y = x + ox, y + oy
            if 0 <= X < c.w and 0 <= Y < c.h:
                part, tone = TONES[ch]
                c.m[Y * c.w + X] = part
                c.ov[Y * c.w + X] = tone


# Профиль (смотрит влево). Голова y=0…14: волосы с карамельными прядями, лоб, бровь, глаз, нос 1 px, ухо закрыто прядью.
HEAD_SIDE = [
    '................',
    '.....kkKKKh.....',
    '...kKKAHHHHhh...',
    '..kKHHAHAHHHhh..',
    '..KHHHHHAHAHHh..',
    '..KHHHHHAHAHHhh.',
    '..LSHHHHHHAHHhh.',
    '..DDSsHHHHAHHhh.',
    '..SESSsHHAHHHhh.',
    '.SSSSSsHHAHHHh..',
    '..SSCSsHhAHHHh..',
    '..SMSSsHhAHHHh..',
    '...SSSsHhHHHh...',
    '....ssSHhHHh....',
    '.....sSsHHh.....',
]
# Корпус y=14…23: шея, жилет (грудь с пуговицей, талия), длинные волосы за спиной и прядь на груди.
TORSO_SIDE = [
    '.....SsKHHhh....',
    '....KKreeHHh....',
    '....KHrteeAHh...',
    '....KHreeeAHh...',
    '....KHrewwAHh...',
    '....HHrtewwHHh..',
    '....KHrreeeHHh..',
    '....hHeeeeeqHh..',
    '.....hweeeeqhh..',
    '.....wwwwwwqhh..',
]
# Ближняя рука y=15…23 (голая): 0 висит, 1 отведена назад, -1 вынесена вперёд.
ARM_SIDE = {
    0: [
        '.......LS.......',
        '.......LSs......',
        '.......LSs......',
        '.......LSs......',
        '.......LSs......',
        '.......LSs......',
        '.......sQs......',
        '.......LSs......',
        '.......Ss.......',
    ],
    1: [
        '.......LS.......',
        '.......LSs......',
        '........LSs.....',
        '........LSs.....',
        '.........LSs....',
        '.........LSs....',
        '.........sQs....',
        '.........LSs....',
        '..........Ss....',
    ],
    -1: [
        '.......LS.......',
        '.......LSs......',
        '......LSs.......',
        '......LSs.......',
        '.....LSs........',
        '.....LSs........',
        '.....sQs........',
        '.....LSs........',
        '......Ss........',
    ],
}
# Ноги y=24…31 (в шаге корпус опускается на 1 px, ноги с y=25). 0 стоит; -1 ближняя нога впереди; +1 ближняя сзади.
LEGS_SIDE = {
    0: [
        '.....poooi......',
        '.....poooii.....',
        '.....pooiii.....',
        '.....pooiii.....',
        '.....pooiii.....',
        '....GJJjYjj.....',
        '...GJJJjjYjj....',
        '...YYYYYYYYY....',
    ],
    -1: [
        '.....poooii.....',
        '....pooo.uii....',
        '...pooo..uii....',
        '...poo...uiii...',
        '..GJJj....uii...',
        '.GJJJjj..YYjjj..',
        '.YYYYYY..YYYY...',
    ],
    1: [
        '.....iiooop.....',
        '....iii.pooo....',
        '...iii..pooo....',
        '...iii...pooo...',
        '..Yjj.....GJJj..',
        '.Yjjjj...GJJjjj.',
        '.YYYYY...YYYYY..',
    ],
}


def hero_left(step: int, arms=None, post=None) -> Cv:
    c = HCv(16, 32, PARTS)
    dy = 1 if step != 0 else 0
    paint(c, LEGS_SIDE[step], 0, 24 + dy)
    paint(c, TORSO_SIDE, 0, 14 + dy)
    if arms:
        arms(c, step)
    else:
        paint(c, ARM_SIDE[-step], 0, 15 + dy)  # рука против ближней ноги
    paint(c, HEAD_SIDE, 0, dy)
    if post:
        post(c)
    return c


def portrait() -> Cv:
    """32×32: голова и плечи для UI."""
    c = Cv(32, 32, PARTS)
    c.poly([[5.0, 9.0], [27.0, 9.0], [29.0, 20.0], [28.0, 32.0], [4.0, 32.0], [3.0, 20.0]], 'hairb')
    c.poly([[2, 32], [4, 26.0], [9, 23.0], [23, 23.0], [28, 26.0], [30, 32]], 'vest')
    c.poly([[11.0, 23.0], [21.0, 23.0], [16, 30.4]], 'neck')
    c.rect(13.2, 19.0, 5.6, 4.4, 'neck')
    c.ell(16, 13.6, 8.4, 9.2, 'skin')
    c.ell(16, 8.6, 9.6, 7.6, 'hair')
    c.ell(16, 4.8, 7.4, 3.6, 'hair')
    # лоб: волосы расходятся от пробора по центру
    c.fill(lambda x, y: ((x - 16) / 8.4) ** 2 + ((y - 13.6) / 9.2) ** 2 <= 1 and y > 7.4 + abs(x - 16) * 0.62 and 9.6 < x < 22.4, 'skin', only=['hair'])
    # пряди спереди спадают на плечи
    for s in (-1, 1):
        c.cap(16 + s * 8.2, 13.0, 16 + s * 9.4, 27.4, 2.0, 'hair')
    c.vline(16, 1, 6, 'hair.1')
    c.orect(10, 14, 4, 2, 'eye_white'); c.orect(18, 14, 4, 2, 'eye_white')
    c.orect(11, 14, 2, 2, 'hair.3'); c.orect(19, 14, 2, 2, 'hair.3')
    c.dots([12, 14, 20, 14], 'ink')
    c.orect(10, 12, 4, 1, 'hair.0'); c.orect(18, 12, 4, 1, 'hair.0')
    c.orect(9, 18, 2, 1, 'cheek'); c.orect(21, 18, 2, 1, 'cheek')
    c.dots([16, 17, 15, 17], 'skin.1')
    c.orect(14, 20, 4, 1, 'mouth'); c.dots([13, 19, 18, 19], 'cheek')
    c.dots([16, 27, 16, 29, 16, 31], 'vest.4')
    strands(c, [(7, 4, 10, 2), (22, 3, 9, 2), (5, 11, 22, 2), (27, 12, 24, 2), (3, 14, 20, 3), (28, 15, 22, 3), (8, 6, 12, 3), (11, 3, 7, 3), (9, 24, 31, 2), (24, 24, 31, 2)])
    return c


# ───────────────────────────── рабочие позы (F-03): полив, удобрение, ноша, бросок ─────────────────────────────

def sleeve(c: Cv, x0, y0, x1, y1, r: float = 1.5) -> None:
    c.cap(x0, y0, x1, y1, r, 'sleeve')


def hand(c: Cv, x, y, rx: float = 1.3, ry: float = 1.2) -> None:
    c.ell(x, y, rx, ry, 'handf')
    c.dot(x - rx * 0.4, y - ry * 0.4, 'skin.3')


def stream(c: Cv, x: int, y0: int, y1: int) -> None:
    """Струйка воды: сверху светлее, по краю тёмные точки."""
    for k, y in enumerate(range(y0, y1)):
        c.dot(x, y, 'water.4' if k == 0 else ('water.3' if k % 2 else 'water.2'))
        if k % 2 == 1:
            c.dot(x + 1, y, 'water.1')


def spill(c: Cv, x: int, y0: int, n: int = 4) -> None:
    for k in range(n):
        c.dot(x + (k % 2), y0 + k, 'gold.3' if k % 2 == 0 else 'sack.3')
    c.dot(x - 1, y0 + 1, 'sack.3')


def side_arm_front(c: Cv, side: int) -> None:
    x = 8 + side * 5.4
    c.cap(x, 16.2, x + side * 0.1, 21.6, 1.5, 'sleeve')
    c.ell(x + side * 0.1, 23.1, 1.3, 1.2, 'hand')


# вода
def water_front(frame: int):
    def arms(c, step):
        sleeve(c, 2.9, 16.4, 4.8, 21.0); sleeve(c, 13.1, 16.4, 11.2, 21.0)

    def post(c):
        if frame == 0:
            c.rect(5.0, 19.6, 5.6, 4.6, 'can')
            c.poly([[10.6, 20.8], [13.4, 17.8], [14.8, 18.8], [10.6, 22.4]], 'can')
            c.dots([14, 18, 15, 18], 'tin.4')
            c.dots([6, 18, 7, 17, 8, 17, 9, 18], 'tin.1')
        else:
            c.poly([[5.0, 19.4], [10.6, 21.0], [10.6, 25.6], [5.0, 24.0]], 'can')
            c.poly([[10.6, 21.6], [13.8, 23.4], [15.0, 24.6], [10.6, 24.6]], 'can')
            c.dots([6, 18, 7, 18, 8, 19, 9, 19], 'tin.1')
            stream(c, 14, 26, 31)
        hand(c, 4.8, 22.6 if frame == 0 else 22.8); hand(c, 11.2, 23.4 if frame == 0 else 24.8, 1.2, 1.1)
    return arms, post


def water_up(frame: int):
    def arms(c, step):
        sleeve(c, 2.9, 16.4, 4.6, 20.2); sleeve(c, 13.1, 16.4, 11.4, 20.2)

    def post(c):
        hand(c, 5.0, 21.0); hand(c, 11.0, 21.0)
        if frame == 0:
            c.poly([[11.6, 20.0], [13.6, 17.8], [14.8, 18.6], [12.4, 21.4]], 'can')
        else:
            c.poly([[11.6, 20.0], [13.8, 18.4], [14.8, 19.4], [12.4, 21.4]], 'can')
            stream(c, 14, 14, 18)
    return arms, post


def water_left(frame: int):
    def arms(c, step):
        sleeve(c, 8.0, 16.4, 5.4, 21.0)

    def post(c):
        if frame == 0:
            c.rect(2.4, 19.2, 4.4, 4.8, 'can')
            c.poly([[2.4, 21.0], [0.4, 17.8], [0.0, 19.0], [2.4, 22.8]], 'can')
            c.dots([0, 17, 1, 17], 'tin.4')
            c.vline(7, 19, 23, 'tin.1')
            hand(c, 5.8, 22.0)
        else:
            c.poly([[2.6, 20.0], [6.8, 18.6], [6.8, 23.4], [2.6, 24.8]], 'can')
            c.poly([[2.6, 22.6], [0.2, 23.4], [0.0, 25.4], [2.6, 24.8]], 'can')
            c.vline(7, 20, 23, 'tin.1')
            hand(c, 5.8, 22.0)
            stream(c, 0, 26, 31)
    return arms, post


# удобрение
def fert_front(frame: int, up: bool = False):
    def arms(c, step):
        side_arm_front(c, -1)
        sleeve(c, 13.1, 16.4, 14.4, 20.6)

    def post(c):
        if frame == 0:
            c.ell(13.4, 23.8, 2.6, 2.8, 'sack')
        else:
            c.ell(13.6, 22.8, 2.8, 2.5, 'sack')
        c.dot(14, 21 if frame == 0 else 20, 'vest.2'); c.dot(13, 21 if frame == 0 else 20, 'vest.2')
        hand(c, 14.2, 20.4 if frame == 0 else 19.6, 1.2, 1.1)
        if frame == 1:
            c.dots([12, 25], 'sack.1')
            spill(c, 13, 26)
    return arms, post


def fert_left(frame: int):
    def arms(c, step):
        sleeve(c, 8.0, 16.4, 5.0, 19.8)

    def post(c):
        if frame == 0:
            c.ell(3.8, 23.0, 2.7, 2.8, 'sack')
            c.dots([3, 20, 4, 20], 'vest.2'); hand(c, 4.6, 19.6, 1.2, 1.1)
        else:
            c.ell(3.2, 22.0, 2.9, 2.5, 'sack')
            c.dots([4, 19, 5, 19], 'vest.2'); hand(c, 5.2, 18.8, 1.2, 1.1)
            c.dot(2, 24, 'sack.1')
            spill(c, 2, 25)
    return arms, post


# ноша над головой
def carry_arms_front(c, step):
    sleeve(c, 3.0, 16.4, 1.4, 4.4, 1.3); sleeve(c, 13.0, 16.4, 14.6, 4.4, 1.3)


def carry_post_front(c):
    hand(c, 1.4, 2.0, 1.3, 1.4); hand(c, 14.6, 2.0, 1.3, 1.4)


def carry_arms_left(c, step):
    sleeve(c, 8.0, 16.4, 7.0, 4.4, 1.5)


def carry_post_left(c):
    hand(c, 6.6, 1.6, 1.7, 1.4)


# бросок: руки вперёд-вверх
def throw_arms_front(c, step):
    sleeve(c, 2.9, 16.4, 1.2, 10.8, 1.3); sleeve(c, 13.1, 16.4, 14.8, 10.8, 1.3)


def throw_post_front(c):
    hand(c, 1.0, 9.0, 1.3, 1.4); hand(c, 15.0, 9.0, 1.3, 1.4)


def throw_arms_left(c, step):
    sleeve(c, 7.6, 17.0, 5.0, 15.0, 1.5)


def throw_post_left(c):
    sleeve(c, 6.6, 16.4, 2.8, 12.6, 1.4)
    hand(c, 1.2, 11.2, 1.4, 1.3)


def build() -> None:
    sh = Sheet('hero', 16, 32, anchor=[8, 31], anims={})
    idx = {}
    for d, fn in (('down', hero_down), ('up', hero_up), ('left', hero_left)):
        idx[d] = [sh.add(fn(s).render()) for s in (0, -1, 1)]
    idx['right'] = [sh.flip_of(i) for i in idx['left']]
    for d, (a, b, c) in idx.items():
        sh.anims[f'idle_{d}'] = [a]
        sh.anims[f'walk_{d}'] = [b, a, c, a]

    # новые кадры только в конец листа
    fn = {'down': hero_down, 'up': hero_up, 'left': hero_left}

    def add_pose(name: str, frames: dict) -> None:
        """frames: {сторона: [(step, arms, post), ...]}; right = зеркало left."""
        ids = {}
        for d in ('down', 'up', 'left'):
            ids[d] = [sh.add(fn[d](step, arms, post).render()) for step, arms, post in frames[d]]
        ids['right'] = [sh.flip_of(i) for i in ids['left']]
        for d, lst in ids.items():
            sh.anims[f'{name}_{d}'] = lst

    def two(down, up, left):
        return {'down': [(0, *down(0)), (0, *down(1))], 'up': [(0, *up(0)), (0, *up(1))],
                'left': [(0, *left(0)), (0, *left(1))]}

    add_pose('water', two(water_front, water_up, water_left))
    add_pose('fert', two(lambda f: fert_front(f), lambda f: fert_front(f, True), fert_left))
    carry = {'down': (carry_arms_front, carry_post_front), 'up': (carry_arms_front, carry_post_front),
             'left': (carry_arms_left, carry_post_left)}
    add_pose('carry_idle', {d: [(0, *carry[d])] for d in carry})
    # carry_walk: ноги как у walk (b, a, c, a), руки подняты
    ids = {}
    for d in ('down', 'up', 'left'):
        ids[d] = [sh.add(fn[d](st, *carry[d]).render()) for st in (-1, 0, 1)]
    ids['right'] = [sh.flip_of(i) for i in ids['left']]
    for d, (b, a, c) in ids.items():
        sh.anims[f'carry_walk_{d}'] = [b, a, c, a]
    throw = {'down': (throw_arms_front, throw_post_front), 'up': (throw_arms_front, throw_post_front),
             'left': (throw_arms_left, throw_post_left)}
    add_pose('throw', {d: [(0, *carry[d]), (0, *throw[d])] for d in carry})
    emit(sh)
    single('hero_portrait', portrait().render(), anchor=[16, 31])
