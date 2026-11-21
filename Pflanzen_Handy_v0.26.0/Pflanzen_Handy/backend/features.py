"""Version 0.5: Flächen, Behälter, Zonen und nachvollziehbare Sammelaktionen."""
import hashlib, json, math, uuid, threading, base64
import geometry
from datetime import datetime
LOCK = threading.RLock()
LOCAL = threading.local()
s = None

def number(v, default=1):
    n = float(default if v in ('', None) else v)
    if not math.isfinite(n) or n <= 0 or n > 3000:
        raise ValueError('Maße müssen größer als 0 und höchstens 3000 sein.')
    return n

def rect(v):
    x, y = (float(v['col']), float(v['row']))
    if not math.isfinite(x) or not math.isfinite(y):
        raise ValueError('Ungültige Position.')
    return (x, y, number(v.get('width')), number(v.get('depth')))

def overlaps(a, b):
    return a[0] < b[0] + b[2] - 1e-08 and b[0] < a[0] + a[2] - 1e-08 and (a[1] < b[1] + b[3] - 1e-08) and (b[1] < a[1] + a[3] - 1e-08)

def has_plan(loc):
    return bool(loc.get('width_cm') and loc.get('depth_cm')) if loc.get('unit') == 'cm' else bool(loc.get('rows') and loc.get('cols'))

def contour(c, v):
    a = {**v, 'width': v.get('width', 1), 'depth': v.get('depth', 1)}
    if v.get('container_id'):
        a['shape'] = s.get(c, 'locations', v['container_id']).get('shape', 'rectangle')
    return a

def check_area(c, loc, v, ignore=()):
    box = rect(v)
    import shelf
    shelf.check_placement(loc, v)
    if loc.get('unit', 'slots') == 'slots' and any((not float(n).is_integer() for n in box)):
        raise ValueError('Im Platzraster ganze Plätze verwenden. Für freie Zentimeterpositionen einen maßstäblichen Standort wählen.')
    if min(box[:2]) < 0 or box[0] + box[2] > (loc.get('width_cm') if loc.get('unit') == 'cm' else loc.get('cols', 0)) + 1e-08 or box[1] + box[3] > (loc.get('depth_cm') if loc.get('unit') == 'cm' else loc.get('rows', 0)) + 1e-08:
        raise ValueError('Die gesamte Stellfläche passt nicht in den Standort. Alter Platz bleibt erhalten.')
    if loc.get('occupancy_status') in ('reserved', 'blocked'):
        raise ValueError('Standort ist reserviert oder blockiert.')
    if loc.get('shape') == 'round' and loc.get('type') != 'pot' and (loc.get('unit') == 'cm') and (not geometry.fits(contour(c, v), {'col': 0, 'row': 0, 'width': loc['width_cm'], 'depth': loc['depth_cm'], 'shape': 'round'})):
        raise ValueError('Die gesamte Stellfläche muss innerhalb des runden Randes liegen.')
    for x in s.allrows(c, 'cells'):
        if x['location_id'] == loc['id'] and x['id'] not in ignore and geometry.collision(contour(c, v), contour(c, x)):
            raise ValueError('Die Fläche ist teilweise belegt, reserviert, geplant oder ausgeschlossen. Bitte ein freies Ziel wählen.')
    zones = [z for z in s.allrows(c, 'zones') if z['location_id'] == loc['id'] and any((overlaps(box, rect(a)) for a in z['areas']))]
    if len(zones) > 1:
        raise ValueError('Diese Stellfläche berührt mehrere Zonen. Bitte eindeutig innerhalb einer Zone oder außerhalb platzieren.')
    return zones[0] if zones else None

def cell_at(c, loc, row, col):
    return next((x for x in s.allrows(c, 'cells') if x['location_id'] == loc and geometry.contains(contour(c, x), col, row)), None)

def effective(c, p, location=False):
    if p.get('group_id'):
        return {'group_id': p['group_id'], 'source': 'Eigene Pflegegruppe'}
    locid = (None if p.get('parked') else p.get('parent_id')) if location else p.get('location_id')
    seen = set()
    subject = p['id']
    kind = 'container_id' if location else 'plant_id'
    while locid and locid not in seen:
        seen.add(locid)
        loc = s.get(c, 'locations', locid)
        cell = next((x for x in s.allrows(c, 'cells') if x.get(kind) == subject and x.get('mode') in ('present', 'container')), None)
        if cell:
            zones = [z for z in s.allrows(c, 'zones') if z['location_id'] == locid and any((overlaps(rect(cell), rect(a)) for a in z['areas']))]
            if zones and zones[0].get('group_id'):
                return {'group_id': zones[0]['group_id'], 'source': 'Zone ' + zones[0]['name'] + ' · ' + s.location_path(c, locid)}
        if loc.get('group_id'):
            return {'group_id': loc['group_id'], 'source': s.location_path(c, locid)}
        if loc.get('parked'):
            break
        subject = locid
        kind = 'container_id'
        locid = loc.get('parent_id')
    return {'group_id': '', 'source': 'Keine Vorgabe'}

def validate(c, kind, v, old=None):
    if kind == 'locations':
        v['is_main'] = v.get('is_main', False) in (True, 'true', 'on', '1')
        if v['is_main'] and v.get('parent_id'):
            raise ValueError('Ein Hauptstandort darf keinen übergeordneten Ort haben.')
        if v.get('type') == 'pot':
            v.update(unit='slots', rows=1, cols=1)
        if v.get('unit') == 'cm':
            v['width_cm'] = number(v.get('width_cm'))
            v['depth_cm'] = number(v.get('depth_cm'))
            v['cols'] = math.ceil(v['width_cm'])
            v['rows'] = math.ceil(v['depth_cm'])
            v['step'] = number(v.get('step'), 7)
        if v.get('unit') != 'cm' and v.get('step') not in ('', None) and (not old or v.get('step') != old.get('step')):
            v['step'] = number(v['step'])
        if old and old.get('unit', 'slots') != v.get('unit', 'slots') and (any((x['location_id'] == old['id'] for x in s.allrows(c, 'cells'))) or any((x['location_id'] == old['id'] for x in s.allrows(c, 'zones')))):
            raise ValueError('Maßeinheit eines belegten Plans bleibt erhalten. Bitte einen neuen maßstäblichen Standort anlegen und Pflanzen bewusst umstellen.')
    original_validate(c, kind, v, old)
    if kind in ('plants', 'locations'):
        s.ref(c, v, 'group_id', 'groups')
    if kind == 'locations' and old:
        limitx = v.get('width_cm') if v.get('unit') == 'cm' else v['cols']
        limity = v.get('depth_cm') if v.get('unit') == 'cm' else v['rows']
        bad = [x for x in s.allrows(c, 'cells') if x['location_id'] == old['id'] and (x['col'] + x.get('width', 1) > limitx or x['row'] + x.get('depth', 1) > limity)]
        for z in s.allrows(c, 'zones'):
            if z['location_id'] == old['id'] and any((a['col'] + a.get('width', 1) > limitx or a['row'] + a.get('depth', 1) > limity for a in z['areas'])):
                bad.append(z)
        if bad:
            raise ValueError('Verkleinern betrifft ' + str(len(bad)) + ' Flächen/Zonen: ' + ', '.join((x.get('name') or x.get('note') or s.coord(int(x['row']), int(x['col'])) for x in bad[:8])) + '. Erst umstellen, parken oder bewusst freigeben.')
        parentcell = next((x for x in s.allrows(c, 'cells') if x.get('container_id') == old['id']), None)
        if parentcell and v.get('parent_id') != old.get('parent_id'):
            raise ValueError('Dieser Behälter steht auf einer Fläche. Bitte über „Behälter verschieben“ umstellen oder parken.')
    if kind == 'events':
        s.ref(c, v, 'location_id', 'locations')

def current_place(c, p):
    result = original_current(c, p)
    cell = next((x for x in s.allrows(c, 'cells') if x.get('plant_id') == p['id'] and x['mode'] == 'present'), None)
    if cell:
        result.update(width=cell.get('width', 1), depth=cell.get('depth', 1), unit=s.get(c, 'locations', cell['location_id']).get('unit', 'slots'))
    locid = p.get('location_id')
    result['container_positions'] = []
    while locid:
        loc = s.get(c, 'locations', locid)
        outer = next((x for x in s.allrows(c, 'cells') if x.get('container_id') == locid), None)
        if outer:
            result['container_positions'].append({k: outer[k] for k in ('container_id', 'location_id', 'row', 'col')})
        if loc.get('parked'):
            result['path'] = 'Parkplatz · ' + result['path']
            break
        locid = loc.get('parent_id')
    return result

def move_in_transaction(c, p, target, reason='Standortwechsel'):
    target = dict(target)
    if target.get('location_id') and s.get(c, 'locations', target['location_id']).get('occupancy_status') in ('reserved', 'blocked'):
        raise ValueError('Dieser Standort ist reserviert oder blockiert. Status zuerst freigeben.')
    if target.get('location_id') and s.get(c, 'locations', target['location_id']).get('model_pending'):
        raise ValueError('Bitte zuerst ein konkretes QuickPot-Modell wählen.')
    if target.get('location_id') and (not has_plan(s.get(c, 'locations', target['location_id']))):
        target = {'location_id': target['location_id']}
    if target.get('location_id') and s.get(c, 'locations', target['location_id']).get('type') == 'pot':
        target.update(row=0, col=0, width=1, depth=1)
    before = current_place(c, p)
    locid = target.get('location_id') or ''
    row = target.get('row')
    col = target.get('col')
    own = [x for x in s.allrows(c, 'cells') if x.get('plant_id') == p['id'] and x['mode'] == 'present']
    slot = None
    if row is not None or col is not None:
        if not locid or row is None or col is None:
            raise ValueError('Standort, Reihe und Spalte gemeinsam wählen.')
        if p.get('status', 'active') != 'active':
            raise ValueError('Nur aktive Pflanzen belegen Stellflächen.')
        loc = s.get(c, 'locations', locid)
        row = float(row)
        col = float(col)
        unit = loc.get('unit', 'slots')
        prior = p.get('footprint', {}) if p.get('footprint', {}).get('unit') == unit else {}
        width = number(target.get('width'), prior.get('width', loc.get('step', 1)))
        depth = number(target.get('depth'), prior.get('depth', loc.get('step', 1)))
        slot = {'location_id': locid, 'row': row, 'col': col, 'width': width, 'depth': depth, 'mode': 'present', 'plant_id': p['id'], 'wish_id': '', 'note': ''}
        planned = [x['id'] for x in s.allrows(c, 'cells') if x.get('plant_id') == p['id'] and x['mode'] == 'planned' and (x['location_id'] == locid) and (x['row'] == row) and (x['col'] == col)]
        check_area(c, loc, slot, [x['id'] for x in own] + planned)
        for ident in planned:
            c.execute('DELETE FROM records WHERE id=?', (ident,))
    elif locid:
        s.get(c, 'locations', locid)
    for x in own:
        c.execute('DELETE FROM records WHERE id=?', (x['id'],))
    p['location_id'] = locid
    p['position'] = str(target.get('position', '')) if locid and row is None else ''
    p.pop('planner_hidden', None)
    if slot:
        s.put(c, 'cells', slot)
        p['footprint'] = {'width': slot['width'], 'depth': slot['depth'], 'unit': loc.get('unit', 'slots')}
    after = current_place(c, p)
    s.remember(c, p, before, after, reason)
    s.put(c, 'plants', p, p['id'])

def cell_save(v):
    with s.connect() as c:
        c.execute('BEGIN IMMEDIATE')
        loc = s.get(c, 'locations', v['location_id'])
        old = s.get(c, 'cells', v['id']) if v.get('id') else cell_at(c, loc['id'], float(v['row']), float(v['col']))
        if old and old['location_id'] != loc['id']:
            raise ValueError('Feld gehört zu einem anderen Standort.')
        if old and (v.get('version') != old['version'] or (v.get('id') and v['id'] != old['id'])):
            raise ValueError('Platz inzwischen geändert. Bitte neu laden.')
        if not old and v.get('version'):
            raise ValueError('Platz inzwischen freigegeben. Bitte neu laden.')
        if old and old.get('sowing_id'):
            raise ValueError('Aussaatzellen über die Aussaatgruppe bearbeiten; dadurch bleibt der Verlauf erhalten.')
        mode = v['mode']
        if mode not in ('empty', 'present', 'reserved', 'planned', 'blocked'):
            raise ValueError('Ungültiger Feldtyp.')
        if old and old['mode'] == 'container':
            raise ValueError('Behälter bitte als Ganzes verschieben oder parken.')
        if old and old['mode'] == 'present':
            if mode == 'present' and old.get('plant_id') != v.get('plant_id'):
                raise ValueError('Pflanze zuerst bewusst auf den Parkplatz stellen.')
            if mode != 'present':
                move_in_transaction(c, s.get(c, 'plants', old['plant_id']), {}, 'Stellfläche geräumt – Parkplatz')
        area = {k: v.get(k, '') for k in ('location_id', 'plant_id', 'wish_id', 'note')}
        area.update(row=float(v['row']), col=float(v['col']), width=number(v.get('width'), old.get('width', 1) if old else loc.get('step', 1)), depth=number(v.get('depth'), old.get('depth', 1) if old else loc.get('step', 1)), mode=mode)
        if mode == 'empty':
            if old:
                c.execute('DELETE FROM records WHERE id=?', (old['id'],))
            return
        if mode == 'present':
            p = s.get(c, 'plants', v['plant_id'])
            move_in_transaction(c, p, area, 'Im Plan platziert')
            saved = cell_at(c, loc['id'], area['row'], area['col'])
            saved['note'] = area['note']
            s.put(c, 'cells', saved, saved['id'])
            return
        if mode == 'planned':
            if area['plant_id'] and area['wish_id']:
                raise ValueError('Pflanze oder Wunsch wählen, nicht beide.')
            s.ref(c, area, 'plant_id', 'plants')
            s.ref(c, area, 'wish_id', 'wishes')
        else:
            area['plant_id'] = area['wish_id'] = ''
        check_area(c, loc, area, [old['id']] if old else [])
        s.put(c, 'cells', area, old['id'] if old and old['mode'] != 'present' else None)

def move_plan(v):
    with s.connect() as c:
        c.execute('BEGIN IMMEDIATE')
        x = s.get(c, 'cells', v['cell_id'])
        if x['version'] != v['version'] or x['mode'] != 'planned':
            raise ValueError('Planung inzwischen geändert.')
        loc = s.get(c, 'locations', v['location_id'])
        x.update(location_id=loc['id'], row=float(v['row']), col=float(v['col']))
        check_area(c, loc, x, [x['id']])
        s.put(c, 'cells', x, x['id'])

def move_container(v):
    with s.connect() as c:
        c.execute('BEGIN IMMEDIATE')
        return move_container_in(c, v)

def move_container_in(c, v):
    obj = s.get(c, 'locations', v['id'])
    if obj['version'] != v['version']:
        raise ValueError('Behälter inzwischen geändert. Neu laden.')
    target = v.get('target', {})
    parent = target.get('location_id', '')
    affected = s.descendants(c, obj['id'])
    if parent in affected:
        raise ValueError('Behälter kann nicht in sich selbst oder einem Unterort stehen.')
    ps = [p for p in s.allrows(c, 'plants') if p.get('location_id') in affected]
    before = {p['id']: current_place(c, p) for p in ps}
    old = [x for x in s.allrows(c, 'cells') if x.get('container_id') == obj['id']]
    area = None
    if parent:
        loc = s.get(c, 'locations', parent)
        if obj.get('is_main'):
            raise ValueError('Hauptstandort zuerst als Unterort freigeben.')
        if loc.get('occupancy_status') in ('reserved', 'blocked'):
            raise ValueError('Standort ist reserviert oder blockiert.')
        if loc.get('type') == 'pot' or loc.get('template_snapshot', {}).get('type') == 'quickpot':
            raise ValueError('Dieser Behälter hat feste Pflanzenplätze, keine weiteren Behälterplätze.')
        if has_plan(loc) and target.get('row') is not None:
            area = {'location_id': parent, 'container_id': obj['id'], 'mode': 'container', 'row': float(target['row']), 'col': float(target['col']), 'width': number(target.get('width'), old[0].get('width', 1) if old else 1), 'depth': number(target.get('depth'), old[0].get('depth', 1) if old else 1)}
            check_area(c, loc, area, [x['id'] for x in old])
    for x in old:
        c.execute('DELETE FROM records WHERE id=?', (x['id'],))
    obj.update(parent_id=parent, parked=not bool(parent))
    s.put(c, 'locations', obj, obj['id'])
    if area:
        s.put(c, 'cells', area)
        obj['footprint'] = {'width': area['width'], 'depth': area['depth'], 'unit': loc.get('unit', 'slots')}
        s.put(c, 'locations', obj, obj['id'])
    for p in ps:
        s.remember(c, p, before[p['id']], current_place(c, p), 'Behälter gemeinsam umgestellt')
        s.put(c, 'plants', p, p['id'])
    return True

def grid_bulk(v):
    with s.connect() as c:
        c.execute('BEGIN IMMEDIATE')
        loc = s.get(c, 'locations', v['location_id'])
        entries = v['entries']
        action = v['action']
        changed = 0
        skipped = 0
        if action not in ('reserved', 'blocked', 'release', 'park'):
            raise ValueError('Unbekannte Sammelaktion.')
        if not entries or len(entries) > 10000:
            raise ValueError('Bitte 1 bis 10000 Felder auswählen.')
        checked = []
        seen = set()
        for entry in entries:
            x = cell_at(c, loc['id'], entry['row'], entry['col'])
            key = x['id'] if x else (entry['row'], entry['col'])
            if key in seen:
                continue
            seen.add(key)
            if x and (x['id'] != entry.get('id') or x['version'] != entry.get('version')) or (not x and entry.get('id')):
                raise ValueError('Auswahl inzwischen geändert. Keine Aktion ausgeführt. Bitte neu laden.')
            if x and x.get('sowing_id'):
                raise ValueError('Aussaatzellen über die Gruppenauswahl bearbeiten.')
            checked.append((entry, x))
        for entry, x in checked:
            if action == 'park' and x and (x['mode'] == 'present'):
                move_in_transaction(c, s.get(c, 'plants', x['plant_id']), {}, 'Mehrfachauswahl: Parkplatz')
                changed += 1
            elif action == 'release' and x and (x['mode'] in ('reserved', 'blocked')):
                c.execute('DELETE FROM records WHERE id=?', (x['id'],))
                changed += 1
            elif action in ('reserved', 'blocked') and (not x):
                a = {**entry, 'location_id': loc['id'], 'mode': action, 'width': number(entry.get('width'), loc.get('step', 1)), 'depth': number(entry.get('depth'), loc.get('step', 1))}
                check_area(c, loc, a)
                s.put(c, 'cells', a)
                changed += 1
            else:
                skipped += 1
        return {'changed': changed, 'skipped': skipped}

def zone_save(v):
    with s.connect() as c:
        c.execute('BEGIN IMMEDIATE')
        loc = s.get(c, 'locations', v['location_id'])
        old = s.get(c, 'zones', v['id']) if v.get('id') else None
        if old and old['version'] != v.get('version'):
            raise ValueError('Zone inzwischen geändert.')
        if old and old.get('shelf_level'):
            # Regalebenen: Name und Fläche sind fest; Pflegegruppe, Anstauhöhe, Notizen und Farbe lassen sich ändern.
            if v.get('delete'):
                raise ValueError('Eine Regalebene lässt sich nicht löschen. Im Regal die Ebene in den Eigenschaften ausschalten.')
            v = {**v, 'name': old['name'], 'areas': old['areas'], 'location_id': old['location_id']}
        if v.get('delete'):
            if old:
                c.execute('DELETE FROM records WHERE id=?', (old['id'],))
            return True
        if not str(v.get('name', '')).strip():
            raise ValueError('Zonenname fehlt.')
        s.ref(c, v, 'group_id', 'groups')
        if v.get('water_cm') not in ('', None):
            value = float(v['water_cm'])
            if not math.isfinite(value) or value < 0:
                raise ValueError('Anstauhöhe muss mindestens 0 sein oder leer bleiben.')
        areas = v.get('areas', [])
        if not areas:
            raise ValueError('Bitte zuerst Flächen für die Zone auswählen.')
        for a in areas:
            b = rect(a)
            if min(b[:2]) < 0 or b[0] + b[2] > (loc.get('width_cm') if loc.get('unit') == 'cm' else loc['cols']) or b[1] + b[3] > (loc.get('depth_cm') if loc.get('unit') == 'cm' else loc['rows']):
                raise ValueError('Zone liegt außerhalb.')
            for z in s.allrows(c, 'zones'):
                if z['location_id'] == loc['id'] and z['id'] != v.get('id') and any((overlaps(b, rect(t)) for t in z['areas'])):
                    raise ValueError('Zonen dürfen sich nicht überschneiden. Vorhandene Zone zuerst bearbeiten oder entfernen.')
        zone = {k: v.get(k, '') for k in ('location_id', 'name', 'group_id', 'water_cm', 'notes', 'color', 'areas')}
        if old and old.get('shelf_level'):
            zone['shelf_level'] = old['shelf_level']
        ident = s.put(c, 'zones', zone, v.get('id'))
        for x in s.allrows(c, 'cells'):
            if x['location_id'] == loc['id']:
                check_area(c, loc, x, [x['id']])
        return ident

def photo_upload(v):
    key = 'location_id' if v.get('location_id') else 'plant_id'
    kind = 'locations' if key == 'location_id' else 'plants'
    raw = base64.b64decode(v['data'], validate=True)
    if len(raw) > 15 * 1024 * 1024:
        raise ValueError('Ein Bild darf höchstens 15 MB groß sein.')
    ext = 'jpg' if raw.startswith(b'\xff\xd8\xff') else 'png' if raw.startswith(b'\x89PNG\r\n\x1a\n') else 'webp' if raw.startswith(b'RIFF') and raw[8:12] == b'WEBP' else None
    if not ext:
        raise ValueError('Bitte JPEG, PNG oder WebP verwenden.')
    with s.connect() as c:
        c.execute('BEGIN IMMEDIATE')
        s.get(c, kind, v[key])
        name = uuid.uuid4().hex + '.' + ext
        if v.get('event_id'):
            event = s.get(c, 'events', v['event_id'])
            if event.get(key) != v[key]:
                raise ValueError('Foto und Notiz müssen zum selben Eintrag gehören.')
        (s.DATA / 'photos' / name).write_bytes(raw)
        try:
            return s.put(c, 'photos', {key: v[key], 'event_id': v.get('event_id', ''), 'file': name, 'date': v.get('date', ''), 'description': v.get('description', ''), 'main': not any((x.get(key) == v[key] for x in s.allrows(c, 'photos')))})
        except Exception:
            (s.DATA / 'photos' / name).unlink(missing_ok=True)
            raise

def photo_edit(v):
    with s.connect() as c:
        c.execute('BEGIN IMMEDIATE')
        p = s.get(c, 'photos', v['id'])
        if v.get('version') is not None and v['version'] != p['version']:
            raise ValueError('Foto inzwischen geändert.')
        if v.get('main'):
            key = 'location_id' if p.get('location_id') else 'plant_id'
            for x in s.allrows(c, 'photos'):
                if x.get(key) == p[key]:
                    x['main'] = x['id'] == p['id']
                    s.put(c, 'photos', x, x['id'])
        else:
            p.update(date=v.get('date', ''), description=v.get('description', ''))
            s.put(c, 'photos', p, p['id'])
    return True

def save(kind, v, ident=None):
    if kind == 'plants' and (not ident):
        v = {**v, 'status': 'active', 'status_date': '', 'cause': '', 'recipient': ''}
        if v.get('parent_id') and 'placements' not in v:
            v.update(location_id='', position='')
    elif kind == 'plants' and ident and (v.get('status') in ('dead', 'given')):
        v = {**v, 'placements': [{}]}
    if kind == 'templates':
        with s.connect() as c:
            c.execute('BEGIN IMMEDIATE')
            old = s.get(c, kind, ident) if ident else None
            if old and v.get('version') != old['version']:
                raise ValueError('Vorlage inzwischen geändert. Bitte neu laden.')
            v = {**(old or {}), **v}
            if not v.get('name', '').strip():
                raise ValueError('Vorlagenname fehlt.')
            v = {**v, 'width': number(v.get('width')), 'depth': number(v.get('depth'))}
            if v.get('unit', 'cm') not in ('cm', 'slots'):
                raise ValueError('Ungültige Einheit.')
            if v.get('type', 'pot') not in ('pot', 'quickpot', 'tray'):
                raise ValueError('Ungültiger Vorlagentyp.')
            if v.get('shape', 'rectangle') not in ('round', 'square', 'rectangle'):
                raise ValueError('Ungültige Form.')
            if v.get('shape') in ('round', 'square') and v['width'] != v['depth']:
                raise ValueError('Runde und quadratische Töpfe benötigen gleiche Außenmaße.')
            if v.get('type') in ('quickpot', 'tray'):
                if v.get('unit', 'cm') != 'cm':
                    raise ValueError('Plattenaußenmaße bitte in cm angeben.')
                for k in ('rows', 'cols'):
                    n = float(v.get(k) or 0)
                    if not n.is_integer() or not 1 <= n <= 3000:
                        raise ValueError('Reihen und Spalten: ganze Zahlen von 1 bis 3000.')
                    v[k] = int(n)
                v['cell_count'] = v['rows'] * v['cols']
            else:
                for k in ('cell_count', 'rows', 'cols', 'cell_top_mm', 'cell_height_mm', 'cell_volume_ml'):
                    v.pop(k, None)
            # Änderungen sind lokale Varianten, keine unveränderten Herstellerdaten.
            if old and old.get('source_url') and any((v.get(k) != old.get(k) for k in ('width', 'depth', 'rows', 'cols', 'type', 'shape'))):
                v.update(dimension_basis='Eigene Anpassung einer Herstellervorlage', verified=False)
            i = s.put(c, kind, v, ident)
            return [s.get(c, kind, i)]
    return original_save(kind, v, ident)

def snapshot(c):
    return [list(x) for x in c.execute('SELECT id,kind,body,version FROM records ORDER BY id')]


def snapshot_digest(snap):
    return hashlib.sha256(json.dumps(snap, separators=(',', ':')).encode('utf-8')).hexdigest()


def compact_undo_step(before, after):
    """Speichert nur, was zum Zurücknehmen nötig ist (statt zwei Vollkopien der Datenbank):
    die vorherigen Zeilen der geänderten oder gelöschten Datensätze, die Ids neu angelegter
    Datensätze und eine Prüfsumme des Zustands nach der Aktion."""
    old = {x[0]: x for x in before}
    new = {x[0]: x for x in after}
    restore = [old[i] for i in old if i not in new or new[i] != old[i]]
    added = [i for i in new if i not in old]
    versions = {i: new[i][3] for i in new if i in old and new[i] != old[i]}
    return ({'v': 2, 'restore': restore, 'added': added}, {'v': 2, 'digest': snapshot_digest(after), 'versions': versions})


def rebuild_inventory(c):
    c.execute('DELETE FROM inventory')
    for p in s.allrows(c, 'plants'):
        if p.get('label'):
            c.execute('INSERT INTO inventory(label,plant_id) VALUES (?,?)', (p['label'], p['id']))


STALE_UNDO = 'Seitdem wurden Daten geändert. Rückgängig würde neuere Angaben überschreiben und wurde deshalb abgebrochen.'


def undo(v):
    with s.connect() as c:
        c.execute('BEGIN IMMEDIATE')
        r = c.execute('SELECT before_state,after_state FROM undo_steps WHERE id=?', (v['id'],)).fetchone()
        if not r:
            raise ValueError('Diese Aktion kann nicht mehr zurückgenommen werden.')
        before = json.loads(r['before_state'])
        after = json.loads(r['after_state'])
        current = snapshot(c)
        if isinstance(after, dict) and after.get('v') == 2:
            # Kompaktes Format: Zustand muss exakt dem Zustand nach der Aktion entsprechen.
            if snapshot_digest(current) != after['digest']:
                raise ValueError(STALE_UNDO)
            for ident in before['added']:
                c.execute('DELETE FROM records WHERE id=?', (ident,))
            for ident, kind, body, version in before['restore']:
                c.execute('INSERT OR REPLACE INTO records VALUES (?,?,?,?)', (ident, kind, body, max(version, after['versions'].get(ident, 0)) + 1))
        else:
            # Älteres Format (Vollkopien), z. B. aus einer früheren Programmversion.
            if current != after:
                raise ValueError(STALE_UNDO)
            versions = {x[0]: x[3] for x in after}
            c.execute('DELETE FROM records')
            for ident, kind, body, version in before:
                c.execute('INSERT INTO records VALUES (?,?,?,?)', (ident, kind, body, max(version, versions.get(ident, 0)) + 1))
        rebuild_inventory(c)
        c.execute('DELETE FROM undo_steps')
        return True


def dispatch(path, v):
    with LOCK:
        LOCAL.undo_id = None
        spatial = path.startswith('/api/planner-') or path in ('/api/cell', '/api/move', '/api/move-plan', '/api/grid-bulk', '/api/container-move', '/api/zone')
        with s.connect() as c:
            before = snapshot(c) if spatial else None
        if path == '/api/save':
            key = v.get('request_key') if v['kind'] == 'plants' and (not v.get('id')) else None
            payload = json.dumps(v['values'], sort_keys=True)
            with s.connect() as c:
                prior = c.execute('SELECT payload,result FROM requests WHERE key=?', (key,)).fetchone() if key else None
            if prior:
                if prior['payload'] != payload:
                    raise ValueError('Dieser Anlagevorgang wurde bereits gespeichert. Bitte neu laden und den vorhandenen Horst bearbeiten.')
                result = json.loads(prior['result'])
            else:
                result = s.save(v['kind'], v['values'], v.get('id'))
                if key:
                    with s.connect() as c:
                        c.execute('INSERT INTO requests VALUES (?,?,?)', (key, payload, json.dumps(result)))
        elif path == '/api/delete':
            s.delete(v['kind'], v['id'], v.get('confirm'))
            result = True
        elif path == '/api/cell':
            s.cell_save(v)
            result = True
        elif path == '/api/move':
            result = s.move_plant(v)
        elif path == '/api/move-plan':
            s.move_plan(v)
            result = True
        elif path == '/api/container-move':
            result = move_container(v)
        elif path == '/api/grid-bulk':
            result = grid_bulk(v)
        elif path == '/api/zone':
            result = zone_save(v)
        elif path == '/api/undo':
            result = undo(v)
        elif path == '/api/copy-location':
            result = copy_location(v)
        elif path == '/api/template-instance':
            import catalogue
            result = catalogue.instantiate(s, v)
        elif path.startswith('/api/planner-'):
            import planner
            result = planner.dispatch(s, path, v)
        elif path == '/api/photo':
            result = photo_upload(v)
        elif path == '/api/photo-edit':
            result = photo_edit(v)
        elif path == '/api/bulk':
            s.bulk_update(v)
            result = True
        else:
            raise ValueError('Unbekannte Aktion.')
        if spatial:
            with s.connect() as c:
                after = snapshot(c)
                if before != after:
                    token = uuid.uuid4().hex
                    stored_before, stored_after = compact_undo_step(before, after)
                    c.execute('INSERT INTO undo_steps VALUES (?,?,?)', (token, json.dumps(stored_before), json.dumps(stored_after)))
                    LOCAL.undo_id = token
                    c.execute('DELETE FROM undo_steps WHERE rowid NOT IN (SELECT rowid FROM undo_steps ORDER BY rowid DESC LIMIT 10)')
        return result

def copy_location(v):
    with s.connect() as c:
        c.execute('BEGIN IMMEDIATE')
        old = s.get(c, 'locations', v['id'])
        if old['version'] != v['version']:
            raise ValueError('Standort inzwischen geändert.')
        new = {k: value for k, value in old.items() if k not in ('id', 'version')}
        new['name'] = v['name']
        new['parked'] = False
        validate(c, 'locations', new)
        ident = s.put(c, 'locations', new)
        for x in s.allrows(c, 'cells'):
            if x['location_id'] == old['id'] and x['mode'] == 'blocked':
                s.put(c, 'cells', {**x, 'location_id': ident})
        return s.get(c, 'locations', ident)

def place_text(v):
    tail = ('x ' + str(v['col']) + ' / y ' + str(v['row']) + ' cm' if v.get('unit') == 'cm' else s.coord(v['row'], v['col'])) if v.get('row') is not None else v.get('position', '')
    return v['path'] + (' → ' + tail if tail else '')

def install(module):
    global s, original_validate, original_save, original_current
    s = module
    original_validate = s.validate
    original_save = s.save
    original_current = s.current_place
    s.place_text = place_text
    for name in ('validate', 'save', 'current_place', 'move_in_transaction', 'cell_at', 'cell_save', 'move_plan', 'photo_upload'):
        setattr(s, name, globals()[name])
