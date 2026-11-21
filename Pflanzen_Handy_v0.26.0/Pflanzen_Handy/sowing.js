/* Aussaatgruppen remain separate from inventory plants. */
const sowingStages = {
    germination: 'Keimung', pricking: 'Pikieren', repotting: 'Umtopfen'
};
const sowingEvents = {
    created: 'Angelegt', edited: 'Bearbeitet', assigned: 'Zugewiesen', moved: 'Umgestellt', released: 'Freigegeben', failed: 'Ausgefallen', converted: 'In Bestand übernommen', germination: 'Keimung', pricking: 'Pikiert', repotting: 'Umgetopft', planting: 'Ausgepflanzt', note: 'Notiz', container_removed: 'Behälter gelöscht'
};
function sowingWindows(g) {
    const base = g.actual_date || g.planned_date;
    if (!base)
        return {};
    const result = {};
    for (const [key, pair] of Object.entries(g.ranges || {})) {
        if (pair[0] === '' || pair[0] == null)
            continue;
        result[key] = pair.map(n => {
            const d = new Date(base + 'T12:00:00Z');
            d.setUTCDate(d.getUTCDate() + Number(n));
            return d.toISOString().slice(0, 10);
        });
    }
    return result;
}
function sowingCount(g) {
    return db.cells.filter(c => c.sowing_id === g.id);
}
function sowingSwatch(g) {
    return '<i class="sowing-color" style="background:' + esc(g.color) + '"></i>';
}

function sowingEdit(g = {}, profile = false) {
    openDialog('<h2>' + (profile ? 'Zeitspannen je Art / Sorte' : g.id ? 'Aussaat bearbeiten' : 'Aussaat anlegen') + '</h2>' + (g.id && !profile ? '<p>' + sowingCount(g).length + ' belegte Flächen dieser Gruppe sind von Änderungen betroffen.</p>' : '') + '<p>Alle Zeitfenster sind ungefähre Tage ab Aussaat. Leere Werte bleiben offen. Jede Charge kann eigene Werte erhalten.</p>');
    const f = document.createElement('form');
    f.className = 'formgrid';
    body.append(f);
    if (!profile) {
        const select = document.createElement('select');
        select.innerHTML = options((db.sowing_profiles || []).map(p => [p.id, p.name]), '', 'Optional: Zeitspannen aus Profil übernehmen');
        select.setAttribute('aria-label', 'Zeitspannenprofil');
        f.append(select);
        select.onchange = () => {
            const p = find('sowing_profiles', select.value);
            if (p) {
                for (const k of ['genus', 'species', 'variety'])
                    f.elements[k].value = p[k] || '';
                for (const key of Object.keys(sowingStages))
                    for (let i = 0; i < 2; i++)
                        f.elements[key + i].value = p.ranges[key][i];
                dirty = true;
            }
        };
    }
    for (const spec of [['name', 'Bezeichnung / Charge *'], ['genus', 'Gattung'], ['species', 'Art'], ['variety', 'Sorte'], ...(!profile ? [['planned_date', 'Geplanter Aussaattermin'], ['actual_date', 'Tatsächlich ausgesät am']] : []), ['notes', 'Notizen', 'textarea']])
        f.append(field(spec, g, 'sowing'));
    if (!profile)
        for (const key of ['planned_date', 'actual_date'])
            f.elements[key].type = 'date';
    for (const [key, title] of Object.entries(sowingStages))
        for (let i = 0; i < 2; i++) {
            const name = key + i;
            f.append(field([name, title + ' · ' + (i ? 'bis' : 'von') + ' Tage'], { [name]: g.ranges?.[key]?.[i] ?? '' }, 'sowing'));
            const input = f.elements[name];
            input.type = 'number';
            input.min = 0;
            input.max = 3650;
            input.step = 1;
        }
    if (!profile) {
        f.append(field(['color', 'Gruppenfarbe'], g, 'sowing'));
        f.elements.color.type = 'color';
        f.elements.color.value = g.color || ['#3163b7', '#b64b88', '#ba681f', '#7055ac', '#198775', '#b14949', '#548028', '#527f99'][(db.sowings || []).length % 8];
    }
    const submit = document.createElement('button');
    submit.textContent = 'Speichern';
    f.append(submit, button('Abbrechen', close, 'secondary'));
    f.oninput = () => dirty = true;
    f.onsubmit = async (e) => {
        e.preventDefault();
        submit.disabled = true;
        try {
            const values = Object.fromEntries(new FormData(f));
            values.ranges = Object.fromEntries(Object.keys(sowingStages).map(k => [k, [values[k + 0], values[k + 1]]]));
            const saved = await api('planner-sowing-' + (profile ? 'profile' : 'save'), {
                id: g.id, version: g.version, values
            });
            dirty = false;
            await load();
            modal.close();
            if (profile)
                sowingProfiles();
            else
                sowingDetail(saved);
        }
        catch (err) {
            fail(err);
        }
        finally {
            submit.disabled = false;
        }
    };
}
function sowingProfiles() {
    openDialog('<h2>Zeitspannen je Art / Sorte</h2><p>Profile sind eigene Erfahrungswerte. Änderungen gelten beim nächsten Übernehmen; bestehende Chargen behalten ihre Werte.</p>');
    body.append(button('＋ Profil', () => sowingEdit({}, true)));
    for (const p of db.sowing_profiles || []) {
        const row = document.createElement('div');
        row.className = 'actions';
        row.append(button(p.name, () => sowingEdit(p, true), 'secondary'), button('Profil löschen', async () => {
            if (!confirm('Profil wirklich löschen? Bestehende Aussaaten behalten ihre Zeitspannen.'))
                return;
            await api('planner-sowing-delete-profile', {
                id: p.id, version: p.version, confirmed: true
            });
            await load();
            sowingProfiles();
        }, 'danger'));
        body.append(row);
    }
}
function sowingDetail(g) {
    if (!g)
        return;
    openDialog('<h2>' + sowingSwatch(g) + esc(g.name) + '</h2>');
    const summary = document.createElement('p');
    summary.textContent = (g.actual_date ? 'Tatsächliche Aussaat: ' + g.actual_date : 'Planung: ' + (g.planned_date || 'offen')) + ' · ' + sowingCount(g).length + ' belegte Flächen';
    body.append(summary);
    const windows = sowingWindows(g);
    const table = document.createElement('table');
    table.innerHTML = '<thead><tr><th>Schritt</th><th>Ungefähres Zeitfenster</th></tr></thead><tbody>' + Object.keys(sowingStages).map(k => '<tr><td>' + sowingStages[k] + '</td><td>' + esc(windows[k]?.join(' bis ') || 'Nicht hinterlegt') + '</td></tr>').join('') + '</tbody>';
    body.append(table);
    actions(body, [['Bearbeiten', () => sowingEdit(g), 'secondary'], ['Behälter / Zellen zuweisen', () => sowingAssignDialog('', g.id)], ['Neuen Behälter auf Parkplatz erstellen', () => sowingNewContainer(g), 'secondary'], ['Dokumentieren', () => sowingEventDialog(g), 'secondary'], ['Gruppe über alle Standorte auswählen', () => sowingGroupSelection(g), 'secondary'], ['Aussaat löschen', () => sowingDelete(g), 'danger']]);
    const hist = document.createElement('details');
    hist.innerHTML = '<summary>Verlauf / Historie</summary>';
    for (const e of (db.sowing_events || []).filter(e => e.sowing_id === g.id).reverse()) {
        const p = document.createElement('p');
        p.textContent = e.date + ' · ' + (sowingEvents[e.kind] || e.kind) + (e.cells ? ' · ' + e.cells.length + ' Flächen' : '') + (e.location_path ? ' · ' + e.location_path : '') + (e.note ? ' · ' + e.note : '');
        hist.append(p);
    }
    body.append(hist);
}
function sowingEventDialog(g) {
    openDialog('<h2>Entwicklung dokumentieren</h2>');
    const f = document.createElement('form');
    f.className = 'formgrid';
    for (const spec of [['kind', 'Schritt', 'select', [...Object.entries(sowingStages), ['planting', 'Auspflanzen'], ['note', 'Notiz']]], ['date', 'Datum *'], ['note', 'Notiz', 'textarea']])
        f.append(field(spec, { date: today() }, 'sowing-event'));
    f.elements.date.type = 'date';
    const b = document.createElement('button');
    b.textContent = 'Dokumentieren';
    f.append(b, button('Abbrechen', close, 'secondary'));
    body.append(f);
    f.oninput = () => dirty = true;
    f.onsubmit = async (e) => {
        e.preventDefault();
        b.disabled = true;
        try {
            await api('planner-sowing-event', {
                id: g.id, version: g.version, ...Object.fromEntries(new FormData(f))
            });
            dirty = false;
            await load();
            sowingDetail(find('sowings', g.id));
        }
        catch (err) {
            fail(err);
        }
        finally {
            b.disabled = false;
        }
    };
}
function sowingDelete(g) {
    openDialog('<h2>Aussaat löschen?</h2><p>Die Aussaat und ihr Verlauf werden gelöscht. Bei belegten Zellen oder übernommenen Bestandspflanzen ist das Löschen gesperrt.</p>');
    body.append(button('Abbrechen', close, 'secondary'), button('Wirklich löschen', async () => {
        await api('planner-sowing-delete', {
            id: g.id, version: g.version, confirmed: true
        });
        await load();
        dirty = false;
        modal.close();
        render();
    }, 'danger'));
}
function sowingNewContainer(g) {
    openDialog('<h2>Neuer Aussaatbehälter</h2><p>Der neue Behälter wird leer auf dem Parkplatz angelegt. Anschließend die gewünschten Flächen zuweisen.</p>');
    const f = document.createElement('form');
    f.className = 'formgrid';
    for (const spec of [['name', 'Behältername *'], ['template', 'Aus Vorlage übernehmen (optional)', 'select', db.templates.filter(t => !t.hidden).map(t => [t.id, t.name])], ['width', 'Schalenbreite in cm'], ['depth', 'Schalentiefe in cm']])
        f.append(field(spec, {
            name: g.name + ' · Schale', width: 30, depth: 20
        }));
    for (const k of ['width', 'depth']) {
        f.elements[k].type = 'number';
        f.elements[k].min = .1;
        f.elements[k].step = 'any';
        f.elements[k].required = true;
    }
    const b = document.createElement('button');
    b.textContent = 'Auf Parkplatz erstellen';
    f.append(b, button('Abbrechen', close, 'secondary'));
    body.append(f);
    f.oninput = () => dirty = true;
    f.onsubmit = async (e) => {
        e.preventDefault();
        b.disabled = true;
        try {
            const v = Object.fromEntries(new FormData(f)), t = find('templates', v.template);
            const sc = (await api('planner-workspace-scenes', { ids: [''] }))[0];
            const made = await api('planner-workspace-create', {
                name: v.name, object_type: 'tray', shape: 'rectangle', width: Number(v.width), depth: Number(v.depth), template_id: t?.id, template_version: t?.version, target: {
                    location_id: '', col: 0, row: Math.max(0, ...sc.items.map(i => i.row + i.depth)) + 5
                }
            });
            dirty = false;
            await load();
            sowingAssignDialog(made[0].id, g.id);
        }
        catch (err) {
            fail(err);
        }
        finally {
            b.disabled = false;
        }
    };
}
function sowingAssignDialog(location = '', group = '', initial = null) {
    openDialog('<h2>Aussaat zuweisen</h2><p>Nur freie Flächen sind auswählbar. Eine Schale ohne feste Zellen kann als eine gemeinsame Aussaatfläche belegt werden.</p>');
    const f = document.createElement('form');
    f.className = 'formgrid';
    body.append(f);
    f.append(field(['group', 'Aussaat *', 'select', (db.sowings || []).map(g => [g.id, g.name])], { group }), field(['location', 'Behälter *', 'select', db.locations.filter(l => l.rows && l.cols || l.width_cm && l.depth_cm).map(l => [l.id, locationPath(l.id)])], { location }));
    const grid = document.createElement('div');
    grid.className = 'full sowing-grid';
    f.append(grid);
    const info = document.createElement('p');
    info.className = 'full';
    f.append(info);
    let areas = [];
    const set = new Map();
    const update = () => info.textContent = set.size + ' Flächen werden zugewiesen';
    function draw() {
        grid.replaceChildren();
        set.clear();
        areas = [];
        const loc = find('locations', f.elements.location.value);
        if (!loc) {
            update();
            return;
        }
        const fixed = loc.type === 'pot' || loc.quickpot_family || loc.template_snapshot?.type === 'quickpot';
        if (fixed && !loc.model_pending) {
            if (loc.rows * loc.cols > 3000) {
                grid.textContent = 'Maximal 3000 Zellen pro Auswahl.';
                return;
            }
            grid.style.gridTemplateColumns = 'repeat(' + Math.min(loc.cols, 30) + ',minmax(28px,1fr))';
            for (let row = 0; row < loc.rows; row++)
                for (let col = 0; col < loc.cols; col++)
                    areas.push({
                        row, col, width: 1, depth: 1
                    });
        }
        else if (!loc.model_pending) {
            grid.style.gridTemplateColumns = '1fr';
            areas = initial && loc.id === location ? initial : [{
                    row: 0, col: 0, width: loc.unit === 'cm' ? loc.width_cm : loc.cols, depth: loc.unit === 'cm' ? loc.depth_cm : loc.rows
                }];
        }
        else
            grid.textContent = 'Bitte zuerst ein Zellmodell auswählen.';
        for (const [i, a] of areas.entries()) {
            const b = button(fixed ? coord(a.row, a.col) : 'Ausgewählte Fläche / ganze Schale', () => {
                if (set.has(i))
                    set.delete(i);
                else
                    set.set(i, a);
                b.classList.toggle('chosen', set.has(i));
                update();
            }, 'secondary');
            b.disabled = db.cells.some(c => c.location_id === loc.id && intersect(areaOf(c), a));
            grid.append(b);
            if (!b.disabled && initial?.some(x => x.row === a.row && x.col === a.col)) {
                set.set(i, a);
                b.classList.add('chosen');
            }
        }
        update();
    }
    f.elements.location.onchange = draw;
    draw();
    const all = button('Alle freien Zellen auswählen', () => {
        set.clear();
        const loc = find('locations', f.elements.location.value);
        if (!loc)
            return;
        areas.forEach((a, i) => {
            if (!db.cells.some(c => c.location_id === loc.id && intersect(areaOf(c), a)))
                set.set(i, a);
        });
        [...grid.children].forEach((b, i) => b.classList.toggle('chosen', set.has(i)));
        update();
    }, 'secondary');
    const b = document.createElement('button');
    b.textContent = 'Auswahl zuweisen';
    f.append(all, b, button('Abbrechen', close, 'secondary'));
    f.oninput = () => dirty = true;
    f.onsubmit = async (e) => {
        e.preventDefault();
        b.disabled = true;
        try {
            const g = find('sowings', f.elements.group.value), loc = find('locations', f.elements.location.value);
            if (!g || !loc || !set.size)
                throw Error('Bitte Aussaat, Behälter und freie Flächen auswählen.');
            await api('planner-sowing-assign', {
                id: g.id, version: g.version, location_id: loc.id, location_version: loc.version, areas: [...set.values()]
            });
            dirty = false;
            await load();
            modal.close();
            if (page === 'locations')
                board();
            else
                sowingDetail(find('sowings', g.id));
        }
        catch (err) {
            fail(err);
        }
        finally {
            b.disabled = false;
        }
    };
}
function sowingGroupSelection(g, location = null, only = null) {
    const cells = only || sowingCount(g).filter(c => location === null || c.location_id === location);
    openDialog('<h2>' + esc(g.name) + ' · Auswahl</h2><p><b>' + cells.length + ' betroffene Flächen</b> · ' + (location === null ? 'über alle Standorte' : 'auf dieser Platte') + '</p>');
    const entries = cells.map(c => ({ id: c.id, version: c.version }));
    const list = document.createElement('div');
    for (const c of cells) {
        const p = document.createElement('p');
        p.textContent = locationPath(c.location_id) + ' · ' + coord(c.row, c.col);
        list.append(p);
    }
    body.append(list);
    const note = document.createElement('textarea');
    note.placeholder = 'Notiz / Ausfallgrund';
    note.setAttribute('aria-label', 'Notiz zur gemeinsamen Änderung');
    body.append(note);
    const apply = async (action, extra = {}) => {
        await api('planner-sowing-' + action, {
            id: g.id, version: g.version, entries, note: note.value, ...extra
        });
        dirty = false;
        await load();
        modal.close();
        if (page === 'locations')
            board();
        else
            sowingDetail(find('sowings', g.id));
    };
    if (cells.length)
        actions(body, [['Als ausgefallen freigeben', () => apply('release', { failed: true }), 'danger'], ['Zellen freigeben', () => apply('release'), 'secondary'], ['Als einzelne Bestandspflanzen übernehmen', () => sowingConvert(g, cells), 'secondary']]);
    body.append(button('Abbrechen', close, 'secondary'));
}
function sowingConvert(g, cells) {
    openDialog('<h2>' + cells.length + ' Bestandspflanzen übernehmen</h2><p>Jeder übernommene Horst erhält eine Inventar-ID und behält seine Aussaat als Herkunft. Aus einer Schale können mehrere Pflanzen zunächst unzugeordnet übernommen werden. Die ausgewählten Aussaatflächen werden dabei frei.</p>');
    const f = document.createElement('form');
    f.className = 'formgrid';
    for (const spec of [['name', 'Bezeichnung *'], ['genus', 'Gattung *'], ['species', 'Art (leer = UNK)'], ['year', 'Zugangsjahr *'], ['count', 'Anzahl Pflanzen *']])
        f.append(field(spec, {
            ...g, year: year(), count: cells.length
        }));
    f.elements.count.type = 'number';
    f.elements.count.min = 1;
    f.elements.count.max = 500;
    f.elements.count.step = 1;
    const keepLabel = document.createElement('label');
    keepLabel.className = 'inlinecheck full';
    const keep = document.createElement('input');
    keep.type = 'checkbox';
    keep.checked = cells.every(c => {
        const l = find('locations', c.location_id);
        return l?.type === 'pot' || l?.quickpot_family || l?.template_snapshot?.type === 'quickpot';
    });
    keepLabel.append(keep, 'Bisherige Plätze übernehmen (nur bei gleicher Anzahl)');
    f.append(keepLabel);
    const b = document.createElement('button');
    b.textContent = 'Pflanzen übernehmen';
    f.append(b, button('Abbrechen', close, 'secondary'));
    body.append(f);
    f.oninput = () => dirty = true;
    f.onsubmit = async (e) => {
        e.preventDefault();
        b.disabled = true;
        try {
            await api('planner-sowing-convert', {
                id: g.id, version: g.version, entries: cells.map(c => ({ id: c.id, version: c.version })), values: Object.fromEntries(new FormData(f)), year: f.elements.year.value, count: Number(f.elements.count.value), keep_places: keep.checked
            });
            dirty = false;
            await load();
            modal.close();
            if (page === 'locations')
                board();
            else
                sowingDetail(find('sowings', g.id));
        }
        catch (err) {
            fail(err);
        }
        finally {
            b.disabled = false;
        }
    };
}
function sowingCellInspector(host, item, sc) {
    const g = find('sowings', item.sowing_id), cell = find('cells', item.id);
    if (!g || !cell)
        return;
    host.append(button('Aussaat öffnen', () => sowingDetail(g), 'secondary'), button('Gesamte Gruppe auf dieser Platte auswählen', () => sowingGroupSelection(g, sc.id), 'secondary'), button('Gruppe über alle Standorte auswählen', () => sowingGroupSelection(g), 'secondary'), button('Diese Zelle bearbeiten / freigeben', () => sowingGroupSelection(g, sc.id, [cell]), 'secondary'));
}
function sowingSelectEmpty(sc, a, side) {
    if (!canLeave())
        return;
    dirty = false;
    desktopSelection = null;
    const host = $('#workInspector');
    if (!host)
        return;
    host.replaceChildren();
    const row = Math.floor(a.row / sc.sy), col = Math.floor(a.col / sc.sx), loc = find('locations', sc.id);
    if (row < 0 || col < 0 || row >= loc.rows || col >= loc.cols)
        return;
    clearSelection();
    workSelected = null;
    selectionLoc = sc.id;
    cellsSelected.set(row + ':' + col, {
        row, col, width: 1, depth: 1
    });
    const title = document.createElement('h3');
    title.textContent = (side === 'left' ? 'Links' : 'Rechts') + ' · ' + coord(row, col) + ' · Leer';
    host.append(title, button('Pflanze zuweisen', () => workInsert(sc, a), 'secondary'), button('Aussaat zuweisen', () => sowingAssignDialog(sc.id, '', [{
            row, col, width: 1, depth: 1
        }]), 'secondary'));
}
function sowingDecorate(b, item, sc, scale) {
    const p = item.kind === 'plant' ? workObject(item) : null, g = find('sowings', item.sowing_id || p?.sowing_id);
    if (g) {
        const dot = document.createElement('i');
        dot.className = 'sowing-dot';
        dot.style.setProperty('--sowing-color', g.color);
        dot.title = g.name;
        b.append(dot);
    }
    if (item.kind === 'container' && workObject(item)?.type === 'pot') {
        const p = db.plants.find(p => p.location_id === item.object_id && (p.status || 'active') === 'active');
        if (p) {
            const h = document.createElement('span');
            h.className = 'plant-handle';
            h.dataset.dragPlant = p.id;
            h.textContent = '❧';
            h.title = 'Pflanze ziehen (Topf bleibt stehen)';
            b.append(h);
        }
    }
}
const sowingStatus = workStatus;
workStatus = function (item) {
    let id = item.sowing_id;
    if (item.kind === 'container' && workObject(item)?.type === 'pot')
        id = db.cells.find(c => c.location_id === item.object_id && c.sowing_id)?.sowing_id;
    if (id)
        return find('sowings', id)?.actual_date ? 'present' : 'reserved';
    return sowingStatus(item);
};
const sowingMove = workMove;
workMove = async function (item, target) {
    if (!item.sowing_id)
        return sowingMove(item, target);
    const g = find('sowings', item.sowing_id);
    await api('planner-sowing-move', {
        id: g.id, version: g.version, entries: [{ id: item.id, version: item.version }], target
    });
    await load();
    await board();
};
const sowingTarget = workTarget;
workTarget = function (e, item, ox = 0, oy = 0) {
    return sowingTarget(e, item.sowing_id ? { ...item, kind: 'plant' } : item, ox, oy);
};
const sowingValid = workValid;
workValid = function (sc, a, item, target) {
    return sowingValid(sc, a, item.sowing_id ? { ...item, kind: 'plant' } : item, target);
};
const sowingOpen = workOpen;
workOpen = function (item, side) {
    if (item.sowing_id)
        return sowingDetail(find('sowings', item.sowing_id));
    return sowingOpen(item, side);
};
