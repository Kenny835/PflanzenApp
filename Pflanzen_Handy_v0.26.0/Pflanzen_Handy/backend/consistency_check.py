"""Konsistenzprüfung für Pflanzenstandort, Zellbelegung, Behälterhierarchie und Inventarindex.

Aufruf (liest nur, verändert nichts):
    python consistency_check.py                 prüft data/pflanzen.sqlite3
    python consistency_check.py PFAD.sqlite3    prüft eine Sicherungskopie

Liefert eine Liste verständlicher Verstöße (leer = konsistent)."""
import sqlite3
import sys


def check(s):
    """Prüft die Datenbank des Servermoduls s."""
    with s.connect() as c:
        return check_connection(s, c)


def check_connection(s, c):
    problems = []
    rows = {k: s.allrows(c, k) for k in s.KINDS}
    inventory = [tuple(r) for r in c.execute('SELECT label, plant_id FROM inventory')]
    plants = {p['id']: p for p in rows['plants']}
    locs = {l['id']: l for l in rows['locations']}
    cells = rows['cells']
    groups = {g['id']: g for g in rows['sowings']}

    # Behälterhierarchie
    for l in locs.values():
        parent = l.get('parent_id')
        if parent and parent not in locs:
            problems.append(f"Standort {l['name']}: Elternstandort fehlt")
        seen, cur = set(), l
        while cur and cur.get('parent_id'):
            if cur['id'] in seen:
                problems.append(f"Standort {l['name']}: Hierarchie-Schleife")
                break
            seen.add(cur['id'])
            cur = locs.get(cur['parent_id'])

    # Zellen
    present = {}
    container_cells = {}
    for x in cells:
        if x.get('location_id') not in locs:
            problems.append(f"Zelle {x['id'][:6]} ({x.get('mode')}): Standort {x.get('location_id')} existiert nicht")
        mode = x.get('mode')
        if mode == 'present':
            if x.get('plant_id') not in plants:
                problems.append(f"Zelle present: Pflanze {x.get('plant_id')} existiert nicht")
            else:
                present.setdefault(x['plant_id'], []).append(x)
        elif mode == 'planned':
            if x.get('plant_id') not in plants:
                problems.append("Zelle planned: Pflanze existiert nicht")
        elif mode == 'container':
            cid = x.get('container_id')
            if cid not in locs:
                problems.append(f"Zelle container: Behälter {cid} existiert nicht")
            container_cells.setdefault(cid, []).append(x)
        elif mode == 'reserved' and x.get('sowing_id'):
            if x['sowing_id'] not in groups:
                problems.append("Zelle reserved: Saatgruppe existiert nicht")
    for pid, lst in present.items():
        if len(lst) > 1:
            problems.append(f"Pflanze {plants[pid].get('label')}: {len(lst)} aktuelle Zellen")
        p = plants[pid]
        if lst[0].get('location_id') != p.get('location_id'):
            problems.append(f"Pflanze {p.get('label')}: location_id {p.get('location_id')!r} passt nicht zur Zelle {lst[0].get('location_id')!r}")
    for cid, lst in container_cells.items():
        if len(lst) > 1:
            problems.append(f"Behälter {cid[:6]} steht in {len(lst)} Zellen")
        elif cid in locs and lst[0].get('location_id') != locs[cid].get('parent_id') and locs[cid].get('parent_id'):
            problems.append(f"Behälter {locs[cid]['name']}: Zelle in {lst[0].get('location_id')[:6]} aber parent_id {locs[cid].get('parent_id')[:6]}")

    # Überlappungen belegter Flächen je Standort
    import features
    by_loc = {}
    for x in cells:
        if x.get('mode') in ('present', 'container', 'blocked') or (x.get('mode') == 'reserved' and not x.get('sowing_id')):
            by_loc.setdefault(x['location_id'], []).append(x)
    for lid, lst in by_loc.items():
        for i in range(len(lst)):
            for j in range(i + 1, len(lst)):
                a, b = lst[i], lst[j]
                try:
                    if features.overlaps(features.rect(a), features.rect(b)):
                        problems.append(f"Überlappung in {locs.get(lid, {}).get('name', lid[:6])}: {a['mode']}/{b['mode']} bei ({a['row']},{a['col']})")
                except Exception as e:  # pragma: no cover
                    problems.append(f'Überlappungsprüfung fehlgeschlagen: {e}')

    # Regale: Ebenen-Zonen passen zur Beschreibung, alles steht innerhalb einer eingeschalteten Ebene
    import shelf
    for loc in locs.values():
        meta = loc.get('shelf')
        if not meta:
            continue
        regions = shelf.regions(meta)
        import workspace
        base = shelf.base_size(meta)
        foot = workspace.physical(loc)
        if sorted((round(foot['width'], 6), round(foot['depth'], 6))) != sorted((round(base[0], 6), round(base[1], 6))):
            problems.append(f"Regal {loc['name']}: Grundfläche {foot['width']:g} × {foot['depth']:g} cm passt nicht zu den Ebenen ({base[0]:g} × {base[1]:g} cm)")
        inner = shelf.outer_size(meta)
        if (loc.get('width_cm'), loc.get('depth_cm')) != inner:
            problems.append(f"Regal {loc['name']}: Innenmaße {loc.get('width_cm')} × {loc.get('depth_cm')} cm passen nicht zu den Ebenen ({inner[0]:g} × {inner[1]:g} cm)")
        for x in cells:
            if x.get('container_id') == loc['id'] and x.get('mode') == 'container' and sorted((x['width'], x['depth'])) != sorted(base):
                problems.append(f"Regal {loc['name']}: belegt im Raum {x['width']:g} × {x['depth']:g} cm statt der Grundfläche")
        zones = [z for z in rows['zones'] if z.get('location_id') == loc['id'] and z.get('shelf_level')]
        if sorted(z['shelf_level'] for z in zones) != [r['level'] for r in regions]:
            problems.append(f"Regal {loc['name']}: Ebenen-Zonen passen nicht zu den eingeschalteten Ebenen")
        for z in zones:
            r = next((r for r in regions if r['level'] == z['shelf_level']), None)
            if r and z['areas'] != [{'col': r['col'], 'row': r['row'], 'width': r['width'], 'depth': r['depth']}]:
                problems.append(f"Regal {loc['name']}: Zone {z['name']} liegt nicht an der richtigen Stelle")
        for x in cells:
            if x.get('location_id') == loc['id'] and x.get('mode') in ('present', 'container', 'planned') and shelf.region_of(meta, x) is None:
                problems.append(f"Regal {loc['name']}: Objekt bei ({x['row']},{x['col']}) steht nicht innerhalb einer eingeschalteten Ebene")

    # Pflanzen
    for p in plants.values():
        lid = p.get('location_id')
        if lid and lid not in locs:
            problems.append(f"Pflanze {p.get('label')}: Standort {lid[:6]} existiert nicht")
        if p.get('planner_hidden') and (lid or p['id'] in present):
            problems.append(f"Pflanze {p.get('label')}: planner_hidden, aber Standort/Zelle vorhanden")
        if p.get('status', 'active') != 'active' and p['id'] in present:
            problems.append(f"Pflanze {p.get('label')}: nicht aktiv, belegt aber eine Zelle")

    # Inventarindex
    labels = {p['label']: p['id'] for p in plants.values() if p.get('label')}
    inv = dict(inventory)
    if len(inv) != len(inventory):
        problems.append('Inventarindex: doppelte Kennung')
    if inv != labels:
        miss = set(labels) - set(inv)
        extra = set(inv) - set(labels)
        problems.append(f'Inventarindex weicht ab (fehlend {sorted(miss)[:3]}, überzählig {sorted(extra)[:3]})')
    return problems


def main(argv):
    import server as s
    path = argv[1] if len(argv) > 1 else str(s.DB)
    try:
        c = sqlite3.connect('file:' + path + '?mode=ro', uri=True)
    except sqlite3.Error as e:
        print('Datenbank kann nicht geöffnet werden:', e)
        return 2
    c.row_factory = sqlite3.Row
    try:
        problems = check_connection(s, c)
    finally:
        c.close()
    if not problems:
        print('Keine Unstimmigkeiten gefunden.')
        return 0
    print(len(problems), 'Unstimmigkeit(en):')
    for p in problems:
        print(' -', p)
    return 1


if __name__ == '__main__':
    sys.exit(main(sys.argv))
