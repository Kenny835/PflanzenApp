/* Uses the existing two-pane workspace and concrete locations throughout. */
Object.assign(sowingEvents, {
    unpotted: 'Ausgetopft', group_moved: 'Saatgruppe verschoben', planted: 'Ausgepflanzt'
});
let sowingPlannerGroup = '', sowingScoped = null, sowingSort = { key: 'name', direction: 1 };
function sortedSowings(rows, q = '') {
    return rows.filter(g => [g.name, g.genus, g.species, g.variety].join(' ').toLocaleLowerCase('de').includes(q.toLocaleLowerCase('de'))).sort((a, b) => {
        const av = sowingSort.key === 'name' ? a.name : (a.actual_date || a.planned_date || ''), bv = sowingSort.key === 'name' ? b.name : (b.actual_date || b.planned_date || '');
        return av.localeCompare(bv, 'de') * sowingSort.direction || a.id.localeCompare(b.id);
    });
}
function sowingList() {
    app.innerHTML = '<section class="panel"><h2>Saatgruppen</h2><div class="actions" id="sowingActions"></div><label>Suchen<input id="sowingSearch" type="search"></label><div class="table-scroll"><table><thead><tr><th><button id="sortSowingName">Name ↕</button></th><th><button id="sortSowingDate">Aussaatdatum ↕</button></th><th>Belegte Pflanzstellen</th><th>Ausgetopft</th><th>Aktionen</th></tr></thead><tbody id="sowingRows"></tbody></table></div><p id="sowingEmpty"></p></section>';
    $('#sowingActions').append(button('＋ Saatgruppe', () => sowingEdit()), button('Aussaatplaner öffnen', () => sowingPlannerOpen(), 'secondary'), button('Zeitspannen je Art / Sorte', sowingProfiles, 'secondary'));
    const draw = () => {
        const rows = sortedSowings(db.sowings || [], $('#sowingSearch').value), host = $('#sowingRows');
        host.replaceChildren();
        $('#sowingEmpty').textContent = rows.length ? '' : 'Noch keine passenden Saatgruppen. Über „＋ Saatgruppe“ anlegen.';
        for (const g of rows) {
            const tr = document.createElement('tr');
            tr.innerHTML = '<td>' + sowingSwatch(g) + esc(g.name) + '</td><td>' + esc(g.actual_date || g.planned_date || 'Offen') + (g.actual_date ? '' : ' (geplant)') + '</td><td>' + sowingCount(g).length + '</td><td>' + (g.unplaced_slots || 0) + '</td>';
            const td = document.createElement('td');
            td.append(button('Planer', () => sowingPlannerOpen(g.id)), button('Details', () => sowingDetail(g), 'secondary'), button('Bearbeiten', () => sowingEdit(g), 'secondary'));
            tr.append(td);
            host.append(tr);
        }
        $('#sortSowingName').textContent = 'Name ' + (sowingSort.key === 'name' ? (sowingSort.direction === 1 ? '↑' : '↓') : '↕');
        $('#sortSowingDate').textContent = 'Aussaatdatum ' + (sowingSort.key === 'date' ? (sowingSort.direction === 1 ? '↑' : '↓') : '↕');
    };
    for (const [id, key] of [['sortSowingName', 'name'], ['sortSowingDate', 'date']])
        $('#' + id).onclick = () => {
            sowingSort.direction = sowingSort.key === key ? -sowingSort.direction : 1;
            sowingSort.key = key;
            draw();
        };
    $('#sowingSearch').oninput = draw;
    draw();
}
async function sowingPlannerOpen(group = '') {
    if (!canLeave())
        return;
    dirty = false;
    modal.close();
    sowingPlannerGroup = group || '@all';
    sowingScoped = null;
    clearSelection();
    const cells = group ? sowingCount(find('sowings', group)) : [];
    const loc = find('locations', cells[0]?.location_id);
    boardState.left = loc?.type === 'pot' && loc.parent_id ? loc.parent_id : loc?.id || '';
    boardState.right = '';
    await board();
}
const sowingPlannerGo = go;
go = function (p) {
    if (!canLeave())
        return;
    dirty = false;
    if (p !== 'locations' || !sowingPlannerGroup) {
        sowingPlannerGroup = '';
        sowingScoped = null;
    }
    return sowingPlannerGo(p);
};
const sowingPlannerBoard = board;
board = async function () {
    await sowingPlannerBoard();
    if (!$('#boards'))
        return;
    if (sowingPlannerGroup) {
        $('#pageTitle').textContent = 'Aussaatplaner';
        const tools = $('#boardActions');
        tools.prepend(button('← Saatgruppen', () => go('sowing'), 'secondary'), button('Gefäß hinzufügen / Vorlage verwenden', () => sowingAddVessel(), 'secondary'), button('Vorhandenes Gefäß vom Parkplatz öffnen', () => sowingFromParking(), 'secondary'));
        const hint = document.createElement('p');
        hint.textContent = sowingPlannerGroup === '@all' ? 'Alle Saatgruppen sichtbar.' : ('Hervorgehoben: ' + label('sowings', sowingPlannerGroup) + ' · andere Gruppen bleiben sichtbar.');
        tools.after(hint);
    }
    sowingPaintSelection();
};
function sowingAddVessel() {
    openDialog('<h2>Gefäß hinzufügen</h2><p>Eine Vorlage erzeugt eine neue, unabhängige Kopie auf dem Parkplatz.</p>');
    const select = document.createElement('select');
    select.setAttribute('aria-label', 'Gefäßvorlage');
    select.innerHTML = options(db.templates.filter(t => !t.hidden).map(t => [t.id, (t.catalogue_key ? 'Standard: ' : 'Eigene Vorlage: ') + t.name]), '', 'Vorlage wählen');
    body.append(select, button('Neue Kopie erstellen', async () => {
        const t = find('templates', select.value);
        if (!t)
            throw Error('Bitte eine Vorlage wählen.');
        const obj = await api('planner-blueprint-instantiate', { id: t.id, version: t.version });
        await load();
        modal.close();
        boardState.left = obj.id;
        await board();
    }), button('Freies Gefäß anlegen', () => newObjects(), 'secondary'), button('Abbrechen', close, 'secondary'));
}
function sowingFromParking() {
    openDialog('<h2>Gefäß vom Parkplatz übernehmen</h2><p>Das vorhandene Gefäß wird geöffnet. Es wird keine Kopie angelegt; vorhandene Belegungen bleiben erhalten.</p>');
    const items = db.locations.filter(l => l.parked);
    if (!items.length)
        body.append('Keine geparkten Gefäße.');
    for (const l of items)
        body.append(button(l.name, async () => {
            modal.close();
            boardState.left = l.id;
            await board();
        }, 'secondary'));
    body.append(button('Abbrechen', close, 'secondary'));
}
function sowingWithin(c, scope) {
    return c.location_id === scope || underLocation(c.location_id, scope);
}
function scopedSowingCells(group, scope) {
    return db.cells.filter(c => c.sowing_id === group && sowingWithin(c, scope));
}
function sowingSelectGroup(group, scope) {
    const cells = scopedSowingCells(group, scope);
    if (!cells.length)
        throw Error('Keine Pflanzstellen dieser Saatgruppe im aktuellen Gefäß.');
    sowingScoped = {
        group, scope, entries: cells.map(c => ({ id: c.id, version: c.version }))
    };
    clearSelection();
    for (const sc of workScenes.values())
        for (const item of sc.items)
            if (cells.some(c => c.id === item.id)) {
                workMulti.set(item.key, item);
                workMultiSource = sc.id;
            }
    board();
}
function sowingPaintSelection() {
    if (!sowingScoped)
        return;
    const bar = $('#selectionBar');
    if (bar)
        bar.hidden = true;
    const cells = scopedSowingCells(sowingScoped.group, sowingScoped.scope);
    for (const plane of document.querySelectorAll('[data-work-scene]')) {
        const sc = workScenes.get(plane.dataset.workScene);
        for (const b of plane.querySelectorAll('[data-work-key]')) {
            const item = sc.items.find(i => i.key === b.dataset.workKey);
            if (item && (cells.some(c => c.id === item.id) || item.kind === 'container' && cells.some(c => sowingWithin(c, item.object_id))))
                b.classList.add('sowing-selected');
        }
    }
    const host = $('#workInspector');
    if (!host)
        return;
    host.replaceChildren();
    const title = document.createElement('h3');
    title.textContent = 'Saatgruppe „' + label('sowings', sowingScoped.group) + '“ · ' + cells.length + ' Pflanzstellen in ' + label('locations', sowingScoped.scope);
    host.append(title);
    host.append(button('Gemeinsam verschieben', () => sowingGroupTarget('move')), button('Austopfen', () => sowingUnpot(), 'secondary'), button('Auspflanzen …', () => sowingGroupTarget('plant'), 'secondary'), button('Auswahl aufheben', () => {
        sowingScoped = null;
        clearSelection();
        board();
    }, 'secondary'));
}
async function sowingScopedApply(action, target = null, anchor_id = null) {
    const sel = sowingScoped;
    if (!sel)
        throw Error('Zuerst eine Saatgruppe im Gefäß auswählen.');
    const g = find('sowings', sel.group);
    await api('planner-sowing-group-action', {
        id: g.id, version: g.version, scope_id: sel.scope, entries: sel.entries, action, target, anchor_id
    });
    sowingScoped = null;
    clearSelection();
    await load();
    modal.close();
    await board();
}
function sowingUnpot() {
    openDialog('<h2>Austopfen bestätigen</h2><p>' + sowingScoped.entries.length + ' Pflanzstellen werden freigegeben. Die Saatgruppe und die Anzahl ausgetopfter Pflanzstellen bleiben erhalten. Andere Gefäße bleiben unverändert.</p>');
    body.append(button('Jetzt austopfen', () => sowingScopedApply('unpot')), button('Abbrechen', close, 'secondary'));
}
function sowingGroupTarget(action) {
    openDialog('<h2>' + sowingScoped.entries.length + ' Pflanzstellen ' + (action === 'plant' ? 'auspflanzen' : 'verschieben') + '</h2><p>Freie feste Zellen oder enthaltene Pflanzstellen werden der Reihe nach belegt. Bei Platzmangel bleibt alles unverändert. Beim Ziehen einer Auswahl direkt zwischen festen Rastern bleibt ihr Muster erhalten.</p>');
    const select = document.createElement('select');
    select.setAttribute('aria-label', 'Zielgefäß');
    select.innerHTML = options(locationOptions(), '', 'Zielgefäß wählen');
    body.append(select, button('Gemeinsam übernehmen', () => {
        if (!select.value)
            throw Error('Ziel wählen.');
        return sowingScopedApply(action, { location_id: select.value });
    }), button('Abbrechen', close, 'secondary'));
}
const scopedBatchMove = workMoveBatch;
workMoveBatch = async function (items, anchor, target) {
    if (sowingScoped && items.every(i => i.sowing_id === sowingScoped.group))
        return sowingScopedApply('move', target, anchor.id);
    return scopedBatchMove(items, anchor, target);
};
const scopedSelect = workSelect;
workSelect = function (item, sc, side, host) {
    sowingScoped = null;
    scopedSelect(item, sc, side, host);
};
const scopedInspector = sowingCellInspector;
sowingCellInspector = function (host, item, sc) {
    scopedInspector(host, item, sc);
    host.prepend(button('Saatgruppe auf dieser Platte auswählen', () => sowingSelectGroup(item.sowing_id, sc.id)));
};
const scopedProperties = workProperties;
workProperties = function (obj) {
    scopedProperties(obj);
    const host = $('#workInspector') || body;
    const groups = [...new Set(db.cells.filter(c => c.sowing_id && sowingWithin(c, obj.id)).map(c => c.sowing_id))];
    for (const id of groups)
        host.append(button('Saatgruppe auf dieser Platte auswählen: ' + label('sowings', id), () => {
            modal.close();
            sowingSelectGroup(id, obj.id);
        }, 'secondary'));
    if (sowingPlannerGroup && obj.id)
        host.append(button('Gefäß samt Belegung auf Parkplatz', async () => {
            await api('planner-workspace-place', {
                kind: 'container', id: obj.id, version: obj.version, target: {
                    location_id: '', col: 0, row: Math.max(0, ...(await api('planner-workspace-scenes', { ids: [''] }))[0].items.map(i => i.row + i.depth)) + 5
                }
            });
            await load();
            boardState.right = '';
            await board();
        }, 'secondary'));
};
var workModel = workProperties;
const groupDecorate = sowingDecorate;
sowingDecorate = function (b, item, sc, scale) {
    groupDecorate(b, item, sc, scale);
    let group = item.sowing_id || workObject(item)?.sowing_id;
    if (item.kind === 'container') {
        const ids = [...new Set(db.cells.filter(c => c.sowing_id && sowingWithin(c, item.object_id)).map(c => c.sowing_id))];
        if (ids.length === 1)
            group = ids[0];
        else if (ids.length > 1)
            b.title += ' · Saatgruppen: ' + ids.map(id => label('sowings', id)).join(', ');
    }
    if (group) {
        b.dataset.sowingGroup = group;
        const g = find('sowings', group);
        if (g) {
            b.title += ' · Saatgruppe: ' + g.name;
            b.setAttribute('aria-label', b.title);
            if (!b.querySelector('.sowing-dot')) {
                const dot = document.createElement('i');
                dot.className = 'sowing-dot';
                dot.style.setProperty('--sowing-color', g.color);
                b.append(dot);
            }
            if (sowingPlannerGroup === group)
                b.classList.add('sowing-focus');
        }
    }
};
// Composite trays expose their real nested fixed planting places for group assignment.
const assignSimple = sowingAssignDialog;
sowingAssignDialog = function (location = '', group = '', initial = null) {
    group = group || (sowingPlannerGroup !== '@all' ? sowingPlannerGroup : '');
    const parent = find('locations', location);
    if (!parent || parent.type === 'pot' || parent.quickpot_family || parent.template_snapshot?.type === 'quickpot')
        return assignSimple(location, group, initial);
    const descendants = db.locations.filter(l => underLocation(l.id, location) && l.id !== location && (l.type === 'pot' || l.quickpot_family || l.template_snapshot?.type === 'quickpot') && !l.model_pending);
    if (!descendants.length)
        return assignSimple(location, group, initial);
    openDialog('<h2>Pflanzstellen der Zusammenstellung belegen</h2><p>Ein Gefäß kann mehrere Saatgruppen aufnehmen. Bereits belegte Plätze bleiben geschützt.</p>');
    const select = document.createElement('select');
    select.setAttribute('aria-label', 'Saatgruppe');
    select.innerHTML = options((db.sowings || []).map(g => [g.id, g.name]), group, 'Saatgruppe wählen');
    body.append(select);
    const chosen = new Map(), info = document.createElement('p');
    body.append(info);
    const update = () => info.textContent = chosen.size + ' ausgewählte Pflanzstellen';
    for (const l of descendants) {
        const title = document.createElement('h3');
        title.textContent = l.name;
        body.append(title);
        const row = document.createElement('div');
        row.className = 'actions';
        body.append(row);
        for (let r = 0; r < l.rows; r++)
            for (let c = 0; c < l.cols; c++) {
                const a = {
                    location_id: l.id, row: r, col: c, width: 1, depth: 1
                }, key = l.id + ':' + r + ':' + c, b = button(coord(r, c), () => {
                    if (chosen.has(key))
                        chosen.delete(key);
                    else
                        chosen.set(key, a);
                    b.classList.toggle('chosen', chosen.has(key));
                    update();
                }, 'secondary');
                b.disabled = db.cells.some(cell => cell.location_id === l.id && intersect(a, areaOf(cell)));
                row.append(b);
            }
    }
    update();
    body.append(button('Auswahl zuweisen', async () => {
        const g = find('sowings', select.value);
        if (!g || !chosen.size)
            throw Error('Saatgruppe und freie Pflanzstellen wählen.');
        await api('planner-sowing-assign-places', {
            id: g.id, version: g.version, places: [...chosen.values()]
        });
        await load();
        modal.close();
        board();
    }), button('Abbrechen', close, 'secondary'));
};
const groupRenderPlan = workRenderPlan;
workRenderPlan = function (host, sc, side) {
    groupRenderPlan(host, sc, side);
    if (sowingPlannerGroup && sowingPlannerGroup !== '@all' && sc.id && scopedSowingCells(sowingPlannerGroup, sc.id).length) {
        host.prepend(button('Saatgruppe auf dieser Platte auswählen', () => sowingSelectGroup(sowingPlannerGroup, sc.id), 'secondary'));
    }
};
const groupValid = workValid;
workValid = function (sc, a, item, target) {
    if (sowingScoped && sc.fixed && item.sowing_id === sowingScoped.group) {
        const cells = sowingScoped.entries.map(e => find('cells', e.id));
        if (cells.every(c => c && c.location_id === sowingScoped.scope)) {
            const anchor = find('cells', item.id);
            if (anchor) {
                const baseCol = Math.floor(target.col / sc.sx), baseRow = Math.floor(target.row / sc.sy), ids = new Set(cells.map(c => c.id)), filtered = { ...sc, items: sc.items.filter(i => !ids.has(i.id)) };
                return cells.every(c => {
                    const col = (baseCol + c.col - anchor.col) * sc.sx, row = (baseRow + c.row - anchor.row) * sc.sy;
                    return groupValid(filtered, {
                        col, row, width: sc.sx, depth: sc.sy
                    }, item, {
                        ...target, col: col + sc.sx / 2, row: row + sc.sy / 2
                    });
                });
            }
        }
    }
    return groupValid(sc, a, item, target);
};
const scopedEmptySelection = sowingSelectEmpty;
sowingSelectEmpty = function (sc, a, side) {
    sowingScoped = null;
    document.querySelectorAll('.sowing-selected').forEach(el => el.classList.remove('sowing-selected'));
    return scopedEmptySelection(sc, a, side);
};
