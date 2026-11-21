/* 0.7 — ein Planer für Standorte, Behälter und Parkplatz. */
const workPrefs = {}, workScroll = {}, workScenes = new Map();
let workEpoch = 0, workSelected = null;
const workMulti = new Map();
let workMultiSource = null;
function workCollision(a, b) {
    const ar = a.shape === 'round' && Math.abs(a.width - a.depth) < 1e-8, br = b.shape === 'round' && Math.abs(b.width - b.depth) < 1e-8;
    if (ar && br)
        return Math.hypot(a.col + a.width / 2 - b.col - b.width / 2, a.row + a.depth / 2 - b.row - b.depth / 2) < (a.width + b.width) / 2 - 1e-8;
    if (ar || br) {
        if (br)
            return workCollision(b, a);
        const x = a.col + a.width / 2, y = a.row + a.depth / 2;
        return Math.hypot(x - Math.max(b.col, Math.min(x, b.col + b.width)), y - Math.max(b.row, Math.min(y, b.row + b.depth))) < a.width / 2 - 1e-8;
    }
    return intersect(a, b);
}
function workContains(a, x, y) {
    return a.shape === 'round' && Math.abs(a.width - a.depth) < 1e-8 ? Math.hypot(x - a.col - a.width / 2, y - a.row - a.depth / 2) <= a.width / 2 : x >= a.col && x < a.col + a.width && y >= a.row && y < a.row + a.depth;
}
function workPref(sc) {
    return workPrefs[sc.id] || (workPrefs[sc.id] = {
        grid: true, snap: true, step: sc.step || 7, level: 6, scale: 0
    });
}
function workSnap(n, sc) {
    const p = workPref(sc);
    return Math.max(0, Math.round((p.snap ? Math.round(n / p.step) * p.step : n) * 10000) / 10000);
}
function workObject(item) {
    return item.kind === 'container' ? find('locations', item.object_id) : item.kind === 'plant' ? find('plants', item.object_id) : null;
}
function workOrientation(obj) {
    if (obj?.orientation != null)
        return obj.orientation;
    const t = obj?.template_snapshot, f = obj?.footprint;
    return t && f && t.width !== t.depth && f.width === t.depth && f.depth === t.width ? 1 : 0;
}
function workCellSvg(a, classes, round = false) {
    if (round)
        return '<ellipse cx="' + (a.col + a.width / 2) + '" cy="' + (a.row + a.depth / 2) + '" rx="' + a.width / 2 + '" ry="' + a.depth / 2 + '" class="' + classes + '"/>';
    return '<rect x="' + a.col + '" y="' + a.row + '" width="' + a.width + '" height="' + a.depth + '" rx="' + a.width * .12 + '" ry="' + a.depth * .12 + '" class="' + classes + '"/>';
}
// Ebenen eines Regals von oben nach unten, dicht untereinander (Gegenstück zu shelf.regions in shelf.py; beide müssen gleich rechnen)
function shelfRegions(meta) {
    const out = [];
    meta.enabled.forEach((on, i) => {
        if (on)
            out.push({ level: i + 1, col: meta.pad, row: meta.pad + out.length * (meta.depth + meta.gap), width: meta.width, depth: meta.depth });
    });
    return out;
}
function workIcon(item, scale = 4) {
    const obj = workObject(item), plate = obj?.quickpot_family || obj?.template_snapshot?.type === 'quickpot';
    let rows = obj?.rows || 1, cols = obj?.cols || 1;
    if (workOrientation(obj) % 2)
        [rows, cols] = [cols, rows];
    const w = item.width, h = item.depth, pad = Math.min(w, h) * .08;
    let inner = '';
    if (plate) {
        if (!obj.model_pending) {
            const cells = db.cells.filter(x => x.location_id === obj.id);
            for (let r = 0; r < obj.rows; r++)
                for (let c = 0; c < obj.cols; c++) {
                    let x = c / obj.cols, y = r / obj.rows, cw = 1 / obj.cols, ch = 1 / obj.rows;
                    for (let turn = 0; turn < workOrientation(obj); turn++)
                        [x, y, cw, ch] = [1 - y - ch, x, ch, cw];
                    const cell = cells.find(a => c >= a.col && c < a.col + (a.width || 1) && r >= a.row && r < a.row + (a.depth || 1));
                    const group = typeof db.sowings !== 'undefined' && find('sowings', cell?.sowing_id || find('plants', cell?.plant_id)?.sowing_id);
                    const state = cell?.mode === 'present' || group?.actual_date ? 'occupied' : cell?.mode || 'empty';
                    inner += workCellSvg({
                        col: x * w, row: y * h, width: cw * w, depth: ch * h
                    }, 'pot-cavity quickpot-cell ' + state);
                    if (group)
                        inner += '<circle cx="' + ((x + cw * .84) * w) + '" cy="' + ((y + ch * .16) * h) + '" r="' + Math.min(cw * w, ch * h) / 16 + '" fill="' + group.color + '"/>';
                }
        }
    }
    else if (item.kind === 'container')
        inner = '<rect x="' + pad + '" y="' + pad + '" width="' + (w - pad * 2) + '" height="' + (h - pad * 2) + '" rx="' + (item.shape === 'round' ? w / 2 : Math.min(w, h) * .08) + '" class="pot-cavity"/>';
    // Ein Regal belegt im Raum nur seine Grundfläche. Seine Ebenen liegen in der Innenansicht übereinander und würden hier verzerrt erscheinen.
    if (obj && item.kind === 'container' && !plate && obj.type !== 'pot' && !obj.model_pending && !obj.shelf) {
        const cells = db.cells.filter(x => x.location_id === obj.id);
        const dw = obj.unit === 'cm' ? obj.width_cm : obj.cols, dh = obj.unit === 'cm' ? obj.depth_cm : obj.rows;
        if (dw && dh && w * scale > 65 && h * scale > 40)
            for (const cell of cells) {
                let x = cell.col / dw, y = cell.row / dh, cw = (cell.width || 1) / dw, ch = (cell.depth || 1) / dh;
                for (let turn = 0; turn < workOrientation(obj); turn++)
                    [x, y, cw, ch] = [1 - y - ch, x, ch, cw];
                const child = find('locations', cell.container_id), rx = child?.shape === 'round' ? cw * w / 2 : Math.min(cw * w, ch * h) * .08;
                inner += '<rect x="' + ((x + cw * .075) * w) + '" y="' + ((y + ch * .075) * h) + '" width="' + Math.max(.2, cw * w * .85) + '" height="' + Math.max(.2, ch * h * .85) + '" rx="' + rx + '" class="nested-pot ' + (cell.mode === 'present' ? 'occupied' : cell.mode === 'container' && child?.type === 'pot' && db.plants.some(p => p.location_id === child.id && (p.status || 'active') === 'active') ? 'occupied' : child?.occupancy_status || cell.mode) + '" style="stroke:' + workBorder({ kind: child ? 'container' : 'plant', object_id: child?.id || cell.plant_id }) + '"/>';
            }
    }
    const outline = item.shape === 'round' ? '<ellipse cx="' + w / 2 + '" cy="' + h / 2 + '" rx="' + (w / 2 - .15) + '" ry="' + (h / 2 - .15) + '" class="pot-outline"/>' : '<rect x=".15" y=".15" width="' + Math.max(.1, w - .3) + '" height="' + Math.max(.1, h - .3) + '" rx="' + Math.min(w, h) * .06 + '" class="pot-outline"/>';
    return '<svg viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none" aria-hidden="true">' + outline + inner + '</svg>';
}
function workTarget(e, item, ox = 0, oy = 0) {
    const plane = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-work-scene]');
    if (!plane)
        return null;
    const sc = workScenes.get(plane.dataset.workScene), scale = Number(plane.dataset.workScale), r = plane.getBoundingClientRect();
    const x = (e.clientX - r.left) / scale, y = (e.clientY - r.top) / scale;
    // Fixed cells are pointer targets, not objects snapped by their grabbed corner.
    // Send the cell centre so floating point boundaries cannot select a neighbour.
    if (item.kind === 'plant' && sc.fixed) {
        const col = Math.floor(x / sc.sx) * sc.sx, row = Math.floor(y / sc.sy) * sc.sy;
        return {
            sc, plane, scale, area: {
                col, row, width: sc.sx, depth: sc.sy, shape: sc.shape
            }, target: {
                location_id: sc.id, col: col + sc.sx / 2, row: row + sc.sy / 2, loose: false
            }
        };
    }
    let col = workSnap(x - ox, sc), row = workSnap(y - oy, sc);
    if (item.kind === 'plant') {
        const x = (e.clientX - r.left) / scale, y = (e.clientY - r.top) / scale;
        const pot = sc.items.find(b => b.kind === 'container' && workContains(b, x, y) && find('locations', b.object_id)?.type === 'pot');
        if (pot) {
            col = pot.col + pot.width / 2;
            row = pot.row + pot.depth / 2;
        }
    }
    return {
        sc, plane, scale, area: {
            col, row, width: item.width, depth: item.depth, shape: item.shape
        }, target: {
            location_id: sc.id, col, row, loose: sc.bounded && !sc.fixed && (col >= sc.width || row >= sc.depth)
        }
    };
}
function workValid(sc, a, item, target) {
    if (sc.legacy || item.unknown && item.kind === 'container')
        return false;
    const potHit = item.kind === 'plant' && sc.items.find(b => b.kind === 'container' && workContains(b, a.col, a.row) && find('locations', b.object_id)?.type === 'pot');
    if (potHit)
        return !['reserved', 'blocked'].includes(find('locations', potHit.object_id)?.occupancy_status) && !db.plants.some(p => p.location_id === potHit.object_id && p.id !== item.object_id) && !db.cells.some(c => c.location_id === potHit.object_id && c.plant_id !== item.object_id);
    if (sc.fixed) {
        if (item.kind !== 'plant' || a.col < 0 || a.row < 0 || a.col >= sc.width || a.row >= sc.depth)
            return false;
        const x = target.col ?? (a.col + a.width / 2), y = target.row ?? (a.row + a.depth / 2);
        return !sc.items.some(b => b.object_id !== item.object_id && workContains(b, x, y));
    }
    if (item.kind === 'container' && (sc.id === item.object_id || underLocation(sc.id, item.object_id)))
        return false;
    if (sc.bounded) {
        const boundary = {
            col: 0, row: 0, width: sc.width, depth: sc.depth
        };
        if (target.loose ? workCollision(a, boundary) : a.col + a.width > sc.width + 1e-8 || a.row + a.depth > sc.depth + 1e-8)
            return false;
    }
    return !sc.items.some(b => b.object_id !== item.object_id && workCollision(a, b));
}
async function workMove(item, target) {
    if (item.kind === 'cell') {
        if (item.mode !== 'planned')
            throw Error('Reservierungen und ausgeschlossene Flächen über die Auswahl bearbeiten.');
        const sc = workScenes.get(target.location_id);
        if (!sc || !sc.bounded || target.loose)
            throw Error('Planungen benötigen eine begrenzte Stellfläche.');
        await api('move-plan', {
            cell_id: item.id, version: item.version, location_id: sc.id, row: target.row / sc.sy, col: target.col / sc.sx
        });
    }
    else
        await api('planner-workspace-place', {
            kind: item.kind, id: item.object_id, version: item.object_version, target
        });
    await load();
    await board();
}
function workOpen(item, side) {
    const obj = workObject(item);
    if (item.kind === 'container') {
        if (obj.type === 'pot')
            potEditor(obj);
        else {
            boardState[side] = obj.id;
            board();
        }
    }
    else if (item.kind === 'plant')
        detail(obj.id);
    else {
        const sc = workScenes.get(item.location_id), loc = find('locations', sc.id);
        objectEditor(loc, {
            ...item, row: item.row / sc.sy, col: item.col / sc.sx, width: item.width / sc.sx, depth: item.depth / sc.sy
        });
    }
}

function workSurface(host, sc, side, opts = {}) {
    const pref = workPref(sc), scrollKey = (opts.pick ? 'picker' : side) + ':' + sc.id;
    sc.canvas_width = Math.max(sc.canvas_width, pref.canvasWidth || 0);
    sc.canvas_depth = Math.max(sc.canvas_depth, pref.canvasDepth || 0);
    let scale = pref.scale || Math.max(.6, Math.min(5, (host.clientWidth || 650) / Math.min(sc.canvas_width, 220))), gesture = null, ghost = null, lastTap = null, suppressUntil = 0;
    const controls = document.createElement('div');
    controls.className = 'planner-tools';
    host.append(controls);
    const wrap = document.createElement('div');
    wrap.className = 'surfacewrap work-wrap';
    wrap.dataset.scrollKey = scrollKey;
    const plane = document.createElement('div');
    plane.className = 'surface work-plane';
    plane.dataset.workScene = sc.id;
    plane.tabIndex = 0;
    plane.setAttribute('aria-label', sc.name + ' Arbeitsfläche');
    wrap.append(plane);
    host.append(wrap);
    // Ganze Fläche sichtbar machen: Breite UND Höhe berücksichtigen (früher nur die Breite, hohe Flächen wie Regale wurden abgeschnitten)
    const fit = () => Math.max(.03, Math.min(((wrap.clientWidth || host.clientWidth || 500) - 20) / sc.canvas_width, ((wrap.clientHeight || 480) - 20) / sc.canvas_depth));
    if (sc.shelf) {
        wrap.classList.add('work-shelf');
        if (!pref.scale)
            scale = fit();
    }
    const selected = document.createElement('div');
    selected.className = 'work-selection actions';
    selected.setAttribute('aria-live', 'polite');
    host.append(selected);
    const resize = n => {
        scale = Math.max(.03, Math.min(60, n));
        pref.scale = scale;
        paint();
    };
    controls.append(button('−', () => resize(scale / 1.4), 'secondary'), button('＋', () => resize(scale * 1.4), 'secondary'), button('Übersicht', () => resize(fit()), 'secondary'));
    for (const [key, title] of [['grid', 'Raster'], ['snap', 'Einrasten']]) {
        const l = document.createElement('label');
        l.className = 'inlinecheck';
        const i = document.createElement('input');
        i.type = 'checkbox';
        i.checked = pref[key];
        i.onchange = () => {
            pref[key] = i.checked;
            paint();
        };
        l.append(i, title);
        controls.append(l);
    }
    const label = document.createElement('label');
    label.textContent = 'Einraststufe';
    const range = document.createElement('input');
    range.type = 'range';
    range.min = 1;
    range.max = 6;
    range.step = 1;
    range.value = pref.level;
    label.append(range);
    controls.append(label);
    const input = document.createElement('input');
    input.type = 'number';
    input.min = .01;
    input.step = 'any';
    input.value = pref.step;
    input.setAttribute('aria-label', 'Einrasten in cm');
    controls.append(input);
    range.oninput = () => {
        pref.level = Number(range.value);
        pref.step = [.1, .25, .5, .75, 1, sc.step || 7][pref.level - 1];
        input.value = pref.step;
        paint();
    };
    input.onchange = () => {
        if (input.reportValidity()) {
            pref.step = Number(input.value);
            paint();
        }
    };
    function box(el, a) {
        Object.assign(el.style, {
            left: a.col * scale + 'px', top: a.row * scale + 'px', width: a.width * scale + 'px', height: a.depth * scale + 'px'
        });
    }
    function paint() {
        plane.replaceChildren();
        plane.dataset.workScale = scale;
        plane.style.width = sc.canvas_width * scale + 'px';
        plane.style.height = sc.canvas_depth * scale + 'px';
        plane.style.backgroundSize = pref.step * scale + 'px ' + pref.step * scale + 'px';
        plane.style.backgroundImage = pref.grid ? '' : 'none';
        if (sc.bounded) {
            const boundary = document.createElement('div');
            boundary.className = 'work-boundary';
            box(boundary, {
                col: 0, row: 0, width: sc.width, depth: sc.depth
            });
            if (sc.shape === 'round')
                boundary.style.borderRadius = '50%';
            plane.append(boundary);
            if (!sc.fixed) {
                const l = document.createElement('span');
                l.className = 'work-loose-label';
                l.textContent = 'Freie Ablage · weiterhin ' + sc.name;
                Object.assign(l.style, { left: (sc.width + 4) * scale + 'px', top: '2px' });
                plane.append(l);
            }
        }
        if (sc.fixed) {
            plane.style.backgroundImage = 'none';
            const loc = find('locations', sc.id);
            if (loc && !loc.model_pending) {
                for (let r = 0; r < loc.rows; r++)
                    for (let c = 0; c < loc.cols; c++) {
                        const cell = document.createElement('div');
                        cell.className = 'work-empty-cell';
                        if (loc.type === 'pot' && loc.shape === 'round')
                            cell.style.borderRadius = '50%';
                        cell.title = coord(r, c) + ' · Leer';
                        box(cell, {
                            col: c * sc.sx, row: r * sc.sy, width: sc.sx, depth: sc.sy
                        });
                        plane.append(cell);
                    }
            }
            else {
                const hint = document.createElement('span');
                hint.textContent = 'Zellmodell noch auswählen';
                plane.append(hint);
            }
        }
        for (const z of db.zones.filter(z => z.location_id === sc.id))
            for (const a of z.areas) {
                const mark = document.createElement('div');
                mark.className = 'zonepaint' + (z.shelf_level ? ' shelf-level' : '');
                mark.textContent = z.name;
                box(mark, {
                    col: a.col * sc.sx, row: a.row * sc.sy, width: a.width * sc.sx, depth: a.depth * sc.sy
                });
                plane.append(mark);
            }
        for (const item of sc.items) {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'work-object ' + item.mode + ' status-' + workStatus(item) + (item.shape === 'round' ? ' work-round' : '');
            b.dataset.workKey = item.key;
            b.style.setProperty('--object-border', workBorder(item));
            b.title = item.name + ' · ' + statusLabels[workStatus(item)] + (workObject(item)?.shelf ? ' · Regal mit ' + workObject(item).shelf.enabled.filter(Boolean).length + ' Ebenen' : '') + (workObject(item)?.model_pending ? ' · Zellmodell noch offen' : '') + (item.unknown ? ' · Außenmaße noch festlegen' : '');
            b.setAttribute('aria-label', b.title);
            const fixedLoc = sc.fixed && find('locations', sc.id);
            if (fixedLoc?.type === 'pot' && fixedLoc.shape === 'round')
                b.classList.add('work-round');
            b.innerHTML = sc.fixed && !item.loose ? '<svg viewBox="0 0 ' + item.width + ' ' + item.depth + '" preserveAspectRatio="none" aria-hidden="true">' + workCellSvg({
                col: 0, row: 0, width: item.width, depth: item.depth
            }, 'pot-outline', fixedLoc?.type === 'pot' && fixedLoc.shape === 'round') + '</svg>' : workIcon(item, scale);
            const text = document.createElement('span');
            text.textContent = item.name;
            b.append(text);
            if (item.width * scale < 45 || item.depth * scale < 35)
                text.hidden = true;
            box(b, item);
            b.onclick = e => {
                e.stopPropagation();
                clickItem(item, e);
            };
            b.ondblclick = e => {
                e.preventDefault();
                e.stopPropagation();
                if (!opts.pick)
                    properties(item);
            };
            plane.append(b);
            if (typeof sowingDecorate === 'function')
                sowingDecorate(b, item, sc, scale);
            if (workSelected?.sc.id === sc.id && workSelected.item.key === item.key || workMulti.has(item.key) || selectionLoc === sc.id && cellsSelected.has(item.row / sc.sy + ':' + item.col / sc.sx))
                b.classList.add('work-selected');
        }
        if (selectionLoc === sc.id)
            for (const a of cellsSelected.values()) {
                const mark = document.createElement('div');
                mark.className = 'selectionmark';
                box(mark, {
                    col: a.col * sc.sx, row: a.row * sc.sy, width: a.width * sc.sx, depth: a.depth * sc.sy
                });
                plane.append(mark);
            }
        const selectedItem = workSelected?.sc.id === sc.id && sc.items.find(x => x.key === workSelected.item.key);
        if (selectedItem && !selectionMode && !workMulti.size)
            rotationFor(selectedItem);
    }
    function properties(item) {
        if (item.kind === 'container') {
            workSelected = {
                item, sc, side
            };
            desktopSelection = { id: item.object_id, side };
            workProperties(workObject(item));
        }
        else
            workOpen(item, side);
    }
    function rotationFor(item) {
        plane.querySelectorAll?.('.work-rotate').forEach(el => el.remove());
        if (opts.pick || item.kind !== 'container' || item.shape === 'round')
            return;
        const obj = workObject(item), b = button('↻', async () => {
            await workRotate(obj);
        }, 'work-rotate');
        b.dataset.workControl = 'true';
        b.title = 'Um 90° drehen';
        b.setAttribute('aria-label', item.name + ' um 90 Grad drehen');
        Object.assign(b.style, { left: Math.max(0, (item.col + item.width) * scale - 12) + 'px', top: Math.max(0, item.row * scale - 12) + 'px' });
        b.onpointerdown = e => e.stopPropagation();
        b.ondblclick = e => {
            e.preventDefault();
            e.stopPropagation();
        };
        const click = b.onclick;
        b.onclick = e => {
            e.stopPropagation();
            click(e);
        };
        plane.append(b);
    }
    function selectItem(item, add = true) {
        if (workMultiSource !== sc.id) {
            clearSelection();
            workMultiSource = sc.id;
        }
        if (add)
            workMulti.set(item.key, item);
        else
            workMulti.delete(item.key);
        if (item.id) {
            selectionLoc = sc.id;
            const a = {
                ...item, row: item.row / sc.sy, col: item.col / sc.sx, width: item.width / sc.sx, depth: item.depth / sc.sy
            }, key = a.row + ':' + a.col;
            if (add)
                cellsSelected.set(key, a);
            else
                cellsSelected.delete(key);
        }
    }
    function clickItem(item, e) {
        if (Date.now() < suppressUntil)
            return;
        if (opts.pick) {
            opts.pick(item.col + item.width / 2, item.row + item.depth / 2);
            return;
        }
        if (selectionMode || e.shiftKey) {
            selectItem(item, !workMulti.has(item.key));
            updateSelectionBar();
            paint();
        }
        else {
            workSelect(item, sc, side, selected);
            paint();
        }
    }
    const pos = e => {
        const r = plane.getBoundingClientRect();
        return { col: (e.clientX - r.left) / scale, row: (e.clientY - r.top) / scale };
    };
    function blank(e) {
        const a = pos(e);
        if (opts.pick)
            return opts.pick(workSnap(a.col, sc), workSnap(a.row, sc));
        if (!selectionMode && sc.fixed && !find('locations', sc.id)?.model_pending) {
            if (typeof sowingSelectEmpty === 'function')
                sowingSelectEmpty(sc, a, side);
            paint();
            return;
        }
        if (selectionMode && sc.id && sc.bounded) {
            const loc = find('locations', sc.id), d = dims(loc);
            toggleSelection(loc, {
                col: Math.floor(a.col / sc.sx / d.step) * d.step, row: Math.floor(a.row / sc.sy / d.step) * d.step, width: d.step, depth: d.step
            }, e);
            paint();
        }
    }
    plane.onclick = e => {
        if (Date.now() < suppressUntil || e.target.closest('[data-work-control]'))
            return;
        const a = pos(e), item = sc.items.findLast(i => workContains(i, a.col, a.row));
        if (item)
            clickItem(item, e);
        else
            blank(e);
    };
    plane.ondblclick = e => {
        if (opts.pick || selectionMode || e.shiftKey || e.target.closest('[data-work-control]'))
            return;
        e.preventDefault();
        const a = pos(e), item = sc.items.findLast(i => workContains(i, a.col, a.row));
        if (item)
            properties(item);
        else
            workInsert(sc, { col: workSnap(a.col, sc), row: workSnap(a.row, sc) });
    };
    plane.ondragstart = e => e.preventDefault();
    plane.onpointerdown = e => {
        if (e.button !== 0 || boardBusy || opts.pick || e.target.closest('[data-work-control]'))
            return;
        const a = pos(e);
        let hit = sc.items.findLast(i => workContains(i, a.col, a.row));
        const plantHandle = e.target.closest('[data-drag-plant]');
        if (plantHandle) {
            const p = find('plants', plantHandle.dataset.dragPlant);
            if (p)
                hit = {
                    kind: 'plant', key: p.id, object_id: p.id, object_version: p.version, name: p.name, col: a.col, row: a.row, width: sc.step || 7, depth: sc.step || 7
                };
        }
        if (selectionMode && !e.shiftKey && hit && !workMulti.has(hit.key))
            return;
        gesture = {
            boxSelect: !!e.shiftKey && !hit, start: a, id: e.pointerId, x: e.clientX, y: e.clientY, left: wrap.scrollLeft, top: wrap.scrollTop, item: hit, group: workMulti.has(hit?.key) && workMulti.size > 1 ? [...workMulti.values()] : null, ox: hit ? a.col - hit.col : 0, oy: hit ? a.row - hit.row : 0, moved: false
        };
        plane.setPointerCapture(e.pointerId);
    };
    plane.onpointermove = e => {
        const g = gesture;
        if (!g)
            return;
        if (Math.hypot(e.clientX - g.x, e.clientY - g.y) > ((g.item?.kind === 'plant' || g.item?.sowing_id) && sc.fixed ? Math.min(5, Math.min(sc.sx, sc.sy) * scale / 4) : 5))
            g.moved = true;
        if (!g.moved)
            return;
        e.preventDefault();
        if (g.boxSelect) {
            const a = pos(e);
            ghost?.remove();
            ghost = document.createElement('div');
            ghost.className = 'selectionmark';
            box(ghost, {
                col: Math.min(a.col, g.start.col), row: Math.min(a.row, g.start.row), width: Math.abs(a.col - g.start.col), depth: Math.abs(a.row - g.start.row)
            });
            plane.append(ghost);
            return;
        }
        if (!g.item) {
            wrap.scrollLeft = g.left - e.clientX + g.x;
            wrap.scrollTop = g.top - e.clientY + g.y;
            return;
        }
        ghost?.remove();
        if (typeof window !== 'undefined' && e.pointerType === 'touch') {
            if (e.clientY < 65)
                window.scrollBy(0, -18);
            else if (e.clientY > window.innerHeight - 65)
                window.scrollBy(0, 18);
        }
        const d = workTarget(e, g.item, g.ox, g.oy);
        if (!d)
            return;
        ghost = document.createElement('div');
        ghost.textContent = g.group?.length > 1 ? g.group.length + ' Objekte' : '';
        ghost.className = 'dropghost ' + (workValid(d.sc, d.area, g.item, d.target) ? 'valid' : 'invalid');
        if (g.item.shape === 'round')
            ghost.style.borderRadius = '50%';
        Object.assign(ghost.style, {
            left: d.area.col * d.scale + 'px', top: d.area.row * d.scale + 'px', width: d.area.width * d.scale + 'px', height: d.area.depth * d.scale + 'px'
        });
        d.plane.append(ghost);
    };
    plane.onpointerup = async (e) => {
        const g = gesture;
        if (!g)
            return;
        gesture = null;
        ghost?.remove();
        if (plane.hasPointerCapture(e.pointerId))
            plane.releasePointerCapture(e.pointerId);
        if (g.boxSelect && g.moved) {
            const a = pos(e), rect = {
                col: Math.min(a.col, g.start.col), row: Math.min(a.row, g.start.row), width: Math.abs(a.col - g.start.col), depth: Math.abs(a.row - g.start.row)
            };
            for (const item of sc.items)
                if (workCollision(rect, item))
                    selectItem(item, true);
            suppressUntil = Date.now() + 300;
            updateSelectionBar();
            paint();
            return;
        }
        if (!g.moved) {
            if (e.pointerType === 'touch' && !g.item && !selectionMode) {
                const now = Date.now();
                if (lastTap && lastTap.key === 'blank' && now - lastTap.time < 350 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 20)
                    workInsert(sc, pos(e));
                lastTap = {
                    key: 'blank', time: now, x: e.clientX, y: e.clientY
                };
            }
            if (e.pointerType === 'touch' && g.item && !selectionMode) {
                const now = Date.now();
                if (lastTap && lastTap.key === g.item.key && now - lastTap.time < 350)
                    properties(g.item);
                lastTap = { key: g.item.key, time: now };
            }
            return;
        }
        e.preventDefault();
        suppressUntil = Date.now() + 300;
        if (!g.item)
            return;
        const d = workTarget(e, g.item, g.ox, g.oy);
        if (!d)
            return;
        boardBusy = true;
        try {
            if (d.sc.legacy)
                return workCalibrate(find('locations', d.sc.id));
            if (g.item.unknown && g.item.kind === 'container')
                return workProperties(workObject(g.item));
            if (g.group?.length) {
                await workMoveBatch(g.group, g.item, d.target);
            }
            else
                await workMove(g.item, d.target);
        }
        catch (err) {
            boardError(err);
        }
        finally {
            boardBusy = false;
        }
    };
    plane.onpointercancel = () => {
        gesture = null;
        ghost?.remove();
    };
    plane.onlostpointercapture = () => {
        gesture = null;
        ghost?.remove();
    };
    plane.onkeydown = e => {
        if (e.key.startsWith('Arrow')) {
            e.preventDefault();
            wrap.scrollBy({ left: e.key === 'ArrowLeft' ? -80 : e.key === 'ArrowRight' ? 80 : 0, top: e.key === 'ArrowUp' ? -80 : e.key === 'ArrowDown' ? 80 : 0 });
        }
    };
    paint();
    const old = workScroll[scrollKey];
    if (old) {
        wrap.scrollLeft = old[0];
        wrap.scrollTop = old[1];
    }
    wrap.onscroll = () => {
        workScroll[scrollKey] = [wrap.scrollLeft, wrap.scrollTop];
        if (!sc.bounded && (wrap.scrollLeft + wrap.clientWidth > plane.clientWidth - 80 || wrap.scrollTop + wrap.clientHeight > plane.clientHeight - 80)) {
            sc.canvas_width += 100;
            sc.canvas_depth += 100;
            pref.canvasWidth = sc.canvas_width;
            pref.canvasDepth = sc.canvas_depth;
            paint();
        }
    };
}
const workRightState = { tab: 'plan', locked: false };
let workRenderingProperties = false;

async function workArrange(sc) {
    if (!canLeave())
        return;
    dirty = false;
    const loc = find('locations', sc.id);
    await api('planner-workspace-arrange', { id: sc.id, version: loc?.version });
    clearSelection();
    await load();
    await board();
}

// 0.19: Standardmäßig ein breites Arbeitsfeld; das zweite Feld (zum Umsetzen zwischen Standorten) wird bei Bedarf zugeschaltet.
let workTwoPane = false;
try {
    workTwoPane = localStorage.getItem('workTwoPane') === '1';
}
catch (e) { }
function workSetTwoPane(on) {
    workTwoPane = !!on;
    try {
        localStorage.setItem('workTwoPane', on ? '1' : '0');
    }
    catch (e) { }
}
// 0.24: Navigations- und Werkzeugleisten über der Fläche ausblenden (Pfad oben bleibt), damit die Fläche höher beginnt
let workBarsHidden = false;
try {
    workBarsHidden = localStorage.getItem('workBarsHidden') === '1';
}
catch (e) { }
function workSetBarsHidden(on) {
    workBarsHidden = !!on;
    try {
        localStorage.setItem('workBarsHidden', on ? '1' : '0');
    }
    catch (e) { }
}
async function board() {
    if (dirty && !canLeave())
        return;
    dirty = false;
    const epoch = ++workEpoch, originPage = page;
    try {
        const scenes = await api('planner-workspace-scenes', { ids: [boardState.left || '', boardState.right || ''] });
        if (epoch !== workEpoch || page !== originPage)
            return;
        for (const wrap of document.querySelectorAll('#boards .work-wrap'))
            if (wrap.dataset.scrollKey)
                workScroll[wrap.dataset.scrollKey] = [wrap.scrollLeft, wrap.scrollTop];
        openLocationPage('board', boardState.left, '<div class="work-topbar"><h2>Standorte & Arbeitsflächen</h2><div id="boardActions" class="actions"></div><div class="status-legend"><span class="empty">□ Leer</span><span class="present">● Besetzt</span><span class="reserved">◇ Reserviert</span><span class="blocked">× Blockiert</span></div></div><div id="selectionBar" class="chosen"></div><details class="help-details"><summary>Bedienhinweise</summary><p class="help">Ziehen: Objekt bewegen · ❧ am Topf ziehen: nur Pflanze bewegen · freie Fläche ziehen: Ansicht bewegen · Klick: auswählen · Shift + Klick: Auswahl ergänzen · Shift + Ziehen: Auswahlrahmen · Doppelklick: Eigenschaften oder Neuanlage. Alle Außenmaße in cm.</p></details><div id="boardMessage" role="status"></div><div class="work-boards" id="boards"></div>');
        if (boardState.right && !workTwoPane)
            workSetTwoPane(true);
        $('#boards')?.classList?.toggle('single', !workTwoPane);
        $('#boards')?.classList?.toggle('bars-hidden', workBarsHidden);
        const actions = $('#boardActions');
        actions.append(button(workBarsHidden ? 'Leisten einblenden' : 'Leisten ausblenden', () => {
            workSetBarsHidden(!workBarsHidden);
            board();
        }, 'secondary'));
        actions.append(button(workTwoPane ? 'Zweites Feld schließen' : 'Zweites Feld öffnen', () => {
            workSetTwoPane(!workTwoPane);
            if (!workTwoPane)
                boardState.right = '';
            board();
        }, 'secondary'));
        actions.append(button(selectionMode ? 'Auswahl beenden' : 'Mehrfachauswahl', () => {
            selectionMode = !selectionMode;
            clearSelection();
            board();
        }, 'secondary'));
        if (undoId)
            actions.append(button('Rückgängig', async () => {
                await api('undo', { id: undoId });
                undoId = null;
                clearSelection();
                await load();
                board();
            }, 'secondary'));
        workScenes.clear();
        for (const sc of scenes)
            workScenes.set(sc.id, sc);
        const left = document.createElement('section');
        left.className = 'boardpane';
        $('#boards').append(left);
        workRenderPlan(left, scenes[0], 'left');
        if (workTwoPane) {
            const right = document.createElement('section');
            right.id = 'workRight';
            right.className = 'boardpane';
            $('#boards').append(right);
            await workRenderRight(scenes[1]);
        }
        updateSelectionBar();
    }
    catch (err) {
        boardError(err);
    }
}

function workCalibrate(loc) {
    openDialog('<h2>Platzraster in Zentimeter umrechnen</h2><p>Alle Positionen, Stellflächen und Zonen werden gemeinsam umgerechnet. Beispiel: 7 cm je Rasterplatz macht aus 10 × 5 Plätzen eine Fläche von 70 × 35 cm.</p>');
    const f = document.createElement('form');
    f.innerHTML = '<label>Größe eines Rasterplatzes in cm<input name="step" type="number" min="0.1" step="any" value="7" required></label><button>Raster umrechnen</button>';
    body.append(f);
    f.onsubmit = async (e) => {
        e.preventDefault();
        try {
            await api('planner-workspace-calibrate', {
                id: loc.id, version: loc.version, step: Number(f.elements.step.value)
            });
            dirty = false;
            await load();
            board();
        }
        catch (err) {
            fail(err);
        }
    };
}
async function workPlaceDialog(item) {
    const dialog = document.createElement('dialog');
    dialog.className = 'placepicker';
    dialog.innerHTML = '<h2>Ziel wählen</h2><label>Standort<select></select></label><p>Außenmaße bleiben erhalten. Ziel auf der Arbeitsfläche antippen.</p><div class="work-pick"></div><p class="notice"></p><div class="actions"></div>';
    document.body.append(dialog);
    const select = dialog.querySelector('select');
    select.innerHTML = options(locationOptions(item.kind === 'container' ? item.object_id : undefined), '', 'Parkplatz');
    let target = null, epoch = 0;
    async function draw() {
        const n = ++epoch, sc = (await api('planner-workspace-scenes', { ids: [select.value] }))[0];
        if (n !== epoch)
            return;
        workScenes.set(sc.id, sc);
        target = null;
        const host = dialog.querySelector('.work-pick');
        host.replaceChildren();
        workSurface(host, sc, 'left', {
            pick: (col, row) => {
                target = {
                    location_id: sc.id, col, row, loose: sc.bounded && !sc.fixed && (col >= sc.width || row >= sc.depth)
                };
                dialog.querySelector('.notice').textContent = 'Ziel: x ' + col + ' / y ' + row + ' cm';
            }
        });
    }
    select.onchange = () => draw().catch(fail);
    select.closest('label').hidden = true;
    const cascade = document.createElement('div');
    dialog.insertBefore(cascade, dialog.querySelector('.work-pick'));
    locationCascade(cascade, select.value, id => {
        select.value = id;
        draw().catch(fail);
    }, { exclude: item.kind === 'container' ? item.object_id : undefined });
    dialog.querySelector('.actions').append(button('Hier abstellen', async () => {
        if (!target)
            throw Error('Bitte zuerst einen Punkt wählen.');
        await workMove(item, target);
        dialog.close();
        dialog.remove();
    }), button('Abbrechen', () => {
        dialog.close();
        dialog.remove();
    }, 'secondary'));
    dialog.addEventListener('cancel', () => dialog.remove());
    dialog.showModal();
    await draw();
}
function workFamilySize(family) {
    const counts = new Map();
    for (const t of db.templates.filter(t => t.type === 'quickpot' && t.family === family)) {
        const k = t.width + '|' + t.depth;
        counts.set(k, (counts.get(k) || 0) + 1);
    }
    const k = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
    return k ? k.split('|').map(Number) : [51.5, 33.5];
}
function workInsert(sc, anchor = null, multiple = false) {
    if (sc.legacy)
        return workCalibrate(find('locations', sc.id));
    if (sc.fixed) {
        const loc = find('locations', sc.id);
        if (loc.model_pending)
            return workModel(loc);
        openDialog('<h2>Pflanze einer Zelle zuordnen</h2>');
        const row = Math.floor((anchor?.row || 0) / sc.sy), col = Math.floor((anchor?.col || 0) / sc.sx);
        if (row >= loc.rows || col >= loc.cols) {
            body.append('Bitte eine Zelle innerhalb der Platte wählen.');
            return;
        }
        assignPlantUI(body, {
            location_id: sc.id, row, col, width: 1, depth: 1
        }, board);
        return;
    }
    insertDialog(sc, anchor, multiple);
}

const workOldPot = potEditor;
potEditor = function (obj) {
    workOldPot(obj);
    $('#locationContent').append(button('Außenmaße / Eigenschaften', () => workProperties(obj), 'secondary'));
};
const workOldDetail = locationDetail;
locationDetail = function (id) {
    workOldDetail(id);
    const obj = find('locations', id);
    if (obj && obj.type !== 'pot') {
        const host = $('#locationContent');
        host?.append(button('Arbeitsfläche öffnen', () => locationVisit(id)), button('Außenmaße / Plattenmodell', () => workProperties(obj), 'secondary'));
    }
};
// Shape-aware validation also applies to the older plant-placement form.
function validArea(loc, a, ignorePlant = '', ignoreContainer = '', reserved = []) {
    const d = dims(loc);
    if (![a.row, a.col, a.width, a.depth].every(Number.isFinite) || a.width <= 0 || a.depth <= 0 || a.row < 0 || a.col < 0 || a.col + a.width > d.w + 1e-8 || a.row + a.depth > d.h + 1e-8)
        return false;
    const shape = find('locations', ignoreContainer)?.shape;
    const candidate = { ...a, shape };
    if (db.zones.filter(z => z.location_id === loc.id && z.areas.some(x => intersect(a, areaOf(x)))).length > 1)
        return false;
    if (reserved.some(x => x.location_id === loc.id && x.row != null && workCollision(candidate, areaOf(x))))
        return false;
    return !db.cells.some(x => x.location_id === loc.id && !(ignorePlant && x.plant_id === ignorePlant && ['present', 'planned'].includes(x.mode)) && !(ignoreContainer && x.container_id === ignoreContainer) && workCollision(candidate, { ...areaOf(x), shape: find('locations', x.container_id)?.shape }));
}
// All entry points for moving a container use the same physical workspace picker.
async function containerPicker(obj, initialLocation) {
    const source = (await api('planner-workspace-scenes', { ids: [obj.parent_id || ''] }))[0];
    let item = source.items.find(x => x.object_id === obj.id);
    if (!item) {
        const f = obj.footprint?.unit === 'cm' ? obj.footprint : obj.unit === 'cm' ? { width: obj.width_cm, depth: obj.depth_cm } : null;
        if (!f)
            return workProperties(obj);
        item = {
            kind: 'container', object_id: obj.id, object_version: obj.version, name: obj.name, shape: obj.shape || 'rectangle', ...f
        };
    }
    if (item.unknown)
        return workProperties(obj);
    return workPlaceDialog(item);
}
async function newObjects(loc = null, anchor = null, multiple = false) {
    const sc = (await api('planner-workspace-scenes', { ids: [loc?.id || ''] }))[0];
    workInsert(sc, anchor, multiple);
}
async function choosePlace(opts, accept) {
    await load();
    const dialog = document.createElement('dialog');
    dialog.className = 'placepicker';
    dialog.innerHTML = '<h2>Standort und Platz wählen</h2><p class="help">Topf oder QuickPot-Zelle antippen, oder eine freie Stelle wählen. Deine Eingaben werden erst beim Speichern des Pflanzenformulars übernommen.</p><label>Standort<select class="pick-location"></select></label><div class="work-pick"></div><p class="notice"></p><p class="picker-error" role="alert"></p><div class="actions"></div>';
    document.body.append(dialog);
    const select = dialog.querySelector('select'), notice = dialog.querySelector('.notice'), error = dialog.querySelector('.picker-error');
    select.innerHTML = options(locationOptions(opts.containerId), opts.initial?.location_id || '', 'Parkplatz / unzugeordnet');
    let target = opts.initial || {}, epoch = 0;
    async function draw() {
        const serial = ++epoch, sc = (await api('planner-workspace-scenes', { ids: [select.value] }))[0];
        if (serial !== epoch)
            return;
        workScenes.set(sc.id, sc);
        target = { location_id: sc.id };
        notice.textContent = sc.id ? 'Ohne festen Platz diesem Standort zuordnen' : 'Nicht zugeordnet';
        error.textContent = '';
        const host = dialog.querySelector('.work-pick');
        host.replaceChildren();
        workSurface(host, sc, 'left', {
            pick: (col, row) => {
                try {
                    const hit = sc.items.findLast(x => workContains(x, col, row));
                    const pot = hit?.kind === 'container' ? find('locations', hit.object_id) : null;
                    if (pot?.type === 'pot' && !opts.containerId) {
                        if (db.plants.some(p => p.location_id === pot.id && p.id !== opts.plantId))
                            throw Error('Dieser Topf ist bereits belegt.');
                        target = {
                            location_id: pot.id, row: 0, col: 0, width: 1, depth: 1
                        };
                    }
                    else if (sc.fixed) {
                        const loc = find('locations', sc.id);
                        if (loc.model_pending)
                            throw Error('Bitte zuerst ein QuickPot-Modell auswählen.');
                        const a = {
                            row: Math.floor(row / sc.sy), col: Math.floor(col / sc.sx), width: 1, depth: 1
                        };
                        if (!validArea(loc, a, opts.plantId, opts.containerId, opts.reserved || []))
                            throw Error('Die Zelle ist belegt oder liegt außerhalb.');
                        target = { location_id: sc.id, ...a };
                    }
                    else if (sc.legacy)
                        throw Error('Dieses Raster zuerst unter Standorte in cm umrechnen.');
                    else if (!sc.bounded || col >= sc.width || row >= sc.depth)
                        target = { location_id: sc.id };
                    else {
                        const fp = find('plants', opts.plantId)?.footprint;
                        const a = {
                            col, row, width: fp?.unit === 'cm' ? fp.width : sc.step, depth: fp?.unit === 'cm' ? fp.depth : sc.step
                        };
                        if (!validArea(find('locations', sc.id), a, opts.plantId, opts.containerId, opts.reserved || []))
                            throw Error('Diese Stellfläche ist belegt oder zu klein.');
                        target = { location_id: sc.id, ...a };
                    }
                    if ((opts.reserved || []).some(x => x.location_id === target.location_id && x.row === target.row && x.col === target.col && target.row != null))
                        throw Error('Dieser Platz ist bereits für einen anderen neuen Horst ausgewählt.');
                    notice.textContent = targetText(target);
                    error.textContent = '';
                }
                catch (err) {
                    error.textContent = err.message;
                    target = null;
                }
            }
        });
    }
    select.onchange = () => draw().catch(err => error.textContent = err.message);
    select.closest('label').hidden = true;
    const cascade = document.createElement('div');
    dialog.insertBefore(cascade, dialog.querySelector('.work-pick'));
    locationCascade(cascade, select.value, id => {
        select.value = id;
        draw().catch(err => error.textContent = err.message);
    }, { exclude: opts.containerId });
    const actions = dialog.querySelector('.actions');
    actions.append(button('Platz übernehmen', async () => {
        if (!target)
            throw Error('Bitte einen gültigen Platz wählen.');
        await accept(target);
        dialog.close();
        dialog.remove();
    }), button('Nur Standort', async () => {
        await accept(select.value ? { location_id: select.value } : {});
        dialog.close();
        dialog.remove();
    }, 'secondary'), button('Abbrechen', () => {
        dialog.close();
        dialog.remove();
    }, 'secondary'));
    if (!opts.containerId)
        actions.append(button('Neuen leeren Topf erstellen', () => createPotForPlacement(dialog, accept), 'secondary'));
    dialog.addEventListener('cancel', () => dialog.remove());
    dialog.showModal();
    await draw();
}
const workClearSelection = clearSelection;
clearSelection = function () {
    workClearSelection();
    workMulti.clear();
    workMultiSource = null;
};
async function workMoveBatch(items, anchor, target) {
    const entries = items.filter(x => ['container', 'plant'].includes(x.kind)).map(x => ({
        kind: x.kind, id: x.object_id, version: x.object_version, target: {
            ...target, col: target.col + x.col - anchor.col, row: target.row + x.row - anchor.row
        }
    }));
    if (entries.length !== items.length)
        throw Error('Nur Töpfe, Behälter und Pflanzen gemeinsam verschieben.');
    await api('planner-workspace-batch', { entries });
    clearSelection();
    await load();
    await board();
}
onSelectionBar(function () {
    const bar = $('#selectionBar');
    if (!bar || !workMulti.size)
        return;
    const info = document.createElement('p');
    info.textContent = workMulti.size + ' Objekte: Ein ausgewähltes Objekt ziehen, um die Gruppe gemeinsam zu verschieben.';
    bar.append(info, button('Ausgewählte Objekte auf Parkplatz', async () => {
        const items = [...workMulti.values()], sc = (await api('planner-workspace-scenes', { ids: [''] }))[0], x = Math.min(...items.map(i => i.col)), y = Math.min(...items.map(i => i.row));
        await workMoveBatch(items, { col: x, row: y }, {
            location_id: '', col: 0, row: Math.max(0, ...sc.items.map(i => i.row + i.depth)) + 10
        });
    }, 'secondary'), button('Objektauswahl aufheben', () => {
        clearSelection();
        board();
    }, 'secondary'));
});

