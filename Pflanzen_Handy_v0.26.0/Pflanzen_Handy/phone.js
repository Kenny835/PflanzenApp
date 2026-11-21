'use strict';
/* Handy-Version, Seitenteil (wird vor allen anderen Skripten geladen):
   - leitet Anfragen an /api/…, /photos/… und /q/… an den lokalen Python-Worker um (statt ans Netz),
   - beantwortet auch Anfragen des Service Workers (Fotos, Downloads),
   - zeigt beim ersten Start eine Ladeanzeige und bittet den Browser, die Daten dauerhaft zu behalten. */
(() => {
    const base = new URL('./', document.baseURI);
    const relative = url => {
        const u = new URL(url, document.baseURI);
        return u.origin === base.origin && u.pathname.startsWith(base.pathname) ? u.pathname.slice(base.pathname.length) + u.search : null;
    };
    const isBackend = rel => rel !== null && /^(api|photos|q)\//.test(rel);
    let seq = 0;
    const pending = new Map();
    const worker = new Worker('worker.js');
    let readyResolve, readyReject;
    const ready = new Promise((res, rej) => { readyResolve = res; readyReject = rej; });
    const note = document.createElement('div');
    note.id = 'phoneLoading';
    note.setAttribute('role', 'status');
    note.textContent = 'Pflanzen-App wird gestartet …';
    note.style.cssText = 'position:fixed;inset:0;display:grid;place-items:center;background:#f3f4ee;color:#203d31;font:18px system-ui,sans-serif;z-index:9999';
    document.addEventListener('DOMContentLoaded', () => document.body.append(note));
    worker.onmessage = e => {
        const m = e.data;
        if (m.ready) {
            note.remove();
            return readyResolve();
        }
        if (m.failed) {
            note.textContent = 'Start nicht möglich: ' + m.failed;
            return readyReject(new Error(m.failed));
        }
        const p = pending.get(m.id);
        pending.delete(m.id);
        p && p(m);
    };
    const call = async (method, rel, body, token) => {
        await ready;
        const id = ++seq;
        const reply = new Promise(res => pending.set(id, res));
        worker.postMessage({ id, method, path: '/' + rel, body, token }, body ? [body] : []);
        return reply;
    };
    const toResponse = m => {
        const headers = new Headers(m.headers);
        if (m.status === 302 && headers.has('Location')) {
            // Weiterleitung von /q/… auf die Startseite mit Adressteil
            headers.set('Location', base.pathname + headers.get('Location').replace(/^\//, ''));
        }
        return new Response(m.status === 204 || m.status === 304 || m.status === 302 ? null : m.body, { status: m.status, headers });
    };
    const realFetch = window.fetch.bind(window);
    window.fetch = async (input, init = {}) => {
        const req = input instanceof Request ? input : null;
        const rel = relative(req ? req.url : input);
        if (!isBackend(rel))
            return realFetch(input, init);
        const method = (init.method || (req && req.method) || 'GET').toUpperCase();
        let body = init.body !== undefined ? init.body : (req ? await req.arrayBuffer() : null);
        if (typeof body === 'string')
            body = new TextEncoder().encode(body).buffer;
        else if (body instanceof Blob)
            body = await body.arrayBuffer();
        const headers = new Headers(init.headers || (req && req.headers) || {});
        const token = headers.get('X-App-Token');
        return toResponse(await call(method, rel, body, token));
    };
    // Service Worker fragt für Fotos und Downloads nach
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.addEventListener('message', async e => {
            const d = e.data || {};
            if (d.type !== 'backend' || !e.ports[0])
                return;
            const rel = relative(d.url);
            const m = await call('GET', rel, null);
            e.ports[0].postMessage({ status: m.status, headers: m.headers, body: m.body }, [m.body]);
        });
        window.addEventListener('load', async () => {
            try {
                const hadController = !!navigator.serviceWorker.controller;
                await navigator.serviceWorker.register('sw.js');
                if (!hadController)
                    navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true });
            }
            catch (err) {
                console.warn('Offline-Modus nicht verfügbar:', err);
            }
        });
    }
    try {
        navigator.storage?.persist?.();
    }
    catch (err) {
        /* optional */
    }
    window.APP_PHONE = true;
    window.phoneRestore = async file => {
        const m = await call('POST', 'api/restore', await file.arrayBuffer());
        const data = JSON.parse(new TextDecoder().decode(m.body));
        if (m.status !== 200)
            throw Error(data.error || 'Sicherung konnte nicht eingespielt werden.');
        return data.result;
    };
})();
