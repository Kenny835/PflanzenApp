/* 0.5 – maßstäbliche Stellflächen, Mehrfachauswahl, Behälter und Fotos */
let undoId = null, selectionLoc = '', cellsSelected = new Map(), selectionMode = false, selectionAnchor = null, focusPlant = null;
const zooms = {}, defaultsSize = {};
async function api(path, values) {
    const r = await fetch('api/' + path, values ? {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-App-Token': window.APP_TOKEN }, body: JSON.stringify(values)
    } : {});
    const x = await r.json();
    if (!r.ok)
        throw Error(x.error || 'Anfrage fehlgeschlagen');
    if (x.undo_id)
        undoId = x.undo_id;
    return values ? x.result : x;
}
const oldDragSource = dragSource;
dragSource = function (el, payload) {
    if (payload.kind === 'plant' && !payload.width) {
        const p = find('plants', payload.plant_id);
        Object.assign(payload, p?.footprint || {});
    }
    oldDragSource(el, payload);
    el.addEventListener('dragstart', e => {
        if (selectionMode && selectionLoc === el.dataset.locationId && cellsSelected.has(el.dataset.areaRow + ':' + el.dataset.areaCol)) {
            dragPayload = {
                kind: 'selection', location_id: selectionLoc, entries: [...cellsSelected.values()]
            };
            e.dataTransfer.setData('application/x-pflanzen', JSON.stringify(dragPayload));
        }
    });
};
// Zusätzlich auch die älteren Formularaktionen vor Doppelklicks schützen.
document.addEventListener('submit', e => {
    const f = e.target;
    if (f.dataset.submitting === '1') {
        e.preventDefault();
        e.stopImmediatePropagation();
        return;
    }
    f.dataset.submitting = '1';
    setTimeout(() => {
        delete f.dataset.submitting;
    }, 800);
}, true);
locationTypes.tray = 'Quickpotplatte / Tray';
configs.locations = [['name', 'Name *'], ['type', 'Art des Standorts', 'select', Object.entries(locationTypes)], ['parent_id', 'Übergeordneter Ort', 'select', []], ['unit', 'Darstellung', 'select', [['slots', 'Raster mit einzelnen Plätzen'], ['cm', 'Maßstäbliche Fläche in cm']]], ['rows', 'Rasterreihen (nur Platzraster)'], ['cols', 'Rasterspalten (nur Platzraster)'], ['width_cm', 'Breite in cm (maßstäblich)'], ['depth_cm', 'Tiefe in cm (maßstäblich)'], ['step', 'Sichtbarer Rasterabstand in cm'], ['group_id', 'Pflegevorgabe', 'groups'], ['substrate', 'Substratmischung', 'textarea'], ['layers', 'Schichtaufbau', 'textarea'], ['substrate_date', 'Substrat eingefüllt / gewechselt am'], ['description', 'Beschreibung', 'textarea']];
const oldSimple = simpleForm;
simpleForm = function (kind, obj = null, defaults = {}) {
    if (dirty && !canLeave())
        return;
    dirty = false;
    oldSimple(kind, obj, {
        unit: 'slots', step: 7, ...defaults
    });
    if (kind !== 'locations')
        return;
    const f = body.querySelector('form');
    for (const k of ['rows', 'cols'])
        f.elements[k].value = obj?.[k] ?? defaults[k] ?? 0;
    const update = () => {
        const measured = f.elements.unit.value === 'cm';
        for (const k of ['rows', 'cols'])
            f.elements[k].closest('label').hidden = measured;
        for (const k of ['width_cm', 'depth_cm', 'step']) {
            f.elements[k].closest('label').hidden = !measured;
            f.elements[k].required = measured;
            f.elements[k].type = 'number';
            f.elements[k].min = .1;
            f.elements[k].max = 3000;
            f.elements[k].step = 'any';
        }
    };
    f.elements.unit.addEventListener('change', update);
    update();
    const submit = f.onsubmit;
    f.onsubmit = async (e) => {
        if (obj && (obj.group_id || '') !== f.elements.group_id.value) {
            const ps = db.plants.filter(p => underLocation(p.location_id, obj.id));
            const inherited = ps.filter(p => !p.group_id);
            if (!confirm('Pflegevorgabe ändern? ' + inherited.length + ' Pflanzen ohne eigene Pflegegruppe werden neu ausgewertet; ' + (ps.length - inherited.length) + ' eigene Vorgaben bleiben erhalten. Vorrangige Zonen-/Behältervorgaben bleiben wirksam.')) {
                e.preventDefault();
                return;
            }
        }
        await submit(e);
    };
    f.insertAdjacentHTML('afterbegin', '<p class="notice">Für gemischte Topfgrößen „Maßstäbliche Fläche“ wählen. Quickpotplatten bekommen hier ihr internes Platzraster; die Außenmaße legst du beim Platzieren auf dem Tisch fest. Bestehende belegte Raster behalten ihre Einheit.</p>');
};
const dims = l => ({
    w: l.unit === 'cm' ? Number(l.width_cm) : Number(l.cols), h: l.unit === 'cm' ? Number(l.depth_cm) : Number(l.rows), step: l.unit === 'cm' ? Number(l.step || 7) : 1
});
const areaOf = x => ({
    row: Number(x.row), col: Number(x.col), width: Number(x.width || 1), depth: Number(x.depth || 1)
});
const intersect = (a, b) => a.col < b.col + b.width - 1e-8 && b.col < a.col + a.width - 1e-8 && a.row < b.row + b.depth - 1e-8 && b.row < a.row + a.depth - 1e-8;
const at = (loc, r, c) => db.cells.find(x => x.location_id === loc && r >= x.row && r < x.row + (x.depth || 1) && c >= x.col && c < x.col + (x.width || 1));
const positionName = (loc, a) => loc.unit === 'cm' ? `x ${a.col} / y ${a.row} cm` : coord(a.row, a.col);
function currentTarget(p) {
    const x = db.cells.find(x => x.plant_id === p.id && x.mode === 'present');
    return {
        location_id: p.location_id || '', row: x?.row ?? null, col: x?.col ?? null, width: x?.width || p.footprint?.width || 1, depth: x?.depth || p.footprint?.depth || 1, position: p.position || ''
    };
}
const oldLocationPath = locationPath;
locationPath = function (id) {
    let cursor = id, seen = new Set();
    while (cursor && !seen.has(cursor)) {
        seen.add(cursor);
        const l = find('locations', cursor);
        if (l?.parked)
            return 'Parkplatz · ' + oldLocationPath(id);
        cursor = l?.parent_id;
    }
    return oldLocationPath(id);
};
const oldTargetText = targetText;
targetText = function (t) {
    const l = find('locations', t?.location_id);
    return l?.unit === 'cm' && t.row != null ? (t.path || locationPath(l.id)) + ' → ' + positionName(l, t) : oldTargetText(t);
};
function clearSelection() {
    cellsSelected.clear();
    selectionAnchor = null;
}

function areaTitle(x) {
    return x.mode === 'container' ? '▣ ' + label('locations', x.container_id) : x.mode === 'present' ? '● ' + label('plants', x.plant_id) : x.mode === 'planned' ? '◇ ' + (find('plants', x.plant_id)?.name || find('wishes', x.wish_id)?.name || x.note || 'Geplant') : ({ reserved: '□ Reserviert', blocked: '× Außerhalb' }[x.mode] || 'Frei') + (x.note ? ' · ' + x.note : '');
}
function surface(host, loc, onPick, { picker = false, active = null, ignorePlant = '', ignoreContainer = '', reserved = [] } = {}) {
    const d = dims(loc);
    if (!d.w || !d.h) {
        host.innerHTML = empty('Dieser Standort hat keinen Plan.');
        return;
    }
    let scale = zooms[loc.id] || (loc.unit === 'cm' ? 5 : 62);
    const tools = document.createElement('div');
    tools.className = 'actions';
    const wrap = document.createElement('div');
    wrap.className = 'surfacewrap';
    const plane = document.createElement('div');
    plane.className = 'surface';
    plane.tabIndex = 0;
    plane.setAttribute('aria-label', 'Standortplan ' + loc.name);
    wrap.append(plane);
    host.append(tools, wrap);
    const labelZoom = document.createElement('span');
    tools.append(button('−', () => resize(scale / 1.4), 'secondary'), button('＋', () => resize(scale * 1.4), 'secondary'), button('Gesamtansicht', () => resize(Math.max(.1, (wrap.clientWidth - 20) / d.w)), 'secondary'), labelZoom);
    const instructions = document.createElement('p');
    instructions.className = 'help';
    instructions.textContent = 'Zum Navigieren scrollen oder am Handy wischen. Bei fokussiertem Plan: Pfeiltasten. Flächen anklicken; Shift + Klick wählt ein Rechteck. Maße ändern sich durch Zoom nicht.';
    host.append(instructions);
    function sizeNode(node, a) {
        Object.assign(node.style, {
            left: a.col * scale + 'px', top: a.row * scale + 'px', width: a.width * scale + 'px', height: a.depth * scale + 'px'
        });
    }
    function resize(n) {
        scale = Math.min(loc.unit === 'cm' ? 30 : 140, Math.max(.1, n));
        zooms[loc.id] = scale;
        plane.style.width = d.w * scale + 'px';
        plane.style.height = d.h * scale + 'px';
        plane.style.backgroundSize = d.step * scale + 'px ' + d.step * scale + 'px';
        labelZoom.textContent = `${d.w} × ${d.h} ${loc.unit === 'cm' ? 'cm' : 'Plätze'}`;
        draw();
    }
    function paint(a, cls, text) {
        const el = document.createElement('div');
        el.className = cls;
        el.textContent = text || '';
        sizeNode(el, a);
        plane.append(el);
        return el;
    }
    function selectedPaint() {
        plane.querySelectorAll('.selectionmark').forEach(x => x.remove());
        if (selectionLoc === loc.id && !picker)
            for (const a of cellsSelected.values())
                paint(areaOf(a), 'selectionmark');
        if (active)
            paint(active, 'selectionmark');
    }
    function pick(a, e) {
        onPick(a, e);
        selectedPaint();
    }
    function draw() {
        plane.replaceChildren();
        for (const z of db.zones.filter(x => x.location_id === loc.id))
            for (const a of z.areas) {
                const el = paint(areaOf(a), 'zonepaint', z.name);
                el.style.borderColor = /^#[a-f0-9]{6}$/i.test(z.color) ? z.color : '#6f85a4';
                el.title = 'Zone ' + z.name;
            }
        for (const x of db.cells.filter(x => x.location_id === loc.id)) {
            const a = areaOf(x), b = button('', () => {
            }, 'area ' + x.mode);
            b.innerHTML = '<b>' + esc(positionName(loc, x)) + '</b><span>' + esc(areaTitle(x)) + '</span>';
            b.dataset.areaRow = x.row;
            b.dataset.areaCol = x.col;
            b.dataset.locationId = loc.id;
            b.title = areaTitle(x);
            b.setAttribute('aria-label', positionName(loc, x) + ' ' + areaTitle(x));
            sizeNode(b, a);
            if (x.plant_id === focusPlant)
                b.classList.add('focused');
            b.onclick = e => {
                e.stopPropagation();
                pick({
                    ...a, id: x.id, version: x.version
                }, e);
            };
            plane.append(b);
            if (!picker) {
                const p = find('plants', x.plant_id);
                if (selectionMode && selectionLoc === loc.id && cellsSelected.has(x.row + ':' + x.col))
                    dragSource(b, {
                        kind: 'selection', location_id: loc.id, entries: [...cellsSelected.values()]
                    });
                else if (x.mode === 'present' && p)
                    dragSource(b, {
                        kind: 'plant', plant_id: p.id, version: p.version, width: a.width, depth: a.depth, unit: loc.unit || 'slots'
                    });
                else if (x.mode === 'container') {
                    const l = find('locations', x.container_id);
                    dragSource(b, {
                        kind: 'container', id: l.id, version: l.version, width: a.width, depth: a.depth, unit: loc.unit || 'slots'
                    });
                }
                else if (x.mode === 'planned')
                    dragSource(b, {
                        kind: 'plan', cell_id: x.id, version: x.version, width: a.width, depth: a.depth, unit: loc.unit || 'slots'
                    });
            }
        }
        selectedPaint();
    }
    const point = e => {
        const r = plane.getBoundingClientRect();
        return {
            row: Math.floor(Math.max(0, e.clientY - r.top) / scale / d.step) * d.step, col: Math.floor(Math.max(0, e.clientX - r.left) / scale / d.step) * d.step, width: d.step, depth: d.step
        };
    };
    plane.onclick = e => pick(point(e), e);
    plane.onkeydown = e => {
        if (e.key.startsWith('Arrow')) {
            e.preventDefault();
            wrap.scrollBy({ left: e.key === 'ArrowLeft' ? -80 : e.key === 'ArrowRight' ? 80 : 0, top: e.key === 'ArrowUp' ? -80 : e.key === 'ArrowDown' ? 80 : 0 });
        }
    };
    if (!picker) {
        let ghost;
        plane.ondragover = e => {
            if (!dragPayload)
                return;
            e.preventDefault();
            if (ghost)
                ghost.remove();
            const a = {
                ...point(e), width: dragPayload.width || d.step, depth: dragPayload.depth || d.step
            };
            ghost = paint(a, 'dropghost ' + (validArea(loc, a, dragPayload.plant_id, dragPayload.id) ? 'valid' : 'invalid'));
            e.dataTransfer.dropEffect = 'move';
        };
        plane.ondragleave = e => {
            if (!plane.contains(e.relatedTarget)) {
                ghost?.remove();
                ghost = null;
            }
        };
        plane.ondrop = async (e) => {
            e.preventDefault();
            e.stopPropagation();
            ghost?.remove();
            const payload = dragPayload;
            if (!payload || boardBusy)
                return;
            boardBusy = true;
            try {
                if (payload.kind === 'selection')
                    throw Error('Eine Mehrfachauswahl über „Auf Parkplatz“ oder in die Parkplatzleiste verschieben.');
                const a = {
                    ...point(e), width: payload.width || d.step, depth: payload.depth || d.step
                };
                await performMove(payload, { location_id: loc.id, ...a });
                clearSelection();
                dirty = false;
                await load();
                board();
            }
            catch (err) {
                boardError(err);
            }
            finally {
                boardBusy = false;
                dragPayload = null;
            }
        };
    }
    resize(scale);
    if (focusPlant) {
        const node = plane.querySelector('.focused');
        if (node)
            setTimeout(() => node.scrollIntoView({ block: 'nearest', inline: 'nearest' }), 0);
    }
}
async function performMove(payload, target) {
    const loc = find('locations', target.location_id);
    if (target.row != null && payload.unit && loc && (loc.unit || 'slots') !== payload.unit)
        throw Error('Das Ziel verwendet eine andere Maßeinheit. Bitte „Platz wählen“ verwenden und die Maße dort festlegen.');
    if (payload.kind === 'container')
        return api('container-move', {
            id: payload.id, version: payload.version, target
        });
    if (payload.kind === 'plan')
        return api('move-plan', { ...payload, ...target });
    return api('move', {
        plant_id: payload.plant_id, version: payload.version, target
    });
}
function toggleSelection(loc, a, e) {
    if (selectionLoc !== loc.id) {
        clearSelection();
        selectionLoc = loc.id;
    }
    if (e.shiftKey && selectionAnchor) {
        const d = dims(loc);
        let count = 0;
        for (let r = Math.min(a.row, selectionAnchor.row); r <= Math.max(a.row, selectionAnchor.row); r += d.step)
            for (let c = Math.min(a.col, selectionAnchor.col); c <= Math.max(a.col, selectionAnchor.col); c += d.step) {
                if (++count > 10000)
                    throw Error('Bitte höchstens 10000 Felder auf einmal auswählen.');
                const x = at(loc.id, r, c), v = x ? {
                    ...areaOf(x), id: x.id, version: x.version
                } : {
                    row: r, col: c, width: Math.min(d.step, d.w - c), depth: Math.min(d.step, d.h - r)
                };
                cellsSelected.set(v.row + ':' + v.col, v);
            }
    }
    else {
        const key = a.row + ':' + a.col;
        cellsSelected.has(key) ? cellsSelected.delete(key) : cellsSelected.set(key, a);
        selectionAnchor = a;
    }
    updateSelectionBar();
}
// Auswahlleiste: Grundleiste plus Erweiterungen (Hooks) der anderen Module, in Ladereihenfolge.
const selectionBarHooks = [];
function onSelectionBar(hook) {
    selectionBarHooks.push(hook);
}
function updateSelectionBar() {
    selectionBarBase();
    for (const hook of selectionBarHooks)
        hook();
}
function selectionBarBase() {
    const n = $('#selectionBar');
    if (!n)
        return;
    n.replaceChildren();
    const entries = [...cellsSelected.values()], objects = entries.map(x => find('cells', x.id));
    const free = objects.filter(x => !x).length, present = objects.filter(x => x?.mode === 'present').length;
    const t = document.createElement('p');
    t.textContent = `${entries.length} ausgewählt · ${free} frei · ${present} Pflanzen`;
    n.append(t);
    if (!entries.length)
        return;
    for (const [action, title] of [['reserved', 'Reservieren'], ['blocked', 'Außerhalb markieren'], ['release', 'Freigeben'], ['park', 'Pflanzen auf Parkplatz']])
        n.append(button(title, async () => {
            const eligible = action === 'park' ? present : action === 'release' ? objects.filter(x => ['blocked', 'reserved'].includes(x?.mode)).length : free;
            if (!eligible)
                throw Error('Kein passendes Feld in der Auswahl.');
            if (!confirm(`${title}: ${eligible} betroffen, ${entries.length - eligible} bleiben unverändert. Ausführen?`))
                return;
            const result = await api('grid-bulk', {
                location_id: selectionLoc, entries, action
            });
            clearSelection();
            await load();
            board();
            $('#boardMessage').textContent = `${result.changed} geändert, ${result.skipped} übersprungen.`;
        }, 'secondary'));
    n.append(button('Zone aus Auswahl', () => zoneForm(find('locations', selectionLoc), null, entries.map(areaOf)), 'secondary'), button('Auswahl aufheben', () => {
        clearSelection();
        board();
    }, 'secondary'));
}

function drawBoard(host, loc) {
    const pane = document.createElement('section');
    pane.className = 'boardpane';
    pane.innerHTML = '<h3>' + esc(loc.name) + '</h3><p class="help">' + esc(locationPath(loc.id)) + '</p>';
    host.append(pane);
    const tools = actions(pane, [['Standortdetails', () => locationDetail(loc.id), 'secondary'], ['Behälter / Platte zuordnen', () => {
                const choices = db.locations.filter(x => x.id !== loc.id && !underLocation(loc.id, x.id) && ['tray', 'tub', 'table', 'other'].includes(x.type));
                openDialog('<h2>Behälter oder Platte wählen</h2><p>Für neue Platten zuerst einen Standort vom Typ Quickpotplatte anlegen.</p>');
                for (const l of choices)
                    body.append(button(l.name, () => containerPicker(l, loc.id), 'secondary'));
                body.append(button('Neue Platte anlegen', () => simpleForm('locations', null, {
                    type: 'tray', rows: 6, cols: 8
                })));
            }, 'secondary']]);
    if (selectionMode)
        tools.append(button('Alle Felder auswählen', () => {
            const d = dims(loc);
            if (Math.ceil(d.w / d.step) * Math.ceil(d.h / d.step) > 10000)
                throw Error('Bitte Bereich mit Shift + Klick eingrenzen (höchstens 10000 Felder).');
            clearSelection();
            selectionLoc = loc.id;
            for (let r = 0; r < d.h; r += d.step)
                for (let c = 0; c < d.w; c += d.step) {
                    const x = at(loc.id, r, c), a = x ? {
                        ...areaOf(x), id: x.id, version: x.version
                    } : {
                        row: r, col: c, width: Math.min(d.step, d.w - c), depth: Math.min(d.step, d.h - r)
                    };
                    cellsSelected.set(a.row + ':' + a.col, a);
                }
            board();
        }, 'secondary'));
    const plan = document.createElement('div');
    pane.append(plan);
    surface(plan, loc, (a, e) => {
        if (selectionMode) {
            toggleSelection(loc, a, e);
            return;
        }
        if (canLeave()) {
            dirty = false;
            areaEditor(loc, a);
        }
    });
    const zones = db.zones.filter(z => z.location_id === loc.id);
    for (const z of zones)
        pane.append(button('Zone: ' + z.name, () => zoneForm(loc, z), 'secondary'));
    for (const l of db.locations.filter(x => x.parent_id === loc.id && x.type !== 'pot'))
        pane.append(button('▣ ' + l.name, () => {
            boardState.left = l.id;
            clearSelection();
            board();
        }, 'secondary'));
}
function sizeFields(f, loc, values) {
    const fs = document.createElement('fieldset');
    fs.innerHTML = '<legend>Stellfläche · ' + (loc.unit === 'cm' ? 'cm' : 'Rasterplätze') + '</legend><div class="formgrid"></div>';
    for (const [k, title] of [['col', 'Position x / Spalte (ab 0)'], ['row', 'Position y / Reihe (ab 0)'], ['width', 'Breite'], ['depth', 'Tiefe']]) {
        const l = field([k, title], values);
        const i = l.querySelector('input');
        i.type = 'number';
        i.min = ['row', 'col'].includes(k) ? 0 : loc.unit === 'cm' ? .1 : 1;
        i.step = loc.unit === 'cm' ? 'any' : '1';
        i.required = true;
        fs.querySelector('.formgrid').append(l);
    }
    const select = document.createElement('select');
    select.setAttribute('aria-label', 'Topf- oder Plattenvorlage');
    select.innerHTML = options((db.templates || []).filter(x => !x.hidden && (x.unit || 'cm') === (loc.unit || 'slots')), '', 'Vorlage wählen');
    select.onchange = () => {
        const t = find('templates', select.value);
        if (t) {
            f.elements.width.value = t.width;
            f.elements.depth.value = t.depth;
            f.dispatchEvent(new Event('input', { bubbles: true }));
        }
    };
    fs.append(select);
    f.append(fs);
}
function areaEditor(loc, a) {
    const old = find('cells', a.id);
    const n = $('#cellEditor');
    n.innerHTML = '<hr><h3>' + esc(loc.name) + ' · ' + esc(positionName(loc, a)) + '</h3>';
    if (old?.mode === 'container') {
        const l = find('locations', old.container_id);
        actions(n, [['Behälter öffnen', () => locationDetail(l.id)], ['Behälter verschieben', () => containerPicker(l)], ['Behälter parken', async () => {
                    await api('container-move', {
                        id: l.id, version: l.version, target: {}
                    });
                    await load();
                    board();
                }, 'secondary']]);
        return;
    }
    if (old?.mode === 'present') {
        const p = find('plants', old.plant_id);
        actions(n, [['Pflanze öffnen', () => detail(p.id)], ['Verschieben', () => choosePlace({ initial: currentTarget(p), plantId: p.id }, async (target) => {
                    await api('move', {
                        plant_id: p.id, version: p.version, target
                    });
                    dirty = false;
                    await load();
                    board();
                })]]);
    }
    const f = document.createElement('form');
    n.append(f);
    sizeFields(f, loc, a);
    f.append(field(['mode', 'Belegung', 'select', [['empty', 'Frei'], ['reserved', 'Reserviert'], ['blocked', 'Außerhalb'], ['planned', 'Geplant'], ['present', 'Tatsächliche Pflanze']]], { mode: old?.mode || 'reserved' }), field(['plant_id', 'Bestandspflanze', 'select', db.plants.filter(p => p.status === 'active').map(p => [p.id, p.label + ' · ' + p.name])], old || {}), field(['wish_id', 'Alternativ Wunsch', 'select', db.wishes], old || {}), field(['note', 'Bezeichnung / Platznotiz'], old || {}));
    const sync = () => {
        f.elements.plant_id.closest('label').hidden = !['present', 'planned'].includes(f.elements.mode.value);
        f.elements.wish_id.closest('label').hidden = f.elements.mode.value !== 'planned';
    };
    sync();
    f.onchange = () => {
        dirty = true;
        sync();
    };
    f.oninput = () => dirty = true;
    const b = document.createElement('button');
    b.textContent = 'Stellfläche speichern';
    f.append(b);
    f.onsubmit = async (e) => {
        e.preventDefault();
        if (b.disabled)
            return;
        b.disabled = true;
        try {
            const v = Object.fromEntries(new FormData(f));
            if (!['present', 'planned'].includes(v.mode))
                v.plant_id = '';
            if (v.mode !== 'planned')
                v.wish_id = '';
            if (old?.mode === 'present' && v.mode !== 'present' && !confirm('Die bisherige Pflanze auf den Parkplatz stellen und Fläche ändern?'))
                return;
            await api('cell', {
                ...v, location_id: loc.id, id: old?.id, version: old?.version
            });
            dirty = false;
            await load();
            board();
        }
        catch (err) {
            fail(err);
        }
        finally {
            b.disabled = false;
        }
    };
}

function zoneForm(loc, z = null, areas = []) {
    if (dirty && !canLeave())
        return;
    dirty = false;
    openDialog('<h2>' + esc(z ? 'Zone bearbeiten' : 'Zone anlegen') + '</h2><p>Ein Feld gehört höchstens zu einer Zone. Anstauhöhe ist eine Planungsangabe; leer bedeutet nicht angegeben.</p>');
    const f = document.createElement('form');
    for (const spec of [['name', 'Name *'], ['group_id', 'Pflegegruppe', 'groups'], ['water_cm', 'Soll-Anstauhöhe in cm (optional)'], ['color', 'Farbe'], ['notes', 'Notizen', 'textarea']])
        f.append(field(spec, z || { color: '#6688aa' }));
    f.elements.color.type = 'color';
    f.elements.water_cm.type = 'number';
    f.elements.water_cm.min = 0;
    f.elements.water_cm.step = 'any';
    const b = document.createElement('button');
    b.textContent = 'Zone speichern';
    f.append(b);
    body.append(f);
    f.oninput = () => dirty = true;
    f.onsubmit = async (e) => {
        e.preventDefault();
        b.disabled = true;
        try {
            if (z && !confirm('Zonenvorgabe aktualisieren? Pflanzen ohne eigene Pflegegruppe werden entsprechend neu zugeordnet.'))
                return;
            await api('zone', {
                ...Object.fromEntries(new FormData(f)), location_id: loc.id, id: z?.id, version: z?.version, areas: z?.areas || areas
            });
            dirty = false;
            clearSelection();
            await load();
            board();
        }
        catch (err) {
            fail(err);
        }
        finally {
            b.disabled = false;
        }
    };
    if (z)
        body.append(button('Zone entfernen', async () => {
            if (!confirm('Zone entfernen? Pflanzen bleiben stehen und verwenden gegebenenfalls die Standortvorgabe.'))
                return;
            await api('zone', {
                location_id: loc.id, id: z.id, version: z.version, delete: true
            });
            dirty = false;
            await load();
            board();
        }, 'secondary'));
}

function photoQueue(host, keepExisting = false) {
    const section = document.createElement('section');
    section.innerHTML = '<h3>Fotos hinzufügen</h3><div class="drop"><p>Kamera, Speicher oder Fotos hier hineinziehen</p><div class="actions"></div></div><div class="gallery"></div>';
    host.append(section);
    let queue = [], main = null, pending = Promise.resolve(), upload = null;
    const gallery = document.createElement('input'), camera = document.createElement('input');
    for (const i of [gallery, camera]) {
        i.type = 'file';
        i.accept = 'image/*';
        i.className = 'photo-file-input';
        section.append(i);
    }
    gallery.multiple = true;
    camera.setAttribute('capture', 'environment');
    const actionsNode = section.querySelector('.actions');
    for (const [input, title] of [[camera, 'Foto aufnehmen'], [gallery, 'Fotos auswählen']]) {
        const label = document.createElement('label');
        label.textContent = title;
        label.append(input);
        actionsNode.append(label);
    }
    const status = document.createElement('p');
    status.className = 'help photo-progress';
    status.setAttribute('role', 'status');
    section.querySelector('.drop').append(status);
    async function add(files) {
        for (const file of files) {
            status.textContent = 'Foto wird vorbereitet …';
            try {
                const data = await preparePhoto(file);
                const x = {
                    data, name: file.name, key: 'local-' + Date.now() + '-' + Math.random().toString(36).slice(2)
                };
                queue.push(x);
                if (!main && !keepExisting)
                    main = x.key;
                dirty = true;
                draw();
                status.textContent = queue.length + ' Foto(s) ausgewählt. Zum Übernehmen speichern.';
            }
            catch (e) {
                status.textContent = e.message;
                status.className = 'errorbox photo-progress';
                throw e;
            }
        }
    }
    function enqueue(files) {
        const list = Array.from(files);
        pending = pending.catch(() => {
        }).then(() => add(list));
        pending.catch(() => {
        });
        return pending;
    }
    gallery.onchange = () => {
        enqueue(gallery.files);
        gallery.value = '';
    };
    camera.onchange = () => {
        enqueue(camera.files);
        camera.value = '';
    };
    const drop = section.querySelector('.drop');
    drop.ondragover = e => {
        e.preventDefault();
        drop.classList.add('over');
    };
    drop.ondragleave = () => drop.classList.remove('over');
    drop.ondrop = e => {
        e.preventDefault();
        drop.classList.remove('over');
        enqueue(e.dataTransfer.files);
    };
    function draw() {
        const grid = section.querySelector('.gallery');
        grid.replaceChildren();
        for (const x of queue) {
            const card = document.createElement('div');
            card.className = 'photocard';
            card.innerHTML = '<img alt="Fotovorschau" src="' + x.data + '">';
            const radio = document.createElement('input');
            radio.type = 'radio';
            radio.name = 'new-main-' + section.dataset.key;
            radio.checked = x.key === main;
            radio.onchange = () => {
                main = x.key;
                dirty = true;
            };
            const l = document.createElement('label');
            l.className = 'inlinecheck';
            l.append(radio, document.createTextNode('Anzeigebild'));
            card.append(l, field(['date', 'Aufnahmedatum'], x, x.key), field(['description', 'Beschreibung'], x, x.key));
            card.querySelector('[name=date]').oninput = e => {
                x.date = e.target.value;
                dirty = true;
            };
            card.querySelector('[name=description]').oninput = e => {
                x.description = e.target.value;
                dirty = true;
            };
            card.append(button('Auswahl entfernen', () => {
                queue = queue.filter(q => q !== x);
                if (main === x.key)
                    main = keepExisting ? null : queue[0]?.key;
                draw();
            }, 'secondary'));
            grid.append(card);
        }
    }
    section.dataset.key = ('local-' + Date.now() + '-' + Math.random().toString(36).slice(2));
    return {
        section, get count() {
            return queue.length;
        }, async save(owner) {
            await pending;
            if (upload)
                return upload;
            upload = (async () => {
                status.className = 'help photo-progress';
                status.textContent = 'Fotos werden gespeichert …';
                for (const x of queue) {
                    if (!x.saved)
                        x.saved = await api('photo', {
                            ...owner, data: x.data.split(',')[1], date: x.date || '', description: x.description || ''
                        });
                }
                const chosen = queue.find(x => x.key === main);
                if (chosen)
                    await api('photo-edit', { id: chosen.saved, main: true });
                queue = [];
                main = null;
                draw();
                status.textContent = 'Fotos gespeichert.';
            })();
            try {
                await upload;
            }
            catch (e) {
                status.className = 'errorbox photo-progress';
                status.textContent = e.message;
                throw e;
            }
            finally {
                upload = null;
            }
        }
    };
}
function ownerGallery(host, key, id, refresh) {
    host.replaceChildren();
    host.className = 'gallery';
    const photos = db.photos.filter(x => x[key] === id), main = photos.find(x => x.main) || photos[0];
    for (const x of photos) {
        const card = document.createElement('div');
        card.className = 'photocard';
        card.innerHTML = '<a href="photos/' + esc(x.file) + '" target="_blank" rel="noopener"><img loading="lazy" src="photos/' + esc(x.file) + '" alt="' + esc(x.description || 'Foto') + '"></a><small>' + esc(x.date || 'Datum offen') + '</small><p>' + esc(x.description || '') + '</p>';
        const labelNode = document.createElement('label');
        labelNode.className = 'inlinecheck';
        const radio = document.createElement('input');
        radio.type = 'radio';
        radio.name = 'main-photo-' + id;
        radio.checked = x === main;
        radio.onchange = async () => {
            if (dirty && !canLeave()) {
                radio.checked = false;
                return;
            }
            try {
                await api('photo-edit', {
                    id: x.id, version: x.version, main: true
                });
                dirty = false;
                await load();
                refresh();
            }
            catch (e) {
                fail(e);
            }
        };
        labelNode.append(radio, document.createTextNode('Anzeigebild'));
        card.append(labelNode, button('Angaben', () => {
            if (dirty && !canLeave())
                return;
            dirty = false;
            photoEditOwner(x, refresh);
        }, 'secondary'), button('Entfernen', () => {
            if (dirty && !canLeave())
                return;
            dirty = false;
            remove('photos', x, refresh);
        }, 'secondary'));
        host.append(card);
    }
}
function photoEditOwner(x, refresh) {
    openDialog('<h2>Bildangaben</h2>');
    const f = document.createElement('form');
    f.append(field(['date', 'Aufnahmedatum'], x), field(['description', 'Beschreibung', 'textarea'], x));
    const b = document.createElement('button');
    b.textContent = 'Speichern';
    f.append(b);
    body.append(f);
    f.oninput = () => dirty = true;
    f.onsubmit = async (e) => {
        e.preventDefault();
        b.disabled = true;
        try {
            await api('photo-edit', {
                id: x.id, version: x.version, ...Object.fromEntries(new FormData(f))
            });
            dirty = false;
            await load();
            refresh();
        }
        catch (err) {
            fail(err);
        }
        finally {
            b.disabled = false;
        }
    };
}

const originalDetail = detail;
detail = function (id) {
    if (dirty && !canLeave())
        return;
    dirty = false;
    originalDetail(id);
    const p = find('plants', id);
    if (!p)
        return;
    ownerGallery($('#photos'), 'plant_id', id, () => detail(id));
    $('#uploads').replaceChildren();
    const q = photoQueue($('#uploads'), db.photos.some(x => x.plant_id === id));
    $('#uploads').append(button('Ausgewählte Fotos speichern', async () => {
        await q.save({ plant_id: id });
        dirty = false;
        await load();
        detail(id);
    }));
    $('#detailActions .actions').append(button('Standort anzeigen', () => {
        if (!p.location_id) {
            boardState.left = '';
        }
        else
            boardState.left = p.location_id;
        focusPlant = p.id;
        board();
    }, 'secondary'));
};
const originalLocationDetail = locationDetail;
locationDetail = function (id) {
    if (dirty && !canLeave())
        return;
    dirty = false;
    originalLocationDetail(id);
    const l = find('locations', id);
    if (!l || l.type === 'pot')
        return;
    const cover = db.photos.find(x => x.location_id === id && x.main) || db.photos.find(x => x.location_id === id);
    if (l.unit === 'cm')
        $('#locInfo').firstElementChild.textContent = (locationTypes[l.type] || 'Standort') + ' · ' + l.width_cm + ' × ' + l.depth_cm + ' cm';
    if (cover)
        $('#locInfo').insertAdjacentHTML('afterbegin', '<img class="locationcover" src="photos/' + esc(cover.file) + '" alt="' + esc(l.name) + '">');
    for (const [key, title] of [['substrate', 'Substrat'], ['layers', 'Schichtaufbau'], ['substrate_date', 'Substratdatum']])
        if (l[key])
            $('#locInfo').insertAdjacentHTML('beforeend', '<p><b>' + title + ':</b> ' + esc(l[key]) + '</p>');
    $('#locInfo').insertAdjacentHTML('beforeend', '<p><b>Pflegevorgabe:</b> ' + esc(l.group_id ? label('groups', l.group_id) : 'Keine eigene Vorgabe') + '</p>');
    $('#locActions .actions').append(button('Behälter verschieben / parken', () => containerPicker(l), 'secondary'), button('Zusammenstellung leer duplizieren', async () => {
        const name = prompt('Name des neuen Standorts', l.name + ' Kopie');
        if (!name)
            return;
        const rows = await api('planner-blueprint-duplicate', {
            id: l.id, version: l.version, name
        });
        await load();
        locationDetail(rows.id);
    }, 'secondary'));
    const docs = document.createElement('section');
    docs.innerHTML = '<hr><h3>Standortbilder</h3><div class="locationgallery"></div><div class="locationuploads"></div><hr><h3>Dokumentation</h3><div class="locationnotes"></div><details><summary>Historie / Dokumentation</summary><div class="locationtimeline"></div></details>';
    $('#locationContent').append(docs);
    ownerGallery(docs.querySelector('.locationgallery'), 'location_id', id, () => locationDetail(id));
    const q = photoQueue(docs.querySelector('.locationuploads'), db.photos.some(x => x.location_id === id));
    docs.querySelector('.locationuploads').append(button('Standortfotos speichern', async () => {
        await q.save({ location_id: id });
        dirty = false;
        await load();
        locationDetail(id);
    }));
    const f = document.createElement('form');
    f.append(field(['date', 'Datum (auch ungenau)'], { date: today() }), field(['notes', 'Notiz *', 'textarea'], {}));
    const b = document.createElement('button');
    b.textContent = 'Notiz speichern';
    const nq = photoQueue(f, db.photos.some(x => x.location_id === id));
    f.append(b);
    let savedEvent = null;
    docs.querySelector('.locationnotes').append(f);
    f.oninput = () => dirty = true;
    f.onsubmit = async (e) => {
        e.preventDefault();
        b.disabled = true;
        try {
            const noteValues = {
                location_id: id, kind: 'note', date: f.querySelector('[name=date]').value, notes: f.querySelector('[name=notes]').value
            };
            if (!savedEvent)
                savedEvent = (await api('save', { kind: 'events', values: noteValues }))[0];
            await nq.save({ location_id: id, event_id: savedEvent.id });
            dirty = false;
            await load();
            locationDetail(id);
        }
        catch (err) {
            fail(err);
        }
        finally {
            b.disabled = false;
        }
    };
    for (const event of db.events.filter(x => x.location_id === id).reverse()) {
        const p = document.createElement('p');
        p.className = 'notice prewrap';
        p.textContent = (event.date || 'Datum offen') + '\n' + event.notes;
        for (const image of db.photos.filter(x => x.event_id === event.id)) {
            const a = document.createElement('a');
            a.href = 'photos/' + image.file;
            a.target = '_blank';
            a.rel = 'noopener';
            const img = document.createElement('img');
            img.src = a.href;
            img.alt = image.description || 'Foto zur Notiz';
            img.className = 'thumb';
            a.append(img);
            p.append(a);
        }
        p.append(button('Bearbeiten', () => locationEventEdit(event), 'secondary'));
        docs.querySelector('.locationtimeline').append(p);
    }
};
function locationEventEdit(event) {
    openDialog('<h2>Standortnotiz bearbeiten</h2>');
    const f = document.createElement('form');
    f.append(field(['date', 'Datum'], event), field(['notes', 'Notiz *', 'textarea'], event));
    const b = document.createElement('button');
    b.textContent = 'Speichern';
    f.append(b);
    body.append(f);
    f.oninput = () => dirty = true;
    f.onsubmit = async (e) => {
        e.preventDefault();
        b.disabled = true;
        try {
            await api('save', {
                kind: 'events', id: event.id, values: { ...event, ...Object.fromEntries(new FormData(f)) }
            });
            dirty = false;
            await load();
            locationDetail(event.location_id);
        }
        catch (err) {
            fail(err);
        }
        finally {
            b.disabled = false;
        }
    };
}
const originalRender = render;
render = function () {
    originalRender();
    let badge = $('#parkingBadge');
    if (!badge) {
        badge = button('', () => {
            boardState.left = '';
            board();
        }, 'secondary');
        badge.id = 'parkingBadge';
        document.querySelector('header').append(badge);
    }
    badge.textContent = 'Parkplatz: ' + db.plants.filter(p => p.status === 'active' && !p.location_id).length;
};
// Startup is performed after all modules in boot.js.
