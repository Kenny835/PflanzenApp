"""Pflanzen-App – lokaler WLAN-Testserver, Python 3.10+, keine Zusatzpakete.

Die Versionsnummer steht ausschließlich in der Datei VERSION.
Hinweis: Die Funktionen cell_at, cell_save, move_plan, move_in_transaction, photo_upload und
place_text sind in features.py definiert und werden von features.install() hier eingesetzt."""
import sys, argparse, base64, io, json, os, re, secrets, socket, sqlite3, threading, uuid, webbrowser, zipfile
import care_calendar
from datetime import datetime
from contextlib import closing
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit
ROOT = Path(__file__).resolve().parent
DATA = Path(os.environ.get('PFLANZEN_DATA', ROOT / 'data'))
DB = DATA / 'pflanzen.sqlite3'
TOKEN = secrets.token_urlsafe(32)


def current_version():
    """Version aus der Datei VERSION (wird bei jedem Aufruf neu gelesen)."""
    try:
        return (ROOT / 'VERSION').read_text(encoding='utf-8').strip() or 'unbekannt'
    except OSError:
        return 'unbekannt'


# Version des laufenden Serverprogramms: beim Start einmal gelesen. Weicht sie später von
# current_version() ab, wurden die Dateien ausgetauscht, ohne den Server neu zu starten.
SERVER_VERSION = current_version()
# Feste Bilddateien der Oberfläche (Logo und Symbol des Browserfensters)
STATIC_FILES = {'/logo.png': ('image/png', 'logo.png'), '/favicon.ico': ('image/x-icon', 'favicon.ico')}
# Art eines Verlaufseintrags (schnelle Pflegeeinträge); ältere Notizen haben keine
EVENT_TYPES = ('water', 'fertilize', 'repot', 'bloom', 'pest', 'note')
KINDS = ('plants', 'locations', 'groups', 'wishes', 'events', 'photos', 'cells', 'zones', 'templates', 'sowings', 'sowing_profiles', 'sowing_events')

class Connection(sqlite3.Connection):

    def __exit__(self, *args):
        try:
            return super().__exit__(*args)
        finally:
            self.close()

def connect():
    c = sqlite3.connect(DB, timeout=20, factory=Connection)
    c.row_factory = sqlite3.Row
    return c

def init():
    DATA.mkdir(parents=True, exist_ok=True)
    (DATA / 'photos').mkdir(exist_ok=True)
    with connect() as c:
        c.executescript('CREATE TABLE IF NOT EXISTS records(id TEXT PRIMARY KEY,kind TEXT NOT NULL,body TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1); CREATE TABLE IF NOT EXISTS inventory(label TEXT PRIMARY KEY,plant_id TEXT UNIQUE NOT NULL); CREATE TABLE IF NOT EXISTS app_meta(key TEXT PRIMARY KEY,value TEXT); CREATE TABLE IF NOT EXISTS requests(key TEXT PRIMARY KEY,payload TEXT,result TEXT); CREATE TABLE IF NOT EXISTS undo_steps(id TEXT PRIMARY KEY,before_state TEXT,after_state TEXT); PRAGMA user_version=3;')
        if not c.execute("SELECT 1 FROM app_meta WHERE key='v05-defaults'").fetchone():
            for size in (7, 9, 14):
                put(c, 'templates', {'name': str(size) + ' × ' + str(size) + ' cm Topf', 'width': size, 'depth': size, 'unit': 'cm'})
            c.execute("INSERT INTO app_meta VALUES ('v05-defaults','1')")
        import catalogue
        catalogue.seed(sys.modules[__name__], c)
        import shelf
        shelf.migrate(sys.modules[__name__], c)

def allrows(c, kind):
    return [dict(json.loads(r['body']), id=r['id'], version=r['version']) for r in c.execute('SELECT * FROM records WHERE kind=? ORDER BY rowid', (kind,))]

def get(c, kind, ident):
    r = c.execute('SELECT * FROM records WHERE id=? AND kind=?', (ident, kind)).fetchone()
    if not r:
        raise ValueError('Eintrag nicht gefunden.')
    return dict(json.loads(r['body']), id=r['id'], version=r['version'])

def put(c, kind, v, ident=None):
    v = dict(v)
    v.pop('id', None)
    v.pop('version', None)
    if ident:
        c.execute('UPDATE records SET body=?,version=version+1 WHERE id=?', (json.dumps(v, ensure_ascii=False), ident))
    else:
        ident = uuid.uuid4().hex
        c.execute('INSERT INTO records(id,kind,body) VALUES (?,?,?)', (ident, kind, json.dumps(v, ensure_ascii=False)))
    return ident

def ref(c, v, key, kind):
    if v.get(key):
        get(c, kind, v[key])

def code(s):
    s = re.sub('[^A-Z]', '', str(s).upper())
    if len(s) < 3:
        raise ValueError('Für die ID mindestens drei Buchstaben bei Gattung und Art angeben.')
    return s[:3]

def allocate(c, v, ident):
    species = v.get('species', '').strip()
    sc = 'HYB' if v.get('taxon_type') == 'hybrid' else 'UNK' if not species or v.get('taxon_type') == 'unknown' else code(species)
    year = str(v.get('year', ''))
    if not re.fullmatch('\\d{4}', year) or not 1800 <= int(year) <= 2200:
        raise ValueError('Bitte ein Zugangsjahr zwischen 1800 und 2200 angeben.')
    prefix = f"{code(v.get('genus', ''))}-{sc}-{year}-"
    used = {r[0] for r in c.execute('SELECT label FROM inventory WHERE label LIKE ?', (prefix + '%',))}
    n = 1
    while prefix + f'{n:03}' in used:
        n += 1
    label = prefix + f'{n:03}'
    c.execute('INSERT INTO inventory VALUES (?,?)', (label, ident))
    return label

def coord(row, col):
    name = ''
    n = int(row) + 1
    while n:
        n -= 1
        name = chr(65 + n % 26) + name
        n //= 26
    return name + str(int(col) + 1)

def location_path(c, ident):
    parts = []
    seen = set()
    while ident:
        if ident in seen:
            raise ValueError('Standorthierarchie enthält eine Schleife.')
        seen.add(ident)
        loc = get(c, 'locations', ident)
        parts.append(loc['name'])
        ident = loc.get('parent_id', '')
    return ' → '.join(reversed(parts))

def descendants(c, ident):
    result = {ident}
    pending = [ident]
    locations = allrows(c, 'locations')
    while pending:
        parent = pending.pop()
        for loc in locations:
            if loc.get('parent_id') == parent and loc['id'] not in result:
                result.add(loc['id'])
                pending.append(loc['id'])
    return result

def current_place(c, p):
    cell = next((x for x in allrows(c, 'cells') if x.get('plant_id') == p['id'] and x.get('mode') == 'present'), None)
    location = p.get('location_id') or ''
    return {'location_id': location, 'row': cell['row'] if cell else None, 'col': cell['col'] if cell else None, 'position': p.get('position', '') if location else '', 'path': location_path(c, location) if location else 'Parkplatz – nicht zugeordnet'}

def remember(c, p, before, after, reason):
    if before == after:
        return
    now = datetime.now().isoformat(timespec='seconds')
    entry = {**before, 'history_id': uuid.uuid4().hex, 'left_at': now, 'reason': reason}
    p['location_history'] = ([entry] + p.get('location_history', []))[:3]
    put(c, 'events', {'plant_id': p['id'], 'date': now, 'kind': 'system', 'notes': reason + ': ' + place_text(before) + ' → ' + place_text(after) + ' (Erfassungszeitpunkt).'})

def move_plant(v):
    with connect() as c:
        c.execute('BEGIN IMMEDIATE')
        p = get(c, 'plants', v['plant_id'])
        if v.get('version') != p['version']:
            raise ValueError('Pflanze inzwischen geändert. Bitte neu laden.')
        if v.get('history_id'):
            target = next((x for x in p.get('location_history', []) if x['history_id'] == v['history_id']), None)
            if not target:
                raise ValueError('Historischer Standort nicht mehr verfügbar.')
            # Wurde ein Behälter inzwischen umgestellt, ist der alte Ort nicht identisch.
            if target.get('location_id') and location_path(c, target['location_id']) != target['path']:
                raise ValueError('Der frühere Behälter wurde verschoben oder umbenannt. Bitte das gewünschte Ziel neu wählen.')
            if target.get('container_positions') and target['container_positions'] != current_place(c, p).get('container_positions'):
                raise ValueError('Der Topf oder Behälter wurde inzwischen verschoben. Bitte dessen gewünschten Platz gezielt wählen.')
            reason = 'An vorherigen Platz zurückgestellt'
        else:
            target = v.get('target', {})
            reason = 'Auf Parkplatz verschoben' if not target.get('location_id') else 'Umgestellt'
        move_in_transaction(c, p, target, reason)
        return get(c, 'plants', p['id'])

def validate(c, kind, v, old=None):
    if kind in ('plants', 'locations', 'groups', 'wishes') and (not str(v.get('name', '')).strip()):
        raise ValueError('Bitte eine Bezeichnung eingeben.')
    if kind == 'plants':
        if not v.get('genus'):
            raise ValueError('Bitte die Gattung angeben.')
        for key, k in [('location_id', 'locations'), ('group_id', 'groups'), ('parent_id', 'plants')]:
            ref(c, v, key, k)
        if v.get('status', 'active') not in ('active', 'given', 'dead'):
            raise ValueError('Ungültiger Bestandsstatus.')
        if old:
            if (v.get('parent_id') or '') != (old.get('parent_id') or ''):
                raise ValueError('Die Ausgangspflanze einer gespeicherten Teilung bleibt fest.')
            v['label'] = old['label']
        if v.get('parent_id'):
            parent = get(c, 'plants', v['parent_id'])
            v['clone_key'] = parent['clone_key']
        v['clone_key'] = v.get('clone_key') or uuid.uuid4().hex
    if kind == 'locations':
        ref(c, v, 'parent_id', 'locations')
        if old and v.get('parent_id') in descendants(c, old['id']):
            raise ValueError('Ein Ort kann nicht sich selbst oder einem seiner Unterorte zugeordnet werden.')
        if v.get('type', 'place') not in ('place', 'table', 'tub', 'bed', 'shelf', 'other', 'tray', 'pot'):
            raise ValueError('Ungültiger Standorttyp.')
        for k in ('rows', 'cols'):
            v[k] = int(v.get(k) or 0)
            if not 0 <= v[k] <= 3000:
                raise ValueError('Rastergröße: 0 bis 3000 je Richtung.')
        if bool(v['rows']) != bool(v['cols']):
            raise ValueError('Reihen und Spalten gemeinsam angeben.')
        if old:
            for cell in allrows(c, 'cells'):
                if cell.get('location_id') == old['id'] and (cell['row'] >= v['rows'] or cell['col'] >= v['cols']):
                    raise ValueError('Vor dem Verkleinern alle betroffenen Rasterfelder leeren.')
    if kind == 'events':
        ref(c, v, 'plant_id', 'plants')
        ref(c, v, 'location_id', 'locations')
        if not (v.get('plant_id') or v.get('location_id')) or not v.get('notes', '').strip():
            raise ValueError('Pflanze und Notiz fehlen.')
        if v.get('type') not in (None, '') + EVENT_TYPES:
            raise ValueError('Unbekannte Art des Eintrags.')

def save(kind, v, ident=None):
    if kind not in ('plants', 'locations', 'groups', 'wishes', 'events'):
        raise ValueError('Ungültiger Bereich.')
    with connect() as c:
        c.execute('BEGIN IMMEDIATE')
        old = get(c, kind, ident) if ident else None
        if old and v.get('version') != old['version']:
            raise ValueError('Eintrag inzwischen geändert. Bitte neu laden.')
        v = dict(v)
        count = int(v.pop('count', 1) or 1)
        placements = v.pop('placements', None)
        if not 1 <= count <= 100:
            raise ValueError('Anzahl: 1 bis 100.')
        if kind != 'plants' or ident:
            count = 1
        if placements is not None and (not isinstance(placements, list) or len(placements) != count):
            raise ValueError('Bitte für jeden Horst eine Zuordnung oder einen Parkplatz wählen.')
        if old:
            v = {**old, **v}
        if kind == 'plants':
            v['location_history'] = old.get('location_history', []) if old else []
        if kind == 'groups':
            care_calendar.validate(v, old)
        validate(c, kind, v, old)
        if old:
            if kind == 'plants':
                target = placements[0] if placements is not None else None
                if target is None and ((v.get('location_id') or '') != (old.get('location_id') or '') or v.get('position', '') != old.get('position', '')):
                    target = {'location_id': v.get('location_id', ''), 'position': v.get('position', '')}
                if target is not None:
                    v['location_id'] = old.get('location_id', '')
                    v['position'] = old.get('position', '')
                    move_in_transaction(c, v, target)
                else:
                    put(c, kind, v, ident)
            elif kind == 'locations':
                affected = descendants(c, ident)
                plants = [p for p in allrows(c, 'plants') if p.get('location_id') in affected]
                previous = {p['id']: current_place(c, p) for p in plants}
                put(c, kind, v, ident)
                for p in plants:
                    after = current_place(c, p)
                    if previous[p['id']] != after:
                        remember(c, p, previous[p['id']], after, 'Ort / Behälter geändert')
                        put(c, 'plants', p, p['id'])
            else:
                put(c, kind, v, ident)
            return [get(c, kind, ident)]
        ids = []
        for index in range(count):
            new = dict(v)
            target = (placements[index] if placements is not None else {'location_id': v.get('location_id', ''), 'position': v.get('position', '')}) if kind == 'plants' else None
            if kind == 'plants':
                new['location_id'] = ''
                new['position'] = ''
            i = put(c, kind, new)
            if kind == 'plants':
                new['label'] = allocate(c, new, i)
                new['id'] = i
                put(c, kind, new, i)
                if target.get('location_id'):
                    move_in_transaction(c, new, target, 'Beim Anlegen zugeordnet')
            ids.append(i)
        if kind == 'plants' and v.get('wish_id'):
            w = get(c, 'wishes', v['wish_id'])
            w['fulfilled'] = True
            put(c, 'wishes', w, w['id'])
        return [get(c, kind, i) for i in ids]

def remove_unused_photo_files():
    """Löscht Bilddateien, die in keinem Datensatz mehr vorkommen (nach erfolgreichem Speichern)."""
    folder = DATA / 'photos'
    if not folder.is_dir():
        return
    with connect() as c:
        used = {p['file'] for p in allrows(c, 'photos')}
    for f in folder.iterdir():
        if f.is_file() and f.name not in used:
            f.unlink()


def delete(kind, ident, confirm):
    """Endgültiges Löschen in EINER Transaktion: entweder passiert alles oder nichts."""
    if confirm != 'löschen':
        raise ValueError('Zum endgültigen Löschen exakt „löschen“ eingeben.')
    if kind not in KINDS:
        raise ValueError('Ungültiger Bereich.')
    with connect() as c:
        c.execute('BEGIN IMMEDIATE')
        obj = get(c, kind, ident)
        if kind == 'groups' and any((x.get('group_id') == ident for k in ('locations', 'zones') for x in allrows(c, k))):
            raise ValueError('Pflegegruppe wird noch von einem Standort oder einer Zone verwendet.')
        if kind == 'zones' and obj.get('shelf_level'):
            raise ValueError('Eine Regalebene lässt sich nicht löschen. Im Regal die Ebene in den Eigenschaften ausschalten.')
        if kind == 'locations' and any((x.get('container_id') == ident for x in allrows(c, 'cells'))):
            raise ValueError('Behälter zuerst aus der Stellfläche heraus auf den Parkplatz verschieben.')
        if kind == 'locations' and any((x.get('parent_id') == ident for x in allrows(c, 'locations'))):
            raise ValueError('Dieser Ort hat noch untergeordnete Standorte oder Behälter.')
        if kind in ('locations', 'groups'):
            key = 'location_id' if kind == 'locations' else 'group_id'
            if any((p.get(key) == ident for p in allrows(c, 'plants'))):
                raise ValueError('Dieser Eintrag ist noch Pflanzen zugeordnet.')
            if kind == 'locations' and any((x.get('location_id') == ident for x in allrows(c, 'cells'))):
                raise ValueError('Zuerst das Raster leeren.')
        if kind == 'plants':
            for p in allrows(c, 'plants'):
                if p.get('parent_id') == ident:
                    p['parent_id'] = ''
                    p['parent_deleted'] = obj['label'] + ' (Ausgangspflanze endgültig gelöscht)'
                    put(c, 'plants', p, p['id'])
            for k in ('events', 'photos', 'cells', 'zones', 'templates', 'sowings', 'sowing_profiles', 'sowing_events'):
                for r in allrows(c, k):
                    if r.get('plant_id') == ident:
                        c.execute('DELETE FROM records WHERE id=?', (r['id'],))
            c.execute('DELETE FROM inventory WHERE plant_id=?', (ident,))
        if kind == 'wishes':
            for r in allrows(c, 'cells'):
                if r.get('wish_id') == ident:
                    r['wish_id'] = ''
                    r['note'] = r.get('note', '') + ' Wunsch gelöscht: ' + obj['name']
                    put(c, 'cells', r, r['id'])
        c.execute('DELETE FROM records WHERE id=?', (ident,))
        if kind == 'locations':
            # Standortdokumentation mit entfernen – Unterlagen, die zu einer Pflanze gehören, bleiben erhalten.
            for k in ('zones', 'photos', 'events'):
                for x in allrows(c, k):
                    if x.get('location_id') == ident and (not x.get('plant_id')):
                        c.execute('DELETE FROM records WHERE id=?', (x['id'],))
        if kind in ('photos', 'locations'):
            # Jeder Besitzer behält ein Hauptbild, falls er noch Bilder hat.
            photos = allrows(c, 'photos')
            owners = {('location_id', x['location_id']) if x.get('location_id') else ('plant_id', x['plant_id']) for x in photos}
            for key, owner in owners:
                mine = [x for x in photos if x.get(key) == owner]
                if mine and (not any((x.get('main') for x in mine))):
                    mine[0]['main'] = True
                    put(c, 'photos', mine[0], mine[0]['id'])
    remove_unused_photo_files()

def bulk_update(v):
    with connect() as c:
        c.execute('BEGIN IMMEDIATE')
        if v['field'] not in ('location_id', 'group_id', 'status'):
            raise ValueError('Ungültiges Feld.')
        for entry in v['entries']:
            p = get(c, 'plants', entry['id'])
            if p['version'] != entry['version']:
                raise ValueError('Ein Eintrag wurde inzwischen geändert. Bitte neu laden.')
            if v['field'] == 'location_id':
                move_in_transaction(c, p, {'location_id': v['value']}, 'Mehrfachauswahl: Standort geändert')
            else:
                old = dict(p)
                p[v['field']] = v['value']
                validate(c, 'plants', p, old)
                if v['field'] == 'status' and v['value'] != 'active':
                    move_in_transaction(c, p, {}, 'Bestandsstatus geändert – Platz frei')
                else:
                    put(c, 'plants', p, p['id'])

def backup_bytes():
    # Snapshot + Fotos unter Schreibsperre, damit die Sicherung in sich zusammenpasst.
    with connect() as lock:
        lock.execute('BEGIN IMMEDIATE')
        temp = DATA / ('snapshot-' + uuid.uuid4().hex + '.sqlite3')
        with closing(connect()) as src, closing(sqlite3.connect(temp)) as dest:
            src.backup(dest)
        out = io.BytesIO()
        try:
            with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
                z.write(temp, 'data/pflanzen.sqlite3')
                for f in (DATA / 'photos').iterdir():
                    if f.is_file():
                        z.write(f, 'data/photos/' + f.name)
        finally:
            temp.unlink(missing_ok=True)
        return out.getvalue()

# Sicherungsordner: Standard ist <Daten>/backups; über die Einstellungen kann ein anderer Ordner gewählt werden (z. B. USB-Stick oder Cloud-Ordner).
AUTO_BACKUP_NAME = re.compile(r'\d{8}-\d{6}\.zip')
AUTO_BACKUP_KEEP = 20


def backup_dir():
    custom = get_meta('backup_dir')
    return Path(custom) if custom else DATA / 'backups'


def set_backup_dir(value):
    """Speichert den Sicherungsordner (leer = Standard). Der Ordner muss absolut sein, existieren oder angelegt werden können und beschreibbar sein."""
    value = str(value or '').strip().strip('"')
    if not value:
        with connect() as c:
            c.execute("DELETE FROM app_meta WHERE key='backup_dir'")
        return storage_info()
    folder = Path(value).expanduser()
    if not folder.is_absolute() or len(value) > 400:
        raise ValueError('Bitte den vollständigen Ordnerpfad angeben, z. B. D:\\Sicherungen oder /mnt/stick/pflanzen.')
    try:
        folder.mkdir(parents=True, exist_ok=True)
        probe = folder / ('.schreibtest-' + uuid.uuid4().hex)
        probe.write_bytes(b'x')
        probe.unlink()
    except OSError as e:
        raise ValueError('In diesen Ordner kann nicht geschrieben werden: ' + (e.strerror or str(e)))
    if folder.resolve() == (ROOT / 'web').resolve():
        raise ValueError('Dieser Ordner gehört zum Programm und ist als Sicherungsordner nicht erlaubt.')
    with connect() as c:
        c.execute('INSERT INTO app_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', ('backup_dir', str(folder)))
    return storage_info()


def prune_backups(folder, keep=AUTO_BACKUP_KEEP):
    """Entfernt die ältesten automatisch benannten Sicherungen (nur JJJJMMTT-HHMMSS.zip), behält die neuesten keep Stück."""
    files = sorted(f for f in folder.iterdir() if f.is_file() and AUTO_BACKUP_NAME.fullmatch(f.name)) if folder.is_dir() else []
    for f in files[:-keep] if keep > 0 else []:
        f.unlink(missing_ok=True)
    return max(0, len(files) - keep)


def backup_now():
    """Legt eine Sicherung im Sicherungsordner ab und gibt Name und Größe zurück."""
    folder = backup_dir()
    folder.mkdir(parents=True, exist_ok=True)
    name = datetime.now().strftime('%Y%m%d-%H%M%S') + '.zip'
    data = backup_bytes()
    (folder / name).write_bytes(data)
    prune_backups(folder)
    return {'name': name, 'size': len(data)}


def storage_info():
    """Wo liegen Daten, Fotos und Sicherungen, und welche Sicherungen gibt es."""
    folder = backup_dir()
    backups = []
    if folder.is_dir():
        for f in sorted((f for f in folder.iterdir() if f.is_file() and f.suffix == '.zip'), key=lambda f: f.stat().st_mtime, reverse=True)[:30]:
            st = f.stat()
            backups.append({'name': f.name, 'size': st.st_size, 'time': datetime.fromtimestamp(st.st_mtime).strftime('%Y-%m-%d %H:%M')})
    return {'data_dir': str(DATA), 'database': str(DB), 'photos_dir': str(DATA / 'photos'), 'backup_dir': str(folder),
            'backup_dir_custom': bool(get_meta('backup_dir')), 'backups': backups, 'keep': AUTO_BACKUP_KEEP, 'version': SERVER_VERSION}


# Etiketten-Entwürfe (0.21): frei gestaltbare Etiketten aus Bausteinen. Gespeichert werden nur eigene Entwürfe; die Vorlagen stehen in der Oberfläche.
LABEL_FIELDS = ('label', 'name', 'genus', 'species', 'variety', 'clone_name', 'clone_code', 'category', 'acquired', 'year', 'source', 'location', 'breeder', 'natural_site', 'original_name', 'pot', 'text')
LABEL_QR_POSITIONS = ('left', 'right', 'top', 'none')
LABEL_MAX_DESIGNS = 30
LABEL_MAX_BLOCKS = 12


def _label_number(v, low, high, what):
    try:
        n = float(v)
    except (TypeError, ValueError):
        raise ValueError(what + ' muss eine Zahl sein.')
    if not low <= n <= high:
        raise ValueError(what + ' muss zwischen ' + str(low).rstrip('0').rstrip('.') + ' und ' + str(high).rstrip('0').rstrip('.') + ' liegen.')
    return round(n, 1)


def clean_label_designs(value):
    """Prüft eine Liste eigener Etiketten-Entwürfe und gibt eine bereinigte Kopie zurück. Fehler sind verständliche ValueError."""
    if not isinstance(value, list) or len(value) > LABEL_MAX_DESIGNS:
        raise ValueError('Höchstens %d eigene Etiketten möglich.' % LABEL_MAX_DESIGNS)
    out, seen = [], set()
    for d in value:
        if not isinstance(d, dict):
            raise ValueError('Ungültiges Etikett.')
        ident = str(d.get('id', ''))
        if not re.fullmatch(r'[a-z0-9-]{1,40}', ident) or ident in seen:
            raise ValueError('Ungültige oder doppelte Etiketten-Kennung.')
        seen.add(ident)
        name = str(d.get('name', '')).strip()
        if not 1 <= len(name) <= 60:
            raise ValueError('Bitte dem Etikett einen Namen geben (höchstens 60 Zeichen).')
        qr = d.get('qr', 'left')
        if qr not in LABEL_QR_POSITIONS:
            raise ValueError('Ungültige Position des QR-Codes.')
        blocks = d.get('blocks', [])
        if not isinstance(blocks, list) or len(blocks) > LABEL_MAX_BLOCKS:
            raise ValueError('Höchstens %d Bausteine je Etikett.' % LABEL_MAX_BLOCKS)
        clean_blocks = []
        for b in blocks:
            if not isinstance(b, dict) or b.get('field') not in LABEL_FIELDS:
                raise ValueError('Unbekannter Baustein.')
            prefix = str(b.get('prefix', ''))[:40]
            text = str(b.get('text', ''))[:80]
            clean_blocks.append({'field': b['field'], 'prefix': prefix, 'text': text if b['field'] == 'text' else '',
                                 'size': _label_number(b.get('size', 8), 4, 40, 'Schriftgröße'), 'bold': bool(b.get('bold'))})
        out.append({'id': ident, 'name': name, 'width': _label_number(d.get('width'), 15, 200, 'Breite'), 'height': _label_number(d.get('height'), 10, 200, 'Höhe'),
                    'qr': qr, 'border': bool(d.get('border', True)), 'blocks': clean_blocks})
    return out


def get_label_designs():
    raw = get_meta('label_designs')
    try:
        return json.loads(raw) if raw else []
    except ValueError:
        return []


def set_label_designs(value):
    designs = clean_label_designs(value)
    with connect() as c:
        c.execute('INSERT INTO app_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', ('label_designs', json.dumps(designs, ensure_ascii=False)))
    return designs


# Pflegehinweise je Gattung oder Art (0.24): frei formulierte Angaben, in der Pflanzenansicht angezeigt. Gespeichert in app_meta.
CARE_FIELDS = ('water', 'light', 'substrate', 'climate', 'fertilizer', 'notes')
CARE_MAX_PROFILES = 300
CARE_MAX_TEXT = 600


def clean_care_profiles(value):
    """Prüft die Liste der Pflegehinweise und gibt eine bereinigte Kopie zurück. Fehler sind verständliche ValueError."""
    if not isinstance(value, list) or len(value) > CARE_MAX_PROFILES:
        raise ValueError('Höchstens %d Pflegehinweise möglich.' % CARE_MAX_PROFILES)
    out, seen, keys = [], set(), set()
    for d in value:
        if not isinstance(d, dict):
            raise ValueError('Ungültiger Pflegehinweis.')
        ident = str(d.get('id', ''))
        if not re.fullmatch(r'[a-z0-9-]{1,40}', ident) or ident in seen:
            raise ValueError('Ungültige oder doppelte Kennung eines Pflegehinweises.')
        seen.add(ident)
        genus = str(d.get('genus', '')).strip()
        species = str(d.get('species', '')).strip()
        if not 1 <= len(genus) <= 80 or len(species) > 80:
            raise ValueError('Bitte eine Gattung angeben (die Art ist freiwillig).')
        key = (genus.casefold(), species.casefold())
        if key in keys:
            raise ValueError('Für %s gibt es schon Pflegehinweise.' % (genus + (' ' + species if species else '')))
        keys.add(key)
        item = {'id': ident, 'genus': genus, 'species': species}
        for f in CARE_FIELDS:
            item[f] = str(d.get(f, '') or '').strip()[:CARE_MAX_TEXT]
        if not any(item[f] for f in CARE_FIELDS):
            raise ValueError('Bitte mindestens eine Angabe machen.')
        out.append(item)
    return out


def get_care_profiles():
    raw = get_meta('care_profiles')
    try:
        return json.loads(raw) if raw else []
    except ValueError:
        return []


def set_care_profiles(value):
    profiles = clean_care_profiles(value)
    with connect() as c:
        c.execute('INSERT INTO app_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', ('care_profiles', json.dumps(profiles, ensure_ascii=False)))
    return profiles


# Gespeicherte Ansichten für „Meine Pflanzen“ (0.25): Name, Filter, Sortierung, Seitengröße und sichtbare Spalten. Gespeichert in app_meta.
VIEW_FILTERS = ('q', 'genus', 'species', 'category', 'group_id', 'location_id', 'role', 'status')
VIEW_COLUMNS = ('label', 'name', 'species', 'place', 'group', 'status', 'year', 'clone', 'source', 'pot', 'role')
VIEW_MAX = 30


def clean_plant_views(value):
    """Prüft die Liste der gespeicherten Ansichten; Fehler sind verständliche ValueError."""
    if not isinstance(value, list) or len(value) > VIEW_MAX:
        raise ValueError('Höchstens %d Ansichten möglich.' % VIEW_MAX)
    out, seen, names = [], set(), set()
    for d in value:
        if not isinstance(d, dict):
            raise ValueError('Ungültige Ansicht.')
        ident = str(d.get('id', ''))
        if not re.fullmatch(r'[a-z0-9-]{1,40}', ident) or ident in seen:
            raise ValueError('Ungültige oder doppelte Kennung einer Ansicht.')
        seen.add(ident)
        name = str(d.get('name', '')).strip()
        if not 1 <= len(name) <= 60:
            raise ValueError('Bitte einen Namen für die Ansicht angeben (höchstens 60 Zeichen).')
        if name.casefold() in names:
            raise ValueError('Eine Ansicht „%s“ gibt es schon.' % name)
        names.add(name.casefold())
        raw = d.get('filters') if isinstance(d.get('filters'), dict) else {}
        filters = {k: str(raw[k]).strip()[:120] for k in VIEW_FILTERS if raw.get(k) not in (None, '')}
        sort = d.get('sort') if d.get('sort') in VIEW_COLUMNS else 'name'
        hidden = [c for c in VIEW_COLUMNS if c in (d.get('hidden') or []) and c != 'name']
        size = 100 if d.get('size') == 100 else 50
        out.append({'id': ident, 'name': name, 'filters': filters, 'sort': sort, 'dir': 'desc' if d.get('dir') == 'desc' else 'asc', 'size': size, 'hidden': hidden})
    return out


def get_plant_views():
    raw = get_meta('plant_views')
    try:
        return json.loads(raw) if raw else []
    except ValueError:
        return []


def set_plant_views(value):
    views = clean_plant_views(value)
    with connect() as c:
        c.execute('INSERT INTO app_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', ('plant_views', json.dumps(views, ensure_ascii=False)))
    return views


def plants_csv():
    """Alle Pflanzen als CSV (Semikolon, UTF-8 mit BOM), direkt in Excel zu öffnen."""
    with connect() as c:
        plants = allrows(c, 'plants')
        locs = {l['id']: l for l in allrows(c, 'locations')}

    def path(lid):
        parts, seen = [], set()
        while lid and lid in locs and lid not in seen:
            seen.add(lid)
            parts.append(locs[lid].get('name', ''))
            lid = locs[lid].get('parent_id')
        return ' › '.join(reversed(parts))
    columns = [('Kennung', 'label'), ('Name', 'name'), ('Gattung', 'genus'), ('Art', 'species'), ('Varietät', 'variety'), ('Klonname', 'clone_name'),
               ('Züchtercode', 'clone_code'), ('Fachgruppe', 'category'), ('Status', 'status'), ('Eingang', 'acquired'), ('Herkunft', 'source')]
    names = {'active': 'Im Bestand', 'given': 'Abgegeben', 'dead': 'Eingegangen'}

    def cell(v):
        t = str(v if v is not None else '').replace('\r', ' ').replace('\n', ' ')
        if t[:1] in ('=', '+', '-', '@'):
            t = "'" + t  # keine Formeln aus Fremdtext in Excel auslösen
        return '"' + t.replace('"', '""') + '"'
    lines = [';'.join(cell(h) for h, _ in columns + [('Standort', '')])]
    for p in sorted(plants, key=lambda p: str(p.get('label', ''))):
        row = [names.get(p.get(k), p.get(k)) if k == 'status' else p.get(k) for _, k in columns]
        lines.append(';'.join(cell(v) for v in row + [path(p.get('location_id'))]))
    return ('\ufeff' + '\r\n'.join(lines) + '\r\n').encode('utf-8')


def lan_addresses():
    """Namen und Adressen, unter denen dieser Rechner im Heimnetz erreichbar ist (zulässige Host-Angaben)."""
    host = socket.gethostname()
    addresses = {'127.0.0.1', 'localhost', host, host + '.local'}
    try:
        addresses.update(socket.gethostbyname_ex(host)[2])
    except OSError:
        pass
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(('192.0.2.1', 80))
        addresses.add(s.getsockname()[0])
        s.close()
    except OSError:
        pass
    return addresses


# QR-Codes: Adresse, unter der Geräte im Heimnetz die App erreichen (steckt in jedem QR-Code)
QR_BASE_PATTERN = re.compile(r'https?://([A-Za-z0-9]([A-Za-z0-9.-]{0,60}[A-Za-z0-9])?)(:[0-9]{1,5})?')


def get_meta(key):
    with connect() as c:
        row = c.execute('SELECT value FROM app_meta WHERE key=?', (key,)).fetchone()
    return row['value'] if row else None


def qr_base_host():
    base = get_meta('qr_base')
    m = QR_BASE_PATTERN.fullmatch(base) if base else None
    return m.group(1) if m else None


def qr_settings(port):
    """Aktuelle Adresse für QR-Codes, der automatische Vorschlag (erste Heimnetz-Adresse dieses Rechners) und ob sie eigens gesetzt wurde."""
    ips = sorted(a for a in lan_addresses() if re.fullmatch(r'\d+\.\d+\.\d+\.\d+', a) and not a.startswith('127.'))
    guessed = 'http://' + (ips[0] if ips else '127.0.0.1') + ':' + str(port)
    custom = get_meta('qr_base')
    return {'base': custom or guessed, 'guessed': guessed, 'custom': bool(custom)}


def set_qr_base(value, allowed_hosts):
    """Speichert die Adresse für QR-Codes (leer = Vorschlag verwenden) und lässt deren Rechnernamen zu."""
    value = str(value or '').strip().rstrip('/')
    with connect() as c:
        if not value:
            c.execute("DELETE FROM app_meta WHERE key='qr_base'")
            return True
        m = QR_BASE_PATTERN.fullmatch(value)
        if not m or len(value) > 100:
            raise ValueError('Bitte eine Adresse wie http://192.168.1.20:8766 oder http://pflanzen.local:8766 eingeben (ohne Pfad).')
        c.execute("INSERT OR REPLACE INTO app_meta VALUES ('qr_base', ?)", (value,))
    allowed_hosts.add(m.group(1))
    return True


def resolve_code(code):
    """Aus dem Code eines QR-Codes die Pflanze oder den Standort/Behälter finden: (Art, Kennung) oder None.
    Pflanzen: Inventar-ID (Groß-/Kleinschreibung egal). Standorte und Behälter: Anfang der Kennung (ab 8 Zeichen, muss eindeutig sein)."""
    with connect() as c:
        row = c.execute('SELECT plant_id FROM inventory WHERE upper(label)=upper(?)', (code,)).fetchone()
        if row:
            return ('plant', row['plant_id'])
        if re.fullmatch('[0-9a-fA-F]{8,32}', code):
            rows = c.execute("SELECT id,kind FROM records WHERE kind IN ('plants','locations') AND id LIKE ? ESCAPE '\\'", (code.lower() + '%',)).fetchall()
            if len(rows) == 1:
                return ('plant' if rows[0]['kind'] == 'plants' else 'loc', rows[0]['id'])
    return None


def friendly_error(e):
    """Übersetzt technische Python-Meldungen in verständliches Deutsch.
    Eigene Meldungen der App (ValueError mit deutschem Text) bleiben unverändert."""
    text = str(e)
    if isinstance(e, KeyError):
        return 'Unvollständige Anfrage: Angabe ' + text + ' fehlt. Bitte Seite neu laden (Strg+F5).'
    if isinstance(e, TypeError):
        return 'Ungültige Anfrage (falscher Datentyp). Bitte Seite neu laden (Strg+F5).'
    m = re.match(r"could not convert string to float: '(.*)'", text) or re.match(r"invalid literal for int\(\) with base 10: '(.*)'", text)
    if m:
        return '„' + m.group(1) + '“ ist keine gültige Zahl.'
    if isinstance(e, (OverflowError, ZeroDivisionError)) or text.startswith(('math domain', 'cannot convert float', 'int too large')):
        return 'Die Zahl ist zu groß oder ungültig.'
    if text.startswith(('Only base64', 'Invalid base64', 'Incorrect padding', 'Non-base64')) or 'base64' in text:
        return 'Die Bilddaten sind beschädigt. Bitte das Foto erneut auswählen.'
    if isinstance(e, json.JSONDecodeError) or text.startswith(('Expecting', 'Extra data', 'Unterminated')):
        return 'Die Anfrage konnte nicht gelesen werden.'
    if isinstance(e, sqlite3.Error):
        return 'Datenbankfehler: ' + text + ' Bitte Aktion wiederholen; bleibt der Fehler, die Sicherung einspielen.'
    return text or type(e).__name__


class Handler(BaseHTTPRequestHandler):

    def respond(self, status, data, mime='application/json; charset=utf-8', filename=None):
        raw = data if isinstance(data, bytes) else json.dumps(data, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header('Content-Type', mime)
        self.send_header('Content-Length', str(len(raw)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        if filename:
            self.send_header('Content-Disposition', 'attachment; filename="' + filename + '"')
        self.end_headers()
        self.wfile.write(raw)

    def trusted(self):
        return self.headers.get('Host', '').split(':')[0] in self.server.allowed_hosts

    def do_GET(self):
        if not self.trusted():
            return self.respond(403, {'error': 'Host nicht freigegeben. Die beim Start angezeigte Adresse verwenden.'})
        path = urlsplit(self.path).path
        if path == '/':
            html = (ROOT / 'web/index.html').read_text(encoding='utf-8').replace('__TOKEN__', TOKEN).replace('__VERSION__', current_version())
            return self.respond(200, html.encode(), 'text/html; charset=utf-8')
        if path in STATIC_FILES:
            mime, name = STATIC_FILES[path]
            return self.respond(200, (ROOT / 'web' / name).read_bytes(), mime)
        if re.fullmatch('/[a-z_]+\\.(js|css)', path) and (ROOT / 'web' / path[1:]).is_file():
            return self.respond(200, (ROOT / 'web' / path[1:]).read_bytes(), 'text/javascript; charset=utf-8' if path.endswith('js') else 'text/css; charset=utf-8')
        if path == '/api/version':
            return self.respond(200, {'server': SERVER_VERSION, 'files': current_version()})
        if path == '/api/qr-base':
            return self.respond(200, qr_settings(self.server.server_port))
        if path.startswith('/q/'):
            code = path[3:]
            found = resolve_code(code) if re.fullmatch('[A-Za-z0-9_-]{4,40}', code) else None
            if not found:
                page = ('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Nicht gefunden</title>'
                        '<body style="font-family:sans-serif;max-width:32rem;margin:3rem auto;padding:0 1rem"><h1>Nicht gefunden</h1>'
                        '<p>Zu diesem QR-Code gibt es keine Pflanze und keinen Behälter (mehr). Vielleicht wurde der Eintrag gelöscht oder der Code stammt aus einem anderen Bestand.</p>'
                        '<p><a href="/">Zur Startseite</a></p>')
                return self.respond(404, page.encode(), 'text/html; charset=utf-8')
            self.send_response(302)
            self.send_header('Location', '/#' + found[0] + '=' + found[1])
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Content-Length', '0')
            self.end_headers()
            return None
        if path == '/api/all':
            with connect() as c:
                data = {k: allrows(c, k) for k in KINDS}
                for p in data['plants']:
                    p['effective_care'] = features.effective(c, p)
                for loc in data['locations']:
                    loc['effective_care'] = features.effective(c, loc, location=True)
                return self.respond(200, data)
        if path == '/api/export':
            with connect() as c:
                return self.respond(200, {'schema_version': 3, 'data': {k: allrows(c, k) for k in KINDS}}, filename='pflanzen-export.json')
        if path == '/api/label-designs':
            return self.respond(200, {'designs': get_label_designs()})
        if path == '/api/care-profiles':
            return self.respond(200, {'profiles': get_care_profiles()})
        if path == '/api/plant-views':
            return self.respond(200, {'views': get_plant_views()})
        if path == '/api/storage':
            return self.respond(200, storage_info())
        if path == '/api/export-plants.csv':
            return self.respond(200, plants_csv(), 'text/csv; charset=utf-8', 'Pflanzen.csv')
        if path == '/api/backup':
            return self.respond(200, backup_bytes(), 'application/zip', 'Pflanzen_Sicherung.zip')
        if re.fullmatch('/photos/[a-f0-9]{32}\\.(jpg|png|webp)', path):
            f = DATA / path[1:]
            if f.exists():
                return self.respond(200, f.read_bytes(), {'.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp'}[f.suffix])
        return self.respond(404, {'error': 'Nicht gefunden'})

    def do_POST(self):
        if not self.trusted() or self.headers.get('X-App-Token') != TOKEN:
            return self.respond(403, {'error': 'Zugriff verweigert. Seite neu laden.'})
        try:
            n = int(self.headers.get('Content-Length', 0))
            if not 0 < n <= 22 * 1024 * 1024:
                raise ValueError('Anfrage leer oder zu groß.')
            v = json.loads(self.rfile.read(n))
            if not isinstance(v, dict):
                raise ValueError('Objekt erwartet.')
            path = urlsplit(self.path).path
            if path == '/api/qr-base':
                set_qr_base(v.get('base'), self.server.allowed_hosts)
                return self.respond(200, {'result': qr_settings(self.server.server_port)})
            if path == '/api/label-designs':
                return self.respond(200, {'result': {'designs': set_label_designs(v.get('designs'))}})
            if path == '/api/care-profiles':
                return self.respond(200, {'result': {'profiles': set_care_profiles(v.get('profiles'))}})
            if path == '/api/plant-views':
                return self.respond(200, {'result': {'views': set_plant_views(v.get('views'))}})
            if path == '/api/backup-dir':
                return self.respond(200, {'result': set_backup_dir(v.get('dir'))})
            if path == '/api/backup-now':
                made = backup_now()
                return self.respond(200, {'result': {'made': made, 'storage': storage_info()}})
            result = features.dispatch(path, v)
            self.respond(200, {'result': result, 'undo_id': features.LOCAL.undo_id})
        except (ValueError, KeyError, TypeError, sqlite3.Error) as e:
            self.respond(400, {'error': friendly_error(e)})
        except Exception as e:
            import traceback
            traceback.print_exc()
            self.respond(500, {'error': 'Interner Fehler: ' + friendly_error(e) + ' Bitte Seite neu laden und prüfen, ob die Aktion ausgeführt wurde. Einzelheiten stehen im Serverfenster.'})

def import_old(path):
    with sqlite3.connect(path) as old, connect() as c:
        old.row_factory = sqlite3.Row
        c.execute('BEGIN IMMEDIATE')
        if allrows(c, 'plants'):
            raise ValueError('Übernahme nur in einen leeren neuen Pflanzenbestand möglich.')
        catalog = {r['id']: dict(r) for r in old.execute('SELECT * FROM catalog')}
        mapping = {}
        clones = {}
        locations = {}
        rows = [dict(r) for r in old.execute('SELECT * FROM plants')]
        for p in rows:
            cat = catalog.get(p['catalog_id'], {})
            location = p.get('location', '')
            if location and location not in locations:
                locations[location] = put(c, 'locations', {'name': location, 'rows': 0, 'cols': 0})
            clone = clones.setdefault(p['catalog_id'], uuid.uuid4().hex)
            i = put(c, 'plants', {'name': p['label'], 'label': p['label'], 'genus': '', 'species': cat.get('species', ''), 'clone_name': cat.get('name', ''), 'clone_code': cat.get('clone_code', ''), 'clone_key': clone, 'location_id': locations.get(location, ''), 'source': p.get('source', ''), 'acquired': p.get('acquired', ''), 'notes': p.get('notes', ''), 'status': 'active', 'role': 'unspecified', 'legacy_id': p['id'], 'year': '', 'taxon_type': 'unknown'})
            # Eindeutige alte sichtbare Kennung bewahren; bei Dubletten expliziter Alt-Zusatz.
            label = p['label']
            if c.execute('SELECT 1 FROM inventory WHERE label=?', (label,)).fetchone():
                label += '-ALT-' + str(p['id'])
            c.execute('INSERT INTO inventory VALUES (?,?)', (label, i))
            q = get(c, 'plants', i)
            q['label'] = label
            put(c, 'plants', q, i)
            mapping[p['id']] = i
        for p in rows:
            if p.get('parent_id') in mapping:
                q = get(c, 'plants', mapping[p['id']])
                q['parent_id'] = mapping[p['parent_id']]
                put(c, 'plants', q, q['id'])
        for e in old.execute('SELECT * FROM events WHERE plant_id IS NOT NULL'):
            if e['plant_id'] in mapping:
                put(c, 'events', {'plant_id': mapping[e['plant_id']], 'date': e['date'], 'notes': e['kind'] + '\n' + e['notes'], 'kind': 'note'})
    print(f'{len(rows)} Pflanzen übernommen. Alte Datenbank unverändert. Botanische Angaben bitte ergänzen.')

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--port', type=int, default=8766)
    ap.add_argument('--no-browser', action='store_true')
    ap.add_argument('--import-old')
    args = ap.parse_args()
    init()
    if args.import_old:
        import_old(args.import_old)
        return
    try:
        backup_now()
    except OSError as e:
        print('Hinweis: Start-Sicherung nicht möglich (' + str(e) + '). Sicherungsordner in den Einstellungen prüfen.')
    addresses = lan_addresses()
    try:
        server = ThreadingHTTPServer(('0.0.0.0', args.port), Handler)
    except OSError as e:
        print('Start fehlgeschlagen / Port belegt:', e)
        return
    server.allowed_hosts = addresses
    qr_host = qr_base_host()
    if qr_host:
        addresses.add(qr_host)
    print('\nPFLANZEN-APP ' + SERVER_VERSION + ' – Desktop-Testversion\nPC: http://127.0.0.1:' + str(args.port))
    for a in sorted(addresses - {'127.0.0.1', 'localhost', socket.gethostname()}):
        print('Handy im gleichen WLAN: http://' + a + ':' + str(args.port))
    print('Nur im vertrauenswürdigen Heimnetz verwenden; keine Portfreigabe.\nStoppen: Strg+C. Daten: ' + str(DATA), flush=True)
    if not args.no_browser:
        threading.Timer(0.7, lambda: webbrowser.open('http://127.0.0.1:' + str(args.port))).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
import features
features.install(sys.modules[__name__])
if __name__ == '__main__':
    main()
