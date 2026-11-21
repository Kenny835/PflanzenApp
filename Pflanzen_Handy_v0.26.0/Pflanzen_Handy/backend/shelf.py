"""Regal: eine maßstäbliche Arbeitsfläche mit festen, gleich großen Ebenen.

Aufbau
- Das Regal ist ein Standort vom Typ 'shelf' (Einheit cm) mit der Beschreibung `shelf`:
  {'levels': n, 'width': Breite je Ebene, 'depth': Tiefe je Ebene, 'gap': Abstand, 'pad': Rand, 'enabled': [bool, ...]}.
- Jede eingeschaltete Ebene ist eine Zone "Ebene n" (mit shelf_level) und liegt in der Ansicht untereinander.
  Töpfe, Trays und Pflanzen stehen direkt auf dem Regal, aber nur innerhalb einer eingeschalteten Ebene. Dadurch lassen
  sich Objekte mit der gewohnten Bedienung zwischen den Ebenen ziehen, ohne den Umweg über den Parkplatz.
- Ausgeschaltete Ebenen sind nicht sichtbar. Ihre Behälter kommen samt Inhalt auf den Parkplatz, die übrigen Ebenen
  rücken zusammen. Die Gesamtgröße des Regals im Standort bleibt gleich.
"""
import math

import geometry

MAX_LEVELS = 8
DEFAULT_LEVELS = 8
DEFAULT_GAP = 4.0
PAD = 2.0
EPS = 1e-08


def _num(value, name, low, high):
    try:
        n = float(value)
    except (TypeError, ValueError):
        raise ValueError(name + ': bitte eine Zahl angeben.')
    if not math.isfinite(n) or not low <= n <= high:
        raise ValueError(f'{name}: {low:g} bis {high:g}.')
    return n


def clean_meta(v):
    """Prüft die Regalbeschreibung (aus Anfrage oder Vorlage) und ergänzt Standardwerte."""
    levels = _num(v.get('levels', DEFAULT_LEVELS), 'Anzahl der Ebenen', 1, MAX_LEVELS)
    if not float(levels).is_integer():
        raise ValueError('Anzahl der Ebenen: ganze Zahl von 1 bis %d.' % MAX_LEVELS)
    levels = int(levels)
    enabled = v.get('enabled')
    if enabled is None:
        enabled = [True] * levels
    if not isinstance(enabled, list) or len(enabled) != levels:
        raise ValueError('Ungültige Angabe, welche Ebenen eingeschaltet sind.')
    enabled = [e is True or e in ('true', 'on', 1, '1') for e in enabled]
    if not any(enabled):
        raise ValueError('Mindestens eine Ebene muss eingeschaltet bleiben.')
    return {'levels': levels, 'width': _num(v.get('width'), 'Breite je Ebene', 1, 3000), 'depth': _num(v.get('depth'), 'Tiefe je Ebene', 1, 3000),
            'gap': _num(v.get('gap', DEFAULT_GAP), 'Abstand zwischen den Ebenen', 0, 100), 'pad': PAD, 'enabled': enabled}


def outer_size(meta):
    """Maße der Innenansicht: alle Ebenen übereinander, unabhängig davon, welche eingeschaltet sind.
    Das ist NICHT der Platzbedarf im Raum, siehe base_size()."""
    return (meta['width'] + 2 * meta['pad'], meta['levels'] * meta['depth'] + (meta['levels'] - 1) * meta['gap'] + 2 * meta['pad'])


def base_size(meta):
    """Grundfläche des Regals im Raum (Platzbedarf auf der übergeordneten Fläche): Breite und Tiefe EINER Ebene.
    Die Ebenen liegen im Regal übereinander, nicht hintereinander."""
    return (meta['width'], meta['depth'])


def regions(meta):
    """Die sichtbaren Ebenen von oben nach unten, dicht untereinander."""
    out = []
    for n, on in enumerate(meta['enabled'], start=1):
        if on:
            out.append({'level': n, 'col': meta['pad'], 'row': meta['pad'] + len(out) * (meta['depth'] + meta['gap']), 'width': meta['width'], 'depth': meta['depth']})
    return out


def _box(area):
    return {'col': float(area['col']), 'row': float(area['row']), 'width': float(area['width']), 'depth': float(area['depth'])}


def region_of(meta, area):
    """Ebene, in der die Fläche ganz liegt, sonst None."""
    box = _box(area)
    return next((r for r in regions(meta) if geometry.fits(box, r)), None)


def check_placement(loc, area):
    """Auf einem Regal darf nur innerhalb einer eingeschalteten Ebene abgelegt werden."""
    meta = loc.get('shelf')
    if meta and region_of(meta, area) is None:
        raise ValueError('Auf dem Regal nur innerhalb einer eingeschalteten Ebene ablegen. Zwischen den Ebenen ist kein Platz.')


def guard_edit(old, typ, width, depth):
    """Typ und Grundfläche eines Regals ändern sich nur über neues Anlegen, sonst passen die Ebenen nicht mehr."""
    meta = old.get('shelf')
    if not meta:
        if typ == 'shelf':
            raise ValueError('Ein vorhandener Behälter lässt sich nicht in ein Regal umwandeln. Bitte ein neues Regal anlegen.')
        return
    if typ != 'shelf':
        raise ValueError('Ein Regal lässt sich nicht in eine andere Objektart umwandeln.')
    w, d = base_size(meta)
    same = abs(width - w) < 1e-6 and abs(depth - d) < 1e-6
    turned = abs(width - d) < 1e-6 and abs(depth - w) < 1e-6
    if not (same or turned):
        raise ValueError('Die Grundfläche eines Regals ergibt sich aus der Größe seiner Ebenen. Für andere Maße bitte ein neues Regal anlegen.')


def inner_dims(meta):
    """Felder der Innenansicht (maßstäbliche Fläche mit allen Ebenen)."""
    width, depth = outer_size(meta)
    return {'unit': 'cm', 'width_cm': width, 'depth_cm': depth, 'rows': math.ceil(depth), 'cols': math.ceil(width)}


def migrate(s, c):
    """Regale aus 0.14.0 bis 0.14.2 belegten im Raum die Gesamtgröße aller Ebenen. Jetzt gilt die Grundfläche einer Ebene.
    Idempotent: ein Regal mit richtiger Grundfläche bleibt unberührt."""
    import workspace as w
    changed = 0
    for loc in s.allrows(c, 'locations'):
        meta = loc.get('shelf')
        if not meta:
            continue
        width, depth = base_size(meta)
        if w.orientation(loc) % 2:
            width, depth = depth, width
        want = {'width': width, 'depth': depth, 'unit': 'cm'}
        if loc.get('footprint') == want:
            continue
        loc['footprint'] = want
        s.put(c, 'locations', loc, loc['id'])
        for cell in s.allrows(c, 'cells'):
            if cell.get('container_id') == loc['id'] and cell.get('mode') == 'container':
                cell['width'], cell['depth'] = width, depth
                s.put(c, 'cells', cell, cell['id'])
        changed += 1
    return changed


def level_zones(c, s, shelf_id):
    return [z for z in s.allrows(c, 'zones') if z.get('location_id') == shelf_id and z.get('shelf_level')]


def sync_zones(s, c, loc):
    """Legt für jede eingeschaltete Ebene die Zone "Ebene n" an bzw. passt sie an, entfernt die übrigen."""
    meta = loc['shelf']
    wanted = {r['level']: r for r in regions(meta)}
    have = {z['shelf_level']: z for z in level_zones(c, s, loc['id'])}
    for level, zone in have.items():
        if level not in wanted:
            c.execute('DELETE FROM records WHERE id=?', (zone['id'],))
    for level, r in wanted.items():
        area = {'col': r['col'], 'row': r['row'], 'width': r['width'], 'depth': r['depth']}
        if level in have:
            zone = have[level]
            zone['areas'] = [area]
            s.put(c, 'zones', zone, zone['id'])
        else:
            s.put(c, 'zones', {'location_id': loc['id'], 'name': 'Ebene %d' % level, 'group_id': '', 'water_cm': '', 'notes': '', 'color': '', 'areas': [area], 'shelf_level': level})


def set_levels(s, c, v):
    """Ebenen ein- oder ausschalten. Behälter auf ausgeschalteten Ebenen kommen samt Inhalt auf den Parkplatz,
    die übrigen Ebenen rücken zusammen. Alles in einer Transaktion (und damit rückgängig zu machen)."""
    import planner_qol
    import workspace as w
    loc = w.checked(s, c, 'locations', v['id'], v['version'])
    old = loc.get('shelf')
    if not old:
        raise ValueError('Dieses Objekt ist kein Regal.')
    new = clean_meta({**old, 'enabled': v.get('enabled')})
    old_regions = {r['level']: r for r in regions(old)}
    new_regions = {r['level']: r for r in regions(new)}
    parked = 0
    for cell in s.allrows(c, 'cells'):
        if cell['location_id'] != loc['id']:
            continue
        level = next((n for n, r in old_regions.items() if geometry.fits(_box(cell), r)), None)
        if level in new_regions:
            shift = new_regions[level]['row'] - old_regions[level]['row']
            if abs(shift) > EPS:
                cell['row'] = float(cell['row']) + shift
                s.put(c, 'cells', cell, cell['id'])
            continue
        # Ebene ausgeschaltet: Behälter und Pflanzen auf den Parkplatz, reine Flächenmarkierungen entfernen.
        if cell.get('container_id'):
            planner_qol.park_container(s, c, s.get(c, 'locations', cell['container_id']))
            parked += 1
        elif cell.get('plant_id') and cell['mode'] == 'present':
            p = s.get(c, 'plants', cell['plant_id'])
            s.move_in_transaction(c, p, {}, 'Regalebene ausgeschaltet – auf den Parkplatz')
            p = s.get(c, 'plants', p['id'])
            p.pop('workspace_position', None)
            s.put(c, 'plants', p, p['id'])
            parked += 1
        else:
            c.execute('DELETE FROM records WHERE id=?', (cell['id'],))
    loc = s.get(c, 'locations', loc['id'])
    loc['shelf'] = new
    s.put(c, 'locations', loc, loc['id'])
    sync_zones(s, c, s.get(c, 'locations', loc['id']))
    return {'shelf': s.get(c, 'locations', loc['id']), 'parked': parked}


def dispatch(s, c, action, v):
    if action == 'levels':
        return set_levels(s, c, v)
    raise ValueError('Unbekannte Regalaktion.')
