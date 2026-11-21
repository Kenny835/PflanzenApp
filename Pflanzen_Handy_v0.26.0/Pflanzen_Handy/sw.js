'use strict';
/* Service Worker der Handy-Version: macht die App offline startbar (alle Programmdateien werden beim ersten Öffnen
   gespeichert) und holt Fotos und Downloads (/photos/…, /api/…) vom Python-Worker der geöffneten Seite. */
const CACHE = 'pflanzen-handy-0.26.0';
const scope = new URL('./', self.location.href).pathname;

self.addEventListener('install', e => {
    e.waitUntil((async () => {
        const list = await (await fetch('precache.json', { cache: 'no-store' })).json();
        const cache = await caches.open(CACHE);
        await cache.addAll(list.files.map(f => new Request(f, { cache: 'reload' })));
        await self.skipWaiting();
    })());
});
self.addEventListener('activate', e => {
    e.waitUntil((async () => {
        for (const k of await caches.keys())
            if (k.startsWith('pflanzen-handy-') && k !== CACHE)
                await caches.delete(k);
        await self.clients.claim();
    })());
});

async function fromPage(url, clientId) {
    const all = await self.clients.matchAll({ type: 'window' });
    const client = all.find(c => c.id === clientId) || all[0];
    if (!client)
        return new Response('Die App ist nicht geöffnet.', { status: 503 });
    const reply = await new Promise(resolve => {
        const ch = new MessageChannel();
        ch.port1.onmessage = ev => resolve(ev.data);
        client.postMessage({ type: 'backend', url }, [ch.port2]);
        setTimeout(() => resolve({ status: 504, headers: {}, body: new ArrayBuffer(0) }), 20000);
    });
    const headers = new Headers(reply.headers);
    if (reply.status === 302 && headers.has('Location'))
        headers.set('Location', scope + headers.get('Location').replace(/^\//, ''));
    return new Response([204, 302, 304].includes(reply.status) ? null : reply.body, { status: reply.status, headers });
}

self.addEventListener('fetch', e => {
    const req = e.request;
    if (req.method !== 'GET')
        return;
    const url = new URL(req.url);
    if (url.origin !== self.location.origin || !url.pathname.startsWith(scope))
        return;
    const rel = url.pathname.slice(scope.length);
    if (/^(api|photos|q)\//.test(rel))
        return e.respondWith(fromPage(req.url, e.clientId || e.resultingClientId));
    e.respondWith((async () => {
        const hit = await caches.match(rel === '' ? 'index.html' : req, { ignoreSearch: true });
        if (hit)
            return hit;
        try {
            return await fetch(req);
        }
        catch (err) {
            if (req.mode === 'navigate')
                return (await caches.match('index.html')) || Response.error();
            return Response.error();
        }
    })());
});
