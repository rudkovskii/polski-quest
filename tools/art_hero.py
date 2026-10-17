"""Герой по фото Шэфа: 16×32, 4 стороны × 3 кадра, портрет 32×32.

Короткие тёмно-русые волосы с зачёсом вверх, короткая борода, светло-голубая рубашка, тёмно-синий пиджак и брюки,
коричневый ремень и ботинки. Голова — одна группа (без швов), руки отдельной группой, ботинки отдельной.
"""
from __future__ import annotations

from art_core import Cv, Sheet, P, emit, single

PARTS = {
    'hair': P('hair', r=3, g='head'), 'skin': P('skin', r=2, g='head'), 'beard': P('beard', r=2, g='head'),
    'shirt': P('shirt', r=2, g='torso'), 'blazer': P('blazer', r=3, g='torso'), 'belt': P('belt', r=1, g='torso'),
    'sleeve': P('blazer', r=2, g='sleeve'), 'hand': P('skin', r=1, g='hand'),
    'trouser': P('trouser', r=3, g='legs'), 'boot': P('boot', r=1, g='boot'),
}


def legs_front(c: Cv, step: int, cx: float = 8.0) -> None:
    """Штаны и ботинки спереди/сзади. step: -1 левая нога приподнята, +1 правая, 0 стоит."""
    for side, sx in ((-1, cx - 2.0), (1, cx + 2.0)):
        lift = 1.2 if step == side else 0
        c.rect(sx - 1.9, 23.0, 3.8, 6.9 - lift, 'trouser')
        c.ell(sx + side * 0.2, 30.2 - lift, 2.4, 1.4, 'boot')
    c.vline(8, 25, 30, 'trouser.1')


def arms_front(c: Cv, step: int) -> None:
    for side in (-1, 1):
        sw = -0.9 if step == -side else (0.6 if step == side else 0)
        x = 8 + side * 5.4
        c.cap(x, 16.2, x + side * 0.1, 21.6 + sw, 1.5, 'sleeve')
        c.ell(x + side * 0.1, 23.1 + sw, 1.3, 1.2, 'hand')


def head_front(c: Cv) -> None:
    c.ell(8, 9.2, 5.2, 5.4, 'skin')
    c.ell(2.9, 9.8, 0.9, 1.4, 'skin'); c.ell(13.1, 9.8, 0.9, 1.4, 'skin')
    c.ell(8, 5.6, 5.5, 4.5, 'hair')
    c.ell(8.8, 3.4, 4.0, 2.5, 'hair')
    c.fill(lambda x, y: ((x - 8) / 5.2) ** 2 + ((y - 9.2) / 5.4) ** 2 <= 1 and y > 7.2 and 4.7 < x < 11.3, 'skin', only=['hair'])
    c.poly([[3.5, 10.2], [4.5, 13.2], [8, 15.0], [11.5, 13.2], [12.5, 10.2], [11.4, 11.8], [8, 12.7], [4.6, 11.8]], 'beard', only=['skin'])
    c.rect(5.8, 11.0, 4.4, 1.0, 'beard', only=['skin'])
    c.dots([5, 9, 10, 9], 'ink')
    c.dots([7, 12, 8, 12], 'mouth')


def hero_down(step: int) -> Cv:
    c = Cv(16, 32, PARTS)
    legs_front(c, step)
    c.rect(4.8, 22.0, 6.4, 1.8, 'belt')
    c.rect(4.2, 15.0, 7.6, 7.2, 'shirt')
    c.poly([[2.8, 16.2], [4.4, 14.6], [6.4, 14.6], [7.2, 20.4], [6.6, 23.9], [3.2, 23.9]], 'blazer')
    c.poly([[13.2, 16.2], [11.6, 14.6], [9.6, 14.6], [8.8, 20.4], [9.4, 23.9], [12.8, 23.9]], 'blazer')
    c.dot(8, 22.6, 'gold.3')
    arms_front(c, step)
    c.rect(6.2, 13.4, 3.6, 2.2, 'skin')
    head_front(c)
    return c


def hero_up(step: int) -> Cv:
    c = Cv(16, 32, PARTS)
    legs_front(c, step)
    c.poly([[2.8, 16.2], [4.4, 14.6], [11.6, 14.6], [13.2, 16.2], [12.8, 23.9], [3.2, 23.9]], 'blazer')
    arms_front(c, step)
    c.rect(6.2, 13.2, 3.6, 2.2, 'skin')
    c.ell(8, 9.2, 5.2, 5.4, 'skin')
    c.ell(2.9, 9.8, 0.9, 1.4, 'skin'); c.ell(13.1, 9.8, 0.9, 1.4, 'skin')
    c.ell(8, 7.6, 5.5, 6.4, 'hair')
    c.ell(8.0, 3.4, 4.2, 2.5, 'hair')
    c.rect(4.6, 11.6, 6.8, 2.2, 'skin', only=['hair'])
    c.vline(8, 17, 23, 'blazer.1')
    return c


def hero_left(step: int) -> Cv:
    c = Cv(16, 32, PARTS)
    for side in (1, -1):
        off = step * side * 1.6
        lift = 0.8 if (step != 0 and off > 0) else 0.0
        c.rect(6.2 + off, 23.0, 3.8, 6.9 - lift, 'trouser')
        c.ell(6.9 + off, 30.2 - lift, 3.0, 1.4, 'boot')
    c.rect(5.0, 22.0, 6.4, 1.8, 'belt')
    c.poly([[5.0, 16.0], [6.6, 14.6], [9.6, 14.6], [11.0, 16.0], [11.0, 23.9], [5.0, 23.9]], 'blazer')
    c.rect(5.0, 15.2, 1.4, 6.8, 'shirt')
    c.dot(5, 22.6, 'gold.3')
    sw = -step * 1.6
    c.cap(8 + sw * 0.4, 16.4, 8 + sw, 21.8, 1.6, 'sleeve')
    c.ell(8 + sw, 23.2, 1.3, 1.2, 'hand')
    c.rect(6.4, 13.4, 3.2, 2.2, 'skin')
    c.ell(7.8, 9.2, 4.9, 5.4, 'skin')
    c.ell(9.6, 9.8, 0.9, 1.4, 'skin')
    c.ell(8.6, 5.6, 5.2, 4.5, 'hair')
    c.ell(7.4, 3.4, 3.9, 2.5, 'hair')
    c.fill(lambda x, y: ((x - 7.8) / 4.9) ** 2 + ((y - 9.2) / 5.4) ** 2 <= 1 and y > 7.2 and x < 9.0, 'skin', only=['hair'])
    c.rect(9.0, 6.6, 3.8, 5.2, 'hair', only=['skin', None, 'hair'])
    c.poly([[2.9, 10.4], [3.8, 13.0], [6.6, 14.9], [9.2, 13.4], [9.2, 10.2], [6.2, 11.8]], 'beard', only=['skin'])
    c.rect(3.0, 11.0, 2.6, 1.0, 'beard', only=['skin'])
    c.rect(2.0, 9.4, 1.4, 1.6, 'skin')
    c.dot(4, 9, 'ink')
    return c


def portrait() -> Cv:
    """32×32: голова и плечи для UI."""
    c = Cv(32, 32, PARTS)
    c.poly([[1, 32], [3, 25.4], [8, 22.6], [24, 22.6], [29, 25.4], [31, 32]], 'blazer')
    c.poly([[12, 22.6], [20, 22.6], [17.6, 32], [14.4, 32]], 'shirt')
    c.rect(12.4, 19.6, 7.2, 4.0, 'skin')
    c.ell(16, 13.2, 9.4, 9.8, 'skin')
    c.ell(6.8, 14.0, 1.8, 2.8, 'skin'); c.ell(25.2, 14.0, 1.8, 2.8, 'skin')
    c.ell(16, 8.0, 10.2, 8.0, 'hair')
    c.ell(17.6, 3.4, 8.0, 3.2, 'hair')
    c.fill(lambda x, y: ((x - 16) / 9.4) ** 2 + ((y - 13.2) / 9.8) ** 2 <= 1 and y > 10.6 and 8.4 < x < 23.6, 'skin', only=['hair'])
    c.poly([[6.8, 15.0], [8.6, 20.6], [16, 24.2], [23.4, 20.6], [25.2, 15.0], [23.0, 18.6], [16, 20.6], [9.0, 18.6]], 'beard', only=['skin'])
    c.rect(11.4, 17.6, 9.2, 1.8, 'beard', only=['skin'])
    c.orect(10, 13, 4, 2, 'eye_white'); c.orect(18, 13, 4, 2, 'eye_white')
    c.orect(11, 13, 2, 2, 'ink'); c.orect(19, 13, 2, 2, 'ink')
    c.orect(10, 11, 4, 1, 'hair.1'); c.orect(18, 11, 4, 1, 'hair.1')
    c.orect(15, 20, 2, 1, 'mouth')
    return c


def build() -> None:
    sh = Sheet('hero', 16, 32, anchor=[8, 31], anims={})
    idx = {}
    for d, fn in (('down', hero_down), ('up', hero_up), ('left', hero_left)):
        idx[d] = [sh.add(fn(s).render()) for s in (0, -1, 1)]
    idx['right'] = [sh.flip_of(i) for i in idx['left']]
    for d, (a, b, c) in idx.items():
        sh.anims[f'idle_{d}'] = [a]
        sh.anims[f'walk_{d}'] = [b, a, c, a]
    emit(sh)
    single('hero_portrait', portrait().render(), anchor=[16, 31])
