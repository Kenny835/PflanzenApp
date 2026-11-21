"""0.6: unabhängige Töpfe und atomare Chargen, bestehende Datensätze bleiben erhalten."""
import math

def finite(v, default=0):
    n = float(default if v in ('', None) else v)
    if not math.isfinite(n) or n < 0 or n > 3000:
        raise ValueError('Position und Abstand: 0 bis 3000.')
    return n

def integer(v, default, maximum):
    n = float(default if v in ('', None) else v)
    if not n.is_integer() or not 1 <= n <= maximum:
        raise ValueError(f'Bitte eine ganze Zahl von 1 bis {maximum} angeben.')
    return int(n)

def dispatch(s, path, v):
    with s.connect() as c:
        c.execute('BEGIN IMMEDIATE')
        if path.startswith('/api/planner-blueprint-'):
            import blueprints
            return blueprints.dispatch(s, c, path.removeprefix('/api/planner-blueprint-'), v)
        if path.startswith('/api/planner-shelf-'):
            import shelf
            return shelf.dispatch(s, c, path.removeprefix('/api/planner-shelf-'), v)
        if path.startswith('/api/planner-sowing-'):
            import sowing
            return sowing.dispatch(s, c, path.removeprefix('/api/planner-sowing-'), v)
        if path.startswith('/api/planner-workspace-'):
            import workspace
            return workspace.dispatch(s, c, path.removeprefix('/api/planner-workspace-'), v)
        if path == '/api/planner-rotate':
            obj = s.get(c, 'locations', v['id'])
            if obj['version'] != v.get('version'):
                raise ValueError('Objekt inzwischen geändert. Bitte neu laden.')
            if obj.get('type') not in ('pot', 'tray', 'table', 'tub', 'shelf', 'other', 'bed') or obj.get('shape') == 'round':
                raise ValueError('Nur rechteckige platzierbare Objekte drehen.')
            cell = next((x for x in s.allrows(c, 'cells') if x.get('container_id') == obj['id']), None)
            footprint = dict(obj.get('footprint') or {})
            if cell:
                loc = s.get(c, 'locations', cell['location_id'])
                area = {**cell, 'width': cell['depth'], 'depth': cell['width']}
                s.features.check_area(c, loc, area, [cell['id']])
                footprint.update(width=area['width'], depth=area['depth'], unit=loc.get('unit', 'slots'))
                s.put(c, 'cells', area, cell['id'])
            else:
                if not footprint.get('width') or not footprint.get('depth'):
                    raise ValueError('Zuerst die Außenmaße beim Platzieren festlegen.')
                footprint['width'], footprint['depth'] = (footprint['depth'], footprint['width'])
            import workspace
            obj['orientation'] = (workspace.orientation(obj) + 1) % 4
            obj['footprint'] = footprint
            s.put(c, 'locations', obj, obj['id'])
            # Das lokale Innenraster samt Pflanzenplätzen bleibt unverändert.
            return s.get(c, 'locations', obj['id'])
        if path == '/api/planner-create':
            count = integer(v.get('count'), 1, 500)
            per_row = integer(v.get('per_row'), count, 500)
            t = s.get(c, 'templates', v['template_id']) if v.get('template_id') else None
            if t and (t.get('hidden') or t['version'] != v.get('template_version')):
                raise ValueError('Vorlage geändert oder ausgeblendet. Bitte neu laden.')
            kind = t.get('type', 'pot') if t else 'pot'
            loc = s.get(c, 'locations', v['location_id']) if v.get('location_id') else None
            if loc and loc.get('type') == 'pot':
                raise ValueError('In einem Topf kann kein weiterer Behälter stehen.')
            if loc and loc.get('template_snapshot', {}).get('type') == 'quickpot':
                raise ValueError('QuickPot-Zellen werden direkt mit Pflanzen belegt; hier keine weiteren Töpfe einfügen.')
            planned = bool(loc and s.features.has_plan(loc))
            unit = loc.get('unit', 'slots') if planned else t.get('unit', 'cm') if t else v.get('unit', 'cm')
            if unit not in ('cm', 'slots'):
                raise ValueError('Ungültige Einheit.')
            width = s.features.number(v.get('width'), t['width'] if t and t.get('unit', 'cm') == unit else loc.get('step', 1) if loc else 7)
            depth = s.features.number(v.get('depth'), t['depth'] if t and t.get('unit', 'cm') == unit else loc.get('step', 1) if loc else 7)
            if unit == 'slots' and (not width.is_integer() or not depth.is_integer()):
                raise ValueError('Im Platzraster ganze Rasterplätze verwenden.')
            shape = t.get('shape', 'rectangle') if t else v.get('shape', 'square')
            if shape not in ('round', 'square', 'rectangle'):
                raise ValueError('Ungültige Topfform.')
            if shape in ('round', 'square') and width != depth:
                raise ValueError('Runde/quadratische Töpfe benötigen gleiche Außenmaße.')
            gapx = finite(v.get('gap_x'))
            gapy = finite(v.get('gap_y'))
            x = finite(v.get('col'))
            y = finite(v.get('row'))
            result = []
            for i in range(count):
                obj = {'name': (v.get('name') or (t['name'] if t else 'Topf')) + (f' · {i + 1}' if count > 1 else ''), 'type': 'pot' if kind == 'pot' else 'tray', 'unit': 'slots', 'rows': 1 if kind == 'pot' else t['rows'], 'cols': 1 if kind == 'pot' else t['cols'], 'shape': shape, 'parked': not bool(loc), 'parent_id': loc['id'] if loc else '', 'footprint': {'width': width, 'depth': depth, 'unit': unit}, 'template_snapshot': t or {}}
                s.validate(c, 'locations', obj)
                ident = s.put(c, 'locations', obj)
                if planned:
                    area = {'location_id': loc['id'], 'container_id': ident, 'mode': 'container', 'row': round(y + i // per_row * (depth + gapy), 6), 'col': round(x + i % per_row * (width + gapx), 6), 'width': width, 'depth': depth}
                    s.features.check_area(c, loc, area)
                    s.put(c, 'cells', area)
                result.append(s.get(c, 'locations', ident))
            return result
        if path == '/api/planner-park':
            entries = v.get('entries', [])
            if not 1 <= len(entries) <= 10000:
                raise ValueError('Bitte Objekte auswählen.')
            seen = set()
            for e in entries:
                x = s.get(c, 'cells', e['id'])
                if x['id'] in seen:
                    continue
                seen.add(x['id'])
                if x['version'] != e.get('version'):
                    raise ValueError('Auswahl inzwischen geändert. Keine Objekte verschoben.')
                if x['mode'] == 'container':
                    obj = s.get(c, 'locations', x['container_id'])
                    s.features.move_container_in(c, {'id': obj['id'], 'version': obj['version'], 'target': {}})
                elif x['mode'] == 'present':
                    s.move_in_transaction(c, s.get(c, 'plants', x['plant_id']), {}, 'Mehrfachauswahl: Parkplatz')
                else:
                    raise ValueError('Nur Töpfe, Behälter und tatsächliche Pflanzen können geparkt werden.')
            return True
        raise ValueError('Unbekannte Planeraktion.')
