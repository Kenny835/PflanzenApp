"""Scoped atomic group operations. Contents are moved; containers remain in place."""
import geometry
import workspace as w
import sowing

def places(s, c, location):
    loc = s.get(c, 'locations', location)
    if w.fixed(loc):
        if loc.get('model_pending'):
            return []
        return [{'location_id': location, 'row': r, 'col': col, 'width': 1, 'depth': 1} for r in range(loc.get('rows', 1)) for col in range(loc.get('cols', 1))]
    out = []
    for child in s.allrows(c, 'locations'):
        if child.get('parent_id') == location and (not child.get('parked')):
            out.extend(places(s, c, child['id']))
    return out

def dispatch(s, c, v):
    g = w.checked(s, c, 'sowings', v['id'], v['version'])
    scope = v.get('scope_id')
    if not scope:
        raise ValueError('Aktuelles Gefäß angeben.')
    allowed = s.descendants(c, scope)
    cells = sowing.selection(s, c, g, v.get('entries'))
    if any((x['location_id'] not in allowed for x in cells)):
        raise ValueError('Auswahl verlässt das aktuelle Gefäß.')
    action = v.get('action')
    if action == 'unpot':
        for x in cells:
            c.execute('DELETE FROM records WHERE id=?', (x['id'],))
        g['unplaced_slots'] = g.get('unplaced_slots', 0) + len(cells)
        sowing.event(s, c, g, 'unpotted', cells=cells, scope_id=scope)
        sowing.touch(s, c, g)
        return {'count': len(cells)}
    if action not in ('move', 'plant'):
        raise ValueError('Unbekannte Gruppenaktion.')
    target = v.get('target', {})
    dest = target.get('location_id')
    if not dest:
        raise ValueError('Zielgefäß wählen. Ganze Gefäße können auf den Parkplatz verschoben werden.')
    loc = s.get(c, 'locations', dest)
    targets = []
    ignore = [x['id'] for x in cells]
    if 'col' in target and 'row' in target and all((x['location_id'] == scope for x in cells)) and w.fixed(loc) and w.fixed(s.get(c, 'locations', scope)):
        sc = w.scene(s, c, dest)
        col = int(float(target['col']) // sc['sx'])
        row = int(float(target['row']) // sc['sy'])
        anchor = next((x for x in cells if x['id'] == v.get('anchor_id')), cells[0])
        targets = [{'location_id': dest, 'row': row + x['row'] - anchor['row'], 'col': col + x['col'] - anchor['col'], 'width': 1, 'depth': 1} for x in cells]
    else:
        for a in places(s, c, dest):
            try:
                s.features.check_area(c, s.get(c, 'locations', a['location_id']), a, ignore)
            except ValueError:
                continue
            targets.append(a)
            if len(targets) == len(cells):
                break
    if len(targets) != len(cells):
        raise ValueError('Nicht genug freie Pflanzstellen. Alles bleibt unverändert.')
    checked = []
    for a in targets:
        s.features.check_area(c, s.get(c, 'locations', a['location_id']), a, ignore)
        if any((a['location_id'] == b['location_id'] and geometry.collision(a, b) for b in checked)):
            raise ValueError('Zielzellen überlappen.')
        checked.append(a)
    for old, a in zip(cells, targets):
        s.put(c, 'cells', {**old, **a}, old['id'])
    sowing.event(s, c, g, 'planted' if action == 'plant' else 'group_moved', cells=cells, targets=targets, scope_id=scope)
    sowing.touch(s, c, g)
    return {'count': len(cells)}
