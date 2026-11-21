'use strict';
/* Gespeicherte Ansichten für „Meine Pflanzen“ (0.25): Filter, Sortierung, Seitengröße und sichtbare Spalten
   unter einem Namen merken. Die Ansichten liegen auf dem Server (gelten also auf jedem Gerät und sind in Sicherungen).
   Reine Funktionen (plantViewSnapshot, plantViewApply, plantViewSame) sind getestet; plantViewBar baut nur die Leiste. */
const plantViewFilterKeys = ['q', 'genus', 'species', 'category', 'group_id', 'location_id', 'role', 'status'];
let plantViews = [], plantViewsLoaded = false, plantViewCurrent = '', plantViewForm = false, plantViewConfirm = false, plantViewKeepOpen = false, plantViewNote = '';

// Zustand der Liste → speicherbares Objekt (leere Filter entfallen)
function plantViewSnapshot(filters, view) {
    const f = {};
    for (const k of plantViewFilterKeys)
        if (filters && filters[k])
            f[k] = String(filters[k]);
    return { filters: f, sort: view.sort || 'name', dir: view.dir === 'desc' ? 'desc' : 'asc', size: Number(view.size) === 100 ? 100 : 50, hidden: [...(view.hidden || [])].sort() };
}

// Gespeicherte Ansicht → neuer Zustand (Standard = Ansicht ohne Angaben)
function plantViewApply(saved, extras = ['clone', 'source', 'pot', 'role']) {
    const s = saved || {};
    return { filters: { ...(s.filters || {}) }, sort: s.sort || 'name', dir: s.dir || 'asc', size: s.size || 50, hidden: saved ? [...(s.hidden || [])] : [...extras] };
}

// Entspricht der aktuelle Zustand der gespeicherten Ansicht? (zum Anzeigen von „geändert“)
function plantViewSame(saved, filters, view) {
    const a = plantViewSnapshot(saved.filters, saved), b = plantViewSnapshot(filters, view);
    return JSON.stringify(a) === JSON.stringify(b);
}

const plantViewNewId = () => 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

async function plantViewsLoad(force = false) {
    if (plantViewsLoaded && !force)
        return plantViews;
    try {
        plantViews = (await api('plant-views')).views || [];
        plantViewsLoaded = true;
    }
    catch (e) {
        plantViews = [];
    }
    return plantViews;
}
async function plantViewsSave(list) {
    plantViews = (await api('plant-views', { views: list })).views;
    plantViewsLoaded = true;
    return plantViews;
}

function plantViewUse(saved) {
    const st = plantViewApply(saved);
    filters = st.filters;
    plantView.sort = st.sort;
    plantView.dir = st.dir;
    plantView.size = st.size;
    plantView.hidden = st.hidden;
    plantView.page = 1;
    selected.clear();
    plantList();
}

async function plantViewBar() {
    const host = $('#viewBar');
    if (!host)
        return;
    await plantViewsLoad();
    if (!$('#viewBar'))
        return;
    const cur = plantViews.find(v => v.id === plantViewCurrent);
    if (!cur)
        plantViewCurrent = '';
    host.replaceChildren();
    host.className = 'view-bar';
    const pick = document.createElement('label');
    pick.textContent = 'Ansicht';
    const sel = document.createElement('select');
    sel.innerHTML = '<option value="">Standard</option>' + plantViews.map(v => '<option value="' + esc(v.id) + '">' + esc(v.name) + '</option>').join('');
    sel.value = plantViewCurrent;
    sel.onchange = () => {
        plantViewCurrent = sel.value;
        plantViewForm = plantViewConfirm = false;
        plantViewUse(plantViews.find(v => v.id === sel.value));
    };
    pick.append(sel);
    host.append(pick);
    if (cur && !plantViewSame(cur, filters, plantView)) {
        const mark = document.createElement('span');
        mark.className = 'view-changed';
        mark.textContent = 'geändert';
        host.append(mark);
    }
    // Spaltenauswahl
    const det = document.createElement('details');
    det.className = 'view-columns';
    const sum = document.createElement('summary');
    sum.textContent = 'Spalten';
    det.append(sum);
    const box = document.createElement('div');
    box.className = 'view-columns-list';
    for (const [key, title] of plantColumns) {
        if (key === 'select' || key === 'name')
            continue;
        const l = document.createElement('label');
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = !plantView.hidden.includes(key);
        cb.onchange = () => {
            const set = new Set(plantView.hidden);
            cb.checked ? set.delete(key) : set.add(key);
            plantView.hidden = [...set];
            if (plantView.hidden.includes(plantView.sort))
                plantView.sort = 'name';
            listResults();
            plantViewBar();
        };
        l.append(cb, ' ' + title);
        box.append(l);
    }
    det.append(box);
    if (plantViewKeepOpen)
        det.open = true;
    det.ontoggle = () => {
        plantViewKeepOpen = det.open;
    };
    host.append(det);
    // Speichern, Aktualisieren, Löschen
    const acts = document.createElement('span');
    acts.className = 'actions';
    if (plantViewForm) {
        const f = document.createElement('form');
        f.className = 'view-form';
        f.innerHTML = '<label>Name der Ansicht<input name="name" maxlength="60" required></label><button>Speichern</button>';
        f.elements.name.value = cur ? cur.name : '';
        f.onsubmit = async e => {
            e.preventDefault();
            const name = f.elements.name.value.trim();
            const snap = plantViewSnapshot(filters, plantView);
            const same = plantViews.find(v => v.name.toLocaleLowerCase('de') === name.toLocaleLowerCase('de'));
            const entry = { id: same ? same.id : plantViewNewId(), name, ...snap };
            try {
                await plantViewsSave(same ? plantViews.map(v => v.id === same.id ? entry : v) : [...plantViews, entry]);
                plantViewCurrent = entry.id;
                plantViewForm = false;
                plantViewNote = 'Ansicht „' + name + '“ gespeichert.';
                plantViewBar();
            }
            catch (err) {
                fail(err);
            }
        };
        f.append(button('Abbrechen', () => {
            plantViewForm = false;
            plantViewBar();
        }, 'secondary'));
        acts.append(f);
    }
    else {
        acts.append(button(cur ? 'Ansicht speichern …' : 'Als Ansicht speichern …', () => {
            plantViewForm = true;
            plantViewConfirm = false;
            plantViewBar();
            $('#viewBar input[name=name]')?.focus();
        }, 'secondary'));
        if (cur)
            acts.append(button(plantViewConfirm ? 'Wirklich löschen?' : 'Ansicht löschen', async () => {
                if (!plantViewConfirm) {
                    plantViewConfirm = true;
                    return plantViewBar();
                }
                try {
                    await plantViewsSave(plantViews.filter(v => v.id !== cur.id));
                    plantViewCurrent = '';
                    plantViewConfirm = false;
                    plantViewBar();
                }
                catch (err) {
                    fail(err);
                }
            }, 'secondary'));
    }
    host.append(acts);
    if (plantViewNote) {
        const n = document.createElement('span');
        n.className = 'view-note';
        n.setAttribute('role', 'status');
        n.textContent = plantViewNote;
        host.append(n);
        plantViewNote = '';
    }
}
