"""Atomic arrangement and container removal, retaining plants and descendants."""
import math
import geometry
import workspace as w

def arrange(s, c, v):
    ident = v.get('id') or ''
    sc = w.scene(s, c, ident)
    loc = w.checked(s, c, 'locations', ident, v['version']) if ident else None
    if sc['legacy']:
        raise ValueError('Das Platzraster zuerst in cm umrechnen.')
    if loc and (loc.get('model_pending') or loc.get('occupancy_status') in ('blocked', 'reserved')):
        raise ValueError('Bitte zuerst Zellmodell wählen bzw. die Fläche freigeben.')
    items = [x for x in sc['items'] if x['kind'] in ('plant', 'container')]
    obstacles = [x for x in sc['items'] if x['kind'] == 'cell']
    if not items:
        return {'count': 0}
    if len(items) > 500:
        raise ValueError('Bitte höchstens 500 Objekte gleichzeitig anordnen.')
    if any((x.get('unknown') and x['kind'] == 'container' for x in items)):
        raise ValueError('Bitte zuerst für alle Behälter die Außenmaße festlegen.')
    before = {p['id']: s.current_place(c, p) for p in s.allrows(c, 'plants')}
    targets = {}
    if sc['fixed']:
        available = []
        for row in range(loc['rows']):
            for col in range(loc['cols']):
                a = {'row': row * sc['sy'], 'col': col * sc['sx'], 'width': sc['sx'], 'depth': sc['sy']}
                if not any((geometry.collision(a, b) for b in obstacles)):
                    available.append(a)
        if len(available) < len(items):
            raise ValueError('Nicht genug freie Zellen. Es wurde nichts verändert.')
        for item, a in zip(sorted(items, key=lambda a: (a['row'], a['col'], a['object_id'])), available):
            targets[item['object_id']] = a
    else:
        width = sc['width'] if sc['bounded'] else max(100, math.sqrt(sum((i['width'] * i['depth'] for i in items)) * 1.5), max((i['width'] for i in items)))
        height = sc['depth'] if sc['bounded'] else 3000
        boundary = {'row': 0, 'col': 0, 'width': width, 'depth': height, 'shape': sc.get('shape') if sc['bounded'] else 'rectangle'}
        best = None
        # Three deterministic greedy layouts; no rotation or parent changes.
        for key in (lambda a: -(a['width'] * a['depth']), lambda a: -a['depth'], lambda a: -a['width']):
            placed = list(obstacles)
            trial = {}
            points = {(0.0, 0.0)}
            attempts = 0
            for b in obstacles:
                points.update(((b['col'] + b['width'], b['row']), (b['col'], b['row'] + b['depth'])))
            for item in sorted(items, key=lambda a: (key(a), a['object_id'])):
                # Circular boundaries need candidate offsets away from their corners.
                if boundary.get('shape') == 'round':
                    step = max(0.5, min(item['width'], item['depth']) / 2, width / 150, height / 150)
                    candidates = ((x * step, y * step) for y in range(math.ceil(height / step)) for x in range(math.ceil(width / step)))
                else:
                    candidates = sorted(points, key=lambda p: (p[1], p[0]))
                chosen = None
                for x, y in candidates:
                    attempts += 1
                    if attempts > 150000:
                        break
                    a = {**item, 'col': x, 'row': y}
                    if geometry.fits(a, boundary) and (not any((geometry.collision(a, b) for b in placed))):
                        chosen = a
                        break
                if chosen is None:
                    break
                trial[item['object_id']] = chosen
                placed.append(chosen)
                x = chosen['col']
                y = chosen['row']
                right = x + item['width']
                bottom = y + item['depth']
                points.discard((x, y))
                points.update(((right, y), (x, bottom), (0.0, bottom), (right, 0.0)))
            if len(trial) == len(items):
                score = (max((a['row'] + a['depth'] for a in trial.values())), max((a['col'] + a['width'] for a in trial.values())))
                if best is None or score < best[0]:
                    best = (score, trial)
        if best is None:
            raise ValueError('Keine passende Anordnung gefunden. Die bisherigen Plätze bleiben unverändert. Die automatische Suche garantiert keine mathematisch optimale Packung.')
        targets = best[1]
    ids = {x['object_id'] for x in items}
    oldcells = {x.get('container_id') or x.get('plant_id'): x for x in s.allrows(c, 'cells') if x['location_id'] == ident and x['mode'] in ('present', 'container')}
    for objid, cell in oldcells.items():
        if objid in ids:
            s.put(c, 'cells', {**cell, 'location_id': ''}, cell['id'])
    for item in items:
        kind = 'locations' if item['kind'] == 'container' else 'plants'
        obj = s.get(c, kind, item['object_id'])
        a = targets[obj['id']]
        if sc['bounded']:
            cell = {**oldcells.get(obj['id'], {}), 'location_id': ident, 'mode': 'container' if kind == 'locations' else 'present', 'container_id' if kind == 'locations' else 'plant_id': obj['id'], 'row': a['row'] / sc['sy'], 'col': a['col'] / sc['sx'], 'width': a['width'] / sc['sx'], 'depth': a['depth'] / sc['sy']}
            s.features.check_area(c, loc, cell)
            s.put(c, 'cells', cell, cell.get('id'))
            obj.pop('workspace_position', None)
            obj['footprint'] = {'width': cell['width'], 'depth': cell['depth'], 'unit': loc.get('unit', 'slots')}
        else:
            obj['workspace_position'] = {'location_id': ident, 'col': a['col'], 'row': a['row']}
        s.put(c, kind, obj, obj['id'])
    for p in s.allrows(c, 'plants'):
        after = s.current_place(c, p)
        if before[p['id']] != after:
            s.remember(c, p, before[p['id']], after, 'Automatisch angeordnet')
            s.put(c, 'plants', p, p['id'])
    return {'count': len(items)}

def park_container(s, c, child):
    """Container samt Inhalt auf den Parkplatz verschieben (Struktur und Pflanzen bleiben unverändert)."""
    s.features.move_container_in(c, {'id': child['id'], 'version': child['version'], 'target': {}})
    child = s.get(c, 'locations', child['id'])
    child.pop('workspace_position', None)
    s.put(c, 'locations', child, child['id'])


def remove(s, c, v):
    """Einzelner Behälter: gleiche Regel wie remove_many (siehe dort)."""
    return remove_many(s, c, {'entries': [{'id': v['id'], 'version': v['version']}], 'confirmed': v.get('confirmed')})


def dispatch(s, c, action, v):
    if action == 'arrange':
        return arrange(s, c, v)
    if action == 'remove-containers':
        return remove_many(s, c, v)
    if action == 'unassign-plants':
        entries = v.get('entries')
        if not isinstance(entries, list) or not 1 <= len(entries) <= 1000:
            raise ValueError('Bitte 1 bis 1000 Pflanzen auswählen.')
        plants = {e['id']: w.checked(s, c, 'plants', e['id'], e['version']) for e in entries}
        for p in plants.values():
            unassign_plant(s, c, p)
        return {'count': len(plants)}
    if action == 'remove-container':
        return remove(s, c, v)
    if action == 'unassign':
        p = w.checked(s, c, 'plants', v['id'], v['version'])
        if p.get('location_id') != v.get('location_id'):
            raise ValueError('Die Pflanze wurde inzwischen umgestellt.')
        unassign_plant(s, c, p)
        return True
    raise ValueError('Unbekannte Aktion.')

def unassign_plant(s, c, p):
    s.move_in_transaction(c, p, {}, 'Aus Planer entfernt – im Bestand, nicht zugeordnet')
    for cell in s.allrows(c, 'cells'):
        if cell.get('plant_id') == p['id']:
            c.execute('DELETE FROM records WHERE id=?', (cell['id'],))
    p = s.get(c, 'plants', p['id'])
    p.pop('workspace_position', None)
    p['planner_hidden'] = True
    s.put(c, 'plants', p, p['id'])

def remove_many(s, c, v):
    """Ausgewählte Behälter löschen, alles in einer Transaktion.

    Eine Regel für Einzel- und Mehrfachauswahl:
    - Behälter, die in einem gelöschten Behälter liegen (und selbst nicht mit gelöscht werden), kommen samt Inhalt
      und Pflanzen unverändert auf den Parkplatz.
    - Pflanzen, die direkt in einem gelöschten Behälter stehen (Topf, Pflanzstelle, Quickpot-Platte), werden
      "nicht zugeordnet": Sie bleiben im Bestand, erscheinen aber weder im Planer noch auf dem Parkplatz.
    Ein Löschen wird nie blockiert, nur weil Pflanzen enthalten sind."""
    if v.get('confirmed') is not True:
        raise ValueError('Löschen bitte bestätigen.')
    entries = v.get('entries')
    if not isinstance(entries, list) or not 1 <= len(entries) <= 1000:
        raise ValueError('Bitte 1 bis 1000 Behälter auswählen.')
    selected = [w.checked(s, c, 'locations', e['id'], e['version']) for e in entries]
    ids = {obj['id'] for obj in selected}
    locations = s.allrows(c, 'locations')
    # 1. Untergeordnete Behälter, die bleiben, kommen samt Inhalt auf den Parkplatz.
    parked = 0
    for child in locations:
        if child.get('parent_id') in ids and child['id'] not in ids:
            park_container(s, c, s.get(c, 'locations', child['id']))
            parked += 1
    # 2. Pflanzen direkt in gelöschten Behältern: nicht zugeordnet, im Bestand behalten.
    plants = [p for p in s.allrows(c, 'plants') if p.get('location_id') in ids]
    for p in plants:
        unassign_plant(s, c, s.get(c, 'plants', p['id']))
    # 3. Aussaatbelegungen dokumentieren.
    import sowing
    groups = {}
    for cell in s.allrows(c, 'cells'):
        if cell.get('location_id') in ids and cell.get('sowing_id'):
            groups.setdefault(cell['sowing_id'], []).append(cell)
    for gid, cells in groups.items():
        group = s.get(c, 'sowings', gid)
        group['unplaced_slots'] = int(group.get('unplaced_slots', 0)) + len(cells)
        sowing.event(s, c, group, 'container_removed', cells=cells, container_ids=sorted(ids))
        sowing.touch(s, c, group)
    # 4. Strukturdatensätze entfernen. Unterlagen mit Pflanzenbezug bleiben immer erhalten.
    for kind in ('cells', 'zones', 'events', 'photos'):
        for record in s.allrows(c, kind):
            owned = record.get('location_id') in ids
            if kind in ('events', 'photos') and record.get('plant_id'):
                owned = False
            if owned or (kind == 'cells' and record.get('container_id') in ids):
                c.execute('DELETE FROM records WHERE id=?', (record['id'],))
    for ident in ids:
        c.execute('DELETE FROM records WHERE id=?', (ident,))
    return {'removed': sorted(ids), 'parked': parked, 'plants_retained': len(plants)}

