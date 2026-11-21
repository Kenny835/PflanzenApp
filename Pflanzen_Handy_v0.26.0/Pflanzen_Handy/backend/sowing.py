"""Aussaatgruppen: Termine, Belegungen und nachvollziehbare Übernahme."""
from datetime import date, timedelta
import re
import workspace as w
STAGES = ('germination', 'pricking', 'repotting')
PALETTE = ('#3163b7', '#b64b88', '#ba681f', '#7055ac', '#198775', '#b14949', '#548028', '#527f99')

def day(value):
    if not value:
        return ''
    try:
        return date.fromisoformat(str(value)).isoformat()
    except (ValueError, TypeError):
        raise ValueError('Bitte ein gültiges Datum eingeben.')

def ranges(values):
    result = {}
    for stage in STAGES:
        pair = values.get(stage, ['', ''])
        if not isinstance(pair, list) or len(pair) != 2:
            raise ValueError('Zeitfenster benötigen von/bis.')
        if pair in ([None, None], ['', '']):
            result[stage] = ['', '']
            continue
        try:
            a, b = [int(x) for x in pair]
        except (ValueError, TypeError):
            raise ValueError('Zeitfenster in ganzen Tagen angeben.')
        if not 0 <= a <= b <= 3650 or any((str(x) != str(int(x)) for x in pair)):
            raise ValueError('Zeitfenster: 0 bis 3650 Tage, von kleiner oder gleich bis.')
        result[stage] = [a, b]
    return result

def forecast(group):
    base = group.get('actual_date') or group.get('planned_date')
    result = {}
    if base:
        for key, pair in group.get('ranges', {}).items():
            if pair != ['', '']:
                result[key] = [(date.fromisoformat(base) + timedelta(days=n)).isoformat() for n in pair]
    return result

def event(s, c, g, kind, **extra):
    s.put(c, 'sowing_events', {'sowing_id': g['id'], 'kind': kind, 'date': extra.pop('date', date.today().isoformat()), **extra})

def selection(s, c, g, entries):
    if not isinstance(entries, list) or not 1 <= len(entries) <= 3000:
        raise ValueError('Bitte 1 bis 3000 belegte Zellen auswählen.')
    cells = [w.checked(s, c, 'cells', e['id'], e['version']) for e in entries]
    if len({x['id'] for x in cells}) != len(cells) or any((x.get('sowing_id') != g['id'] for x in cells)):
        raise ValueError('Die Auswahl gehört nicht vollständig zur Aussaat.')
    return cells

def touch(s, c, g):
    s.put(c, 'sowings', g, g['id'])

def dispatch(s, c, action, v):
    if action == 'group-action':
        import sowing_groups
        return sowing_groups.dispatch(s, c, v)
    if action in ('save', 'profile'):
        kind = 'sowings' if action == 'save' else 'sowing_profiles'
        old = w.checked(s, c, kind, v['id'], v.get('version')) if v.get('id') else {}
        value = v.get('values', {})
        name = str(value.get('name', '')).strip()
        if not name:
            raise ValueError('Bitte eine Bezeichnung eingeben.')
        n = {**old, 'name': name, 'genus': str(value.get('genus', '')).strip(), 'species': str(value.get('species', '')).strip(), 'variety': str(value.get('variety', '')).strip(), 'ranges': ranges(value.get('ranges', {})), 'notes': str(value.get('notes', ''))}
        if action == 'save':
            color = value.get('color') or old.get('color') or PALETTE[len(s.allrows(c, 'sowings')) % len(PALETTE)]
            if not re.fullmatch('#[0-9a-fA-F]{6}', color):
                raise ValueError('Ungültige Gruppenfarbe.')
            n.update(color=color, planned_date=day(value.get('planned_date')), actual_date=day(value.get('actual_date')))
        ident = s.put(c, kind, n, old.get('id'))
        n = s.get(c, kind, ident)
        if action == 'save':
            event(s, c, n, 'edited' if old else 'created', previous_dates={k: old.get(k, '') for k in ('planned_date', 'actual_date')}, dates={k: n[k] for k in ('planned_date', 'actual_date')})
        return n
    if action == 'duplicate':
        import blueprints
        return blueprints.dispatch(s, c, 'duplicate', v)
    if action == 'delete-profile':
        p = w.checked(s, c, 'sowing_profiles', v['id'], v['version'])
        if not v.get('confirmed'):
            raise ValueError('Löschen bitte bestätigen.')
        c.execute('DELETE FROM records WHERE id=?', (p['id'],))
        return True
    g = w.checked(s, c, 'sowings', v['id'], v.get('version'))
    if action == 'delete':
        if not v.get('confirmed'):
            raise ValueError('Löschen bitte bestätigen.')
        if any((x.get('sowing_id') == g['id'] for kind in ('cells', 'plants') for x in s.allrows(c, kind))):
            raise ValueError('Zuerst die Belegungen freigeben. Aussaaten mit übernommenen Pflanzen bleiben als Herkunft erhalten.')
        for e in s.allrows(c, 'sowing_events'):
            if e['sowing_id'] == g['id']:
                c.execute('DELETE FROM records WHERE id=?', (e['id'],))
        c.execute('DELETE FROM records WHERE id=?', (g['id'],))
        return True
    if action == 'assign-places':
        made = []
        entries = v.get('places', [])
        if not 1 <= len(entries) <= 3000:
            raise ValueError('Bitte freie Pflanzstellen auswählen.')
        for a in entries:
            loc = s.get(c, 'locations', a['location_id'])
            if not w.fixed(loc) or loc.get('model_pending'):
                raise ValueError('Eine feste Pflanzstelle wählen.')
            area = {'row': float(a['row']), 'col': float(a['col']), 'width': 1, 'depth': 1, 'location_id': loc['id']}
            s.features.check_area(c, loc, area)
            ident = s.put(c, 'cells', {**area, 'mode': 'reserved', 'sowing_id': g['id'], 'note': g['name']})
            made.append(s.get(c, 'cells', ident))
        g['unplaced_slots'] = max(0, g.get('unplaced_slots', 0) - len(made))
        event(s, c, g, 'assigned', cells=made)
        touch(s, c, g)
        return made
    if action == 'assign':
        loc = w.checked(s, c, 'locations', v['location_id'], v['location_version'])
        if loc.get('model_pending'):
            raise ValueError('Zuerst das Zellmodell auswählen.')
        areas = v.get('areas', [])
        if not 1 <= len(areas) <= 3000:
            raise ValueError('Bitte 1 bis 3000 Flächen auswählen.')
        if not s.features.has_plan(loc):
            raise ValueError('Der Behälter benötigt ein Raster oder eine definierte Innenfläche.')
        made = []
        for area in areas:
            a = {k: float(area.get(k, 1 if k in ('width', 'depth') else 0)) for k in ('row', 'col', 'width', 'depth')}
            if w.fixed(loc) and (a['width'] != 1 or a['depth'] != 1):
                raise ValueError('Bitte einzelne feste Zellen auswählen.')
            s.features.check_area(c, loc, a)
            ident = s.put(c, 'cells', {**a, 'location_id': loc['id'], 'mode': 'reserved', 'sowing_id': g['id'], 'note': g['name']})
            made.append(s.get(c, 'cells', ident))
        g['unplaced_slots'] = max(0, g.get('unplaced_slots', 0) - len(made))
        event(s, c, g, 'assigned', cells=made, location_path=s.location_path(c, loc['id']))
        touch(s, c, g)
        return made
    if action == 'event':
        kind = v.get('kind')
        if kind not in ('germination', 'pricking', 'repotting', 'planting', 'note'):
            raise ValueError('Ungültiger Dokumentationstyp.')
        d = day(v.get('date'))
        if not d:
            raise ValueError('Bitte ein tatsächliches Datum angeben.')
        event(s, c, g, kind, date=d, note=str(v.get('note', '')))
        touch(s, c, g)
        return True
    if action in ('release', 'convert', 'move'):
        cells = selection(s, c, g, v.get('entries'))
        if action == 'move':
            if len(cells) != 1:
                raise ValueError('Belegungen einzeln in freie Zellen ziehen.')
            source = cells[0]
            target = v['target']
            loc = s.get(c, 'locations', target['location_id'])
            sc = w.scene(s, c, loc['id'])
            if not sc['fixed'] or loc.get('model_pending'):
                raise ValueError('Aussaatzellen nur in feste, freie Zellen verschieben.')
            a = {'row': int(float(target['row']) // sc['sy']), 'col': int(float(target['col']) // sc['sx']), 'width': 1, 'depth': 1}
            s.features.check_area(c, loc, a, [source['id']])
            n = {**source, **a, 'location_id': loc['id']}
            s.put(c, 'cells', n, source['id'])
            event(s, c, g, 'moved', before=source, after=n)
            touch(s, c, g)
            return True
        plants = []
        if action == 'convert':
            from planner import integer
            count = integer(v.get('count'), len(cells), 500)
            keep = v.get('keep_places', True)
            if keep and count != len(cells):
                raise ValueError('Für die Platzübernahme muss die Anzahl zur Zellenauswahl passen.')
            values = v.get('values', {})
            for cell in cells:
                c.execute('DELETE FROM records WHERE id=?', (cell['id'],))
            for index in range(count):
                p = {'name': values.get('name') or g['name'], 'genus': values.get('genus') or g['genus'], 'species': values.get('species') or g['species'], 'variety': g.get('variety', ''), 'year': str(v.get('year') or date.today().year), 'status': 'active', 'accession_type': 'propagation', 'sowing_id': g['id'], 'source': 'Aussaat: ' + g['name'], 'location_id': '', 'role': 'unspecified', 'taxon_type': 'species' if values.get('species') or g['species'] else 'unknown'}
                s.validate(c, 'plants', p)
                ident = s.put(c, 'plants', p)
                p['label'] = s.allocate(c, p, ident)
                p['id'] = ident
                s.put(c, 'plants', p, ident)
                if keep:
                    s.move_in_transaction(c, p, {k: cells[index][k] for k in ('location_id', 'row', 'col', 'width', 'depth')}, 'Aus Aussaat übernommen')
                plants.append(ident)
        else:
            for cell in cells:
                c.execute('DELETE FROM records WHERE id=?', (cell['id'],))
        event(s, c, g, 'converted' if action == 'convert' else 'failed' if v.get('failed') else 'released', cells=cells, plants=plants, note=str(v.get('note', '')))
        touch(s, c, g)
        return {'count': len(cells), 'plants': plants}
    raise ValueError('Unbekannte Aussaataktion.')
