/* 0.6: Töpfe, Pflanzen und Plätze unabhängig bearbeiten. */
locationTypes.pot = 'Topf';
configs.locations.find(x => x[0] === 'type')[3] = Object.entries(locationTypes);
const plannerPrefs = {}, plannerScroll = {};
function prefs(loc) {
    return plannerPrefs[loc.id] || (plannerPrefs[loc.id] = {
        grid: true, snap: true, level: 6, step: dims(loc).step
    });
}
function snapValue(n, loc) {
    const p = prefs(loc), step = loc.unit === 'cm' ? (p.snap ? p.step : 0) : 1;
    return Math.max(0, Math.round((step ? Math.round(n / step) * step : n) * 10000) / 10000);
}
function payloadFor(x, loc) {
    const a = areaOf(x);
    if (x.mode === 'container') {
        const l = find('locations', x.container_id);
        return {
            kind: 'container', id: l.id, version: l.version, ...a, unit: loc.unit || 'slots'
        };
    }
    if (x.mode === 'present') {
        const p = find('plants', x.plant_id);
        return {
            kind: 'plant', plant_id: p.id, version: p.version, ...a, unit: loc.unit || 'slots'
        };
    }
    if (x.mode === 'planned')
        return {
            kind: 'plan', cell_id: x.id, version: x.version, ...a, unit: loc.unit || 'slots'
        };
    return null;
}
const earlierAreaTitle = areaTitle;
areaTitle = function (x) {
    if (x.mode === 'container') {
        const l = find('locations', x.container_id);
        if (l?.type === 'pot') {
            const p = db.plants.find(p => p.location_id === l.id);
            return p ? '● ' + p.label + ' · ' + p.name : '○ ' + l.name + ' · leer';
        }
    }
    return earlierAreaTitle(x);
};
const earlierPerformMove = performMove;
performMove = async function (payload, target) {
    if (payload.kind === 'plant' && target.location_id && target.row != null) {
        const x = at(target.location_id, target.row, target.col), pot = find('locations', x?.container_id);
        if (pot?.type === 'pot') {
            const p = find('plants', payload.plant_id);
            return api('move', {
                plant_id: p.id, version: payload.version, target: {
                    location_id: pot.id, row: 0, col: 0, width: 1, depth: 1
                }
            });
        }
    }
    const loc = find('locations', target.location_id);
    if (target.row != null && payload.unit && loc && (loc.unit || 'slots') !== payload.unit) {
        if (payload.kind === 'plan')
            throw Error('Planungen können nur zwischen Flächen gleicher Maßeinheit verschoben werden.');
        await choosePlace({
            containerId: payload.kind === 'container' ? payload.id : undefined, plantId: payload.plant_id, initial: {
                location_id: loc.id, row: target.row, col: target.col, width: dims(loc).step, depth: dims(loc).step
            }
        }, async (chosen) => {
            await earlierPerformMove({ ...payload, unit: find('locations', chosen.location_id)?.unit || 'slots' }, chosen);
            await load();
            board();
        });
        const picker = [...document.querySelectorAll('.placepicker')].at(-1);
        if (picker)
            picker.querySelector('.help').textContent = 'Quelle und Ziel verwenden verschiedene Maßeinheiten. Bitte die Stellfläche im Ziel festlegen. Erst Übernehmen verschiebt das Objekt; Abbrechen lässt es am bisherigen Platz.';
        return;
    }
    if (payload.kind === 'plan' && target.row == null)
        throw Error('Planungen brauchen einen Rasterplatz. Nur Pflanzen und Behälter können frei abgelegt werden.');
    return earlierPerformMove(payload, target);
};
function canDrop(loc, a, payload) {
    if (payload?.kind === 'plant') {
        const x = at(loc.id, a.row, a.col), pot = find('locations', x?.container_id);
        if (pot?.type === 'pot')
            return !db.plants.some(p => p.location_id === pot.id);
    }
    return validArea(loc, a, payload?.plant_id, payload?.id);
}
const pickerSurface = surface;
surface = function (host, loc, onPick, opts = {}) {
    if (opts.picker)
        return pickerSurface(host, loc, onPick, opts);
    const d = dims(loc), pref = prefs(loc);
    if (!d.w || !d.h) {
        host.innerHTML = empty('Freie Ablage ohne Raster – Töpfe und Behälter unten ablegen.');
        return;
    }
    let scale = zooms[loc.id] || (loc.unit === 'cm' ? 5 : 62), gesture = null, suppress = false, lastTap = null;
    const tools = document.createElement('div');
    tools.className = 'planner-tools';
    const wrap = document.createElement('div');
    wrap.className = 'surfacewrap planner-wrap';
    const plane = document.createElement('div');
    plane.className = 'surface planner-plane';
    plane.dataset.planId = loc.id;
    plane.tabIndex = 0;
    plane.setAttribute('aria-label', 'Plan ' + loc.name);
    wrap.append(plane);
    host.append(tools, wrap);
    const size = document.createElement('span');
    tools.append(button('−', () => resize(scale / 1.4), 'secondary'), button('＋', () => resize(scale * 1.4), 'secondary'), button('Gesamtansicht', () => resize(Math.max(.1, (wrap.clientWidth - 20) / d.w)), 'secondary'), size);
    const grid = document.createElement('label');
    grid.className = 'inlinecheck';
    grid.innerHTML = '<input type="checkbox"> Raster anzeigen';
    grid.firstChild.checked = pref.grid;
    grid.firstChild.onchange = () => {
        pref.grid = grid.firstChild.checked;
        paintGrid();
    };
    tools.append(grid);
    const snap = document.createElement('label');
    snap.className = 'inlinecheck';
    snap.innerHTML = '<input type="checkbox"> Einrasten';
    snap.firstChild.checked = pref.snap;
    snap.firstChild.disabled = loc.unit !== 'cm';
    snap.firstChild.onchange = () => pref.snap = snap.firstChild.checked;
    tools.append(snap);
    if (loc.unit === 'cm') {
        const level = document.createElement('label');
        level.textContent = 'Einraststufe';
        const range = document.createElement('input');
        range.type = 'range';
        range.min = 1;
        range.max = 6;
        range.step = 1;
        range.value = pref.level;
        level.append(range);
        const custom = document.createElement('label');
        custom.textContent = 'Schrittweite in cm';
        const input = document.createElement('input');
        input.type = 'number';
        input.min = .01;
        input.max = 3000;
        input.step = 'any';
        input.value = pref.step;
        custom.append(input);
        range.oninput = () => {
            pref.level = Number(range.value);
            pref.step = [.1, .25, .5, .75, 1, d.step][pref.level - 1];
            input.value = pref.step;
        };
        input.onchange = () => {
            if (input.reportValidity() && Number(input.value) > 0)
                pref.step = Number(input.value);
        };
        tools.append(level, custom);
    }
    const help = document.createElement('p');
    help.className = 'help';
    help.textContent = 'Topf ziehen: verschieben · freie Fläche ziehen: Ansicht bewegen · Doppelklick / Doppeltipp: einfügen · Topf antippen: zuordnen oder bearbeiten. Einfügepunkt: obere linke Ecke.';
    host.append(help);
    const setBox = (el, a) => Object.assign(el.style, {
        left: a.col * scale + 'px', top: a.row * scale + 'px', width: a.width * scale + 'px', height: a.depth * scale + 'px'
    });
    function paintGrid() {
        plane.style.backgroundSize = d.step * scale + 'px ' + d.step * scale + 'px';
        plane.style.backgroundImage = pref.grid ? '' : 'none';
    }
    function resize(n) {
        scale = Math.max(.1, Math.min(loc.unit === 'cm' ? 50 : 160, n));
        zooms[loc.id] = scale;
        plane.dataset.scale = scale;
        plane.style.width = d.w * scale + 'px';
        plane.style.height = d.h * scale + 'px';
        size.textContent = d.w + ' × ' + d.h + (loc.unit === 'cm' ? ' cm' : ' Plätze');
        paintGrid();
        draw();
    }
    function draw() {
        plane.replaceChildren();
        for (const z of db.zones.filter(z => z.location_id === loc.id))
            for (const a of z.areas) {
                const el = document.createElement('div');
                el.className = 'zonepaint';
                el.textContent = z.name;
                el.style.borderColor = /^#[\da-f]{6}$/i.test(z.color) ? z.color : '#6f85a4';
                setBox(el, a);
                plane.append(el);
            }
        for (const x of db.cells.filter(x => x.location_id === loc.id)) {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'area ' + x.mode;
            b.dataset.cellId = x.id;
            if (x.plant_id === focusPlant || db.plants.some(p => p.id === focusPlant && p.location_id === x.container_id))
                b.classList.add('focused');
            b.title = areaTitle(x);
            b.setAttribute('aria-label', areaTitle(x));
            b.innerHTML = '<span>' + esc(areaTitle(x)) + '</span>';
            const obj = find('locations', x.container_id);
            if (obj?.shape === 'round')
                b.classList.add('round-pot');
            if (selectionLoc === loc.id && cellsSelected.has(x.row + ':' + x.col))
                b.classList.add('planner-selected');
            setBox(b, areaOf(x));
            b.onclick = e => {
                e.stopPropagation();
                if (suppress)
                    return;
                if (selectionMode) {
                    toggleSelection(loc, {
                        ...areaOf(x), id: x.id, version: x.version
                    }, e);
                    draw();
                }
                else
                    objectEditor(loc, x);
            };
            plane.append(b);
            if (obj && typeof parentRotationControl === 'function')
                parentRotationControl(plane, obj, areaOf(x), scale);
        }
        if (selectionLoc === loc.id)
            for (const a of cellsSelected.values()) {
                if (a.id)
                    continue;
                const mark = document.createElement('div');
                mark.className = 'selectionmark';
                setBox(mark, a);
                plane.append(mark);
            }
    }
    const point = (e, gridOnly = false) => {
        const r = plane.getBoundingClientRect();
        const x = (e.clientX - r.left) / scale, y = (e.clientY - r.top) / scale;
        return {
            col: gridOnly ? Math.floor(x / d.step) * d.step : snapValue(x, loc), row: gridOnly ? Math.floor(y / d.step) * d.step : snapValue(y, loc), width: d.step, depth: d.step
        };
    };
    plane.onclick = e => {
        if (suppress || e.target.closest('.area'))
            return;
        if (selectionMode) {
            toggleSelection(loc, point(e, true), e);
            draw();
        }
    };
    plane.ondblclick = e => {
        if (selectionMode || e.target.closest('.area'))
            return;
        e.preventDefault();
        newObjects(loc, point(e));
    };
    plane.ondragstart = e => e.preventDefault();
    plane.onpointerdown = e => {
        if (e.button !== 0 || boardBusy)
            return;
        const x = find('cells', e.target.closest('[data-cell-id]')?.dataset.cellId);
        const picked = selectionLoc === loc.id && x && cellsSelected.has(x.row + ':' + x.col);
        if (selectionMode && !picked)
            return;
        const payload = selectionMode ? {
            kind: 'selection', entries: [...cellsSelected.values()].filter(a => ['container', 'present'].includes(find('cells', a.id)?.mode)), ...areaOf(x)
        } : x ? payloadFor(x, loc) : null;
        if (x && !payload)
            return;
        const r = plane.getBoundingClientRect();
        gesture = {
            cell: x, id: e.pointerId, x: e.clientX, y: e.clientY, left: wrap.scrollLeft, top: wrap.scrollTop, payload, offsetX: x ? (e.clientX - r.left) / scale - x.col : 0, offsetY: x ? (e.clientY - r.top) / scale - x.row : 0, moved: false
        };
        plane.setPointerCapture(e.pointerId);
    };
    let ghost = null;
    function dropPoint(e, g) {
        return plannerDestination(e, g.payload, g.offsetX, g.offsetY);
    }
    plane.onpointermove = e => {
        const g = gesture;
        if (!g || g.id !== e.pointerId)
            return;
        if (Math.hypot(e.clientX - g.x, e.clientY - g.y) > 5)
            g.moved = true;
        if (!g.moved)
            return;
        e.preventDefault();
        if (!g.payload) {
            wrap.scrollLeft = g.left - (e.clientX - g.x);
            wrap.scrollTop = g.top - (e.clientY - g.y);
            return;
        }
        ghost?.remove();
        const dest = dropPoint(e, g);
        if (dest?.plane && !dest.free) {
            ghost = document.createElement('div');
            ghost.className = 'dropghost ' + (canDrop(dest.loc, dest.area, g.payload) ? 'valid' : 'invalid');
            const s = Number(dest.plane.dataset.scale);
            Object.assign(ghost.style, {
                left: dest.area.col * s + 'px', top: dest.area.row * s + 'px', width: dest.area.width * s + 'px', height: dest.area.depth * s + 'px'
            });
            dest.plane.append(ghost);
        }
    };
    plane.onpointerup = async (e) => {
        const g = gesture;
        if (!g)
            return;
        gesture = null;
        ghost?.remove();
        if (plane.hasPointerCapture(e.pointerId))
            plane.releasePointerCapture(e.pointerId);
        plannerScroll[loc.id] = [wrap.scrollLeft, wrap.scrollTop];
        if (g.moved) {
            suppress = true;
            setTimeout(() => suppress = false, 100);
            if (!g.payload)
                return;
            const dest = dropPoint(e, g);
            if (!dest)
                return;
            boardBusy = true;
            try {
                if (g.payload.kind === 'selection') {
                    if (!dest.parking)
                        throw Error('Die Auswahl auf den Parkplatz ziehen; dort einzeln neu platzieren.');
                    await api('planner-park', { entries: g.payload.entries });
                    clearSelection();
                }
                else
                    await performMove(g.payload, dest.parking ? {} : { location_id: dest.loc.id, ...dest.area });
                await load();
                board();
            }
            catch (err) {
                boardError(err);
            }
            finally {
                boardBusy = false;
            }
        }
        else if (g.cell) {
            suppress = true;
            setTimeout(() => suppress = false, 100);
            if (selectionMode) {
                toggleSelection(loc, {
                    ...areaOf(g.cell), id: g.cell.id, version: g.cell.version
                }, e);
                draw();
            }
            else
                objectEditor(loc, g.cell);
        }
        else if (e.pointerType === 'touch' && !g.payload && !selectionMode) {
            const now = Date.now();
            if (lastTap && now - lastTap.time < 350 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 20) {
                newObjects(loc, point(e));
                lastTap = null;
            }
            else
                lastTap = {
                    time: now, x: e.clientX, y: e.clientY
                };
        }
    };
    plane.onpointercancel = () => {
        gesture = null;
        ghost?.remove();
    };
    plane.onkeydown = e => {
        if (e.key.startsWith('Arrow')) {
            e.preventDefault();
            wrap.scrollBy({ left: e.key === 'ArrowLeft' ? -80 : e.key === 'ArrowRight' ? 80 : 0, top: e.key === 'ArrowUp' ? -80 : e.key === 'ArrowDown' ? 80 : 0 });
        }
    };
    // Drag-and-drop aus dem Parkplatz am PC; auf Touch zusätzlich „Platz wählen“.
    plane.ondragover = e => {
        if (dragPayload) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
        }
    };
    plane.ondrop = async (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!dragPayload || boardBusy)
            return;
        const p = dragPayload;
        dragPayload = null;
        boardBusy = true;
        try {
            if (p.kind === 'selection')
                throw Error('Mehrfachauswahl über „Objekte auf Parkplatz“ verschieben.');
            await performMove(p, {
                location_id: loc.id, ...point(e), width: p.width || d.step, depth: p.depth || d.step
            });
            await load();
            board();
        }
        catch (err) {
            boardError(err);
        }
        finally {
            boardBusy = false;
        }
    };
    resize(scale);
    const saved = plannerScroll[loc.id];
    if (saved) {
        wrap.scrollLeft = saved[0];
        wrap.scrollTop = saved[1];
    }
    wrap.onscroll = () => plannerScroll[loc.id] = [wrap.scrollLeft, wrap.scrollTop];
};
function objectEditor(loc, x) {
    if (x.mode === 'container') {
        const obj = find('locations', x.container_id);
        if (obj.type === 'pot')
            return potEditor(obj);
        return locationDetail(obj.id);
    }
    // Bestehende Flächen behalten ihren Editor, jetzt in einem Fenster statt Scrollsprung.
    openDialog('<h2>Fläche bearbeiten</h2><div id="cellEditor"></div>');
    areaEditor(loc, {
        ...areaOf(x), id: x.id, version: x.version
    });
    body.append(button('Zurück zum Plan', () => board(), 'secondary'));
}
function potEditor(pot) {
    const p = db.plants.find(p => p.location_id === pot.id);
    const host = openLocationPage('pot', pot.id, '<h2>' + esc(pot.name) + '</h2><p>' + esc(locationPath(pot.id)) + '</p><p>' + esc(templateMeasure({ ...pot.footprint, shape: pot.shape })) + '</p>');
    if (p) {
        host.insertAdjacentHTML('beforeend', '<p><b>' + esc(p.label) + '</b> · ' + esc(p.name) + '</p>');
        actions(host, [['Pflanze öffnen', () => detail(p.id)], ['Pflanze entnehmen · Topf bleibt', async () => {
                    await api('move', {
                        plant_id: p.id, version: p.version, target: {}
                    });
                    await load();
                    potEditor(find('locations', pot.id));
                }, 'secondary']]);
    }
    else
        assignPlantUI(host, {
            location_id: pot.id, row: 0, col: 0, width: 1, depth: 1
        }, () => potEditor(find('locations', pot.id)));
    actions(host, [['Topf verschieben', () => containerPicker(pot)], ['Topf samt Pflanze parken', async () => {
                await api('container-move', {
                    id: pot.id, version: pot.version, target: {}
                });
                await load();
                board();
            }, 'secondary'], ['Topfangaben bearbeiten', () => simpleForm('locations', pot), 'secondary'], ['Zurück zum Plan', () => board(), 'secondary']]);
    if (!p && !pot.parent_id)
        host.append(button('Leeren Topf löschen', () => remove('locations', pot, board), 'danger'));
}
function assignPlantUI(host, target, refresh) {
    const f = document.createElement('form');
    f.innerHTML = '<label>Pflanze suchen<input type="search" name="query" placeholder="ID oder Bezeichnung"></label><label>Pflanze auswählen<select name="plant" required></select></label><p class="help">Beim Zuordnen wird die Pflanze von ihrem bisherigen Platz entnommen. Ihr bisheriger Topf bleibt leer stehen.</p><button>Pflanze zuordnen</button>';
    host.append(f);
    const fill = () => {
        const q = f.elements.query.value.toLowerCase();
        f.elements.plant.innerHTML = options(db.plants.filter(p => p.status === 'active' && (p.name + ' ' + p.label).toLowerCase().includes(q)).map(p => [p.id, p.label + ' · ' + p.name + ' · ' + place(p)]), '', 'Pflanze wählen');
    };
    fill();
    f.elements.query.oninput = fill;
    f.onsubmit = async (e) => {
        e.preventDefault();
        const b = f.querySelector('button');
        b.disabled = true;
        try {
            const p = find('plants', f.elements.plant.value);
            await api('move', {
                plant_id: p.id, version: p.version, target
            });
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

const previousDrawBoard = drawBoard;
drawBoard = function (host, loc) {
    previousDrawBoard(host, loc);
    const pane = host.lastElementChild;
    const controls = pane.querySelector('.actions');
    controls.prepend(button('＋ Topf / Tray', () => newObjects(loc)), button('Mehrfacherzeugung', () => newObjects(loc, null, true), 'secondary'));
};

onSelectionBar(function () {
    const entries = [...cellsSelected.values()].filter(e => ['container', 'present'].includes(find('cells', e.id)?.mode));
    if (entries.length)
        $('#selectionBar')?.append(button(entries.length + ' Objekte samt Inhalt auf Parkplatz', async () => {
            await api('planner-park', { entries });
            clearSelection();
            await load();
            board();
        }, 'secondary'));
});
// Standortzuordnung und Pflege stehen zusammen; Statusfelder erst nach der Anlage.

// Parkplatz-Karten auch per Pointer (Maus, Stift, Finger) in einen Plan ziehen.
function parkingPointer(card, payload) {
    card.draggable = false;
    card.ondragstart = e => e.preventDefault();
    card.classList.add('pointer-card');
    let g = null, ghost = null;
    card.onpointerdown = e => {
        if (e.button !== 0 || e.target.closest('button,input,select,a') || boardBusy)
            return;
        g = {
            id: e.pointerId, x: e.clientX, y: e.clientY, moved: false
        };
        card.setPointerCapture(e.pointerId);
    };
    const destination = e => plannerDestination(e, payload);
    card.onpointermove = e => {
        if (!g)
            return;
        if (Math.hypot(e.clientX - g.x, e.clientY - g.y) > 5)
            g.moved = true;
        if (!g.moved)
            return;
        e.preventDefault();
        ghost?.remove();
        const d = destination(e);
        if (d?.plane && !d.free) {
            ghost = document.createElement('div');
            ghost.className = 'dropghost ' + (canDrop(d.loc, d.area, payload) ? 'valid' : 'invalid');
            Object.assign(ghost.style, {
                left: d.area.col * d.scale + 'px', top: d.area.row * d.scale + 'px', width: d.area.width * d.scale + 'px', height: d.area.depth * d.scale + 'px'
            });
            d.plane.append(ghost);
        }
    };
    card.onpointerup = async (e) => {
        if (!g)
            return;
        const moved = g.moved;
        g = null;
        ghost?.remove();
        if (card.hasPointerCapture(e.pointerId))
            card.releasePointerCapture(e.pointerId);
        if (!moved)
            return;
        const d = destination(e);
        if (!d)
            return;
        boardBusy = true;
        try {
            await performMove(payload, d.parking ? {} : { location_id: d.loc.id, ...d.area });
            await load();
            board();
        }
        catch (err) {
            boardError(err);
        }
        finally {
            boardBusy = false;
        }
    };
    card.onpointercancel = () => {
        g = null;
        ghost?.remove();
    };
}

// One hit test for dragging from either pane or a loose-object card.
function plannerDestination(e, payload, offsetX = 0, offsetY = 0) {
    const hit = document.elementFromPoint(e.clientX, e.clientY);
    if (hit?.closest('#parking'))
        return { parking: true };
    const free = hit?.closest('[data-free-location]');
    if (free)
        return { free: true, loc: find('locations', free.dataset.freeLocation) };
    const plane = hit?.closest('[data-plan-id]');
    if (!plane)
        return null;
    const loc = find('locations', plane.dataset.planId), scale = Number(plane.dataset.scale), r = plane.getBoundingClientRect();
    // Offsets in source slots must not be interpreted as centimetres (or vice versa).
    if (payload.unit && (loc.unit || 'slots') !== payload.unit)
        offsetX = offsetY = 0;
    return {
        plane, loc, scale, area: {
            col: snapValue((e.clientX - r.left) / scale - offsetX, loc), row: snapValue((e.clientY - r.top) / scale - offsetY, loc), width: payload.width || dims(loc).step, depth: payload.depth || dims(loc).step
        }
    };
}
const drawBoardWithPlan = drawBoard;
drawBoard = function (host, loc) {
    drawBoardWithPlan(host, loc);
    const pane = host.lastElementChild;
    const free = document.createElement('section');
    free.className = 'free-location';
    free.dataset.freeLocation = loc.id;
    free.innerHTML = '<h4>Hier ohne Rasterplatz</h4><p class="help">Töpfe, Trays oder Pflanzen hier ablegen: diesem Standort zugeordnet, ohne Platzbegrenzung. Zum Platzieren eine Karte auf den Plan ziehen oder „Platz wählen“ nutzen.</p>';
    pane.append(free);
    dropTarget(free, async (payload) => {
        if (!['plant', 'container'].includes(payload.kind))
            throw Error('Hier einzelne Pflanzen oder Behälter ablegen.');
        await performMove(payload, { location_id: loc.id });
    });
    // Existing directly assigned plant cards also get touch dragging.
    for (const p of db.plants.filter(p => p.status === 'active' && p.location_id === loc.id && !db.cells.some(x => x.plant_id === p.id && x.mode === 'present'))) {
        const card = moveCard(p);
        parkingPointer(card, {
            kind: 'plant', plant_id: p.id, version: p.version, ...p.footprint
        });
        free.append(card);
    }
    for (const obj of db.locations.filter(l => l.parent_id === loc.id && !l.parked && !db.cells.some(x => x.container_id === l.id))) {
        const card = document.createElement('div');
        card.className = 'movecard';
        card.dataset.containerId = obj.id;
        card.textContent = '▣ ' + obj.name;
        card.append(button('Öffnen', () => obj.type === 'pot' ? potEditor(obj) : locationDetail(obj.id), 'secondary'), button('Platz wählen', () => containerPicker(obj), 'secondary'), button('Auf Parkplatz', async () => {
            await performMove({
                kind: 'container', id: obj.id, version: obj.version
            }, {});
            await load();
            board();
        }, 'secondary'));
        parkingPointer(card, {
            kind: 'container', id: obj.id, version: obj.version, ...obj.footprint
        });
        free.append(card);
    }
};
