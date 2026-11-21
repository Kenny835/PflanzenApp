"""Offline-Vorlagenkatalog; bestehende Benutzerdaten werden nicht überschrieben."""
import json
KEY = 'v051-catalogue'

def seed(s, c):
    if c.execute('SELECT 1 FROM app_meta WHERE key=?', (KEY,)).fetchone():
        return
    existing = s.allrows(c, 'templates')
    keys = {x.get('catalogue_key') for x in existing}
    for v in json.loads((s.ROOT / 'catalogue.json').read_text(encoding='utf-8')):
        if v['catalogue_key'] in keys:
            continue
        # Die unveränderten alten 7-/9-cm-Vorgaben behalten ihre Identität.
        old = next((x for x in existing if v.get('shape') == 'square' and x.get('name') == f"{v['width']} × {v['width']} cm Topf" and (x.get('width') == v['width']) and (x.get('depth') == v['depth']) and (x.get('unit') == 'cm') and (not x.get('catalogue_key')) and (set(x) <= {'name', 'width', 'depth', 'unit', 'id', 'version'})), None)
        s.put(c, 'templates', v, old['id'] if old else None)
    c.execute('INSERT INTO app_meta VALUES (?,?)', (KEY, '1'))

def instantiate(s, v):
    with s.connect() as c:
        t = s.get(c, 'templates', v['id'])
    if t['version'] != v.get('version'):
        raise ValueError('Vorlage inzwischen geändert. Bitte neu laden.')
    if t.get('hidden') or t.get('type') not in ('quickpot', 'tray'):
        raise ValueError('Bitte eine sichtbare Plattenvorlage wählen.')
    return s.save('locations', {'name': v.get('name') or t['name'], 'type': 'tray', 'unit': 'slots', 'rows': t['rows'], 'cols': t['cols'], 'parked': True, 'parent_id': '', 'footprint': {'width': t['width'], 'depth': t['depth'], 'unit': 'cm'}, 'template_snapshot': t})
