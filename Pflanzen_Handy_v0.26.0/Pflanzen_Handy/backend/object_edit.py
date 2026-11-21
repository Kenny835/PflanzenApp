"""0.8 object edits are atomic; parking is an explicit alternative to a spatial conflict."""
import math, re
import geometry
import workspace as w

class SpaceConflict(ValueError):
    pass

def color(value):
    if value in ('', None):
        return ''
    if not re.fullmatch('#[0-9a-fA-F]{6}', str(value)):
        raise ValueError('Randfarbe muss eine gültige Hex-Farbe sein.')
    return value.lower()

def edit(s, c, v):
    old = w.checked(s, c, 'locations', v['id'], v['version'])
    c.execute('SAVEPOINT object_edit')
    try:
        result = apply(s, c, old, v)
    except SpaceConflict as e:
        c.execute('ROLLBACK TO object_edit')
        c.execute('RELEASE object_edit')
        if not v.get('park_on_conflict'):
            return {'needs_parking': True, 'message': str(e)}
        # Re-run all validations after rollback; only placement is allowed to change.
        return apply(s, c, old, v, park=True)
    else:
        c.execute('RELEASE object_edit')
        return result

def apply(s, c, old, v, park=False):
    typ = v.get('type') or ('quickpot' if w.fixed(old) and old.get('type') != 'pot' else old.get('type', 'place'))
    if typ not in ('pot', 'quickpot', 'tray', 'table', 'tub', 'bed', 'shelf', 'other', 'place'):
        raise ValueError('Ungültiger Objekttyp.')
    obj = dict(old)
    size = w.physical(old)
    shape = v.get('shape', old.get('shape', 'rectangle'))
    turn = (w.orientation(old) + (1 if v.get('rotate') else 0)) % 4
    if shape not in ('round', 'square', 'rectangle'):
        raise ValueError('Ungültige Form.')
    width = s.features.number(v.get('width'), size['width'])
    depth = s.features.number(v.get('depth'), size['depth'])
    if v.get('rotate'):
        width, depth = (depth, width)
    template = None
    family = v.get('family') or old.get('quickpot_family') or 'Standard'
    if typ == 'quickpot':
        tid = v.get('template_id') if 'template_id' in v else old.get('template_snapshot', {}).get('id') if old.get('template_snapshot', {}).get('type') == 'quickpot' else None
        if tid:
            template = w.checked(s, c, 'templates', tid, v.get('template_version', old.get('template_snapshot', {}).get('version')))
            if template.get('type') != 'quickpot' or (template.get('hidden') and template['id'] != old.get('template_snapshot', {}).get('id')):
                raise ValueError('Bitte ein verfügbares QuickPot-Modell wählen.')
            width, depth = (template['width'], template['depth'])
            family = template.get('family', family)
            if turn % 2:
                width, depth = (depth, width)
        shape = 'rectangle'
    import shelf
    shelf.guard_edit(old, typ, width, depth)
    if shape in ('square', 'round') and width != depth:
        raise ValueError('Runde und quadratische Objekte brauchen gleiche Außenmaße.')
    status = v.get('occupancy_status', old.get('occupancy_status', 'empty'))
    if status not in ('empty', 'reserved', 'blocked'):
        raise ValueError('Ungültiger Flächenstatus.')
    main = v.get('is_main', old.get('is_main', False)) in (True, 'true', 'on', '1')
    children = [x for x in s.allrows(c, 'locations') if x.get('parent_id') == old['id']]
    plants = [p for p in s.allrows(c, 'plants') if p.get('location_id') == old['id']]
    cells = [x for x in s.allrows(c, 'cells') if x['location_id'] == old['id']]
    zones = [z for z in s.allrows(c, 'zones') if z['location_id'] == old['id']]
    if typ in ('pot', 'quickpot') and children:
        raise ValueError('Ein Topf oder eine QuickPotplatte kann keine weiteren Behälter enthalten. Diese zuerst umstellen.')
    if typ == 'pot' and (len(plants) > 1 or len(cells) > 1):
        raise ValueError('Ein einzelner Topf hat nur einen Pflanzenplatz. Vor dem Umwandeln die weiteren Belegungen neu zuordnen.')
    if typ == 'quickpot' and (not template) and (plants or cells):
        raise ValueError('Für vorhandene Pflanzen bitte ein konkretes QuickPot-Modell wählen.')
    if status != 'empty' and (plants or children or any((x['mode'] in ('present', 'container') for x in cells))):
        raise ValueError('Belegte Behälter zuerst leeren, bevor sie reserviert oder blockiert werden.')
    if main and typ in ('pot', 'quickpot'):
        raise ValueError('Ein Hauptstandort ist ein Ort oder eine freie Stellfläche, kein einzelner Topf oder eine QuickPotplatte.')
    fixed = typ in ('pot', 'quickpot')
    rows = template['rows'] if template else 1
    cols = template['cols'] if template else 1
    if 'group_id' in v:
        s.ref(c, v, 'group_id', 'groups')
        obj['group_id'] = v['group_id']
    obj.update(name=str(v.get('name') or old['name']), type='tray' if typ == 'quickpot' else typ, shape=shape, orientation=turn, border_color=color(v.get('border_color', old.get('border_color', ''))), occupancy_status=status, is_main=main, footprint={'width': width, 'depth': depth, 'unit': 'cm'}, quickpot_family=family if typ == 'quickpot' else '', template_snapshot=template or {}, model_pending=typ == 'quickpot' and (not template))
    if fixed:
        obj.update(unit='slots', rows=rows, cols=cols)
    elif typ != 'place' or s.features.has_plan(old):
        iw, ih = (depth, width) if turn % 2 else (width, depth)
        obj.update(unit='cm', width_cm=iw, depth_cm=ih, rows=math.ceil(ih), cols=math.ceil(iw), step=old.get('step', 7))
        if old.get('shelf'):
            obj.update(shelf.inner_dims(old['shelf']))  # Innenansicht mit allen Ebenen bleibt; geändert wird nur die Grundfläche (Drehen)
    else:
        obj.update(unit='slots', rows=0, cols=0)
    # Explicit cell mapping can address existing cells or previously unplaced plants.
    mapping = v.get('mapping', {})
    updated = []
    oldfixed = bool(w.fixed(old))
    for x in cells:
        n = dict(x)
        if fixed:
            pos = mapping.get(x['id'])
            if pos is None and typ == 'pot':
                pos = [0, 0]
            if pos is None and (not oldfixed):
                raise ValueError('Beim Wechsel zur QuickPotplatte bitte jede Belegung einer Zelle zuordnen.')
            pos = pos or [x['row'], x['col']]
            if not all((float(a).is_integer() for a in pos)):
                raise ValueError('Zelladressen müssen ganzzahlig sein.')
            n.update(row=int(pos[0]), col=int(pos[1]), width=1 if x['mode'] == 'present' else x.get('width', 1), depth=1 if x['mode'] == 'present' else x.get('depth', 1))
        elif oldfixed:
            local = w.physical(old)
            if turn % 2:
                local['width'], local['depth'] = (local['depth'], local['width'])
            sx = local['width'] / max(1, old.get('cols', 1))
            sy = local['depth'] / max(1, old.get('rows', 1))
            n.update(col=x['col'] * sx, row=x['row'] * sy, width=x.get('width', 1) * sx, depth=x.get('depth', 1) * sy)
        updated.append(n)
    for p in plants:
        if fixed and (not any((x.get('plant_id') == p['id'] and x['mode'] == 'present' for x in updated))):
            pos = mapping.get('plant:' + p['id'], [0, 0] if typ == 'pot' else None)
            if pos is None:
                raise ValueError('Bitte auch Pflanzen ohne Rasterplatz einer Zelle zuordnen.')
            updated.append({'location_id': old['id'], 'plant_id': p['id'], 'mode': 'present', 'row': float(pos[0]), 'col': float(pos[1]), 'width': 1, 'depth': 1})
    bound = {'col': 0, 'row': 0, 'width': obj['cols'] if fixed else obj.get('width_cm', width), 'depth': obj['rows'] if fixed else obj.get('depth_cm', depth), 'shape': 'rectangle' if fixed else shape}
    for i, x in enumerate(updated):
        if not geometry.fits(s.features.contour(c, x), bound):
            raise ValueError('Der vorhandene Inhalt passt nicht in die neue Innenfläche. Erst Belegungen umstellen oder Zellen zuordnen.')
        if any((geometry.collision(s.features.contour(c, x), s.features.contour(c, y)) for y in updated[:i])):
            raise ValueError('Die neue Zuordnung enthält überlappende Belegungen.')
    for z in zones:
        if fixed != oldfixed:
            raise ValueError('Vor einem Wechsel zwischen festen Zellen und freier Innenfläche die vorhandenen Zonen bearbeiten.')
        if any((not geometry.fits(a, bound) for a in z['areas'])):
            raise ValueError('Eine vorhandene Zone passt nicht in die neue Innenfläche.')
    sc = w.scene(s, c, old.get('parent_id') or '')
    a = next((x for x in sc['items'] if x['object_id'] == old['id']), None)
    candidate = {**(a or {}), 'width': width, 'depth': depth, 'shape': shape}
    if a and (not park) and (not main):
        if sc['legacy']:
            raise ValueError('Das übergeordnete Platzraster zuerst in cm umrechnen.')
        boundary = {'col': 0, 'row': 0, 'width': sc['width'], 'depth': sc['depth'], 'shape': sc.get('shape', 'rectangle')}
        if not a['loose'] and (not geometry.fits(candidate, boundary)):
            raise SpaceConflict('Die geänderten Außenmaße passen nicht auf die bisherige Stellfläche.')
        if a['loose'] and sc['bounded'] and geometry.collision(candidate, boundary):
            raise SpaceConflict('Die neue Größe ragt aus der freien Ablage in die Stellfläche.')
        if any((x['object_id'] != old['id'] and geometry.collision(candidate, x) for x in sc['items'])):
            raise SpaceConflict('Für die geänderte Größe ist am bisherigen Platz nicht genug Platz.')
    if park or main:
        s.features.move_container_in(c, {'id': old['id'], 'version': old['version'], 'target': {}})
        obj.update(parent_id='', parked=not main)
        obj.pop('workspace_position', None)
    elif a:
        outer = next((x for x in s.allrows(c, 'cells') if x.get('container_id') == old['id']), None)
        if outer:
            outer.update(width=width, depth=depth)
            s.put(c, 'cells', outer, outer['id'])
        else:
            obj['workspace_position'] = {'location_id': sc['id'], 'row': a['row'], 'col': a['col']}
    s.put(c, 'locations', obj, obj['id'])
    for x in updated:
        s.put(c, 'cells', x, x.get('id'))
    for p in plants:
        cell = next((x for x in updated if x.get('plant_id') == p['id'] and x['mode'] == 'present'), None)
        if cell:
            p = s.get(c, 'plants', p['id'])
            p['footprint'] = {'width': cell['width'], 'depth': cell['depth'], 'unit': obj['unit']}
            s.put(c, 'plants', p, p['id'])
    return {'saved': True, 'parked': park, 'id': obj['id']}

def dispatch(s, c, action, v):
    if action == 'edit':
        return edit(s, c, v)
    if action == 'colors':
        col = color(v.get('border_color'))
        entries = v.get('entries', [])
        if not 1 <= len(entries) <= 500:
            raise ValueError('Bitte 1 bis 500 Objekte auswählen.')
        for entry in entries:
            kind = entry.get('kind', 'locations')
            if kind not in ('locations', 'plants'):
                raise ValueError('Ungültiger Objekttyp.')
            obj = w.checked(s, c, kind, entry['id'], entry['version'])
            obj['border_color'] = col
            s.put(c, kind, obj, obj['id'])
        return True
    raise ValueError('Unbekannte Objektaktion.')
