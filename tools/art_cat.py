"""Рыжий кот Rudy: 16×16, 4 стороны, ходьба, сидит, умывается, спит, нюхает, крадётся и прыгает, лежит на боку. Правый глаз серый."""
from __future__ import annotations

from art_core import Cv, Sheet, P, emit

PARTS = {
    'body': P('cat', r=3, g='cat'), 'head': P('cat', r=2, g='cat'), 'ear': P('cat', r=1, g='cat'), 'tail': P('cat', r=1, g='tail'),
    'cream': P('cat_cream', r=1, g='cat'), 'paw': P('cat_cream', r=1, g='paw'), 'leg': P('cat', r=1, g='leg'),
}
EAR_IN = 'cat_cream.2'
EYE_GRAY = 'tin.3'  # особая примета Rudy: один глаз серо-голубой (фронт: правый для зрителя; профиль: видимый глаз)


def ears_front(c: Cv, y: float = 3.0, cx: float = 8.0, w: float = 3.9) -> None:
    for s in (-1, 1):
        x0 = cx + s * w
        c.poly([[x0 - s * 0.2, y + 2.2], [x0 + s * 0.6, y - 1.4], [x0 - s * 2.2, y + 1.0]], 'ear')


def face_front(c: Cv, y: float = 6.0, cx: float = 8.0) -> None:
    c.ell(cx, y + 1.7, 1.9, 1.3, 'cream')
    c.dot(cx - 2.7, y, 'ink')
    c.dot(cx + 1.7, y, EYE_GRAY)
    c.dot(cx - 0.5, y + 1.0, 'cheek')
    c.dot(cx - 0.5 + 0.0, y + 1.0, 'cheek')
    c.dots([cx - 3, y - 2, cx + 2, y - 2], 'cat_stripe.2')


def stripes_body(c: Cv, pts) -> None:
    c.dots(pts, 'cat_stripe.2')


def cat_down(step: int) -> Cv:
    c = Cv(16, 16, PARTS)
    c.cap(11.4, 13.2, 13.8, 10.6, 0.9, 'tail')
    for s in (-1, 1):
        lift = 1.0 if step == s else 0
        c.rect(8 + s * 2.0 - 1.0, 12.6 - lift * 0.0, 2.0, 2.8 - lift, 'leg')
        c.rect(8 + s * 2.0 - 1.0, 14.0 - lift, 2.0, 1.4, 'paw')
    c.ell(8, 11.2, 3.7, 3.4, 'body')
    c.ell(8, 11.6, 1.7, 2.2, 'cream')
    ears_front(c)
    c.ell(8, 6.2, 4.1, 3.5, 'head')
    face_front(c, 5.6)
    stripes_body(c, [5, 9, 11, 9, 6, 11, 10, 11])
    return c


def cat_up(step: int) -> Cv:
    c = Cv(16, 16, PARTS)
    c.cap(10.6, 12.6, 12.2, 6.6, 1.0, 'tail')
    for s in (-1, 1):
        lift = 1.0 if step == s else 0
        c.rect(8 + s * 2.0 - 1.0, 13.0, 2.0, 2.4 - lift, 'leg')
    c.ell(8, 11.0, 3.8, 3.6, 'body')
    ears_front(c)
    c.ell(8, 6.2, 4.1, 3.5, 'head')
    stripes_body(c, [6, 5, 8, 4, 10, 5, 5, 9, 8, 8, 11, 9, 7, 12, 9, 12])
    return c


def cat_side(step: int) -> Cv:
    """Смотрит вправо; влево — зеркало."""
    c = Cv(16, 16, PARTS)
    c.cap(2.6, 10.0, 1.8, 5.8, 0.95, 'tail'); c.cap(1.8, 5.8, 3.4, 4.2, 0.95, 'tail')
    for k, lx in enumerate((3.8, 6.0, 8.8, 11.0)):
        off = step * (1 if k % 2 == 0 else -1) * 1.2
        lift = 0.8 if (step and off > 0) else 0
        c.rect(lx + off - 0.9, 11.6, 1.9, 3.4 - lift, 'leg')
        c.rect(lx + off - 0.9, 14.0 - lift, 2.4, 1.4, 'paw')
    c.ell(7.4, 10.0, 5.6, 3.3, 'body')
    c.ell(10.0, 11.6, 2.4, 1.4, 'cream')
    c.poly([[10.4, 5.0], [10.8, 2.2], [12.6, 4.0]], 'ear'); c.poly([[12.6, 4.2], [13.8, 2.0], [14.6, 4.8]], 'ear')
    c.ell(12.4, 7.2, 3.1, 2.9, 'head')
    c.ell(14.4, 8.4, 1.3, 1.1, 'cream')
    c.dot(13, 6, EYE_GRAY); c.dot(15, 7, 'cheek')
    stripes_body(c, [4, 8, 6, 7, 8, 8, 10, 8, 5, 10])
    return c


def cat_sit() -> Cv:
    c = Cv(16, 16, PARTS)
    c.cap(11.8, 14.4, 13.8, 12.2, 0.9, 'tail'); c.cap(11.8, 14.6, 7, 14.8, 0.9, 'tail')
    c.ell(8, 11.0, 3.9, 4.2, 'body')
    c.ell(8, 11.0, 1.8, 2.8, 'cream')
    for s in (-1, 1):
        c.rect(8 + s * 1.8 - 1.0, 12.8, 2.0, 2.6, 'paw')
    ears_front(c, 2.4)
    c.ell(8, 6.0, 4.1, 3.4, 'head')
    face_front(c, 5.4)
    stripes_body(c, [5, 10, 11, 10, 5, 12, 11, 12])
    return c


def cat_wash(frame: int) -> Cv:
    c = Cv(16, 16, PARTS)
    dy = 0.8 if frame else 0
    c.cap(11.8, 14.4, 13.8, 12.2, 0.9, 'tail'); c.cap(11.8, 14.6, 7, 14.8, 0.9, 'tail')
    c.ell(8, 11.0 + dy * 0.5, 3.9, 4.2 - dy * 0.3, 'body')
    c.ell(8, 11.4, 1.8, 2.6, 'cream')
    c.rect(9.4, 12.8, 2.0, 2.6, 'paw')
    ears_front(c, 2.4 + dy)
    c.ell(8, 6.0 + dy, 4.1, 3.4, 'head')
    c.cap(6.4, 12.4, 6.8 + frame * 0.6, 8.2 + dy, 1.0, 'paw')
    c.ell(8, 7.6 + dy, 1.9, 1.2, 'cream')
    c.hline(5, 7, 5 + dy, 'ink'); c.hline(9, 11, 5 + dy, EYE_GRAY)
    stripes_body(c, [10, 11, 11, 13])
    return c


def cat_sleep(frame: int) -> Cv:
    c = Cv(16, 16, PARTS)
    b = 0.5 if frame else 0
    c.cap(13.2, 12.8, 10.6, 14.8, 1.0, 'tail')
    c.ell(8.4, 11.6 - b * 0.5, 6.0, 3.6 + b, 'body')
    c.ell(10.4, 12.8, 2.6, 1.4, 'cream')
    c.poly([[3.2, 9.6], [3.4, 7.2], [5.2, 8.6]], 'ear'); c.poly([[5.6, 8.4], [7.0, 6.6], [7.8, 8.8]], 'ear')
    c.ell(5.4, 11.2, 3.0, 2.6, 'head')
    c.hline(3, 5, 11, EYE_GRAY)
    c.dot(2, 12, 'cheek')
    stripes_body(c, [8, 8, 10, 8, 12, 9])
    return c


def side_legs(c: Cv, ys: float = 11.6) -> None:
    for lx in (3.8, 6.0, 8.8, 11.0):
        c.rect(lx - 0.9, ys, 1.9, 15 - ys - 0.6, 'leg')
        c.rect(lx - 0.9, 14.0, 2.4, 1.4, 'paw')


def cat_sniff(frame: int) -> Cv:
    """Профиль вправо, голова опущена к земле: нюхает."""
    c = Cv(16, 16, PARTS)
    b = 0.6 if frame else 0
    c.cap(2.6, 10.0, 1.8, 5.8, 0.95, 'tail'); c.cap(1.8, 5.8, 3.4, 4.2, 0.95, 'tail')
    side_legs(c)
    c.ell(7.0, 10.0, 5.4, 3.3, 'body')
    c.ell(10.0, 11.8, 2.2, 1.3, 'cream')
    c.poly([[10.6, 9.2 + b], [10.8, 6.6 + b], [12.6, 8.2 + b]], 'ear'); c.poly([[12.8, 8.4 + b], [14.0, 6.6 + b], [14.8, 9.2 + b]], 'ear')
    c.ell(12.8, 11.0 + b, 2.9, 2.6, 'head')
    c.ell(14.6, 12.4 + b, 1.2, 0.9, 'cream')
    c.dot(13, 10 + b, EYE_GRAY); c.dot(15, 11 + b, 'cheek')
    stripes_body(c, [4, 8, 6, 7, 8, 8, 10, 8, 5, 10])
    return c


def cat_crouch(frame: int) -> Cv:
    """Профиль вправо, прижался к земле, зад поднят: выслеживает."""
    c = Cv(16, 16, PARTS)
    t = 1 if frame else 0
    c.cap(1.6, 11.2, 0.4, 8.6 - t * 1.4, 0.95, 'tail')
    c.rect(2.4, 12.4, 1.9, 2.4, 'leg'); c.rect(2.4, 14.0, 2.6, 1.4, 'paw')
    c.rect(11.0, 13.2, 1.9, 1.6, 'leg'); c.rect(11.4, 14.0, 2.8, 1.4, 'paw')
    c.ell(7.6, 11.6, 5.0, 2.4, 'body')
    c.ell(3.8, 9.8, 2.6, 3.4, 'body')
    c.ell(10.0, 12.6, 2.0, 1.0, 'cream')
    c.poly([[11.4, 9.4], [11.8, 6.8], [13.4, 8.4]], 'ear'); c.poly([[13.6, 8.6], [14.8, 6.8], [15.4, 9.4]], 'ear')
    c.ell(13.0, 11.0, 2.7, 2.4, 'head')
    c.ell(14.8, 12.2, 1.1, 0.9, 'cream')
    c.dot(13, 10, EYE_GRAY); c.dot(15, 11, 'cheek')
    stripes_body(c, [5, 9, 7, 9, 9, 10, 3, 9])
    return c


def cat_pounce() -> Cv:
    """Профиль вправо, прыжок: тело вытянуто, передние лапы вперёд. Кадр поднят над землёй."""
    c = Cv(16, 16, PARTS)
    c.cap(2.6, 8.0, 0.8, 4.6, 0.95, 'tail')
    c.cap(3.6, 9.6, 1.8, 12.6, 0.95, 'leg'); c.rect(0.8, 12.2, 2.6, 1.4, 'paw')
    c.cap(5.6, 10.0, 4.6, 12.4, 0.95, 'leg')
    c.cap(4.6, 8.8, 10.4, 6.4, 2.5, 'body')
    c.cap(9.6, 8.0, 14.0, 8.6, 0.95, 'leg'); c.rect(13.0, 8.0, 2.6, 1.6, 'paw')
    c.cap(8.8, 8.8, 12.2, 10.2, 0.95, 'leg'); c.rect(11.4, 10.0, 2.4, 1.4, 'paw')
    c.ell(9.4, 8.4, 2.0, 1.4, 'cream')
    c.poly([[10.8, 4.6], [11.0, 1.8], [12.8, 3.4]], 'ear'); c.poly([[13.0, 3.6], [14.2, 1.8], [15.0, 4.4]], 'ear')
    c.ell(12.8, 5.4, 2.9, 2.6, 'head')
    c.ell(14.6, 6.6, 1.2, 1.0, 'cream')
    c.dot(13, 4, EYE_GRAY); c.dot(15, 5, 'cheek')
    stripes_body(c, [5, 8, 7, 6, 9, 6])
    return c


def cat_lie(frame: int) -> Cv:
    """Профиль вправо, лежит на боку, лапы вытянуты, дремлет."""
    c = Cv(16, 16, PARTS)
    b = 0.5 if frame else 0
    c.cap(2.4, 12.6, 0.8, 9.4, 0.95, 'tail')
    c.cap(3.4, 13.8, 0.6, 14.2, 0.9, 'leg'); c.rect(0.0, 13.6, 1.6, 1.4, 'paw')
    c.cap(10.0, 13.8, 14.2, 14.0, 0.9, 'leg'); c.rect(13.4, 13.4, 2.4, 1.6, 'paw')
    c.ell(7.4, 11.8 - b * 0.5, 6.0, 2.9 + b, 'body')
    c.ell(8.6, 13.0, 3.2, 1.2, 'cream')
    c.poly([[10.8, 10.0], [11.2, 7.6], [12.8, 9.2]], 'ear'); c.poly([[13.0, 9.4], [14.2, 7.6], [15.0, 10.2]], 'ear')
    c.ell(12.8, 11.8, 2.9, 2.5, 'head')
    c.ell(14.6, 12.8, 1.1, 0.9, 'cream')
    c.hline(12, 14, 11, EYE_GRAY); c.dot(15, 12, 'cheek')
    stripes_body(c, [4, 9, 6, 9, 8, 10, 10, 10])
    return c


def build() -> None:
    sh = Sheet('cat', 16, 16, anchor=[8, 15])
    d = [sh.add(cat_down(s).render()) for s in (0, -1, 1)]
    u = [sh.add(cat_up(s).render()) for s in (0, -1, 1)]
    r = [sh.add(cat_side(s).render()) for s in (0, -1, 1)]
    l = [sh.flip_of(i) for i in r]
    for name, (a, b, c) in {'down': d, 'up': u, 'right': r, 'left': l}.items():
        sh.anims[f'idle_{name}'] = [a]
        sh.anims[f'walk_{name}'] = [b, a, c, a]
    sh.anims['sit'] = [sh.add(cat_sit().render())]
    sh.anims['wash'] = [sh.add(cat_wash(0).render()), sh.add(cat_wash(1).render())]
    sh.anims['sleep'] = [sh.add(cat_sleep(0).render()), sh.add(cat_sleep(1).render())]
    for name, fn, n in (('sniff', cat_sniff, 2), ('crouch', cat_crouch, 2), ('lie', cat_lie, 2), ('pounce', lambda _=0: cat_pounce(), 1)):
        rs = [sh.add(fn(k).render()) for k in range(n)]
        ls = [sh.flip_of(i) for i in rs]
        sh.anims[f'{name}_right'] = rs
        sh.anims[f'{name}_left'] = ls
    emit(sh)
