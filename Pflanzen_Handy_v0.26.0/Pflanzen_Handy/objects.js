/* 0.8: hierarchy, inline properties and semantic object colors. */
const statusLabels = {
    empty: 'Leer', present: 'Mit Pflanze besetzt', reserved: 'Reserviert', blocked: 'Blockiert', planned: 'Geplant'
};
function workStatus(item) {
    const obj = workObject(item);
    if (item.kind === 'plant' || item.mode === 'present')
        return 'present';
    if (item.kind === 'container') {
        if (obj?.type === 'pot' && db.plants.some(p => p.location_id === obj.id && (p.status || 'active') === 'active'))
            return 'present';
        return obj?.occupancy_status || 'empty';
    }
    return item.mode === 'planned' ? 'reserved' : item.mode === 'reserved' ? 'reserved' : item.mode === 'blocked' ? 'blocked' : 'empty';
}
function workBorder(item) {
    const value = workObject(item)?.border_color;
    return /^#[0-9a-f]{6}$/i.test(value || '') ? value : '#637e8b';
}
function workFits(a, b) {
    if (a.col < 0 || a.row < 0 || a.col + a.width > b.width + 1e-8 || a.row + a.depth > b.depth + 1e-8)
        return false;
    if (b.shape !== 'round')
        return true;
    const x = b.width / 2, y = b.depth / 2, r = b.width / 2;
    if (a.shape === 'round')
        return Math.hypot(a.col + a.width / 2 - x, a.row + a.depth / 2 - y) + a.width / 2 <= r + 1e-8;
    return [a.col, a.col + a.width].every(cx => [a.row, a.row + a.depth].every(cy => Math.hypot(cx - x, cy - y) <= r + 1e-8));
}
const oldWorkValid = workValid;
workValid = function (sc, a, item, target) {
    if (sc.bounded && !target.loose && !sc.fixed && !workFits(a, sc))
        return false;
    if (find('locations', sc.id)?.occupancy_status && find('locations', sc.id).occupancy_status !== 'empty')
        return false;
    return oldWorkValid(sc, a, item, target);
};
function locationRoots() {
    return db.locations.filter(l => !l.parked && !l.parent_id);
}
function locationChildren(id, opts = {}) {
    return db.locations.filter(l => l.parent_id === id && !l.parked && (!opts.excludePots || l.type !== 'pot') && (!opts.exclude || !underLocation(l.id, opts.exclude))).sort((a, b) => a.name.localeCompare(b.name, 'de'));
}
function locationCascade(host, current, onChange, opts = {}) {
    const root = document.createElement('div');
    root.className = 'location-cascade';
    host.append(root);
    function draw(id) {
        root.replaceChildren();
        const path = [], seen = new Set();
        let cursor = find('locations', id);
        while (cursor && !seen.has(cursor.id)) {
            seen.add(cursor.id);
            path.unshift(cursor);
            cursor = find('locations', cursor.parent_id);
        }
        const roots = locationRoots().filter(l => (!opts.exclude || !underLocation(l.id, opts.exclude)) && (!opts.excludePots || l.type !== 'pot'));
        const add = (items, value, title, empty) => {
            const label = document.createElement('label');
            label.textContent = title;
            const select = document.createElement('select');
            select.innerHTML = options(items.map(l => [l.id, l.name]), value, empty);
            label.append(select);
            root.append(label);
            return select;
        };
        const top = add(roots, path[0]?.id || '', opts.label || 'Hauptstandort', 'Parkplatz / unzugeordnet');
        // Parked containers remain reachable as a separate branch, not mixed into every root.
        const parked = db.locations.filter(l => l.parked && (!opts.excludePots || l.type !== 'pot') && (!opts.exclude || !underLocation(l.id, opts.exclude)));
        if (parked.length) {
            const option = document.createElement('option');
            option.value = '@parked';
            option.textContent = 'Geparkte Behälter …';
            top.append(option);
            if (path[0]?.parked)
                top.value = '@parked';
        }
        top.onchange = () => {
            if (top.value === '@parked') {
                root.querySelectorAll('.cascade-sub').forEach(x => x.remove());
                const list = add(parked, '', 'Geparkter Behälter', 'Behälter wählen');
                list.parentElement.classList.add('cascade-sub');
                list.onchange = () => {
                    draw(list.value);
                    onChange(list.value);
                };
                onChange('');
                return;
            }
            draw(top.value);
            onChange(top.value);
        };
        if (path[0]?.parked) {
            const select = add(parked, path[0].id, 'Geparkter Behälter', 'Behälter wählen');
            select.onchange = () => {
                draw(select.value);
                onChange(select.value);
            };
        }
        for (let i = 0; i < path.length; i++) {
            const parent = path[i], children = locationChildren(parent.id, opts);
            if (!children.length)
                continue;
            const select = add(children, path[i + 1]?.id || '', parent.name + ' →', 'Diesen Standort verwenden');
            select.parentElement.classList.add('cascade-sub');
            select.onchange = () => {
                const next = select.value || parent.id;
                draw(next);
                onChange(next);
            };
        }
    }
    draw(current);
    return root;
}
function locationOverview() {
    app.innerHTML = '<section class="panel"><h2>Standorte</h2><p>Hauptstandorte aufklappen, um ihre Tische, Trays und Behälter zu sehen.</p><div class="actions" id="locationOverviewActions"></div><div id="locationTree" class="location-tree"></div></section>';
    $('#locationOverviewActions').append(button('＋ Hauptstandort', () => simpleForm('locations', null, { is_main: true, type: 'place' })), button('Parkplatz öffnen', () => {
        boardState.left = '';
        board();
    }, 'secondary'));
    const roots = locationRoots();
    if (!roots.length)
        $('#locationTree').innerHTML = empty('Noch keine Hauptstandorte. Lege beispielsweise dein Gewächshaus an.');
    function row(loc, host, seen = new Set()) {
        if (seen.has(loc.id))
            return;
        const next = new Set(seen);
        next.add(loc.id);
        const details = document.createElement('details'), summary = document.createElement('summary');
        summary.textContent = loc.name + ' · ' + (locationTypes[loc.type] || 'Standort');
        details.append(summary);
        const controls = document.createElement('div');
        controls.className = 'actions';
        details.append(controls);
        controls.append(button('Arbeitsfläche öffnen', () => locationVisit(loc.id)), button('Eigenschaften', () => workProperties(loc), 'secondary'), button('Dokumentation', () => locationDetail(loc.id), 'secondary'));
        const children = document.createElement('div');
        children.className = 'location-tree-children';
        details.append(children);
        let filled = false;
        details.ontoggle = () => {
            if (details.open && !filled) {
                filled = true;
                for (const child of locationChildren(loc.id))
                    row(child, children, next);
            }
        };
        host.append(details);
    }
    for (const root of roots)
        row(root, $('#locationTree'));
}
const manageBefore08 = locationManagement;
locationManagement = function () {
    if (locationView.mode === 'overview')
        locationOverview();
    else
        manageBefore08();
};
const goBefore08 = go;
go = function (p) {
    if (p === 'locations') {
        if (!canLeave())
            return;
        dirty = false;
        locationView = {
            mode: 'overview', id: '', left: '', right: '', scroll: 0
        };
        locationTrail = [];
    }
    goBefore08(p);
};
const simpleBefore08 = simpleForm;
simpleForm = function (kind, obj = null, defaults = {}) {
    simpleBefore08(kind, obj, defaults);
    if (kind !== 'locations')
        return;
    const f = body.querySelector('form');
    const label = document.createElement('label');
    label.className = 'inlinecheck';
    const check = document.createElement('input');
    check.type = 'checkbox';
    check.checked = obj?.is_main ?? defaults.is_main ?? (!obj?.parent_id && !defaults.parent_id);
    const hidden = document.createElement('input');
    hidden.type = 'hidden';
    hidden.name = 'is_main';
    f.append(hidden);
    label.append(check, 'Übergeordneter Hauptstandort');
    f.prepend(label);
    const parent = f.elements.parent_id;
    function sync() {
        hidden.value = check.checked ? 'true' : 'false';
        if (check.checked)
            parent.value = '';
        parent.disabled = check.checked;
    }
    check.onchange = () => {
        dirty = true;
        sync();
    };
    sync();
    const submit = f.onsubmit;
    f.onsubmit = async (e) => {
        sync();
        parent.disabled = false;
        try {
            await submit(e);
        }
        finally {
            parent.disabled = check.checked;
        }
    };
    if (parent) {
        const host = document.createElement('div');
        parent.closest('label').hidden = true;
        f.insertBefore(host, f.firstChild.nextSibling);
        locationCascade(host, parent.value, id => {
            parent.value = id;
            if (id) {
                check.checked = false;
                sync();
            }
        }, { exclude: obj?.id, label: 'Übergeordneter Standort' });
    }
};

async function saveObjectChanges(obj, values) {
    const request = {
        id: obj.id, version: obj.version, ...values
    };
    const result = await api('planner-workspace-edit', request);
    if (!result.needs_parking)
        return true;
    return new Promise(resolve => {
        const dialog = document.createElement('dialog');
        dialog.className = 'space-conflict';
        dialog.innerHTML = '<h2>Am bisherigen Platz ist nicht genug Platz</h2><p></p><div class="actions"></div><p class="errorbox" hidden></p>';
        dialog.querySelector('p').textContent = result.message + ' Das Objekt und sein Inhalt sind bisher unverändert.';
        document.body.append(dialog);
        const finish = x => {
            dialog.close();
            dialog.remove();
            resolve(x);
        };
        dialog.querySelector('.actions').append(button('Abbrechen – unverändert lassen', () => finish(false), 'secondary'), button('Änderung übernehmen und auf Parkplatz verschieben', async () => {
            try {
                await api('planner-workspace-edit', { ...request, park_on_conflict: true });
                finish(true);
            }
            catch (e) {
                const n = dialog.querySelector('.errorbox');
                n.hidden = false;
                n.textContent = e.message;
            }
        }));
        dialog.addEventListener('cancel', e => {
            e.preventDefault();
            finish(false);
        });
        dialog.showModal();
    });
}
async function workRotate(obj) {
    if (!canLeave())
        return;
    if (await saveObjectChanges(obj, { rotate: true })) {
        dirty = false;
        await load();
        await board();
    }
}
// Regal: Ebenen ein- und ausschalten (Gegenstück zu shelf.py; die Berechnung der Ebenen muss dort identisch sein)
// Anzahl der Behälter und freien Pflanzen auf Ebenen, die mit dieser Auswahl ausgeschaltet würden
function shelfImpact(obj, enabled) {
    const regions = shelfRegions(obj.shelf), off = new Set(regions.filter(r => !enabled[r.level - 1]).map(r => r.level));
    let n = 0;
    for (const c of db.cells.filter(c => c.location_id === obj.id && (c.container_id || c.plant_id && c.mode === 'present'))) {
        const r = regions.find(r => c.col >= r.col - 1e-6 && c.row >= r.row - 1e-6 && c.col + c.width <= r.col + r.width + 1e-6 && c.row + c.depth <= r.row + r.depth + 1e-6);
        if (r && off.has(r.level))
            n++;
    }
    return n;
}
function workShelfLevels(host, obj) {
    const box = document.createElement('fieldset'), legend = document.createElement('legend'), list = document.createElement('div'), info = document.createElement('p');
    box.className = 'shelf-levels full';
    legend.textContent = 'Ebenen';
    list.className = 'shelf-level-list';
    info.className = 'help';
    info.textContent = 'Ausgeschaltete Ebenen verschwinden aus der Ansicht, die übrigen rücken zusammen. Behälter auf einer ausgeschalteten Ebene kommen samt Inhalt und Pflanzen auf den Parkplatz.';
    const checks = obj.shelf.enabled.map((on, i) => {
        const label = document.createElement('label'), input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = on;
        label.className = 'inlinecheck';
        label.append(input, 'Ebene ' + (i + 1));
        list.append(label);
        return input;
    });
    let confirmed = false;
    list.oninput = () => {
        confirmed = false;
        info.className = 'help';
    };
    const apply = button('Ebenen übernehmen', async () => {
        const enabled = checks.map(x => x.checked), current = find('locations', obj.id);
        if (!enabled.some(Boolean)) {
            info.className = 'help errorbox';
            info.textContent = 'Mindestens eine Ebene muss eingeschaltet bleiben.';
            return;
        }
        const affected = shelfImpact(current, enabled);
        if (affected && !confirmed) {
            confirmed = true;
            info.className = 'help notice';
            info.textContent = affected + ' Behälter bzw. Pflanzen auf den ausgeschalteten Ebenen kommen samt Inhalt auf den Parkplatz. Zum Bestätigen noch einmal „Ebenen übernehmen“ wählen.';
            return;
        }
        try {
            dirty = false;
            const result = await api('planner-shelf-levels', { id: current.id, version: current.version, enabled });
            await load();
            await board();
            message(result.parked ? result.parked + ' Behälter bzw. Pflanzen auf den Parkplatz verschoben.' : 'Ebenen gespeichert.');
        }
        catch (err) {
            info.className = 'help errorbox';
            info.textContent = err.message;
        }
    }, 'secondary');
    box.append(legend, list, apply, info);
    host.append(box);
}
function workProperties(obj) {
    if (dirty && !canLeave())
        return;
    dirty = false;
    let host = $('#workInspector');
    if ($('#workRight') && !workRenderingProperties) {
        boardState.right = obj.id;
        workRightState.tab = 'properties';
        return workRenderRight();
    }
    if (!host) {
        openDialog('<h2>Objekteigenschaften</h2>');
        host = body;
    }
    host.replaceChildren();
    const title = document.createElement('h3');
    title.textContent = obj.name + ' · Eigenschaften';
    host.append(title);
    const tools = document.createElement('div');
    tools.className = 'actions';
    host.append(tools);
    tools.append(button('Inhalt öffnen', () => {
        if (!canLeave())
            return;
        dirty = false;
        modal.close();
        if ($('#workRight')) {
            workRightState.tab = 'plan';
            workRenderRight();
        }
        else
            locationVisit(obj.id);
    }, 'secondary'));
    if (obj.shape !== 'round')
        tools.append(button('↻ 90° drehen', () => workRotate(obj), 'secondary'));
    tools.append(button('Behälter löschen', () => workDeleteContainer(obj), 'danger'));
    const f = document.createElement('form');
    f.className = 'formgrid object-properties';
    host.append(f);
    const typ = obj.quickpot_family || obj.template_snapshot?.type === 'quickpot' ? 'quickpot' : obj.type || 'place';
    const fp = obj.footprint?.unit === 'cm' ? obj.footprint : obj.unit === 'cm' ? { width: obj.width_cm, depth: obj.depth_cm } : { width: 7, depth: 7 };
    for (const spec of [['name', 'Name'], ['type', 'Objekttyp', 'select', [['place', 'Ort / Gebäude'], ['table', 'Tisch'], ['tray', 'Tray · freie Innenfläche'], ['pot', 'Topf · ein Pflanzenplatz'], ['quickpot', 'QuickPot · feste Zellen'], ['tub', 'Kübel'], ['bed', 'Beet'], ['shelf', 'Regal'], ['other', 'Andere Stellfläche']]], ['shape', 'Form', 'select', [['rectangle', 'Rechteckig'], ['square', 'Quadratisch'], ['round', 'Rund']]], ['width', 'Außenbreite / Durchmesser in cm'], ['depth', 'Außentiefe in cm'], ['family', 'QuickPot-Familie', 'select', [['Standard', 'Standardmaß'], ['Dänenmaß', 'Dänenmaß'], ['', 'Eigene / alle Modelle']]], ['cells', 'Zellenzahl (Filter)', 'select', []], ['template_id', 'QuickPot-Modell', 'select', []], ['occupancy_status', 'Flächenstatus', 'select', [['empty', 'Leer / Belegung automatisch'], ['reserved', 'Reserviert'], ['blocked', 'Blockiert']]]])
        f.append(field(spec, {
            ...obj, ...fp, type: typ, shape: obj.shape || 'rectangle', family: obj.quickpot_family || obj.template_snapshot?.family || 'Standard', occupancy_status: obj.occupancy_status || 'empty'
        }));
    f.append(field(['group_id', 'Pflegegruppe', 'select', db.groups.map(g => [g.id, g.name])], obj));
    f.elements.group_id.options[0].textContent = 'Vom übergeordneten Standort übernehmen';
    const care = document.createElement('p');
    care.className = 'help full';
    const effective = obj.effective_care;
    care.textContent = 'Aktuell wirksam: ' + (effective?.group_id ? label('groups', effective.group_id) : 'Keine Pflegegruppe') + ' · ' + (effective?.source || 'Keine Vorgabe') + '. Eigene Auswahl bleibt bei Änderungen übergeordneter Gruppen erhalten.';
    f.append(care);
    if (obj.shelf)
        workShelfLevels(f, obj);
    for (const k of ['width', 'depth']) {
        const i = f.elements[k];
        i.type = 'number';
        i.min = .1;
        i.max = 3000;
        i.step = 'any';
        i.required = true;
    }
    if (obj.shelf) {
        // Ein Regal bleibt ein Regal; seine Größe ergibt sich aus den Ebenen.
        f.elements.type.replaceChildren(new Option('Regal · Ebenen', 'shelf'));
        f.elements.type.value = 'shelf';
        f.elements.width.readOnly = f.elements.depth.readOnly = true;
    }
    const border = document.createElement('label');
    border.textContent = 'Randfarbe zur Gruppierung';
    const color = document.createElement('input');
    color.type = 'color';
    color.value = obj.border_color || '#637e8b';
    border.append(color);
    f.append(border);
    let borderValue = obj.border_color || '';
    color.oninput = () => {
        borderValue = color.value;
        dirty = true;
    };
    f.append(button('Standardrand wiederherstellen', () => {
        borderValue = '';
        color.value = '#637e8b';
        dirty = true;
    }, 'secondary'));
    const rootLabel = document.createElement('label');
    rootLabel.className = 'inlinecheck full';
    const main = document.createElement('input');
    main.type = 'checkbox';
    main.checked = !!obj.is_main;
    rootLabel.append(main, 'Übergeordneter Hauptstandort (ohne übergeordneten Ort)');
    f.append(rootLabel);
    const note = document.createElement('p');
    note.className = 'help full';
    note.textContent = 'Weiß = leer · Grün = mit Pflanze besetzt · Gelb = reserviert · Rosarot = blockiert. Randfarbe ist unabhängig von Pflegegruppen. Beim Typwechsel bleibt dieses Objekt mit seiner ID erhalten.';
    f.append(note);
    const mapHost = document.createElement('div');
    mapHost.className = 'container-plants full';
    f.append(mapHost);
    const cells = db.cells.filter(x => x.location_id === obj.id), loose = db.plants.filter(p => p.location_id === obj.id && !cells.some(c => c.plant_id === p.id && c.mode === 'present'));
    let chosen = null;
    function models() {
        // Erst die Zellenzahl, dann das Modell: statt einer Liste mit über 100 Einträgen nur die passenden Modelle
        const family = f.elements.family.value, current = obj.template_snapshot?.type === 'quickpot' ? obj.template_snapshot : null;
        const all = db.templates.filter(t => !t.hidden && t.type === 'quickpot' && (!family || t.family === family));
        const counts = [...new Set(all.map(t => t.cell_count))].sort((a, b) => a - b);
        const cells = f.elements.cells, wanted = cells.dataset.touched ? cells.value : String(current?.cell_count || '');
        cells.innerHTML = options(counts.map(n => [String(n), n + ' Zellen']), counts.includes(Number(wanted)) ? wanted : '', 'Alle Zellenzahlen');
        const list = cells.value ? all.filter(t => String(t.cell_count) === cells.value) : all;
        f.elements.template_id.innerHTML = options(list.map(t => [t.id, t.name + ' · ' + t.cell_count + ' Zellen · ' + t.width + ' × ' + t.depth + ' cm']), current ? current.id : '', 'Noch kein Zellmodell');
    }
    function mapping() {
        mapHost.replaceChildren();
        const plants = db.plants.filter(p => p.location_id === obj.id);
        const title = document.createElement('h4');
        title.textContent = 'Pflanzen in diesem Behälter';
        mapHost.append(title);
        if (!plants.length) {
            mapHost.append('Keine Pflanzen zugeordnet.');
            return;
        }
        const table = document.createElement('table');
        table.innerHTML = '<thead><tr><th>Platz</th><th>ID / Pflanze</th><th></th></tr></thead>';
        const tbody = document.createElement('tbody');
        table.append(tbody);
        mapHost.append(table);
        for (const p of plants) {
            const tr = document.createElement('tr'), position = document.createElement('td'), name = document.createElement('td'), action = document.createElement('td');
            const cell = cells.find(x => x.plant_id === p.id && x.mode === 'present');
            position.textContent = cell ? coord(cell.row, cell.col) : 'Ohne Rasterplatz';
            name.textContent = (p.label || '') + ' · ' + p.name;
            action.append(button('Aus Planer entfernen', async () => {
                if (!canLeave())
                    return;
                dirty = false;
                await api('planner-workspace-unassign', {
                    id: p.id, version: p.version, location_id: obj.id
                });
                await load();
                if ($('#boards'))
                    await board();
                else
                    workProperties(find('locations', obj.id));
            }, 'secondary'));
            tr.append(position, name, action);
            tbody.append(tr);
        }
    }
    function sync(remap = false) {
        const qp = f.elements.type.value === 'quickpot';
        chosen = qp ? find('templates', f.elements.template_id.value) : null;
        for (const k of ['family', 'cells', 'template_id'])
            f.elements[k].closest('label').hidden = !qp;
        f.elements.shape.disabled = qp;
        if (qp)
            f.elements.shape.value = 'rectangle';
        f.elements.width.readOnly = f.elements.depth.readOnly = !!chosen || !!obj.shelf;
        if (chosen) {
            const odd = workOrientation(obj) % 2;
            f.elements.width.value = odd ? chosen.depth : chosen.width;
            f.elements.depth.value = odd ? chosen.width : chosen.depth;
        }
        else if (f.elements.shape.value !== 'rectangle') {
            f.elements.depth.value = f.elements.width.value;
            f.elements.depth.readOnly = true;
        }
        rootLabel.hidden = ['pot', 'quickpot'].includes(f.elements.type.value);
        if (rootLabel.hidden)
            main.checked = false;
        if (remap)
            mapping();
    }
    models();
    sync(true);
    f.elements.type.onchange = () => sync(true);
    f.elements.family.onchange = () => {
        delete f.elements.cells.dataset.touched;
        models();
        sync(true);
    };
    f.elements.cells.onchange = () => {
        f.elements.cells.dataset.touched = '1';
        models();
        sync(true);
    };
    f.elements.template_id.onchange = () => sync(true);
    f.elements.shape.onchange = () => sync();
    f.oninput = () => {
        dirty = true;
        sync();
    };
    const submit = document.createElement('button');
    submit.textContent = 'Änderungen speichern';
    f.append(submit, button('Abbrechen', () => {
        dirty = false;
        if ($('#boards'))
            board();
        else
            close();
    }, 'secondary'));
    f.onsubmit = async (e) => {
        e.preventDefault();
        submit.disabled = true;
        try {
            const values = {
                ...Object.fromEntries(new FormData(f)), shape: f.elements.shape.value, border_color: borderValue, is_main: main.checked, mapping: {}
            };
            if (chosen)
                values.template_version = chosen.version;
            if (await saveObjectChanges(obj, values)) {
                dirty = false;
                await load();
                if ($('#boards'))
                    await board();
                else {
                    modal.close();
                    render();
                }
            }
        }
        catch (err) {
            let box = f.querySelector('.object-error');
            if (!box) {
                box = document.createElement('p');
                box.className = 'object-error errorbox full';
                f.append(box);
            }
            box.textContent = err.message;
        }
        finally {
            submit.disabled = false;
        }
    };
}

function rotationButton(obj, refresh) {
    return button('↻ Um 90° drehen', async () => {
        if (!canLeave())
            return;
        if (await saveObjectChanges(obj, { rotate: true })) {
            dirty = false;
            await load();
            refresh();
        }
    }, 'secondary');
}
onSelectionBar(function () {
    if (!workMulti.size || !$('#selectionBar'))
        return;
    const host = $('#selectionBar'), color = document.createElement('input');
    color.type = 'color';
    color.value = '#637e8b';
    color.setAttribute('aria-label', 'Randfarbe der Auswahl');
    host.append(color);
    async function apply(value) {
        const entries = [...workMulti.values()].filter(x => x.kind !== 'cell').map(x => ({
            kind: x.kind === 'container' ? 'locations' : 'plants', id: x.object_id, version: x.object_version
        }));
        await api('planner-workspace-colors', { entries, border_color: value });
        clearSelection();
        await load();
        board();
    }
    host.append(button('Randfarbe auf Auswahl anwenden', () => apply(color.value), 'secondary'), button('Standardrand für Auswahl', () => apply(''), 'secondary'));
});
async function workDeleteContainer(obj) {
    return workDeleteContainers([{ id: obj.id, version: obj.version }]);
}
// Was beim Löschen passiert (gleiche Regel wie im Server, planner_qol.remove_many):
// bleibende Unterbehälter kommen samt Inhalt auf den Parkplatz, Pflanzen direkt in gelöschten Behältern werden nicht zugeordnet.
function workDeleteImpact(entries) {
    const ids = new Set(entries.map(e => e.id));
    return {
        total: ids.size,
        parked: db.locations.filter(l => ids.has(l.parent_id) && !ids.has(l.id)).length,
        unassigned: db.plants.filter(p => ids.has(p.location_id)).length
    };
}
function workDeleteContainers(entries) {
    if (!entries.length || !canLeave())
        return;
    const impact = workDeleteImpact(entries);
    const dialog = document.createElement('dialog');
    dialog.innerHTML = '<h2>Objekte wirklich löschen?</h2><p class="summary"></p><p>Behälter, die in den gelöschten Objekten liegen, kommen samt Inhalt und Pflanzen auf den Parkplatz. Pflanzen, die direkt in einem gelöschten Objekt stehen, bleiben mit ihrer ID und Dokumentation im Bestand, sind danach nicht zugeordnet und erscheinen weder im Planer noch auf dem Parkplatz. Aussaatgruppen bleiben erhalten; ihre betroffenen Plätze werden freigegeben. Die Aktion kann rückgängig gemacht werden.</p><div class="actions"></div><p class="errorbox" hidden></p>';
    dialog.querySelector('.summary').textContent = entries.length + ' ausgewählt · ' + impact.parked + ' Behälter kommen samt Inhalt auf den Parkplatz · ' + impact.unassigned + ' Pflanzen werden nicht zugeordnet und bleiben im Bestand.';
    document.body.append(dialog);
    let busy = false;
    const finish = () => {
        if (busy)
            return;
        dialog.close();
        dialog.remove();
    };
    const yes = button('Wirklich löschen', async () => {
        if (busy)
            return;
        busy = true;
        yes.disabled = true;
        try {
            const result = await api('planner-workspace-remove-containers', { entries, confirmed: true });
            dirty = false;
            await load();
            clearSelection();
            workSelected = null;
            desktopSelection = null;
            if (typeof sowingScoped !== 'undefined')
                sowingScoped = null;
            for (const side of ['left', 'right'])
                if (result.removed.includes(boardState[side]))
                    boardState[side] = '';
            busy = false;
            finish();
            if ($('#boards'))
                await board();
            else {
                modal.close();
                locationRoot();
            }
        }
        catch (e) {
            busy = false;
            yes.disabled = false;
            const error = dialog.querySelector('.errorbox');
            error.hidden = false;
            error.textContent = e.message;
        }
    }, 'danger');
    dialog.querySelector('.actions').append(button('Abbrechen', finish, 'secondary'), yes);
    dialog.addEventListener('cancel', e => {
        e.preventDefault();
        finish();
    });
    dialog.showModal();
}
onSelectionBar(function () {
    const host = $('#selectionBar');
    if (!host || !workMulti.size)
        return;
    const containers = [...workMulti.values()].filter(x => x.kind === 'container');
    if (!containers.length)
        return;
    const action = button('Ausgewählte Objekte löschen', () => workDeleteContainers(containers.map(x => ({ id: x.object_id, version: x.object_version }))), 'danger');
    // A mixed plant/cell selection must never silently delete only part of the selection.
    action.disabled = containers.length !== workMulti.size;
    if (action.disabled)
        action.title = 'Zum Löschen ausschließlich Behälter auswählen. Pflanzen werden hier nicht gelöscht.';
    host.append(action);
});
async function workUnassignPlants(plants, after = null) {
    if (!plants.length || !canLeave())
        return;
    await api('planner-workspace-unassign-plants', { entries: plants.map(p => ({ id: p.id, version: p.version })) });
    dirty = false;
    clearSelection();
    workSelected = null;
    desktopSelection = null;
    await load();
    if (after)
        await after();
    else
        await board();
    message(plants.length + ' Pflanze(n) bleiben im Bestand, ohne Standort und außerhalb von Planer und Parkplatz.');
}
onSelectionBar(function () {
    const host = $('#selectionBar'), items = [...workMulti.values()];
    if (!host || !items.length || items.some(i => i.kind !== 'plant'))
        return;
    host.append(button('Pflanzen aus Planer entfernen', () => workUnassignPlants(items.map(i => ({ id: i.object_id, version: i.object_version }))), 'secondary'));
});
