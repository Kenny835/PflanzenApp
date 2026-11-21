"""0.7: gemeinsame Arbeitsflächen; cm außen, feste Zelladressen innen."""
import math
from collections import Counter
import geometry

def orientation(obj):
    if 'orientation' in obj:
        return int(obj['orientation']) % 4
    t = obj.get('template_snapshot', {})
    f = obj.get('footprint', {})
    return int(bool(t.get('width') != t.get('depth') and f.get('width') == t.get('depth') and (f.get('depth') == t.get('width'))))

def fixed(loc):
    return loc.get('type') == 'pot' or loc.get('template_snapshot', {}).get('type') == 'quickpot' or loc.get('quickpot_family')

def physical(obj):
    f = obj.get('footprint', {})
    if f.get('unit') == 'cm':
        return dict(f)
    if obj.get('unit') == 'cm':
        return {'width': obj['width_cm'], 'depth': obj['depth_cm'], 'unit': 'cm'}
    t = obj.get('template_snapshot', {})
    if t.get('unit') == 'cm':
        w, h = (t['width'], t['depth'])
        if orientation(obj) % 2:
            w, h = (h, w)
        return {'width': w, 'depth': h, 'unit': 'cm'}
    return {'width': 7, 'depth': 7, 'unit': 'cm', 'unknown': True}

def scene(s, c, ident):
    loc = s.get(c, 'locations', ident) if ident else {'id': '', 'name': 'Parkplatz', 'unit': 'cm'}
    isfixed = bool(fixed(loc))
    bounded = s.features.has_plan(loc)
    legacy = bounded and loc.get('unit', 'slots') == 'slots' and (not isfixed)
    sx = sy = 1
    if isfixed:
        size = physical(loc)
        if orientation(loc) % 2:
            size['width'], size['depth'] = (size['depth'], size['width'])
        sx = size['width'] / max(1, loc.get('cols', 1))
        sy = size['depth'] / max(1, loc.get('rows', 1))
    w = (loc.get('width_cm', 0) if loc.get('unit') == 'cm' else loc.get('cols', 0) * sx) if bounded else 0
    h = (loc.get('depth_cm', 0) if loc.get('unit') == 'cm' else loc.get('rows', 0) * sy) if bounded else 0
    cells = s.allrows(c, 'cells')
    locations = {x['id']: x for x in s.allrows(c, 'locations')}
    plants = {x['id']: x for x in s.allrows(c, 'plants')}
    items = []
    placed = set()
    for cell in cells:
        if not ident or cell['location_id'] != ident:
            continue
        obj = locations.get(cell.get('container_id')) or plants.get(cell.get('plant_id'))
        kind = 'container' if cell.get('container_id') else 'plant' if cell['mode'] == 'present' else 'cell'
        if obj:
            placed.add(obj['id'])
        items.append({**cell, 'key': cell['id'], 'object_id': obj['id'] if obj else cell['id'], 'object_version': obj['version'] if obj else cell['version'], 'kind': kind, 'name': (obj.get('label', '') + ' ' + obj['name']).strip() if obj else cell.get('note') or {'reserved': 'Reserviert', 'blocked': 'Außerhalb', 'planned': 'Geplant'}.get(cell['mode'], 'Fläche'), 'shape': obj.get('shape', 'rectangle') if obj else 'rectangle', 'col': cell['col'] * sx, 'row': cell['row'] * sy, 'width': cell.get('width', 1) * sx, 'depth': cell.get('depth', 1) * sy, 'loose': False})
    loose = []
    for obj in locations.values():
        if obj['id'] in placed or obj['id'] == ident:
            continue
        if ident and obj.get('parent_id') == ident and (not obj.get('parked')) or (not ident and obj.get('parked')):
            loose.append(('container', obj))
    for p in plants.values():
        if p['id'] not in placed and p.get('status', 'active') == 'active' and ((p.get('location_id') or '') == ident) and (ident or not p.get('planner_hidden')):
            loose.append(('plant', p))
    # Saved positions first. Missing positions receive deterministic, non-overlapping presentation positions.
    pending = []
    for kind, obj in sorted(loose, key=lambda pair: pair[1]['id']):
        f = physical(obj)
        a = {'key': obj['id'], 'object_id': obj['id'], 'object_version': obj['version'], 'kind': kind, 'mode': 'container' if kind == 'container' else 'present', 'name': (obj.get('label', '') + ' ' + obj['name']).strip(), 'shape': obj.get('shape', 'square'), 'width': f['width'], 'depth': f['depth'], 'unknown': f.get('unknown', False), 'loose': True}
        pos = obj.get('workspace_position', {})
        if pos.get('location_id') == ident and 'col' in pos:
            a.update(col=pos['col'], row=pos['row'])
            items.append(a)
        else:
            pending.append(a)
    start = w + 20 if bounded else 0
    index = geometry.SpatialIndex()
    for b in items:
        index.add(b)
    for a in pending:
        x = start
        y = 0
        while True:
            a.update(col=x, row=y)
            collisions = index.colliding(a)
            if not collisions:
                break
            x = max((b['col'] + b['width'] for b in collisions)) + 2
            if x > start + max(180, a['width'] * 2):
                x = start
                y = max(y + 2, min((b['row'] + b['depth'] for b in collisions)) + 2)
        items.append(a)
        index.add(a)
    return {'id': ident, 'name': loc['name'], 'shape': loc.get('shape', 'rectangle'), 'width': w, 'depth': h, 'bounded': bounded, 'fixed': isfixed, 'legacy': legacy, 'sx': sx, 'sy': sy, 'step': loc.get('step', 7) if not isfixed else min(sx, sy), 'items': items, 'shelf': bool(loc.get('shelf')), 'canvas_width': max(w + 20 if loc.get('shelf') else 180, w + 20, *[a['col'] + a['width'] + 20 for a in items]), 'canvas_depth': max(110, h + 20, *[a['row'] + a['depth'] + 20 for a in items])}

def checked(s, c, kind, ident, version):
    obj = s.get(c, kind, ident)
    if obj['version'] != version:
        raise ValueError('Objekt inzwischen geändert. Bitte neu laden.')
    return obj

def nonnegative(v):
    n = float(v)
    if not math.isfinite(n) or n < 0:
        raise ValueError('Position muss eine endliche Zahl ab 0 sein.')
    return n

def create_shelf(s, c, v):
    """Neues Regal anlegen: eine maßstäbliche Fläche mit gleich großen Ebenen (siehe shelf.py)."""
    import shelf
    if int(v.get('count', 1)) != 1:
        raise ValueError('Ein Regal wird einzeln angelegt.')
    meta = shelf.clean_meta(v)
    base_width, base_depth = shelf.base_size(meta)
    obj = {'name': v.get('name') or 'Regal', 'type': 'shelf', 'step': 7, 'shape': 'rectangle', 'parked': True, 'parent_id': '', 'footprint': {'width': base_width, 'depth': base_depth, 'unit': 'cm'}, 'template_snapshot': {}, 'quickpot_family': '', 'model_pending': False, 'shelf': meta, **shelf.inner_dims(meta)}
    s.validate(c, 'locations', obj)
    ident = s.put(c, 'locations', obj)
    obj = s.get(c, 'locations', ident)
    obj['parked'] = False
    s.put(c, 'locations', obj, ident)
    obj = s.get(c, 'locations', ident)
    base = v.get('target', {})
    place(s, c, {'kind': 'container', 'id': ident, 'version': obj['version'], 'target': {**base, 'col': nonnegative(base.get('col', 0)), 'row': nonnegative(base.get('row', 0))}})
    shelf.sync_zones(s, c, s.get(c, 'locations', ident))
    return s.get(c, 'locations', ident)


def place(s, c, v, ignore=()):
    kind = v['kind']
    table = 'locations' if kind == 'container' else 'plants'
    if kind not in ('container', 'plant'):
        raise ValueError('Nur Pflanzen oder Behälter verschieben.')
    obj = checked(s, c, table, v['id'], v['version'])
    target = v.get('target', {})
    ident = target.get('location_id') or ''
    dest = scene(s, c, ident)
    loc = s.get(c, 'locations', ident) if ident else None
    if dest['legacy']:
        raise ValueError('Dieses alte Platzraster zuerst einmalig in cm umrechnen.')
    if loc and loc.get('occupancy_status') in ('reserved', 'blocked'):
        raise ValueError('Dieser Behälter ist reserviert oder blockiert. Status zuerst freigeben.')
    if obj.get('is_main') and ident:
        raise ValueError('Hauptstandort zuerst in den Eigenschaften als Unterort freigeben.')
    if kind == 'container' and loc and fixed(loc):
        raise ValueError('Feste QuickPot-Zellen nehmen Pflanzen auf, keine weiteren Töpfe.')
    size = physical(obj)
    if v.get('width') is not None:
        size = {'width': s.features.number(v['width']), 'depth': s.features.number(v['depth']), 'unit': 'cm'}
    if size.get('unknown') and kind == 'container':
        raise ValueError('Bitte zuerst die Außenmaße in cm festlegen.')
    a = {'col': nonnegative(target.get('col', 0)), 'row': nonnegative(target.get('row', 0)), **size, 'shape': obj.get('shape', 'square')}
    if a['shape'] == 'round' and abs(a['width'] - a['depth']) > 1e-08:
        raise ValueError('Ein runder Topf benötigt gleiche Außenmaße.')
    if kind == 'plant' and (not dest['fixed']):
        hit = next((x for x in dest['items'] if x['kind'] == 'container' and geometry.contains(x, a['col'], a['row']) and (s.get(c, 'locations', x['object_id']).get('type') == 'pot')), None)
        if hit:
            s.move_in_transaction(c, obj, {'location_id': hit['object_id'], 'row': 0, 'col': 0, 'width': 1, 'depth': 1})
            return True
    if dest['fixed']:
        if loc.get('model_pending'):
            raise ValueError('Bitte zuerst ein konkretes QuickPot-Modell wählen.')
        row = min(loc['rows'] - 1, math.floor(a['row'] / dest['sy']))
        col = min(loc['cols'] - 1, math.floor(a['col'] / dest['sx']))
        if a['row'] >= dest['depth'] or a['col'] >= dest['width']:
            raise ValueError('Bitte eine Zelle innerhalb der Platte wählen.')
        s.move_in_transaction(c, obj, {'location_id': ident, 'row': row, 'col': col, 'width': 1, 'depth': 1})
        return True
    loose = not dest['bounded'] or bool(target.get('loose'))
    if not loose and (not geometry.fits(a, {'col': 0, 'row': 0, 'width': dest['width'], 'depth': dest['depth'], 'shape': dest.get('shape', 'rectangle')})):
        raise ValueError('Das Objekt passt nicht vollständig auf die Fläche.')
    if loose and dest['bounded'] and geometry.collision(a, {'col': 0, 'row': 0, 'width': dest['width'], 'depth': dest['depth']}):
        raise ValueError('Die freie Ablage liegt außerhalb der begrenzten Stellfläche.')
    if any((x['object_id'] != obj['id'] and x['object_id'] not in ignore and geometry.collision(a, x) for x in dest['items'])):
        raise ValueError('Hier steht bereits ein Objekt oder die Fläche ist reserviert.')
    to = {'location_id': ident}
    if not loose:
        to.update({k: a[k] for k in ('row', 'col', 'width', 'depth')})
    if kind == 'container':
        s.features.move_container_in(c, {'id': obj['id'], 'version': obj['version'], 'target': to})
    else:
        s.move_in_transaction(c, obj, to)
    saved = s.get(c, table, obj['id'])
    saved['footprint'] = {k: a[k] for k in ('width', 'depth')}
    saved['footprint']['unit'] = 'cm'
    if loose:
        saved['workspace_position'] = {'location_id': ident, 'col': a['col'], 'row': a['row']}
    else:
        saved.pop('workspace_position', None)
    s.put(c, table, saved, saved['id'])
    return True

def model(s, c, v):
    obj = checked(s, c, 'locations', v['id'], v['version'])
    t = checked(s, c, 'templates', v['template_id'], v['template_version'])
    if not fixed(obj) or obj.get('type') == 'pot' or t.get('type') != 'quickpot' or t.get('hidden'):
        raise ValueError('Eine sichtbare QuickPot-Vorlage wählen.')
    cells = [x for x in s.allrows(c, 'cells') if x['location_id'] == obj['id']]
    mappings = v.get('mapping', {})
    updated = []
    before = {p['id']: s.current_place(c, p) for p in s.allrows(c, 'plants') if p.get('location_id') == obj['id']}
    for x in cells:
        if x.get('container_id'):
            raise ValueError('Diese Platte enthält einzelne Töpfe. Bitte zuerst umstellen.')
        row, col = mappings.get(x['id'], [x['row'], x['col']])
        if not float(row).is_integer() or not float(col).is_integer() or min(row, col) < 0 or (row + x.get('depth', 1) > t['rows']) or (col + x.get('width', 1) > t['cols']):
            raise ValueError('Belegte Zellen passen nicht: bitte in der Vorschau neu zuordnen.')
        n = {**x, 'row': int(row), 'col': int(col)}
        if any((geometry.collision(n, y) for y in updated)):
            raise ValueError('Zwei Belegungen dürfen nicht dieselbe Zielzelle nutzen.')
        updated.append(n)
    for z in s.allrows(c, 'zones'):
        if z['location_id'] == obj['id'] and any((a['row'] + a['depth'] > t['rows'] or a['col'] + a['width'] > t['cols'] for a in z['areas'])):
            raise ValueError('Eine Zone passt nicht in das neue Zellraster. Bitte zuerst die Zone anpassen.')
    turn = orientation(obj)
    w, h = (t['width'], t['depth'])
    if turn % 2:
        w, h = (h, w)
    obj.update(model_pending=False, rows=t['rows'], cols=t['cols'], template_snapshot=t, quickpot_family=t.get('family', ''), orientation=turn, footprint={'width': w, 'depth': h, 'unit': 'cm'})
    # Validate the new outer contour before writing any cell mapping.
    outer = next((x for x in s.allrows(c, 'cells') if x.get('container_id') == obj['id']), None)
    if outer:
        parent = s.get(c, 'locations', outer['location_id'])
        if parent.get('unit') != 'cm':
            raise ValueError('Übergeordnetes Platzraster zuerst in cm umrechnen.')
        outer.update(width=w, depth=h)
        s.features.check_area(c, parent, outer, [outer['id']])
        s.put(c, 'cells', outer, outer['id'])
    else:
        sc = scene(s, c, obj.get('parent_id') or '')
        old = next((x for x in sc['items'] if x['object_id'] == obj['id']), None)
        if old and any((x['object_id'] != obj['id'] and geometry.collision({**old, 'width': w, 'depth': h}, x) for x in sc['items'])):
            raise ValueError('Die größeren Außenmaße kollidieren mit einem anderen Objekt.')
        if old:
            obj['workspace_position'] = {'location_id': sc['id'], 'col': old['col'], 'row': old['row']}
    s.put(c, 'locations', obj, obj['id'])
    for x in updated:
        s.put(c, 'cells', x, x['id'])
    for p in s.allrows(c, 'plants'):
        if p['id'] in before:
            s.remember(c, p, before[p['id']], s.current_place(c, p), 'QuickPot-Modell gewechselt')
            s.put(c, 'plants', p, p['id'])
    return True

def dispatch(s, c, action, v):
    if action in ('arrange', 'remove-container', 'remove-containers', 'unassign', 'unassign-plants'):
        import planner_qol
        return planner_qol.dispatch(s, c, action, v)
    if action in ('edit', 'colors'):
        import object_edit
        return object_edit.dispatch(s, c, action, v)
    if action == 'scenes':
        return [scene(s, c, x) for x in v.get('ids', [''])]
    if action == 'place':
        return place(s, c, v)
    if action == 'batch':
        entries = v.get('entries', [])
        if not 1 <= len(entries) <= 500:
            raise ValueError('Bitte 1 bis 500 Objekte auswählen.')
        ids = [e['id'] for e in entries]
        if len(ids) != len(set(ids)):
            raise ValueError('Objekt doppelt ausgewählt.')
        targets = []
        for e in entries:
            obj = checked(s, c, 'locations' if e['kind'] == 'container' else 'plants', e['id'], e['version'])
            sc = scene(s, c, e['target'].get('location_id') or '')
            if sc['fixed']:
                raise ValueError('Feste Zellen bitte einzeln zuordnen.')
            size = physical(obj)
            a = {**size, 'shape': obj.get('shape', 'square'), 'row': nonnegative(e['target']['row']), 'col': nonnegative(e['target']['col'])}
            if any((ident == sc['id'] and geometry.collision(a, b) for ident, b in targets)):
                raise ValueError('Die ausgewählten Objekte würden sich am Ziel überlappen.')
            targets.append((sc['id'], a))
        for e in entries:
            place(s, c, e, ignore=ids)
        return True
    if action == 'model':
        return model(s, c, v)
    if action == 'calibrate':
        loc = checked(s, c, 'locations', v['id'], v['version'])
        step = s.features.number(v['step'])
        if fixed(loc) or loc.get('unit') == 'cm' or (not s.features.has_plan(loc)):
            raise ValueError('Nur ein bestehendes Platzraster kann umgerechnet werden.')
        w = loc['cols'] * step
        h = loc['rows'] * step
        if max(w, h) > 3000:
            raise ValueError('Fläche darf höchstens 3000 cm je Seite groß sein.')
        for cell in s.allrows(c, 'cells'):
            if cell['location_id'] != loc['id']:
                continue
            for k in ('row', 'col', 'width', 'depth'):
                cell[k] = cell.get(k, 1) * step
            s.put(c, 'cells', cell, cell['id'])
            kind = 'locations' if cell.get('container_id') else 'plants' if cell.get('plant_id') else None
            if kind:
                obj = s.get(c, kind, cell.get('container_id') or cell['plant_id'])
                obj['footprint'] = {'width': cell['width'], 'depth': cell['depth'], 'unit': 'cm'}
                s.put(c, kind, obj, obj['id'])
        for z in s.allrows(c, 'zones'):
            if z['location_id'] == loc['id']:
                for a in z['areas']:
                    for k in ('row', 'col', 'width', 'depth'):
                        a[k] *= step
                s.put(c, 'zones', z, z['id'])
        loc.update(unit='cm', width_cm=w, depth_cm=h, step=step, rows=math.ceil(h), cols=math.ceil(w))
        s.put(c, 'locations', loc, loc['id'])
        return True
    if action == 'properties':
        obj = checked(s, c, 'locations', v['id'], v['version'])
        sc = scene(s, c, obj.get('parent_id') or '')
        a = next((x for x in sc['items'] if x['object_id'] == obj['id']), None)
        if not a:
            obj['footprint'] = {'width': s.features.number(v['width']), 'depth': s.features.number(v['depth']), 'unit': 'cm'}
            if obj.get('shape') in ('round', 'square') and obj['footprint']['width'] != obj['footprint']['depth']:
                raise ValueError('Gleiche Außenmaße erforderlich.')
        else:
            place(s, c, {'kind': 'container', 'id': obj['id'], 'version': obj['version'], 'width': v['width'], 'depth': v['depth'], 'target': {'location_id': sc['id'], 'col': a['col'], 'row': a['row'], 'loose': a['loose']}})
            obj = s.get(c, 'locations', obj['id'])
        obj['name'] = str(v.get('name') or obj['name'])
        s.put(c, 'locations', obj, obj['id'])
        return True
    if action == 'create':
        count = int(v.get('count', 1))
        per = int(v.get('per_row', 1))
        if not 1 <= count <= 500 or not 1 <= per <= 500:
            raise ValueError('Anzahl und Spalten: 1 bis 500.')
        object_type = v.get('object_type', 'pot')
        if object_type not in ('pot', 'tray', 'table', 'tub', 'shelf'):
            raise ValueError('Ungültiger Objekttyp.')
        if object_type == 'shelf':
            return [create_shelf(s, c, v)]
        family = v.get('family')
        t = checked(s, c, 'templates', v['template_id'], v['template_version']) if v.get('template_id') else None
        if t and t.get('hidden'):
            raise ValueError('Vorlage ist ausgeblendet.')
        if t and t.get('blueprint'):
            import blueprints
            if count != 1:
                raise ValueError('Zusammenstellungen einzeln verwenden oder strukturell duplizieren.')
            return [blueprints.instantiate(s, c, t['blueprint'], v.get('target'), t)]
        if family and family not in ('Standard', 'Dänenmaß'):
            raise ValueError('Unbekannte Maßfamilie.')
        default_size = Counter(((t['width'], t['depth']) for t in s.allrows(c, 'templates') if t.get('type') == 'quickpot' and t.get('family') == family)).most_common(1) if family else []
        dw, dh = default_size[0][0] if default_size else (7, 7)
        w = s.features.number(t['width'] if t else v.get('width', dw))
        h = s.features.number(t['depth'] if t else v.get('depth', dh))
        shape = t.get('shape', 'rectangle') if t else 'rectangle' if family else v.get('shape', 'square')
        if shape not in ('round', 'square', 'rectangle') or (shape in ('round', 'square') and w != h):
            raise ValueError('Ungültige Topfform oder Außenmaße.')
        gap = nonnegative(v.get('gap', 0))
        base = v.get('target', {})
        result = []
        for i in range(count):
            plate = bool(family or (t and t.get('type') in ('quickpot', 'tray')))
            obj = {'name': v.get('name') or (t['name'] if t else 'QuickPot ' + family if family else 'Topf'), 'type': 'tray' if plate else 'pot', 'unit': 'slots', 'rows': t['rows'] if plate and t else 1, 'cols': t['cols'] if plate and t else 1, 'shape': shape, 'parked': True, 'parent_id': '', 'footprint': {'width': w, 'depth': h, 'unit': 'cm'}, 'template_snapshot': t or {}, 'quickpot_family': family or (t.get('family', '') if t and t.get('type') == 'quickpot' else ''), 'model_pending': bool(family and (not t))}
            if not plate and object_type != 'pot':
                obj.update(type=object_type, name=v.get('name') or {'table': 'Tisch', 'tray': 'Tray', 'tub': 'Kübel'}[object_type], unit='cm', width_cm=w, depth_cm=h, rows=math.ceil(h), cols=math.ceil(w), step=7)
            if plate and t and (t.get('type') == 'tray'):
                obj.update(unit='cm', width_cm=w, depth_cm=h, rows=math.ceil(h), cols=math.ceil(w), step=7)
            if count > 1:
                obj['name'] += ' · ' + str(i + 1)
            s.validate(c, 'locations', obj)
            ident = s.put(c, 'locations', obj)
            obj = s.get(c, 'locations', ident)
            # Hide this new object from collision projections until its first placement.
            obj['parked'] = False
            s.put(c, 'locations', obj, ident)
            obj = s.get(c, 'locations', ident)
            place(s, c, {'kind': 'container', 'id': ident, 'version': obj['version'], 'target': {**base, 'col': nonnegative(base.get('col', 0)) + i % per * (w + gap), 'row': nonnegative(base.get('row', 0)) + i // per * (h + gap)}})
            result.append(s.get(c, 'locations', ident))
        return result
    if action == 'rotate':
        obj = checked(s, c, 'locations', v['id'], v['version'])
        if obj.get('shape') == 'round':
            raise ValueError('Runde Töpfe benötigen keine Drehung.')
        sc = scene(s, c, obj.get('parent_id') or '')
        a = next((x for x in sc['items'] if x['object_id'] == obj['id']), None)
        size = physical(obj)
        if not a:
            obj['footprint'] = {'width': size['depth'], 'depth': size['width'], 'unit': 'cm'}
            obj['orientation'] = (orientation(obj) + 1) % 4
            s.put(c, 'locations', obj, obj['id'])
            return True
        place(s, c, {'kind': 'container', 'id': obj['id'], 'version': obj['version'], 'width': size['depth'], 'depth': size['width'], 'target': {'location_id': sc['id'], 'col': a['col'], 'row': a['row'], 'loose': a['loose']}})
        saved = s.get(c, 'locations', obj['id'])
        saved['orientation'] = (orientation(obj) + 1) % 4
        s.put(c, 'locations', saved, saved['id'])
        return True
    raise ValueError('Unbekannte Arbeitsflächenaktion.')
