/* Structural draft editor: no persisted stock records until explicit instantiation. */
let builderState = null, builderCommit = () => true;
function ownTemplates() {
    return (db.templates || []).filter(t => !t.catalogue_key);
}
function blueprintOf(t) {
    if (t.unit && t.unit !== 'cm')
        throw Error('Diese Vorlage verwendet Rasterplätze. Zuerst über „Maße bearbeiten“ reale cm-Maße festlegen.');
    return structuredClone(t.blueprint || {
        name: t.name, type: t.type || 'pot', shape: t.shape || 'rectangle', width: t.width, depth: t.depth, rows: t.rows || 1, cols: t.cols || 1, children: []
    });
}
function builderNode() {
    let n = builderState.root;
    for (const i of builderState.path)
        n = n.children[i].node;
    return n;
}
function builderDirty() {
    dirty = true;
}
function builderStart(t = null) {
    if (!canLeave())
        return;
    dirty = false;
    builderState = {
        root: t ? blueprintOf(t) : {
            name: 'Neue Zusammenstellung', type: 'tray', shape: 'rectangle', width: 80, depth: 40, children: []
        }, template: t?.id ? t : null, path: [], selected: null, scale: 6, snap: 1, grid: true
    };
    builderRender();
}
function builderRotate(n) {
    const depth = n.depth;
    [n.width, n.depth] = [n.depth, n.width];
    if (n.type === 'quickpot')
        [n.rows, n.cols] = [n.cols, n.rows];
    for (const ch of n.children || []) {
        [ch.col, ch.row] = [depth - ch.row - ch.node.depth, ch.col];
        builderRotate(ch.node);
    }
}
function builderBox(ch) {
    return {
        col: ch.col, row: ch.row, width: ch.node.width, depth: ch.node.depth, shape: ch.node.shape
    };
}
function builderFits(ch, ignore = -1) {
    const n = builderNode(), a = builderBox(ch);
    return workFits(a, n) && !(n.children || []).some((b, i) => i !== ignore && workCollision(a, builderBox(b)));
}
function builderRender() {
    page = 'templates';
    renderHeader();
    const state = builderState, n = builderNode();
    app.innerHTML = '<section class="panel"><h2>Vorlagenbaukasten</h2><p>Entwurf ohne Pflanzen und Aussaatbelegung. Ziehen bewegt Elemente, Ziehen auf freier Fläche verschiebt die Ansicht. Doppelklick öffnet Eigenschaften. Zentimeter und Einrastung wie im Standortplaner.</p><div id="builderActions" class="actions"></div><div id="builderPath" class="actions"></div><div id="builderTools" class="actions"></div><div class="surfacewrap work-wrap" id="builderWrap"><div class="surface builder-plane" id="builderPlane"></div></div><div id="builderProperties" class="desktop-inspector"></div></section>';
    const actions = $('#builderActions');
    const loadSelect = document.createElement('select');
    loadSelect.setAttribute('aria-label', 'Vorlage laden');
    loadSelect.innerHTML = options(ownTemplates().map(t => [t.id, t.name]), state.template?.id || '', 'Vorlage laden …');
    loadSelect.onchange = () => {
        const t = find('templates', loadSelect.value);
        if (t)
            builderStart(t);
    };
    actions.append(loadSelect, button('Vorlage aktualisieren', () => builderSave(false)), button('Als neue Vorlage speichern', () => builderSave(true)), button('Auf Parkplatz ablegen', builderPark), button('Eigene Vorlagen', () => go('templates'), 'secondary'));
    actions.querySelectorAll('button')[0].disabled = !state.template;
    const path = $('#builderPath');
    path.append(button(state.root.name, () => {
        if (!builderCommit())
            return;
        state.path = [];
        state.selected = null;
        builderRender();
    }, 'secondary'));
    let cursor = state.root;
    state.path.forEach((i, d) => {
        cursor = cursor.children[i].node;
        const name = cursor.name;
        path.append(button(name, () => {
            if (!builderCommit())
                return;
            state.path = state.path.slice(0, d + 1);
            state.selected = null;
            builderRender();
        }, 'secondary'));
    });
    const tools = $('#builderTools');
    tools.append(button('−', () => {
        if (!builderCommit())
            return;
        state.scale = Math.max(.2, state.scale / 1.3);
        builderRender();
    }, 'secondary'), button('＋', () => {
        if (!builderCommit())
            return;
        state.scale = Math.min(30, state.scale * 1.3);
        builderRender();
    }, 'secondary'), button('Außencontainer bearbeiten', () => {
        state.selected = null;
        builderProps();
    }, 'secondary'));
    const snap = document.createElement('select');
    snap.setAttribute('aria-label', 'Einrasten in cm');
    snap.innerHTML = options([[0, 'Frei'], [.1, '0,1 cm'], [.25, '0,25 cm'], [.5, '0,5 cm'], [.75, '0,75 cm'], [1, '1 cm'], [7, '7 cm']], state.snap);
    snap.value = String(state.snap);
    snap.onchange = () => {
        state.snap = Number(snap.value);
        builderPaint();
    };
    tools.append(snap, button(state.grid ? 'Raster ausblenden' : 'Raster einblenden', () => {
        state.grid = !state.grid;
        builderRender();
    }, 'secondary'));
    const choice = document.createElement('select');
    choice.setAttribute('aria-label', 'Baustein hinzufügen');
    choice.innerHTML = options([['site', 'Pflanzstelle'], ['pot', 'Leerer Topf'], ['tray', 'Tray / Blumenkasten'], ['table', 'Tisch'], ...db.templates.filter(t => !t.hidden).map(t => ['t:' + t.id, (t.catalogue_key ? 'Standard: ' : 'Eigene Vorlage: ') + t.name])], 'site');
    choice.value = 'site';
    tools.append(choice, button('＋ Baustein', () => builderAdd(choice.value)));
    builderPaint();
    builderProps();
}
function builderPaint() {
    const state = builderState, n = builderNode(), plane = $('#builderPlane'), wrap = $('#builderWrap');
    if (!plane)
        return;
    plane.replaceChildren();
    const scale = state.scale;
    Object.assign(plane.style, {
        width: Math.max(n.width + 10, 100) * scale + 'px', height: Math.max(n.depth + 10, 60) * scale + 'px', backgroundSize: (state.snap || 1) * scale + 'px ' + (state.snap || 1) * scale + 'px', backgroundImage: state.grid ? '' : 'none'
    });
    const boundary = document.createElement('div');
    boundary.className = 'work-boundary';
    Object.assign(boundary.style, {
        left: 0, top: 0, width: n.width * scale + 'px', height: n.depth * scale + 'px', borderRadius: n.shape === 'round' ? '50%' : '0'
    });
    plane.append(boundary);
    if (n.type === 'quickpot') {
        for (let r = 0; r < n.rows; r++)
            for (let c = 0; c < n.cols; c++) {
                const cell = document.createElement('div');
                cell.className = 'work-empty-cell';
                Object.assign(cell.style, {
                    left: c * n.width / n.cols * scale + 'px', top: r * n.depth / n.rows * scale + 'px', width: n.width / n.cols * scale + 'px', height: n.depth / n.rows * scale + 'px'
                });
                plane.append(cell);
            }
    }
    (n.children || []).forEach((ch, i) => {
        const b = document.createElement('button');
        b.className = 'builder-item' + (state.selected === i ? ' selected' : '');
        b.dataset.builderIndex = i;
        b.textContent = ch.node.name;
        b.title = ch.node.name + ' · ' + ch.node.width + ' × ' + ch.node.depth + ' cm';
        Object.assign(b.style, {
            left: ch.col * scale + 'px', top: ch.row * scale + 'px', width: ch.node.width * scale + 'px', height: ch.node.depth * scale + 'px', borderRadius: ch.node.shape === 'round' ? '50%' : '4px'
        });
        b.onclick = () => {
            if (Date.now() < state.suppress)
                return;
            if (!builderCommit())
                return;
            state.selected = i;
            builderPaint();
            builderProps();
        };
        b.ondblclick = () => {
            state.selected = i;
            builderProps();
        };
        plane.append(b);
    });
    let gesture = null;
    plane.onpointerdown = e => {
        if (e.button !== 0)
            return;
        if (!builderCommit())
            return;
        const b = e.target.closest('[data-builder-index]'), i = b ? Number(b.dataset.builderIndex) : null;
        gesture = {
            id: e.pointerId, x: e.clientX, y: e.clientY, i, left: wrap.scrollLeft, top: wrap.scrollTop, old: i === null ? null : { ...n.children[i] }, moved: false
        };
        plane.setPointerCapture(e.pointerId);
    };
    plane.onpointermove = e => {
        const g = gesture;
        if (!g)
            return;
        const dx = e.clientX - g.x, dy = e.clientY - g.y;
        if (Math.hypot(dx, dy) > 3)
            g.moved = true;
        if (!g.moved)
            return;
        e.preventDefault();
        if (g.i === null) {
            wrap.scrollLeft = g.left - dx;
            wrap.scrollTop = g.top - dy;
            return;
        }
        const round = x => state.snap ? Math.round(x / state.snap) * state.snap : x;
        const ch = {
            ...g.old, col: Math.max(0, round(g.old.col + dx / scale)), row: Math.max(0, round(g.old.row + dy / scale))
        };
        const b = plane.querySelector('[data-builder-index="' + g.i + '"]');
        b.style.left = ch.col * scale + 'px';
        b.style.top = ch.row * scale + 'px';
        b.classList.toggle('invalid', !builderFits(ch, g.i));
        g.next = ch;
    };
    plane.onpointerup = e => {
        const g = gesture;
        if (!g)
            return;
        gesture = null;
        if (plane.hasPointerCapture(e.pointerId))
            plane.releasePointerCapture(e.pointerId);
        if (g.moved) {
            state.suppress = Date.now() + 250;
            if (g.next && builderFits(g.next, g.i)) {
                n.children[g.i] = g.next;
                state.selected = g.i;
                builderDirty();
            }
            builderPaint();
            builderProps();
        }
    };
    plane.onpointercancel = () => {
        gesture = null;
        builderPaint();
    };
    plane.ondragstart = e => e.preventDefault();
}
function builderAdd(value) {
    if (!builderCommit())
        throw Error('Bitte zuerst die Eingaben korrigieren.');
    const n = builderNode();
    if (['site', 'pot', 'quickpot'].includes(n.type))
        throw Error('Feste Pflanzenplätze nehmen keine weiteren Bausteine auf. Über den Pfad einen äußeren Container öffnen.');
    const t = value.startsWith('t:') ? find('templates', value.slice(2)) : null;
    const node = t ? blueprintOf(t) : {
        type: value, name: ({
            site: 'Pflanzstelle', pot: 'Topf', tray: 'Tray', table: 'Tisch'
        })[value], shape: 'square', width: value === 'tray' ? 30 : value === 'table' ? 50 : 7, depth: value === 'tray' ? 30 : value === 'table' ? 50 : 7, children: []
    };
    let chosen = null;
    for (let y = 0; y <= n.depth - node.depth && !chosen; y++)
        for (let x = 0; x <= n.width - node.width; x++) {
            const ch = {
                col: x, row: y, node
            };
            if (builderFits(ch)) {
                chosen = ch;
                break;
            }
        }
    if (!chosen)
        throw Error('Kein freier Platz für diesen Baustein. Außencontainer vergrößern oder kleinere Maße wählen.');
    n.children.push(chosen);
    builderState.selected = n.children.length - 1;
    builderDirty();
    builderPaint();
    builderProps();
}
function builderProps() {
    const state = builderState, n = builderNode(), ch = state.selected === null ? null : n.children[state.selected], obj = ch?.node || n, host = $('#builderProperties');
    host.replaceChildren();
    const title = document.createElement('h3');
    title.textContent = ch ? 'Baustein bearbeiten' : 'Außencontainer bearbeiten';
    host.append(title);
    const f = document.createElement('form');
    f.className = 'formgrid';
    host.append(f);
    for (const spec of [['name', 'Name *'], ['type', 'Typ', 'select', [['table', 'Tisch'], ['tray', 'Tray / Blumenkasten'], ['tub', 'Kübel'], ['pot', 'Topf'], ['site', 'Pflanzstelle'], ['quickpot', 'QuickPot'], ['bed', 'Beet'], ['other', 'Andere']]], ['shape', 'Form', 'select', [['rectangle', 'Rechteckig'], ['square', 'Quadratisch'], ['round', 'Rund']]], ['width', 'Breite / Durchmesser *'], ['depth', 'Tiefe *'], ...(obj.type === 'quickpot' ? [['rows', 'Reihen'], ['cols', 'Spalten']] : []), ...(ch ? [['col', 'Position x'], ['row', 'Position y']] : [])])
        f.append(field(spec, { ...obj, ...(ch ? { col: ch.col, row: ch.row } : {}) }, 'builder'));
    for (const k of ['width', 'depth', 'row', 'col', 'rows', 'cols'])
        if (f.elements[k]) {
            f.elements[k].type = 'number';
            f.elements[k].step = ['rows', 'cols'].includes(k) ? 1 : 'any';
            f.elements[k].min = ['row', 'col'].includes(k) ? 0 : .1;
            f.elements[k].required = true;
        }
    const save = document.createElement('button');
    save.textContent = 'Entwurf übernehmen';
    f.append(save, button('Eingaben verwerfen', builderProps, 'secondary'));
    f.oninput = builderDirty;
    builderCommit = () => {
        if (!f.reportValidity())
            return false;
        const v = Object.fromEntries(new FormData(f)), next = { ...obj, ...v };
        for (const k of ['width', 'depth', 'rows', 'cols'])
            if (k in next)
                next[k] = Number(next[k]);
        if (['square', 'round'].includes(next.shape))
            next.depth = next.width;
        delete next.col;
        delete next.row;
        if (next.type === 'quickpot') {
            next.rows = next.rows || 1;
            next.cols = next.cols || 1;
        }
        if (['pot', 'site', 'quickpot'].includes(next.type) && next.children?.length) {
            message('Unterelemente zuerst entfernen oder als eigene Zusammenstellung speichern.', true);
            return false;
        }
        if (ch) {
            const updated = {
                node: next, col: Number(v.col), row: Number(v.row)
            };
            if (!builderFits(updated, state.selected)) {
                message('Position ist belegt oder außerhalb.', true);
                return false;
            }
            Object.assign(ch, updated);
        }
        else
            Object.assign(n, next);
        builderDirty();
        return true;
    };
    f.onsubmit = e => {
        e.preventDefault();
        if (builderCommit()) {
            builderPaint();
            builderProps();
        }
    };
    if (ch) {
        host.append(button('Inhalt öffnen', () => {
            if (!builderCommit())
                return;
            state.path.push(state.selected);
            state.selected = null;
            builderRender();
        }, 'secondary'), button('Um 90° drehen', () => {
            const old = structuredClone(ch.node);
            builderRotate(ch.node);
            if (!builderFits(ch, state.selected)) {
                ch.node = old;
                throw Error('Gedreht passt das Element hier nicht.');
            }
            builderDirty();
            builderPaint();
            builderProps();
        }, 'secondary'), button('Baustein entfernen', () => {
            if (!confirm('Baustein samt Unterelementen aus dem Entwurf entfernen?'))
                return;
            n.children.splice(state.selected, 1);
            state.selected = null;
            builderDirty();
            builderPaint();
            builderProps();
        }, 'danger'));
    }
}
async function builderSave(asNew) {
    if (!builderCommit())
        throw Error('Bitte zuerst die Eingaben korrigieren.');
    const state = builderState, t = asNew ? null : state.template;
    if (!asNew && !t)
        throw Error('Zuerst als neue Vorlage speichern.');
    const saved = await api('planner-blueprint-save', {
        id: t?.id, version: t?.version, name: state.root.name, blueprint: state.root
    });
    state.template = saved;
    dirty = false;
    await load();
    builderRender();
    message('Vorlage gespeichert. Bereits verwendete Gefäße bleiben unverändert.');
}
async function builderPark() {
    if (!builderCommit())
        throw Error('Bitte zuerst die Eingaben korrigieren.');
    const obj = await api('planner-blueprint-instantiate', { blueprint: builderState.root });
    dirty = false;
    await load();
    message('„' + obj.name + '“ liegt als eigenständiges Gefäß auf dem Parkplatz.');
    builderRender();
}
function templatesManagement() {
    app.innerHTML = '<section class="panel"><h2>Eigene Vorlagen</h2><p>Standardtöpfe und Quickpotplatten stehen beim Hinzufügen eines Gefäßes bereit. Hier werden nur eigene Vorlagen verwaltet.</p><div id="ownTemplateActions" class="actions"></div><div id="ownTemplateList"></div></section>';
    $('#ownTemplateActions').append(button('＋ Vorlagenbaukasten', () => builderStart()), button('Einfache Maßvorlage', () => templateEdit(), 'secondary'));
    const host = $('#ownTemplateList'), list = ownTemplates();
    if (!list.length)
        host.innerHTML = empty('Noch keine eigenen Vorlagen. Eine neue Zusammenstellung im Baukasten erstellen.');
    for (const t of list) {
        const card = document.createElement('article');
        card.className = 'sowing-card';
        card.innerHTML = '<h3>' + esc(t.name) + '</h3><p>' + esc(templateMeasure(t)) + '</p>';
        if (!t.blueprint)
            card.append(button('Maße bearbeiten', () => templateEdit(t), 'secondary'));
        actions(card, [['Vorlage laden', () => builderStart(t)], ['Auf Parkplatz ablegen', async () => {
                    await api('planner-blueprint-instantiate', { id: t.id, version: t.version });
                    await load();
                    message('Neue unabhängige Kopie auf dem Parkplatz.');
                }, 'secondary'], ['Löschen', async () => {
                    if (!confirm('Eigene Vorlage wirklich löschen? Bereits erstellte Gefäße bleiben erhalten.'))
                        return;
                    await api('planner-blueprint-delete', {
                        id: t.id, version: t.version, confirmed: true
                    });
                    await load();
                    templatesManagement();
                }, 'danger']]);
        host.append(card);
    }
}
