'use strict';
/* Web Worker der Handy-Version: startet Python (Pyodide), lädt die Daten aus dem Browserspeicher (IndexedDB)
   und beantwortet Anfragen mit dem unveränderten Serverprogramm. Alle Anfragen laufen nacheinander. */
importScripts('pyodide/pyodide.js');
let py = null, FS = null, queue = Promise.resolve();
const sync = populate => new Promise((resolve, reject) => FS.syncfs(populate, err => err ? reject(err) : resolve()));

async function start() {
    py = await loadPyodide({ indexURL: 'pyodide/' });
    await py.loadPackage('sqlite3');
    FS = py.FS;
    FS.mkdir('/app');
    FS.mkdir('/data');
    FS.mount(FS.filesystems.IDBFS, {}, '/data');
    await sync(true);
    const manifest = await (await fetch('backend.json')).json();
    for (const name of manifest.files)
        FS.writeFile('/app/' + name, new Uint8Array(await (await fetch('backend/' + name)).arrayBuffer()));
    py.runPython("import sys; sys.path.insert(0, '/app'); import gateway; gateway.start()");
    await sync(false);
    py.globals.set('_handle', py.runPython('gateway.handle'));
}
const ready = start();

async function answer(m) {
    await ready;
    const handle = py.globals.get('_handle');
    const proxy = handle(m.method, m.path, m.body ? new Uint8Array(m.body) : new Uint8Array(0), m.token || 'handy');
    const [status, headers, body] = proxy.toJs({ dict_converter: Object.fromEntries });
    proxy.destroy();
    if (m.method !== 'GET')
        await sync(false);
    const out = new Uint8Array(body).buffer;
    return { id: m.id, status, headers, body: out };
}

self.onmessage = e => {
    const m = e.data;
    queue = queue.then(() => answer(m)).catch(err => ({ id: m.id, status: 500, headers: { 'Content-Type': 'application/json' }, body: new TextEncoder().encode(JSON.stringify({ error: 'Interner Fehler: ' + (err && err.message || err) })).buffer }))
        .then(r => self.postMessage(r, [r.body]));
};
ready.then(() => self.postMessage({ ready: true }), err => self.postMessage({ failed: String(err && err.message || err) }));
