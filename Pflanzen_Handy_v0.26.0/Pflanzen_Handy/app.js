'use strict';
const $ = s => document.querySelector(s), app = $('#app'), modal = $('#modal'), body = $('#modalBody');
let db = {}, page = 'home', dirty = false, detailId = null, detailOrder = [], selected = new Set(), filters = {}, pendingPhotos = [];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]));
const today = () => new Date().toLocaleDateString('sv-SE');
const year = () => String(new Date().getFullYear());
const names = {
    home: 'Startseite', plants: 'Meine Pflanzen', add: 'Pflanze hinzufügen', wishes: 'Wunschliste', locations: 'Standorte', groups: 'Pflegegruppen', templates: 'Behälterbibliothek', sowing: 'Aussaat', more: 'Sonstiges', settings: 'Einstellungen', labels: 'Etiketten gestalten', caretips: 'Pflegehinweise'
};
// Seiten, die nicht in der Leiste stehen, sondern unter „Sonstiges“ erreichbar sind
const subPages = ['templates', 'settings', 'labels', 'caretips'];
const statusNames = {
    active: 'Im Bestand', given: 'Abgegeben', dead: 'Eingegangen'
}, roles = {
    main: 'Hauptpflanze', backup: 'Backup', unspecified: 'Nicht festgelegt'
};
const find = (kind, id) => db[kind]?.find(x => x.id === id);
const label = (kind, id) => find(kind, id)?.name || '—';
function message(s, error = false) {
    $('#message').textContent = s;
    $('#message').className = error ? 'error' : '';
}

async function load() {
    db = await api('all');
}
function fail(e) {
    const box = modal.open ? body : app;
    let n = box.querySelector('.errorbox');
    if (!n) {
        n = document.createElement('div');
        n.className = 'errorbox';
        n.setAttribute('role', 'alert');
        box.prepend(n);
    }
    n.textContent = e.message;
    n.scrollIntoView({ block: 'nearest' });
}
function button(text, fn, cls = '') {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = cls;
    b.textContent = text;
    // Doppelklicks werden ignoriert, solange die Aktion läuft; Fehler erscheinen als Meldung.
    let busy = false;
    b.onclick = async () => {
        if (busy)
            return;
        busy = true;
        b.disabled = true;
        try {
            await fn();
        }
        catch (e) {
            fail(e);
        }
        finally {
            busy = false;
            b.disabled = false;
        }
    };
    return b;
}
function actions(node, items) {
    const a = document.createElement('div');
    a.className = 'actions';
    for (const [t, fn, cls] of items)
        a.append(button(t, fn, cls));
    node.append(a);
    return a;
}
function empty(text) {
    return `<div class="empty">${esc(text)}</div>`;
}
function canLeave() {
    return !dirty || confirm('Nicht gespeicherte Änderungen verwerfen?');
}
// Dialog schließen und zur genau gleichen sichtbaren Stelle der Standortseiten zurückkehren (kein Zurücksetzen der Ansicht)
function close() {
    if (!canLeave())
        return;
    const y = window.scrollY;
    dirty = false;
    modal.close();
    pendingPhotos = [];
    render();
    if (page === 'locations')
        requestAnimationFrame(() => window.scrollTo(0, y));
}
$('#close').onclick = close;
modal.addEventListener('cancel', e => {
    e.preventDefault();
    close();
});
window.addEventListener('beforeunload', e => {
    if (dirty) {
        e.preventDefault();
        e.returnValue = '';
    }
});
function openDialog(html, canNav = false) {
    pendingPhotos = [];
    modal.classList.remove('wide');
    body.innerHTML = html;
    $('#prev').hidden = $('#next').hidden = !canNav;
    if (!modal.open)
        modal.showModal();
    body.scrollTop = 0;
    modal.scrollTop = 0;
    dirty = false;
    return true;
}
$('#home').onclick = () => go('home');
function go(p) {
    if (!canLeave())
        return;
    dirty = false;
    modal.close();
    page = p;
    render();
    window.scrollTo(0, 0);
}
function renderHeader() {
    $('#nav').replaceChildren();
    if (page !== 'home')
        for (const k of Object.keys(names).filter(k => k !== 'home' && !subPages.includes(k)))
            $('#nav').append(button(names[k], () => go(k), page === k || (k === 'more' && subPages.includes(page)) ? 'active' : ''));
    $('#pageTitle').textContent = page === 'home' ? 'Alles wächst an seinem Platz.' : names[page];
    $('#subtitle').textContent = page === 'home' ? 'Bestand, Backups und Ideen für dein nächstes Beet.' : 'Deine Pflanzen-App · lokal und gemeinsam im WLAN';
}
function render() {
    renderHeader();
    if (page === 'home')
        home();
    else if (page === 'plants')
        plantList();
    else if (page === 'add') {
        app.innerHTML = '<section class="panel" id="newPlant"></section>';
        plantForm($('#newPlant'));
    }
    else if (page === 'sowing')
        sowingList();
    else if (page === 'templates')
        templatesManagement();
    else if (page === 'more')
        moreHub();
    else if (page === 'settings')
        settingsPage();
    else if (page === 'labels')
        labelDesignerPage();
    else if (page === 'caretips')
        careTipsPage();
    else if (page === 'locations')
        locationManagement();
    else
        management(page);
}
function home() {
    const active = db.plants.filter(p => p.status === 'active');
    app.innerHTML = '<div class="tiles"></div><section class="panel"><h2>Aktuelles aus deiner Sammlung</h2><div class="summary"><span><b>' + active.length + '</b> Horste im Bestand</span><span><b>' + db.wishes.filter(w => !w.fulfilled).length + '</b> Wünsche</span><span><b>' + db.locations.length + '</b> Standorte</span></div><div id="careToday"></div><div id="recent"></div></section>';
    const icons = {
        plants: '❧', add: '＋', wishes: '☆', locations: '▦', groups: '☘', sowing: '⋮', more: '⋯'
    };
    const hints = {
        plants: 'Ansehen, filtern und bearbeiten', add: 'Einen oder mehrere Horste erfassen', wishes: 'Kleine Liste für große Vorfreude', locations: 'Beete, Tische und Raster planen', groups: 'Gemeinsame Pflegehinweise verwalten', sowing: 'Chargen, Zeitfenster und Aufzuchtplätze', more: 'Behälterbibliothek, Etiketten, Einstellungen'
    };
    for (const k of Object.keys(icons)) {
        const b = button('', () => go(k), 'tile');
        b.innerHTML = `<span class="icon">${icons[k]}</span><b>${names[k]}</b><span>${hints[k]}</span>`;
        $('.tiles').append(b);
    }
    showCareToday();
    const recent = db.plants.slice(-3).reverse();
    if (recent.length) {
        $('#recent').innerHTML = '<h3>Zuletzt angelegt</h3><div class="list"></div>';
        for (const p of recent)
            $('#recent .list').append(contact(p));
    }
    else
        $('#recent').innerHTML = '<p class="notice">Bereit zum Testen: Lege zuerst einen Standort und deine erste Pflanze an. Es sind keine Beispieldaten als echter Bestand eingetragen.</p>';
}
function photo(p) {
    return db.photos.find(x => x.plant_id === p.id && x.main) || db.photos.find(x => x.plant_id === p.id);
}
function thumb(p) {
    const x = photo(p);
    return x ? `<img class="thumb" src="photos/${esc(x.file)}" alt="${esc(p.name)}" loading="lazy">` : '<span class="thumb" aria-hidden="true">❧</span>';
}
function place(p) {
    return targetText(currentTarget(p));
}
function contact(p) {
    const row = document.createElement('div');
    row.className = 'contact';
    const b = button('', () => detail(p.id));
    b.innerHTML = thumb(p) + `<span class="text"><strong>${esc(p.name)}</strong><small>${esc(p.label)}</small><small>${esc(place(p))}${p.status !== 'active' ? ' · ' + esc(statusNames[p.status]) : ''}</small></span>`;
    row.append(b);
    return row;
}
function options(items, current, blank = 'Bitte wählen / offen') {
    return `<option value="">${esc(blank)}</option>` + items.map(x => {
        let [v, t] = Array.isArray(x) ? x : [x.id, x.name];
        return `<option value="${esc(v)}" ${String(current) === String(v) ? 'selected' : ''}>${esc(t)}</option>`;
    }).join('');
}
function uniques(key) {
    return [...new Set(db.plants.map(p => p[key]).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'de'));
}
function filtered() {
    return db.plants.filter(p => {
        if (filters.q && !['name', 'label', 'clone_name', 'clone_code', 'genus', 'species'].some(k => (p[k] || '').toLocaleLowerCase().includes(filters.q.toLocaleLowerCase())))
            return false;
        for (const k of ['genus', 'species', 'category', 'group_id', 'role'])
            if (filters[k] && (k === 'group_id' ? (p.effective_care?.group_id || p.group_id) : p[k]) !== filters[k])
                return false;
        if (filters.location_id === '__park__' && p.location_id)
            return false;
        if (filters.location_id && filters.location_id !== '__park__' && !underLocation(p.location_id, filters.location_id))
            return false;
        return filters.status === 'all' || p.status === (filters.status || 'active');
    }).sort((a, b) => a.name.localeCompare(b.name, 'de') || a.label.localeCompare(b.label));
}
function plantList() {
    app.innerHTML = '<section class="panel"><div class="filters" id="filters"></div><div id="viewBar"></div><div id="activeFilters" class="help"></div><div id="bulk"></div><div id="plants" class="plant-list"></div></section>';
    const specs = [['q', 'Suchen', null], ['genus', 'Gattung', uniques('genus')], ['species', 'Art / Species', [...new Set(db.plants.filter(p => !filters.genus || p.genus === filters.genus).map(p => p.species).filter(Boolean))]], ['category', 'Fachgruppe', uniques('category')], ['group_id', 'Pflegegruppe', db.groups], ['location_id', 'Standort', [['__park__', 'Parkplatz – nicht zugeordnet'], ...locationOptions()]], ['role', 'Funktion', Object.entries(roles)], ['status', 'Status', [['active', 'Im Bestand'], ['given', 'Abgegeben'], ['dead', 'Eingegangen'], ['all', 'Alle Status']]]];
    for (const [key, title, items] of specs) {
        const l = document.createElement('label');
        l.textContent = title;
        const inp = document.createElement(items ? 'select' : 'input');
        if (items)
            inp.innerHTML = options(items.map(x => typeof x === 'string' ? [x, x] : x), filters[key] || (key === 'status' ? 'active' : ''), 'Alle');
        else {
            inp.value = filters.q || '';
            inp.placeholder = 'ID, Name oder Züchtercode';
            l.className = 'search';
        }
        inp.oninput = () => {
            filters[key] = inp.value;
            plantView.page = 1;
            if (key === 'genus') {
                delete filters.species;
                plantList();
            }
            else
                listResults();
        };
        l.append(inp);
        $('#filters').append(l);
    }
    $('#filters').append(button('Zurücksetzen', () => {
        filters = {};
        selected.clear();
        plantView.page = 1;
        plantList();
    }, 'secondary'));
    listResults();
    if (typeof plantViewBar === 'function')
        plantViewBar();
}
function listResults() {
    renderPlantTable(filtered());
    $('#activeFilters').textContent = Object.entries(filters).filter(([k, v]) => v && k !== 'q').map(([k, v]) => k === 'group_id' ? label('groups', v) : k === 'location_id' ? (v === '__park__' ? 'Parkplatz' : locationPath(v)) : k === 'status' ? statusNames[v] || 'Alle Status' : k === 'role' ? roles[v] : v).join(' · ');
    bulkBar();
}
function bulkBar() {
    const b = $('#bulk');
    if (!b)
        return;
    b.replaceChildren();
    if (!selected.size)
        return;
    b.className = 'chosen';
    b.textContent = selected.size + ' ausgewählt';
    actions(b, [['Standort ändern', () => bulk('location_id')], ['Pflegegruppe ändern', () => bulk('group_id')], ['Status ändern', () => bulk('status')], ['QR-Etiketten drucken', () => qrLabelDialog([...selected].map(id => find('plants', id)).filter(Boolean).map(obj => ({ kind: 'plant', obj }))), 'secondary'], ['Auswahl aufheben', () => {
                selected.clear();
                plantList();
            }, 'secondary']]);
}
function bulk(key) {
    openDialog('<h2>Ausgewählte Pflanzen ändern</h2><p>Die Änderung betrifft ' + selected.size + ' Horste.</p><form id="bulkform"><label>Neuer Wert<select name="value">' + options(key === 'status' ? Object.entries(statusNames) : (key === 'location_id' ? locationOptions() : db.groups), '', key === 'status' ? 'Bitte wählen' : 'Ohne Zuordnung') + '</select></label><button>Übernehmen</button></form>');
    const f = $('#bulkform');
    if (key === 'status')
        f.elements.value.required = true;
    f.onsubmit = async (e) => {
        e.preventDefault();
        try {
            await api('bulk', {
                field: key, value: f.elements.value.value, entries: [...selected].map(id => ({ id, version: find('plants', id).version }))
            });
            await load();
            selected.clear();
            modal.close();
            render();
            message('Änderungen gespeichert.');
        }
        catch (e) {
            fail(e);
        }
    };
}

function field(spec, values, prefix = 'f') {
    const [key, title, type, items] = spec, l = document.createElement('label');
    const caption = document.createElement('span');
    caption.className = 'fieldcaption';
    caption.textContent = title;
    l.append(caption);
    if (type === 'textarea')
        l.classList.add('full');
    const i = document.createElement(['select', 'locations', 'groups', 'clone'].includes(type) ? 'select' : type === 'textarea' ? 'textarea' : 'input');
    i.name = key;
    i.id = prefix + '-' + key;
    i.setAttribute('aria-label', title);
    if (type === 'select')
        i.innerHTML = options(items, values[key]);
    else if (type === 'locations' || type === 'groups')
        i.innerHTML = options(type === 'locations' ? locationOptions() : db[type], values[key], type === 'locations' ? 'Parkplatz – nicht zugeordnet' : 'Bitte wählen / offen');
    else if (type === 'clone') {
        const seen = new Set();
        const opts = db.plants.filter(p => p.clone_key && !seen.has(p.clone_key) && seen.add(p.clone_key)).map(p => [p.clone_key, (p.clone_name || p.name) + ' · ' + p.label]);
        i.innerHTML = options(opts, values[key], 'Neuer / eigenständiger Klon');
    }
    else {
        i.value = values[key] ?? '';
        if (type === 'number') {
            i.type = 'number';
            i.min = '1800';
            i.max = '2200';
        }
        if (type === 'suggest') {
            const list = document.createElement('datalist');
            list.id = prefix + '-list-' + key;
            let vals = uniques(key);
            if (key === 'genus')
                vals = [...new Set(['Sarracenia', 'Dionaea', 'Drosera', 'Pinguicula', 'Nepenthes', 'Darlingtonia', ...vals])];
            if (key === 'category')
                vals = [...new Set(['Karnivoren', ...vals])];
            for (const v of vals)
                list.append(new Option(v, v));
            i.setAttribute('list', list.id);
            l.append(list);
        }
    }
    if (title.includes('*'))
        i.required = true;
    l.append(i);
    return l;
}

function detail(id) {
    const p = find('plants', id);
    if (!p)
        return;
    detailId = id;
    openDialog('', true);
    if (!detailOrder.includes(id))
        detailOrder = db.plants.map(p => p.id);
    const idx = detailOrder.indexOf(id);
    $('#prev').disabled = idx <= 0;
    $('#next').disabled = idx >= detailOrder.length - 1;
    $('#prev').onclick = () => {
        if (canLeave())
            detail(detailOrder[idx - 1]);
    };
    $('#next').onclick = () => {
        if (canLeave())
            detail(detailOrder[idx + 1]);
    };
    body.innerHTML = `<div class="detailhead">${thumb(p)}<div><h2>${esc(p.name)}</h2><p>${esc(p.label)}</p><small>${esc(place(p))}</small></div></div><span class="badge">${esc(statusNames[p.status] || 'Im Bestand')} · ${esc(roles[p.role] || 'Nicht festgelegt')}</span><div id="detailActions"></div><hr><div id="quickCare"></div><hr><div class="detailgrid" id="facts"></div><div id="connections"></div><hr><div id="careProfile"></div><hr><h3>Verlauf</h3><div id="notes"></div><div id="timeline" class="timeline"></div><hr><h3>Fotos</h3><div id="photos" class="gallery"></div><div id="uploads"></div><hr><div id="deleteZone"></div>`;
    actions($('#detailActions'), [['Bearbeiten', () => {
                openDialog('');
                plantForm(body, p);
            }], ['Teilung erfassen', () => {
                const copy = {
                    ...p, parent_id: p.id, year: year(), acquired: today(), accession_type: 'division', status: 'active', role: 'backup', price: '', status_date: '', cause: '', recipient: '', position: '', location_id: ''
                };
                delete copy.id;
                delete copy.label;
                delete copy.version;
                openDialog('');
                plantForm(body, null, copy);
            }, 'secondary'], ['QR-Code', () => qrDialog('plant', p), 'secondary']]);
    const facts = [['Gattung / Art', [p.genus, p.species, p.variety].filter(Boolean).join(' ')], ['Klon / Sorte', p.clone_name], ['Züchtercode', p.clone_code], ['Fachgruppe', p.category], ['Pflegegruppe', p.effective_care?.group_id ? label('groups', p.effective_care.group_id) + ' · ' + p.effective_care.source : label('groups', p.group_id)], ['Bezugsquelle', p.source], ['Zugang', p.acquired || p.year], ['Zugangsart', {
                purchase: 'Kauf', exchange: 'Tausch', gift: 'Geschenk', division: 'Eigene Teilung', propagation: 'Eigene Vermehrung'
            }[p.accession_type]], ['Naturstandort', p.natural_site], ['Züchter', p.breeder], ['Substrat', p.substrate], ['Topfgröße', p.pot], ['Preis', p.price], ['Ursprungsbezeichnung', p.original_name], ['Hybridformel', p.hybrid_formula], ['Mutter / Vater', [p.mother, p.father].filter(Boolean).join(' × ')], ['Statusdatum', p.status_date], ['Empfänger', p.recipient], ['Ursache', p.cause], ['Notizen', p.notes]];
    for (const [k, v] of facts)
        if (v && v !== '—')
            $('#facts').insertAdjacentHTML('beforeend', `<dl><dt>${esc(k)}</dt><dd>${esc(v)}</dd></dl>`);
    if (p.parent_id) {
        const par = find('plants', p.parent_id);
        if (par)
            actions($('#connections'), [['Ausgangspflanze: ' + par.label, () => detail(par.id), 'secondary']]);
    }
    else if (p.parent_deleted)
        $('#connections').textContent = p.parent_deleted;
    const siblings = db.plants.filter(x => x.clone_key === p.clone_key && x.id !== p.id);
    if (siblings.length) {
        const d = document.createElement('details');
        d.innerHTML = '<summary>Weitere Horste dieses Klons (' + siblings.length + ')</summary>';
        for (const x of siblings)
            d.append(contact(x));
        $('#connections').append(d);
    }
    for (const x of db.photos.filter(x => x.plant_id === id)) {
        const card = document.createElement('div');
        card.className = 'photocard';
        card.innerHTML = `<a href="photos/${esc(x.file)}" target="_blank" rel="noopener"><img src="photos/${esc(x.file)}" alt="${esc(x.description || p.name)}" loading="lazy"></a><small>${esc(x.date || 'Datum offen')}${x.main ? ' · Hauptbild' : ''}</small><p>${esc(x.description || '')}</p>`;
        card.append(button('Hauptbild', async () => {
            await api('photo-edit', { id: x.id, main: true });
            await load();
            detail(id);
        }, 'secondary'), button('Angaben', () => photoEdit(x), 'secondary'), button('Entfernen', () => remove('photos', x, () => detail(id)), 'secondary'));
        $('#photos').append(card);
    }
    addHistory(p);
    uploadUI(id);
    const nf = document.createElement('form');
    nf.innerHTML = '<div class="formgrid"><label>Beobachtungsdatum (optional)<input name="date" placeholder="z. B. 2026-11 oder unbekannt"></label><label>Notiz<textarea name="notes" required placeholder="Zum Beispiel: Erstmals geblüht"></textarea></label></div><button>Notiz ergänzen</button>';
    nf.oninput = () => dirty = true;
    nf.onsubmit = async (e) => {
        e.preventDefault();
        try {
            await api('save', {
                kind: 'events', values: {
                    plant_id: id, ...Object.fromEntries(new FormData(nf)), kind: 'note'
                }
            });
            dirty = false;
            await load();
            detail(id);
        }
        catch (e) {
            fail(e);
        }
    };
    $('#notes').append(nf);
    plantTimelineView($('#timeline'), p);
    plantQuickCare($('#quickCare'), p);
    plantCareProfileView($('#careProfile'), p);
    $('#deleteZone').innerHTML = '<h3>Endgültig löschen</h3><p class="help">Für Test- und Fehleinträge. Die Inventar-ID wird frei. Fotos und Notizen werden aus dem aktiven Bestand entfernt. Bereits erstellte Sicherungen bleiben erhalten.</p>';
    $('#deleteZone').append(button('Horst unwiderruflich löschen', () => remove('plants', p, () => {
        modal.close();
        selected.delete(id);
        render();
    }), 'danger'));
}
function eventEdit(n) {
    openDialog('<h2>Notiz bearbeiten</h2>');
    const f = document.createElement('form');
    f.append(field(['date', 'Datum'], n), field(['notes', 'Notiz *', 'textarea'], n));
    body.append(f);
    f.oninput = () => dirty = true;
    const b = document.createElement('button');
    b.textContent = 'Speichern';
    f.append(b);
    f.onsubmit = async (e) => {
        e.preventDefault();
        try {
            await api('save', {
                kind: 'events', id: n.id, values: { ...n, ...Object.fromEntries(new FormData(f)) }
            });
            dirty = false;
            await load();
            detail(n.plant_id);
        }
        catch (e) {
            fail(e);
        }
    };
}
function photoEdit(x) {
    openDialog('<h2>Bildangaben</h2>');
    const f = document.createElement('form');
    f.append(field(['date', 'Aufnahmedatum (auch ungenau)'], x), field(['description', 'Beschreibung', 'textarea'], x));
    const b = document.createElement('button');
    b.textContent = 'Speichern';
    f.append(b);
    body.append(f);
    f.oninput = () => dirty = true;
    f.onsubmit = async (e) => {
        e.preventDefault();
        try {
            await api('photo-edit', { id: x.id, ...Object.fromEntries(new FormData(f)) });
            dirty = false;
            await load();
            detail(x.plant_id);
        }
        catch (e) {
            fail(e);
        }
    };
}
function uploadUI(id) {
    const u = $('#uploads');
    u.innerHTML = '<div class="drop" id="drop"><p>Fotos hier ablegen oder auswählen</p><div class="actions" id="photoButtons"></div><small>JPEG, PNG, WebP · maximal 15 MB je Foto</small></div><div id="previews" class="gallery"></div><div id="uploadActions"></div>';
    const gallery = document.createElement('input');
    gallery.type = 'file';
    gallery.accept = 'image/jpeg,image/png,image/webp';
    gallery.multiple = true;
    gallery.hidden = true;
    const camera = document.createElement('input');
    camera.type = 'file';
    camera.accept = 'image/*';
    camera.setAttribute('capture', 'environment');
    camera.hidden = true;
    u.append(gallery, camera);
    $('#photoButtons').append(button('Foto aufnehmen', () => camera.click()), button('Fotos auswählen', () => gallery.click(), 'secondary'));
    async function add(files) {
        for (const f of files) {
            if (f.size > 15 * 1024 * 1024) {
                fail(Error(f.name + ': größer als 15 MB.'));
                continue;
            }
            const data = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result);
                reader.onerror = () => reject(Error('Bild konnte nicht gelesen werden.'));
                reader.readAsDataURL(f);
            });
            pendingPhotos.push({
                data, name: f.name, date: '', description: ''
            });
        }
        dirty = !!pendingPhotos.length;
        previews();
    }
    gallery.onchange = () => add(gallery.files).catch(fail);
    camera.onchange = () => add(camera.files).catch(fail);
    const drop = $('#drop');
    drop.ondragover = e => {
        e.preventDefault();
        drop.classList.add('over');
    };
    drop.ondragleave = () => drop.classList.remove('over');
    drop.ondrop = e => {
        e.preventDefault();
        drop.classList.remove('over');
        add(e.dataTransfer.files).catch(fail);
    };
    function previews() {
        const target = $('#previews');
        target.replaceChildren();
        for (const [i, x] of pendingPhotos.entries()) {
            const card = document.createElement('div');
            card.className = 'photocard';
            const img = document.createElement('img');
            img.src = x.data;
            img.alt = x.name;
            card.append(img);
            const date = field(['date', 'Aufnahmedatum'], x, 'photo' + i), desc = field(['description', 'Beschreibung'], x, 'photo' + i);
            date.querySelector('input').oninput = e => x.date = e.target.value;
            desc.querySelector('input').oninput = e => x.description = e.target.value;
            card.append(date, desc, button('Auswahl entfernen', () => {
                pendingPhotos.splice(i, 1);
                dirty = !!pendingPhotos.length;
                previews();
            }, 'secondary'));
            target.append(card);
        }
        $('#uploadActions').replaceChildren();
        if (pendingPhotos.length) {
            const b = button(pendingPhotos.length + ' Fotos speichern', async () => {
                b.disabled = true;
                try {
                    while (pendingPhotos.length) {
                        const x = pendingPhotos[0];
                        await api('photo', {
                            plant_id: id, data: x.data.split(',')[1], date: x.date, description: x.description
                        });
                        pendingPhotos.shift();
                    }
                    dirty = false;
                    await load();
                    detail(id);
                    message('Fotos gespeichert.');
                }
                catch (e) {
                    previews();
                    fail(e);
                }
                finally {
                    b.disabled = false;
                }
            });
            $('#uploadActions').append(b);
        }
    }
}
function remove(kind, obj, done) {
    openDialog('<h2>Endgültig löschen?</h2><p>' + esc(obj.label || obj.name || 'Bild') + '</p><p>Dies kann in der App nicht rückgängig gemacht werden. Zur Bestätigung <strong>löschen</strong> eingeben.</p><form id="deleteform"><label>Bestätigung<input name="confirm" autocomplete="off" required></label><button class="danger">Endgültig löschen</button></form>');
    $('#deleteform').onsubmit = async (e) => {
        e.preventDefault();
        try {
            await api('delete', {
                kind, id: obj.id, confirm: e.target.elements.confirm.value
            });
            dirty = false;
            await load();
            modal.close();
            render();
            done?.();
            message('Eintrag gelöscht.');
        }
        catch (e) {
            fail(e);
        }
    };
}
const configs = {
    locations: [['name', 'Name *'], ['type', 'Art des Standorts', 'select', [['place', 'Ort / Gebäude'], ['table', 'Tisch'], ['tub', 'Kübel / Behälter'], ['bed', 'Beet'], ['shelf', 'Regal'], ['other', 'Andere Stellfläche']]], ['parent_id', 'Übergeordneter Ort', 'select', []], ['rows', 'Rasterreihen (0 = ohne Raster)'], ['cols', 'Rasterspalten (0 = ohne Raster)'], ['description', 'Beschreibung', 'textarea']], groups: [['name', 'Name *'], ['description', 'Beschreibung', 'textarea'], ['watering', 'Bewässerung / Wasserqualität', 'textarea'], ['light', 'Licht'], ['substrate', 'Substrat'], ['growing_temperature', 'Wunschtemperatur', 'textarea'], ['winter_rest', 'Winterruhe', 'textarea'], ['temperature', 'Bisherige Angaben zu Temperatur und Winterruhe', 'textarea'], ['care', 'Weitere Pflegehinweise', 'textarea']], wishes: [['name', 'Pflanzen- / Klonname *'], ['genus', 'Gattung', 'suggest'], ['species', 'Art / Species', 'suggest'], ['source', 'Bezugsquelle'], ['url', 'Link'], ['notes', 'Kurze Notiz', 'textarea']]
};
function management(kind) {
    app.innerHTML = '<section class="panel"><div class="actions space"><h2>' + names[kind] + '</h2><div id="newItem"></div></div><p class="muted">' + ({
        locations: 'Eigene Standorte anlegen. Mit Reihen und Spalten wird daraus ein Beet- oder Tischraster.', groups: 'Allgemeine Pflegehinweise, unabhängig vom Standort deiner Pflanzen.', wishes: 'Nur deine Wünsche – ohne großen Artenkatalog und ohne Inventar-IDs.'
    }[kind]) + '</p><label>Suchen<input id="manageSearch" placeholder="Bezeichnung suchen"></label><div id="managed" class="list" style="margin-top:18px"></div></section>';
    $('#newItem').append(button('＋ Neu anlegen', () => simpleForm(kind)));
    const show = () => {
        const q = $('#manageSearch').value.toLowerCase();
        $('#managed').replaceChildren();
        const items = db[kind].filter(x => x.name.toLowerCase().includes(q));
        for (const x of items) {
            const row = document.createElement('div');
            row.className = 'contact';
            const b = button('', () => manageDetail(kind, x.id));
            b.innerHTML = `<span class="thumb">${kind === 'wishes' ? '☆' : kind === 'locations' ? '▦' : '☘'}</span><span class="text"><strong>${esc(x.name)}</strong><small>${esc(kind === 'locations' ? (x.rows && x.cols ? x.rows + ' × ' + x.cols + ' Plätze' : 'Ohne Raster') : kind === 'wishes' ? (x.fulfilled ? 'Bereits übernommen' : x.source || 'Noch offen') : x.description || 'Pflegegruppe')}</small></span>`;
            row.append(b);
            if (kind === 'groups') {
                const calendars = document.createElement('div');
                calendars.className = 'actions care-shortcuts';
                calendars.append(button('Gießkalender', () => showCareGroup(x, 'watering'), 'secondary'),
                    button('Ereigniskalender', () => showCareGroup(x, 'events'), 'secondary'));
                row.classList.add('care-group-row');
                row.append(calendars);
            }
            $('#managed').append(row);
        }
        if (!items.length)
            $('#managed').innerHTML = empty('Hier ist noch Platz. Lege deinen ersten Eintrag an.');
    };
    $('#manageSearch').oninput = show;
    show();
}
function simpleForm(kind, obj = null, defaults = {}) {
    openDialog('<h2>' + (obj ? 'Bearbeiten' : 'Neu anlegen') + ' · ' + names[kind] + '</h2>');
    const f = document.createElement('form');
    const grid = document.createElement('div');
    grid.className = 'formgrid';
    for (let spec of configs[kind]) {
        if (kind === 'groups' && spec[0] === 'temperature' && !obj?.temperature)
            continue;
        if (kind === 'locations' && spec[0] === 'parent_id')
            spec = [...spec.slice(0, 3), locationOptions(obj?.id)];
        const l = field(spec, {
            type: 'place', ...defaults, ...(obj || {})
        });
        if ((kind === 'locations' && spec[0] === 'parent_id') || (kind === 'groups' && spec[0] === 'name'))
            l.classList.add('full');
        if (['rows', 'cols'].includes(spec[0])) {
            const i = l.querySelector('input');
            i.type = 'number';
            i.min = 0;
            i.max = 3000;
            i.value = obj?.[spec[0]] || 0;
        }
        grid.append(l);
    }
    f.append(grid);
    const groupEvents = kind === 'groups' ? arrangeCareForm(f, grid, obj) : null;
    if (kind === 'locations') {
        const hint = document.createElement('p');
        hint.className = 'help';
        hint.textContent = 'Ohne übergeordneten Ort steht dieser Eintrag ganz oben. Beim Umstellen eines Kübels oder Tisches bleiben Pflanzen und Rasterplätze erhalten; die letzten Standorte werden dokumentiert. Reihen und Spalten sind optional.';
        f.append(hint);
    }
    if (kind === 'wishes') {
        const l = document.createElement('label');
        l.className = 'inlinecheck';
        l.innerHTML = '<input type="checkbox" name="fulfilled" ' + (obj?.fulfilled ? 'checked' : '') + '> Bereits erfüllt';
        f.append(l);
        const hint = document.createElement('p');
        hint.className = 'help';
        hint.textContent = 'Optionales Wunschfoto: JPEG/PNG/WebP bis 2 MB. Wird nur beim neuen Auswählen ersetzt.';
        const file = document.createElement('input');
        file.type = 'file';
        file.name = 'wishphoto';
        file.accept = 'image/jpeg,image/png,image/webp';
        f.append(hint, file);
    }
    const b = document.createElement('button');
    b.type = 'submit';
    b.textContent = 'Speichern';
    f.append(b);
    body.append(f);
    f.oninput = () => dirty = true;
    f.onsubmit = async (e) => {
        e.preventDefault();
        b.disabled = true;
        try {
            const values = Object.fromEntries(new FormData(f));
            delete values.wishphoto;
            if (kind === 'groups') {
                const missing = groupEvents.find(event => !event.title.trim());
                if (missing) throw Error('Bitte für das Ereignis am ' + missing.date.split('-').reverse().join('.') + ' einen Titel eintragen.');
                values.care_events = groupEvents;
                values.watering_days = [...f.querySelectorAll('[data-water-day]:checked')].map(input => Number(input.value));
            }
            if (obj) {
                values.version = obj.version;
                if (obj.image)
                    values.image = obj.image;
            }
            if (kind === 'wishes') {
                values.fulfilled = f.elements.fulfilled.checked;
                const file = f.elements.wishphoto.files[0];
                if (file) {
                    if (file.size > 2 * 1024 * 1024)
                        throw Error('Wunschfoto maximal 2 MB.');
                    values.image = await new Promise((res, rej) => {
                        const r = new FileReader();
                        r.onload = () => res(r.result);
                        r.onerror = () => rej(Error('Bild konnte nicht gelesen werden'));
                        r.readAsDataURL(file);
                    });
                }
            }
            const saved = await api('save', {
                kind, id: obj?.id, values
            });
            dirty = false;
            await load();
            render();
            manageDetail(kind, saved[0].id);
        }
        catch (e) {
            fail(e);
        }
        finally {
            b.disabled = false;
        }
    };
}
function manageDetail(kind, id) {
    if (kind === 'locations') {
        locationDetail(id);
        return;
    }
    const x = find(kind, id);
    if (kind === 'groups') {
        showCareGroup(x);
        return;
    }
    openDialog('<h2>' + esc(x.name) + '</h2><div id="manageActions"></div><div id="manageFacts" class="detailgrid" style="margin-top:20px"></div><div id="extra"></div>');
    actions($('#manageActions'), [['Bearbeiten', () => simpleForm(kind, x)], ['Löschen', () => remove(kind, x), 'secondary']]);
    for (const [key, title] of configs[kind])
        if (x[key] && key !== 'name')
            $('#manageFacts').insertAdjacentHTML('beforeend', `<dl><dt>${esc(title)}</dt><dd>${esc(x[key])}</dd></dl>`);
    if (kind === 'locations') {
        if (x.rows && x.cols)
            actions($('#extra'), [['Raster öffnen / planen', () => raster(id)]]);
        else
            $('#extra').innerHTML = '<p class="notice">Unter „Bearbeiten“ Reihen und Spalten festlegen, um ein Raster zu aktivieren.</p>';
    }
    if (kind === 'locations' || kind === 'groups') {
        const ps = db.plants.filter(p => p[kind === 'locations' ? 'location_id' : 'group_id'] === id);
        $('#extra').insertAdjacentHTML('beforeend', '<h3>Zugeordnete Horste (' + ps.length + ')</h3>');
        for (const p of ps)
            $('#extra').append(contact(p));
    }
    if (kind === 'wishes') {
        if (x.image && /^data:image\/(jpeg|png|webp);base64,/.test(x.image)) {
            $('#extra').insertAdjacentHTML('beforeend', '<img style="max-width:100%;max-height:280px;margin-top:16px" alt="Wunschfoto" src="' + esc(x.image) + '">');
        }
        if (x.url && /^https?:\/\//i.test(x.url)) {
            const a = document.createElement('a');
            a.href = x.url;
            a.target = '_blank';
            a.rel = 'noopener noreferrer';
            a.textContent = 'Bezugsquelle öffnen';
            $('#extra').append(a);
        }
        actions($('#extra'), [['In den Bestand übernehmen', () => {
                    openDialog('');
                    plantForm(body, null, {
                        name: x.name, genus: x.genus || plantNameParts(x.name).genus, species: x.species || plantNameParts(x.name).species, source: x.source || '', notes: x.notes || '', wish_id: x.id, clone_name: x.name
                    });
                }]]);
        if (x.fulfilled)
            $('#extra').insertAdjacentHTML('beforeend', '<p class="help">Dieser Wunsch wurde bereits als erfüllt markiert. Weitere Horste können trotzdem angelegt werden.</p>');
    }
}
function coord(r, c) {
    let s = '', n = r + 1;
    while (n) {
        n--;
        s = String.fromCharCode(65 + n % 26) + s;
        n = Math.floor(n / 26);
    }
    return s + (c + 1);
}
function raster(id) {
    boardState.left = id;
    board();
}

