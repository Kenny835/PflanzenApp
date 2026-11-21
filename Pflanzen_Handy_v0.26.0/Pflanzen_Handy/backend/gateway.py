"""Handy-Version: ruft das unveränderte Serverprogramm ohne Netzwerk auf.

Läuft in Pyodide (Python als WebAssembly) in einem Web Worker. Die Daten liegen unter /data (im Browser gespeichert).
handle() nimmt eine Anfrage (Methode, Pfad, Inhalt) entgegen und liefert (Status, Kopfzeilen, Inhalt) zurück –
dieselben Antworten, die sonst der HTTP-Server schickt."""
import io
import json
import os
import shutil
import sqlite3
import zipfile
from email.message import Message
from pathlib import Path

os.environ.setdefault('PFLANZEN_DATA', '/data')
import server  # noqa: E402

TOKEN = 'handy'
server.TOKEN = TOKEN
server.lan_addresses = lambda: {'127.0.0.1', 'localhost'}
DATA = server.DATA
_original_storage_info = server.storage_info


def _storage_info():
    info = _original_storage_info()
    photos = DATA / 'photos'
    info['photo_bytes'] = sum(f.stat().st_size for f in photos.iterdir() if f.is_file()) if photos.is_dir() else 0
    info['database_bytes'] = server.DB.stat().st_size if server.DB.exists() else 0
    return info


server.storage_info = _storage_info


class _Request(server.Handler):
    """Der bekannte Handler, aber ohne Socket: Anfrage kommt aus dem Speicher, Antwort wird eingesammelt."""

    def __init__(self, method, path, body, token):
        self.path = path
        self.command = method
        self.headers = Message()
        self.headers['Host'] = 'localhost'
        self.headers['X-App-Token'] = token
        self.headers['Content-Length'] = str(len(body))
        self.rfile = io.BytesIO(body)
        self.server = type('S', (), {'allowed_hosts': {'127.0.0.1', 'localhost'}, 'server_port': 0})()
        self.status, self.out_headers, self.out = 0, {}, io.BytesIO()
        self.wfile = self.out

    def send_response(self, code, message=None):
        self.status = code

    def send_header(self, key, value):
        self.out_headers[key] = value

    def end_headers(self):
        pass

    def log_message(self, *args):
        pass


def start():
    """Datenbank anlegen bzw. öffnen. Vorher muss /data aus dem Browserspeicher geladen sein."""
    server.init()


def handle(method, path, body=b'', token=TOKEN):
    if path.split('?')[0] == '/api/restore' and method == 'POST':
        return _restore(bytes(body))
    req = _Request(method, path, bytes(body), token)
    getattr(req, 'do_' + method)()
    return req.status, req.out_headers, req.out.getvalue()


def _json(status, data):
    return status, {'Content-Type': 'application/json; charset=utf-8'}, json.dumps(data, ensure_ascii=False).encode()


def _restore(raw):
    """Sicherung (ZIP aus „Sicherung herunterladen“) einspielen. Die bisherigen Daten werden vorher als Notsicherung abgelegt."""
    try:
        z = zipfile.ZipFile(io.BytesIO(raw))
    except zipfile.BadZipFile:
        return _json(400, {'error': 'Das ist keine Sicherungsdatei (ZIP).'})
    names = z.namelist()
    if 'data/pflanzen.sqlite3' not in names:
        return _json(400, {'error': 'In der ZIP-Datei fehlt data/pflanzen.sqlite3. Bitte eine Sicherung aus dieser App wählen.'})
    for n in names:
        if '..' in n.split('/') or n.startswith('/') or not n.startswith('data/'):
            return _json(400, {'error': 'Die Sicherung enthält unerwartete Dateien.'})
    temp = DATA / 'restore-check.sqlite3'
    temp.write_bytes(z.read('data/pflanzen.sqlite3'))
    try:
        with sqlite3.connect(temp) as c:
            tables = {r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type='table'")}
            if not {'records', 'inventory', 'app_meta'} <= tables or c.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
                raise ValueError
    except (sqlite3.Error, ValueError):
        temp.unlink(missing_ok=True)
        return _json(400, {'error': 'Die Datenbank in der Sicherung ist unbrauchbar. Es wurde nichts verändert.'})
    # Notsicherung der bisherigen Daten
    try:
        (DATA / 'vor-wiederherstellung.zip').write_bytes(server.backup_bytes())
    except Exception:
        pass
    photos = DATA / 'photos'
    shutil.rmtree(photos, ignore_errors=True)
    photos.mkdir(exist_ok=True)
    for n in names:
        if n.startswith('data/photos/') and not n.endswith('/'):
            (photos / Path(n).name).write_bytes(z.read(n))
    shutil.move(str(temp), str(server.DB))
    server.init()
    return _json(200, {'result': {'restored': True}})
