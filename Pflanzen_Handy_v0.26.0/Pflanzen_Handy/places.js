/* Standortbaum, persistenter Parkplatz, Rasterarbeit und Formular-Platzwahl. */
const locationTypes = {
    place: 'Ort / Gebäude', table: 'Tisch', tub: 'Kübel / Behälter', bed: 'Beet', shelf: 'Regal', other: 'Andere Stellfläche'
};
let boardState = {
    left: '', right: '', query: ''
}, dragPayload = null, boardBusy = false;
function locationPath(id) {
    const parts = [], seen = new Set();
    while (id && !seen.has(id)) {
        seen.add(id);
        const l = find('locations', id);
        if (!l)
            break;
        parts.unshift(l.name);
        id = l.parent_id;
    }
    return parts.join(' → ');
}
function underLocation(id, parent) {
    const seen = new Set();
    while (id && !seen.has(id)) {
        if (id === parent)
            return true;
        seen.add(id);
        id = find('locations', id)?.parent_id;
    }
    return false;
}

function locationOptions(exclude = '') {
    return db.locations.filter(x => !exclude || !underLocation(x.id, exclude)).map(x => [x.id, locationPath(x.id)]).sort((a, b) => a[1].localeCompare(b[1], 'de'));
}

function targetText(t) {
    if (!t?.location_id)
        return 'Parkplatz – nicht zugeordnet';
    return [t.path || locationPath(t.location_id), t.row != null ? coord(t.row, t.col) : t.position].filter(Boolean).join(' → ');
}
function locationManagement() {
    app.innerHTML = '<section class="panel"><div class="actions space"><h2>Orte, Stellflächen & Behälter</h2><div id="newItem"></div></div><p class="muted">Ein Gewächshaus kann Tische und Kübel enthalten. Ein Kübel lässt sich mit seinen Pflanzen an einen anderen Ort umstellen.</p><div class="actions" id="boardLink"></div><label class="searchlabel"><span>Standorte durchsuchen</span><input id="manageSearch" placeholder="Ort, Tisch oder Kübel"></label><div id="locationTree" class="list"></div></section>';
    $('#newItem').append(button('＋ Ort / Stellfläche anlegen', () => simpleForm('locations')));
    $('#boardLink').append(button('Raster & Parkplatz öffnen', () => board()), button('Parkplatz: ' + db.plants.filter(p => p.status === 'active' && !p.location_id).length + ' Horste', () => {
        boardState.left = '';
        board();
    }, 'secondary'));
    const show = () => {
        const q = $('#manageSearch').value.toLocaleLowerCase();
        const tree = $('#locationTree');
        tree.replaceChildren();
        const locs = locationOptions().filter(([id, path]) => (q || find('locations', id)?.type !== 'pot') && path.toLocaleLowerCase().includes(q));
        for (const [id, path] of locs) {
            const l = find('locations', id), row = document.createElement('div');
            row.className = 'contact locationrow';
            const b = button('', () => locationVisit(id));
            b.innerHTML = `<span class="thumb">${l.type === 'tub' ? '◒' : l.parent_id ? '▦' : '⌂'}</span><span class="text"><strong>${esc(l.name)}</strong><small>${esc(path)}</small><small>${esc(locationTypes[l.type] || 'Ort / Gebäude')}${l.rows && l.cols ? ' · ' + (l.unit === 'cm' ? l.width_cm + ' × ' + l.depth_cm + ' cm' : l.rows + ' × ' + l.cols + ' Plätze') : ''}</small></span>`;
            row.append(b);
            tree.append(row);
        }
        if (!locs.length)
            tree.innerHTML = empty('Lege zuerst einen Ort an, zum Beispiel „Gewächshaus“. Danach kannst du Tische oder Kübel darunter anlegen.');
    };
    $('#manageSearch').oninput = show;
    show();
}
function locationDetail(id) {
    const l = find('locations', id);
    if (!l)
        return locationRoot();
    if (l.type === 'pot')
        return potEditor(l);
    openLocationPage('details', id, `<h2>${esc(l.name)}</h2><p class="muted">${esc(locationPath(id))}</p><div id="locActions"></div><div id="locInfo"></div><div id="locChildren"></div><div id="locPlants" class="list"></div>`);
    actions($('#locActions'), [['Bearbeiten / umstellen', () => simpleForm('locations', l)], ['Unterort / Behälter anlegen', () => simpleForm('locations', null, { parent_id: id, type: 'table' }), 'secondary'], ['Raster & Parkplatz', () => {
                boardState.left = id;
                board();
            }, 'secondary'], ['Löschen', () => remove('locations', l), 'secondary']]);
    $('#locInfo').innerHTML = `<p>${esc(locationTypes[l.type] || 'Ort / Gebäude')}${l.rows && l.cols ? ' · Raster ' + l.rows + ' × ' + l.cols : ' · Ohne Raster'}</p><p class="prewrap">${esc(l.description || '')}</p>`;
    const kids = db.locations.filter(x => x.parent_id === id);
    if (kids.length) {
        $('#locChildren').innerHTML = '<h3>Untergeordnete Standorte</h3>';
        for (const x of kids)
            $('#locChildren').append(button(x.name, () => locationDetail(x.id), 'secondary'));
    }
    const ps = db.plants.filter(p => underLocation(p.location_id, id));
    $('#locPlants').innerHTML = '<h3>Zugeordnete Horste, einschließlich Unterorte (' + ps.length + ')</h3>';
    for (const p of ps)
        $('#locPlants').append(contact(p));
}
function addHistory(p) {
    const node = document.createElement('section');
    node.className = 'historypanel';
    node.innerHTML = '<h3>Standort</h3><p><b>Aktuell:</b> ' + esc(place(p)) + '</p>';
    actions(node, [['Verschieben / Platz wählen', () => {
                if (!canLeave())
                    return;
                choosePlace({ initial: currentTarget(p), plantId: p.id }, async (target) => {
                    await api('move', {
                        plant_id: p.id, version: p.version, target
                    });
                    await load();
                    detail(p.id);
                });
            }, 'secondary'], ['Auf Parkplatz', async () => {
                if (!canLeave())
                    return;
                await api('move', {
                    plant_id: p.id, version: p.version, target: {}
                });
                dirty = false;
                await load();
                detail(p.id);
            }, 'secondary']]);
    node.append(button('Aus Planer entfernen', () => workUnassignPlants([p], () => detail(p.id)), 'secondary'));
    const history = document.createElement('details');
    history.innerHTML = '<summary>Standorthistorie · letzte drei Wechsel</summary>';
    node.append(history);
    for (const h of p.location_history || []) {
        const row = document.createElement('div');
        row.className = 'historyentry';
        row.innerHTML = `<div><strong>${esc(targetText(h))}</strong><small>Verlassen am ${esc(h.left_at?.replace('T', ' ') || 'unbekannt')} · ${esc(h.reason || 'Standortwechsel')}</small></div>`;
        row.append(button('Zurückstellen', async () => {
            if (!canLeave())
                return;
            await api('move', {
                plant_id: p.id, version: p.version, history_id: h.history_id
            });
            dirty = false;
            await load();
            detail(p.id);
        }, 'secondary'));
        history.append(row);
    }
    if (!p.location_history?.length)
        history.insertAdjacentHTML('beforeend', '<p class="help">Ab jetzt werden Standortwechsel gespeichert. Frühere, nicht dokumentierte Rasterplätze lassen sich nicht rückwirkend ermitteln.</p>');
    history.insertAdjacentHTML('beforeend', '<p class="help">Zurückstellen überschreibt keine belegten Plätze. Bei inzwischen umgestellten Behältern bitte das Ziel neu wählen.</p>');
    $('#connections').append(node);
}
function attachPlacement(f, p, values) {
    let assignments = null;
    const section = document.createElement('fieldset');
    section.className = 'placementsection';
    section.innerHTML = '<legend>Standort & Rasterplätze wählen</legend><p class="help">Öffnet die Orte und Raster, ohne deine Eingaben zu verlieren. Die Plätze werden erst beim Speichern belegt. Noch nicht zugeordnete Horste bleiben auf dem Parkplatz.</p><div class="placementrows"></div>';
    const qty = () => Math.min(100, Math.max(1, Number(f.elements.count?.value || 1)));
    // Neue Pflanzen: Standort der zuletzt angelegten Pflanze vorbelegt, sonst Parkplatz
    const blank = () => values.location_id ? { location_id: values.location_id, position: values.position || '' } : {};
    if (!p)
        assignments = Array.from({ length: qty() }, blank);
    const baseTarget = () => p ? currentTarget(p) : { location_id: f.elements.location_id.value, position: f.elements.position.value };
    const list = section.querySelector('.placementrows');
    function draw() {
        list.replaceChildren();
        for (let i = 0; i < qty(); i++) {
            const val = assignments ? assignments[i] || {} : baseTarget();
            const row = document.createElement('div');
            row.className = 'placementrow';
            row.innerHTML = '<span><b>' + (qty() > 1 ? 'Horst ' + (i + 1) : 'Zuordnung') + '</b><small>' + esc(targetText(val)) + '</small></span>';
            row.append(button('Ort / Rasterplatz wählen', () => choosePlace({
                initial: val, plantId: p?.id, reserved: (assignments || []).filter((x, n) => n !== i)
            }, target => {
                if (!assignments)
                    assignments = Array.from({ length: qty() }, () => ({}));
                assignments[i] = target;
                dirty = true;
                if (qty() === 1) {
                    f.elements.location_id.value = target.location_id || '';
                    f.elements.position.value = target.position || '';
                }
                draw();
            }), 'secondary'));
            list.append(row);
        }
    }
    f.append(section);
    draw();
    f.elements.count?.addEventListener('input', () => {
        if (assignments)
            assignments = Array.from({ length: qty() }, (_, i) => assignments[i] || blank());
        draw();
    });
    f.elements.location_id.addEventListener('change', () => {
        assignments = Array.from({ length: qty() }, () => ({ location_id: f.elements.location_id.value, position: f.elements.position.value }));
        draw();
    });
    f.elements.position.addEventListener('input', () => {
        assignments = Array.from({ length: qty() }, () => ({ location_id: f.elements.location_id.value, position: f.elements.position.value }));
        draw();
    });
    f.getPlacements = () => assignments;
}

function dragSource(el, payload) {
    el.draggable = true;
    el.addEventListener('dragstart', e => {
        dragPayload = payload;
        e.dataTransfer.setData('application/x-pflanzen', JSON.stringify(payload));
        e.dataTransfer.setData('text/plain', payload.plant_id || payload.cell_id);
        e.dataTransfer.effectAllowed = 'move';
        el.classList.add('dragging');
    });
    el.addEventListener('dragend', () => {
        dragPayload = null;
        el.classList.remove('dragging');
        document.querySelectorAll('.dropover').forEach(x => x.classList.remove('dropover'));
    });
}
function dropTarget(el, fn) {
    el.addEventListener('dragenter', e => {
        if (dragPayload) {
            e.preventDefault();
            el.classList.add('dropover');
        }
    });
    el.addEventListener('dragover', e => {
        if (!dragPayload)
            return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        el.classList.add('dropover');
    });
    el.addEventListener('dragleave', () => el.classList.remove('dropover'));
    el.addEventListener('drop', async (e) => {
        e.preventDefault();
        el.classList.remove('dropover');
        const payload = dragPayload;
        if (!payload || boardBusy)
            return;
        boardBusy = true;
        try {
            if (!canLeave())
                return;
            await fn(payload);
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
    });
}
function boardError(e) {
    const box = $('#boardMessage');
    if (box) {
        box.className = 'errorbox';
        box.textContent = e.message;
    }
    else
        fail(e);
}

function moveCard(p) {
    const row = document.createElement('div');
    row.className = 'movecard';
    row.innerHTML = `<b>${esc(p.name)}</b><small>${esc(p.label)}</small>`;
    dragSource(row, {
        kind: 'plant', plant_id: p.id, version: p.version
    });
    actions(row, [['Platz wählen', () => choosePlace({ initial: currentTarget(p), plantId: p.id }, async (target) => {
                await api('move', {
                    plant_id: p.id, version: p.version, target
                });
                await load();
                board();
            }), 'secondary'], ['Details', () => detail(p.id), 'secondary']]);
    return row;
}

