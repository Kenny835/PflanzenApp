"""Konturen in einer gemeinsamen Einheit. Berühren ist erlaubt."""
import math
EPS = 1e-08

def collision(a, b):
    ax, ay, aw, ah = (a['col'], a['row'], a['width'], a['depth'])
    bx, by, bw, bh = (b['col'], b['row'], b['width'], b['depth'])
    ar = a.get('shape') == 'round' and abs(aw - ah) < EPS
    br = b.get('shape') == 'round' and abs(bw - bh) < EPS
    if ar and br:
        return math.hypot(ax + aw / 2 - bx - bw / 2, ay + ah / 2 - by - bh / 2) < (aw + bw) / 2 - EPS
    if ar or br:
        if br:
            return collision(b, a)
        cx, cy = (ax + aw / 2, ay + ah / 2)
        return math.hypot(cx - max(bx, min(cx, bx + bw)), cy - max(by, min(cy, by + bh))) < aw / 2 - EPS
    return ax < bx + bw - EPS and bx < ax + aw - EPS and (ay < by + bh - EPS) and (by < ay + ah - EPS)

class SpatialIndex:
    """Gitter für schnelle Kollisionssuche: Es werden nur Flächen in der Nähe genau geprüft.
    colliding() liefert dieselben Flächen wie ein Vergleich mit allen (eine Fläche kann mehrfach vorkommen, was für
    Auswertungen wie Maximum und Minimum keinen Unterschied macht), ist aber bei vielen Flächen um Größenordnungen schneller."""

    def __init__(self, cell=25.0):
        self.cell = cell
        self.cells = {}

    def _keys(self, x0, y0, x1, y1):
        c = self.cell
        return [(x, y) for x in range(math.floor(x0 / c), math.floor(x1 / c) + 1) for y in range(math.floor(y0 / c), math.floor(y1 / c) + 1)]

    def add(self, a):
        x0, y0 = (a['col'], a['row'])
        x1, y1 = (x0 + a['width'], y0 + a['depth'])
        rec = (x0, y0, x1, y1, a.get('shape') == 'round', a)
        for key in self._keys(x0, y0, x1, y1):
            self.cells.setdefault(key, []).append(rec)

    def colliding(self, a):
        x0, y0 = (a['col'], a['row'])
        x1, y1 = (x0 + a['width'], y0 + a['depth'])
        rounded = a.get('shape') == 'round'
        found = []
        cells = self.cells
        for key in self._keys(x0, y0, x1, y1):
            for bx0, by0, bx1, by1, bround, b in cells.get(key, ()):
                if x0 < bx1 - EPS and bx0 < x1 - EPS and (y0 < by1 - EPS) and (by0 < y1 - EPS):
                    # Die Umrisse überlappen. Bei Rechtecken ist das schon die Kollision, bei Rundem prüft collision() genau.
                    if not (rounded or bround) or collision(a, b):
                        found.append(b)
        return found


def contains(a, x, y):
    if a.get('shape') == 'round' and abs(a['width'] - a['depth']) < EPS:
        return math.hypot(x - a['col'] - a['width'] / 2, y - a['row'] - a['depth'] / 2) <= a['width'] / 2 + EPS
    return a['col'] <= x < a['col'] + a['width'] and a['row'] <= y < a['row'] + a['depth']

def fits(inner, outer):
    """Entire contour inside outer contour; contact with boundary allowed."""
    if inner['col'] < outer.get('col', 0) - EPS or inner['row'] < outer.get('row', 0) - EPS:
        return False
    if inner['col'] + inner['width'] > outer.get('col', 0) + outer['width'] + EPS or inner['row'] + inner['depth'] > outer.get('row', 0) + outer['depth'] + EPS:
        return False
    if outer.get('shape') != 'round':
        return True
    cx = outer.get('col', 0) + outer['width'] / 2
    cy = outer.get('row', 0) + outer['depth'] / 2
    r = outer['width'] / 2
    if inner.get('shape') == 'round':
        return math.hypot(inner['col'] + inner['width'] / 2 - cx, inner['row'] + inner['depth'] / 2 - cy) + inner['width'] / 2 <= r + EPS
    return all((math.hypot(x - cx, y - cy) <= r + EPS for x in (inner['col'], inner['col'] + inner['width']) for y in (inner['row'], inner['row'] + inner['depth'])))
