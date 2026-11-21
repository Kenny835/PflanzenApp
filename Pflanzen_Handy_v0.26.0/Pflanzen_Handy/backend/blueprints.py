"""Versioned structural templates. No plants, sowing assignments or real IDs in blueprints."""
import copy, math
import geometry
import workspace as w

def number(value):
    n = float(value)
    if not math.isfinite(n) or not 0.1 <= n <= 3000:
        raise ValueError('Maße: 0,1 bis 3000 cm.')
    return n

def clean(node, depth=0, budget=None):
    if budget is None:
        budget = [0]
    budget[0] += 1
    if depth > 8 or budget[0] > 1000:
        raise ValueError('Maximal 1000 Elemente und 8 Unterebenen je Zusammenstellung.')
    typ = node.get('type', 'tray')
    if typ not in ('pot', 'site', 'quickpot', 'tray', 'table', 'tub', 'bed', 'shelf', 'other'):
        raise ValueError('Unbekannter Baustein.')
    n = {'type': typ, 'name': str(node.get('name') or {'site': 'Pflanzstelle', 'pot': 'Topf'}.get(typ, 'Behälter')), 'width': number(node.get('width')), 'depth': number(node.get('depth')), 'shape': node.get('shape', 'rectangle'), 'children': []}
    if n['shape'] not in ('round', 'square', 'rectangle') or (n['shape'] in ('round', 'square') and n['width'] != n['depth']):
        raise ValueError('Form und Maße passen nicht zusammen.')
    if typ == 'shelf':
        import shelf
        n['shelf'] = shelf.clean_meta(node.get('shelf') or {})
        expected = shelf.base_size(n['shelf'])
        if n['shape'] != 'rectangle' or abs(n['width'] - expected[0]) > 1e-6 or abs(n['depth'] - expected[1]) > 1e-6:
            raise ValueError('Die Regalmaße passen nicht zu den Ebenen.')
        frame = shelf.outer_size(n['shelf'])  # Unterbehälter liegen in der Innenansicht, nicht auf der Grundfläche
    if typ == 'quickpot':
        for k in ('rows', 'cols'):
            f = float(node.get(k, 0))
            if not f.is_integer() or not 1 <= f <= 3000:
                raise ValueError('Ganze Reihen und Spalten angeben.')
            n[k] = int(f)
        if n['rows'] * n['cols'] > 10000:
            raise ValueError('Maximal 10000 Zellen pro Platte.')
    if typ in ('pot', 'site', 'quickpot') and node.get('children'):
        raise ValueError('Feste Pflanzplätze enthalten keine weiteren Gefäße.')
    boxes = []
    for child in node.get('children', []):
        item = clean(child['node'], depth + 1, budget)
        x = float(child['col'])
        y = float(child['row'])
        if not all((math.isfinite(q) and q >= 0 for q in (x, y))):
            raise ValueError('Ungültige Position.')
        a = {'col': x, 'row': y, 'width': item['width'], 'depth': item['depth'], 'shape': item['shape']}
        if not geometry.fits(a, {'col': 0, 'row': 0, **n, **({'width': frame[0], 'depth': frame[1]} if typ == 'shelf' else {})}):
            raise ValueError('Ein Baustein liegt außerhalb des Containers.')
        if any((geometry.collision(a, b) for b in boxes)):
            raise ValueError('Bausteine überschneiden sich.')
        boxes.append(a)
        n['children'].append({'col': x, 'row': y, 'node': item})
    return n

def from_template(t):
    if t.get('unit', 'cm') != 'cm':
        raise ValueError('Vorlage verwendet alte Rasterplätze. Zuerst reale Außenmaße in cm festlegen.')
    if t.get('blueprint'):
        return copy.deepcopy(t['blueprint'])
    return clean({'name': t['name'], 'type': t.get('type', 'pot'), 'width': t['width'], 'depth': t['depth'], 'shape': t.get('shape', 'rectangle'), 'rows': t.get('rows', 1), 'cols': t.get('cols', 1)})

def capture(s, c, loc, seen=None):
    seen = set() if seen is None else seen
    if loc['id'] in seen:
        raise ValueError('Zyklische Behälterstruktur.')
    seen.add(loc['id'])
    size = w.physical(loc)
    typ = 'site' if loc.get('planting_site') else 'quickpot' if loc.get('quickpot_family') or loc.get('template_snapshot', {}).get('type') == 'quickpot' else loc.get('type', 'tray')
    if typ not in ('pot', 'site', 'quickpot', 'tray', 'table', 'tub', 'bed', 'shelf', 'other'):
        typ = 'other'
    if size.get('unknown'):
        raise ValueError('Zuerst Außenmaße für alle enthaltenen Behälter festlegen.')
    n = {'name': loc['name'], 'type': typ, 'width': size['width'], 'depth': size['depth'], 'shape': loc.get('shape', 'rectangle'), 'rows': loc.get('rows', 1), 'cols': loc.get('cols', 1), 'children': []}
    if loc.get('shelf'):
        n['shelf'] = copy.deepcopy(loc['shelf'])
        n['width'], n['depth'] = (loc['shelf']['width'], loc['shelf']['depth'])
    # Preserve the visual orientation of fixed plates in a new independent copy.
    if typ == 'quickpot' and w.orientation(loc) % 2:
        n['rows'], n['cols'] = (n['cols'], n['rows'])
    sc = w.scene(s, c, loc['id'])
    for item in sc['items']:
        if item['kind'] != 'container':
            continue
        if item.get('loose'):
            raise ValueError('Unterbehälter zuerst innerhalb der Stellfläche platzieren, bevor die Struktur kopiert wird.')
        n['children'].append({'col': item['col'], 'row': item['row'], 'node': capture(s, c, s.get(c, 'locations', item['object_id']), seen)})
    return clean(n)

def instantiate(s, c, node, target=None, template=None):
    node = clean(node)

    def add(n, parent='', x=0, y=0):
        fixed = n['type'] in ('pot', 'site', 'quickpot')
        qp = n['type'] == 'quickpot'
        obj = {'name': n['name'], 'type': 'pot' if n['type'] == 'site' else 'tray' if qp else n['type'], 'planting_site': n['type'] == 'site', 'shape': n['shape'], 'parent_id': parent, 'parked': not bool(parent), 'is_main': False, 'unit': 'slots' if fixed else 'cm', 'rows': n.get('rows', 1) if fixed else math.ceil(n['depth']), 'cols': n.get('cols', 1) if fixed else math.ceil(n['width']), 'footprint': {'width': n['width'], 'depth': n['depth'], 'unit': 'cm'}, 'occupancy_status': 'empty'}
        if qp:
            obj.update(template_snapshot={'type': 'quickpot', 'rows': n['rows'], 'cols': n['cols'], 'width': n['width'], 'depth': n['depth'], 'unit': 'cm'}, model_pending=False)
        if not fixed:
            obj.update(width_cm=n['width'], depth_cm=n['depth'], step=1)
        if n.get('shelf'):
            import shelf
            obj['shelf'] = copy.deepcopy(n['shelf'])
            obj.update(shelf.inner_dims(obj['shelf']))
        s.validate(c, 'locations', obj)
        ident = s.put(c, 'locations', obj)
        if parent:
            cell = {'location_id': parent, 'mode': 'container', 'container_id': ident, 'row': y, 'col': x, 'width': n['width'], 'depth': n['depth']}
            s.features.check_area(c, s.get(c, 'locations', parent), cell)
            s.put(c, 'cells', cell)
        for child in n['children']:
            add(child['node'], ident, child['col'], child['row'])
        if n.get('shelf'):
            import shelf
            shelf.sync_zones(s, c, s.get(c, 'locations', ident))
        return ident
    ident = add(node)
    obj = s.get(c, 'locations', ident)
    if template:
        obj['blueprint_source'] = {'id': template['id'], 'version': template['version']}
        s.put(c, 'locations', obj, ident)
        obj = s.get(c, 'locations', ident)
    if target is not None:
        w.place(s, c, {'kind': 'container', 'id': ident, 'version': obj['version'], 'target': target})
    return s.get(c, 'locations', ident)

def dispatch(s, c, action, v):
    if action == 'duplicate':
        obj = w.checked(s, c, 'locations', v['id'], v['version'])
        n = capture(s, c, obj)
        n['name'] = str(v.get('name') or n['name'] + ' · Kopie')
        return instantiate(s, c, n)
    if action == 'capture':
        return capture(s, c, w.checked(s, c, 'locations', v['id'], v['version']))
    if action == 'load':
        return from_template(w.checked(s, c, 'templates', v['id'], v['version']))
    if action == 'delete':
        t = w.checked(s, c, 'templates', v['id'], v['version'])
        if t.get('catalogue_key'):
            raise ValueError('Mitgelieferte Vorlagen bleiben im Hintergrund erhalten.')
        if not v.get('confirmed'):
            raise ValueError('Löschen bitte bestätigen.')
        c.execute('DELETE FROM records WHERE id=?', (t['id'],))
        return True
    if action == 'save':
        old = w.checked(s, c, 'templates', v['id'], v['version']) if v.get('id') else None
        if old and old.get('catalogue_key'):
            raise ValueError('Standardvorlagen als eigene Variante speichern.')
        n = clean(v['blueprint'])
        name = str(v.get('name', '')).strip()
        if not name:
            raise ValueError('Bitte einen Vorlagennamen angeben.')
        n['name'] = name
        t = {'name': name, 'type': 'tray', 'shape': n['shape'], 'unit': 'cm', 'width': n['width'], 'depth': n['depth'], 'rows': 1, 'cols': 1, 'family': 'Eigene Vorlagen', 'blueprint': n, 'hidden': False}
        ident = s.put(c, 'templates', t, old['id'] if old else None)
        return s.get(c, 'templates', ident)
    if action == 'instantiate':
        t = w.checked(s, c, 'templates', v['id'], v['version']) if v.get('id') else None
        n = from_template(t) if t else v['blueprint']
        return instantiate(s, c, n, v.get('target'), t)
    raise ValueError('Unbekannte Baukastenaktion.')
