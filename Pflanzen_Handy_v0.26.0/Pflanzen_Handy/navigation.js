/* Persistente Standortseite; Eingaben bleiben kleine Dialoge darüber. */
let locationView = {
    mode: 'overview', id: '', left: '', right: '', scroll: 0
}, locationTrail = [], restoringLocation = false;
const originalLocationOverview = locationManagement;
function locationSnapshot() {
    return { ...locationView, scroll: window.scrollY };
}
function rememberLocationView(mode, id) {
    if (!restoringLocation && (locationView.mode !== mode || locationView.id !== id || locationView.left !== boardState.left || locationView.right !== boardState.right))
        locationTrail.push(locationSnapshot());
    locationView = {
        mode, id, left: boardState.left, right: boardState.right, scroll: locationView.mode === mode && locationView.id === id ? window.scrollY : 0
    };
}
function openLocationPage(mode, id, html) {
    rememberLocationView(mode, id || '');
    page = 'locations';
    modal.close();
    pendingPhotos = [];
    renderHeader();
    if ($('#parkingBadge'))
        $('#parkingBadge').textContent = 'Parkplatz: ' + db.plants.filter(p => p.status === 'active' && !p.location_id).length;
    app.innerHTML = '<nav id="locationCrumbs" aria-label="Standortpfad"></nav><section class="panel" id="locationContent"></section>';
    const host = $('#locationContent');
    host.innerHTML = html;
    locationBreadcrumbs();
    const y = locationView.scroll;
    requestAnimationFrame(() => window.scrollTo(0, y));
    return host;
}
function locationBreadcrumbs() {
    const bar = $('#locationCrumbs');
    if (!bar)
        return;
    bar.append(button('← Zurück', locationBack, 'secondary'), button('Alle Standorte', locationRoot, 'secondary'));
    if (locationView.mode === 'board')
        return;
    let id = locationView.id, chain = [], seen = new Set();
    while (id && !seen.has(id)) {
        seen.add(id);
        const l = find('locations', id);
        if (!l)
            break;
        chain.unshift(l);
        id = l.parent_id;
    }
    for (const l of chain)
        bar.append(button(l.name, () => locationVisit(l.id), l.id === locationView.id ? 'active' : 'secondary'));
}

function locationRoot() {
    if (!canLeave())
        return;
    dirty = false;
    rememberLocationView('overview', '');
    page = 'locations';
    modal.close();
    render();
    window.scrollTo(0, 0);
}
function locationBack() {
    if (!canLeave())
        return;
    dirty = false;
    modal.close();
    let prior = locationTrail.pop();
    if (!prior) {
        const parent = find('locations', locationView.id)?.parent_id;
        if (parent)
            return locationVisit(parent);
        return locationRoot();
    }
    while (prior.id && !find('locations', prior.id) && locationTrail.length)
        prior = locationTrail.pop();
    locationView = prior;
    boardState.left = prior.left || '';
    boardState.right = prior.right || '';
    page = 'locations';
    restoringLocation = true;
    try {
        render();
    }
    finally {
        restoringLocation = false;
    }
    requestAnimationFrame(() => window.scrollTo(0, prior.scroll || 0));
}
locationManagement = function () {
    if (locationView.id && !find('locations', locationView.id))
        locationView = {
            mode: 'overview', id: '', scroll: 0
        };
    const view = { ...locationView };
    restoringLocation = true;
    try {
        if (view.mode === 'board') {
            boardState.left = view.left || view.id;
            boardState.right = view.right || '';
            board();
        }
        else if (view.mode === 'pot')
            potEditor(find('locations', view.id));
        else if (view.mode === 'details')
            locationDetail(view.id);
        else
            originalLocationOverview();
    }
    finally {
        restoringLocation = false;
    }
};
// A topf can be created from plant placement without replacing the plant form.

function createPotForPlacement(picker, accept) {
    const dialog = document.createElement('dialog');
    dialog.className = 'placepicker';
    dialog.innerHTML = '<h2>Neuen Topf erstellen</h2><p>Der Topf wird zunächst unzugeordnet angelegt. Die Pflanze wird erst beim Speichern ihres Formulars zugeordnet.</p><form class="formgrid"><label>Name<input name="name" value="Neuer Topf" required></label><label>Form<select name="shape"><option value="square">Quadratisch</option><option value="round">Rund</option><option value="rectangle">Rechteckig</option></select></label><label>Breite / Durchmesser in cm<input name="width" type="number" min="0.1" step="any" value="7" required></label><label>Tiefe in cm<input name="depth" type="number" min="0.1" step="any" value="7" required></label><button>Topf erstellen und auswählen</button></form><div class="actions"></div><p class="errorbox" hidden></p>';
    document.body.append(dialog);
    const f = dialog.querySelector('form');
    const sync = () => {
        const same = f.elements.shape.value !== 'rectangle';
        f.elements.depth.readOnly = same;
        if (same)
            f.elements.depth.value = f.elements.width.value;
    };
    f.oninput = sync;
    sync();
    dialog.querySelector('.actions').append(button('Abbrechen', () => {
        dialog.close();
        dialog.remove();
    }, 'secondary'));
    dialog.addEventListener('cancel', () => dialog.remove());
    let saved = null;
    f.onsubmit = async (e) => {
        e.preventDefault();
        const b = f.querySelector('button');
        b.disabled = true;
        try {
            if (!saved) {
                const rows = await api('planner-create', {
                    ...Object.fromEntries(new FormData(f)), unit: 'cm', count: 1
                });
                saved = rows[0];
                for (const el of f.querySelectorAll('input,select'))
                    el.disabled = true;
            }
            await load();
            await accept({
                location_id: saved.id, row: 0, col: 0, width: 1, depth: 1
            });
            dialog.close();
            dialog.remove();
            picker.close();
            picker.remove();
        }
        catch (err) {
            const n = dialog.querySelector('.errorbox');
            n.hidden = false;
            n.textContent = err.message;
        }
        finally {
            b.disabled = false;
        }
    };
    dialog.showModal();
}
