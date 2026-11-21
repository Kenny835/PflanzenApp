/* Desktop 0.12: independent panes and one shared inspector. */
let desktopSelection = null;

// Der Weg vom Hauptstandort bis zum Standort, von oben nach unten
function desktopChain(id) {
    const chain = [];
    for (let l = id && find('locations', id), guard = 0; l && guard < 20; l = l.parent_id && find('locations', l.parent_id), guard++)
        chain.unshift(l);
    return chain;
}
function desktopHeader(sc, side, host) {
    // Titelzeile mit anklickbarem Pfad, darunter die Gruppe "Ort" und die enthaltenen Behälter: links wie rechts gleich.
    const title = document.createElement('div');
    title.className = 'pane-title';
    const where = document.createElement('span');
    where.className = 'pane-side';
    where.textContent = side === 'left' ? 'Links' : 'Rechts';
    title.append(where);
    const chain = desktopChain(sc.id);
    if (!chain.length) {
        const here = document.createElement('strong');
        here.textContent = 'Parkplatz';
        title.append(here);
    }
    chain.forEach((l, i) => {
        if (i)
            title.append(' › ');
        if (i === chain.length - 1) {
            const here = document.createElement('strong');
            here.textContent = l.name;
            here.setAttribute('aria-current', 'page');
            title.append(here);
        }
        else
            title.append(button(l.name, () => desktopNavigate(side, l.id), 'crumb'));
    });
    host.append(title);
    const nav = document.createElement('div');
    nav.className = 'desktop-path pane-nav';
    host.append(nav);
    const parent = sc.id && find('locations', sc.id)?.parent_id;
    if (parent)
        nav.append(button('↑ Übergeordnet', () => desktopNavigate(side, parent), 'secondary'));
    nav.append(button('Standort wechseln', () => desktopChoose(side), 'secondary'), button('Parkplatz', () => desktopNavigate(side, ''), 'secondary'));
    if (sc.id) {
        nav.append(button('Eigenschaften', () => {
            desktopSelection = { side, id: sc.id };
            workProperties(find('locations', sc.id));
        }, 'secondary'), button('Dokumentation', () => locationDetail(sc.id), 'secondary'));
        // Ein Klick tiefer: enthaltene Tische, Trays, Regale und Platten (Töpfe nicht, die öffnet man selten für sich)
        const kids = db.locations.filter(l => l.parent_id === sc.id && !l.parked && l.type !== 'pot');
        if (kids.length) {
            const row = document.createElement('div');
            row.className = 'pane-children';
            for (const l of kids.slice(0, 10))
                row.append(button(l.name, () => desktopNavigate(side, l.id), 'secondary'));
            if (kids.length > 10)
                row.append(button('+' + (kids.length - 10) + ' weitere …', () => desktopChoose(side), 'secondary'));
            host.append(row);
        }
    }
}
async function desktopNavigate(side, id) {
    if (!canLeave())
        return;
    dirty = false;
    boardState[side] = id;
    if (side === 'right' && typeof workSetTwoPane === 'function')
        workSetTwoPane(true);
    clearSelection();
    await board();
}
function desktopChoose(side) {
    openDialog('<h2>Standort wechseln · ' + (side === 'left' ? 'links' : 'rechts') + '</h2>');
    const input = document.createElement('input');
    input.type = 'search';
    input.placeholder = 'Standort oder Behälter suchen';
    input.setAttribute('aria-label', 'Standortsuche');
    body.append(input);
    const results = document.createElement('div'), tree = document.createElement('div');
    body.append(results, tree);
    const choose = id => {
        dirty = false;
        modal.close();
        desktopNavigate(side, id);
    };
    locationCascade(tree, boardState[side] || '', choose);
    input.oninput = () => {
        results.replaceChildren();
        tree.hidden = !!input.value;
        const q = input.value.toLocaleLowerCase('de');
        if (q)
            for (const l of db.locations.filter(x => locationPath(x.id).toLocaleLowerCase('de').includes(q)).slice(0, 80))
                results.append(button(locationPath(l.id), () => choose(l.id), 'secondary'));
    };
    body.append(button('Abbrechen', () => {
        dirty = false;
        modal.close();
    }, 'secondary'));
}
function workRenderPlan(host, sc, side) {
    desktopHeader(sc, side, host);
    // Gruppe "Bearbeiten": Hauptaktion zuerst, dann Erzeugen, Anordnen, Zuweisen.
    const tools = document.createElement('div');
    tools.className = 'actions pane-tools';
    host.append(tools);
    if (sc.legacy)
        tools.append(button('Raster in cm umrechnen', () => workCalibrate(find('locations', sc.id))));
    if (!sc.fixed)
        tools.append(button('＋ Behälter', () => workInsert(sc)), button('Mehrfacherzeugung', () => workInsert(sc, null, true), 'secondary'));
    tools.append(button('Automatisch anordnen', () => workArrange(sc), 'secondary'));
    if (sc.id)
        tools.append(button('Aussaat zuweisen', () => sowingAssignDialog(sc.id, '', selectionLoc === sc.id ? [...cellsSelected.values()].filter(a => !a.id).map(a => ({
            row: a.row, col: a.col, width: a.width, depth: a.depth
        })) : null), 'secondary'));
    workSurface(host, sc, side);
}
async function workRenderRight(preloaded) {
    const host = $('#workRight');
    if (!host)
        return;
    const sc = preloaded || (await api('planner-workspace-scenes', { ids: [boardState.right || ''] }))[0];
    host.replaceChildren();
    workScenes.set(sc.id, sc);
    workRenderPlan(host, sc, 'right');
}
const desktopBoard = board;
board = async function () {
    const before = $('#boards'), epoch = workEpoch + 1;
    await desktopBoard();
    if (!$('#boards') || $('#boards') === before || workEpoch !== epoch)
        return;
    if (typeof workPhone === 'function' && workPhone()) {
        desktopSelection = null;
        return;
    }
    const host = document.createElement('section');
    host.id = 'workInspector';
    host.className = 'desktop-inspector';
    host.innerHTML = '<h3>Eigenschaften</h3><p>Links oder rechts ein Objekt auswählen.</p>';
    $('#boards').after(host);
    if (desktopSelection) {
        const obj = find('locations', desktopSelection.id);
        if (obj)
            workProperties(obj);
        else
            desktopSelection = null;
    }
};
const desktopProperties = workProperties;
workProperties = function (obj) {
    if (!obj)
        return;
    if (!desktopSelection || desktopSelection.id !== obj.id)
        desktopSelection = { id: obj.id, side: workSelected?.side || 'left' };
    workRenderingProperties = true;
    try {
        desktopProperties(obj);
    }
    finally {
        workRenderingProperties = false;
    }
    const host = $('#workInspector') || body;
    const source = document.createElement('p');
    source.className = 'badge';
    source.textContent = $('#workInspector') ? 'Auswahl aus Arbeitsfeld ' + (desktopSelection.side === 'right' ? 'rechts' : 'links') : 'Behältereigenschaften';
    host.prepend(source);
    const tools = host.querySelector('.actions');
    if (tools) {
        const old = tools.querySelector('button');
        if (old) {
            old.textContent = 'Hier öffnen';
            old.onclick = () => desktopNavigate(desktopSelection.side, obj.id);
            tools.insertBefore(button(desktopSelection.side === 'left' ? 'Rechts öffnen' : 'Links öffnen', () => desktopNavigate(desktopSelection.side === 'left' ? 'right' : 'left', obj.id), 'secondary'), old.nextSibling);
        }
        tools.append(button('Leer duplizieren', async () => {
            if (!canLeave())
                return;
            const copy = await api('planner-sowing-duplicate', { id: obj.id, version: obj.version });
            dirty = false;
            await load();
            await board();
            message('„' + copy.name + '“ liegt ohne Belegung auf dem Parkplatz.');
        }, 'secondary'));
        tools.append(button('QR-Code', () => qrDialog('loc', obj), 'secondary'));
    }
};

function workSelect(item, sc, side, host) {
    if (!canLeave())
        return;
    dirty = false;
    clearSelection();
    workSelected = {
        item, sc, side
    };
    host.replaceChildren();
    const title = document.createElement('strong');
    title.textContent = item.name;
    host.append(title);
    // Handy: Aktionsfenster statt Auswahl unter der Fläche (phone_actions.js)
    if (typeof workPhone === 'function' && workPhone() && workActionSheet(item, sc, side)) {
        desktopSelection = null;
        return;
    }
    if (item.kind === 'container') {
        desktopSelection = { id: item.object_id, side };
        workProperties(workObject(item));
        host.append(button('Hier öffnen', () => desktopNavigate(side, item.object_id), 'secondary'), button(side === 'left' ? 'Rechts öffnen' : 'Links öffnen', () => desktopNavigate(side === 'left' ? 'right' : 'left', item.object_id), 'secondary'));
        const p = db.plants.find(p => p.location_id === item.object_id && (p.status || 'active') === 'active');
        if (p && workObject(item)?.type === 'pot')
            host.append(button('Pflanze verschieben', () => workPlaceDialog({
                kind: 'plant', object_id: p.id, object_version: p.version, name: p.name, width: 1, depth: 1
            }), 'secondary'));
    }
    else {
        desktopSelection = null;
        const inspector = $('#workInspector');
        if (inspector) {
            inspector.replaceChildren();
            const title = document.createElement('h3');
            title.textContent = (side === 'left' ? 'Links' : 'Rechts') + ' · ' + item.name;
            inspector.append(title);
            if (item.sowing_id)
                sowingCellInspector(inspector, item, sc);
            else if (item.kind === 'plant') {
                const p = workObject(item);
                inspector.append(contact(p), button('Pflanze bearbeiten', () => detail(p.id), 'secondary'), button('Ziel wählen', () => workPlaceDialog(item), 'secondary'), button('Aus Planer entfernen', () => workUnassignPlants([p]), 'secondary'));
                if (p.sowing_id)
                    inspector.append(button('Herkunft: ' + label('sowings', p.sowing_id), () => sowingDetail(find('sowings', p.sowing_id)), 'secondary'));
            }
            else
                inspector.append(button('Zelle bearbeiten', () => workOpen(item, side), 'secondary'));
        }
    }
}
function locationVisit(id) {
    if (!canLeave())
        return;
    dirty = false;
    boardState.left = id;
    board();
}
