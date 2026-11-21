'use strict';
/* Behälter anlegen (Arbeitsfläche): erst die Art wählen, dann nur die passenden Angaben.
   Statt einer Liste mit rund 180 Einträgen (Töpfe, Platten, Vorlagen) gibt es:
   Topf (Form + Größe) · QuickPot-Platte (Maßfamilie + Zellenzahl + Modell) · Tisch · Tray · Regal · Eigene Vorlage.
   Alles Weitere (Typ, Größe, Modell) lässt sich später in den Eigenschaften ändern. */
const insertKinds = [['pot', 'Topf'], ['plate', 'QuickPot-Platte'], ['table', 'Tisch'], ['tray', 'Tray'], ['shelf', 'Regal'], ['own', 'Eigene Vorlage']];
const insertFamilies = ['Standard', 'Dänenmaß'];
let insertLastKind = 'pot';

// Ordnet die Vorlagen für den Dialog: Töpfe nach Form, Platten nach Maßfamilie und Zellenzahl, Eigenes getrennt. Reine Funktion.
function insertCatalogue(templates) {
    const visible = templates.filter(t => !t.hidden);
    const pots = { square: [], round: [] };
    const plates = {};
    const own = [];
    for (const t of visible) {
        if (t.type === 'quickpot' && insertFamilies.includes(t.family))
            ((plates[t.family] ??= {})[t.cell_count] ??= []).push({ id: t.id, version: t.version, name: t.name, width: t.width, depth: t.depth });
        else if (t.type === 'pot' && t.catalogue_key && pots[t.shape])
            pots[t.shape].push({ id: t.id, version: t.version, name: t.name, width: t.width });
        else
            own.push({ id: t.id, version: t.version, name: t.name, width: t.width, depth: t.depth, blueprint: !!t.blueprint });
    }
    for (const list of Object.values(pots))
        list.sort((a, b) => a.width - b.width);
    return { pots, plates, own };
}

const insertNumber = (value, what) => {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0)
        throw Error(what + ': bitte eine Zahl größer 0 angeben.');
    return n;
};

// Aus den Eingaben die Anfrage an den Server bauen. Reine Funktion.
function insertPayload(st, cat) {
    const base = { name: st.name || undefined, count: Number(st.count), per_row: Number(st.perRow), gap: Number(st.gap) || 0 };
    if (st.kind === 'pot') {
        if (st.pot.preset && st.pot.preset !== 'custom') {
            const t = cat.pots[st.pot.shape].find(x => x.id === st.pot.preset);
            if (!t)
                throw Error('Bitte eine Topfgröße wählen.');
            return { ...base, object_type: 'pot', shape: st.pot.shape, template_id: t.id, template_version: t.version };
        }
        const w = insertNumber(st.pot.width, st.pot.shape === 'round' ? 'Durchmesser' : 'Seitenlänge');
        return { ...base, object_type: 'pot', shape: st.pot.shape, width: w, depth: w };
    }
    if (st.kind === 'plate') {
        if (!st.plate.cells)
            return { ...base, object_type: 'pot', family: st.plate.family };
        const t = (cat.plates[st.plate.family]?.[st.plate.cells] || []).find(x => x.id === st.plate.model);
        if (!t)
            throw Error('Bitte ein Modell wählen.');
        return { ...base, object_type: 'pot', template_id: t.id, template_version: t.version };
    }
    if (st.kind === 'table' || st.kind === 'tray')
        return { ...base, object_type: st.kind, shape: 'rectangle', width: insertNumber(st.size[st.kind].width, 'Breite'), depth: insertNumber(st.size[st.kind].depth, 'Tiefe') };
    if (st.kind === 'shelf') {
        const levels = Number(st.shelf.levels);
        if (!Number.isInteger(levels) || levels < 1 || levels > 8)
            throw Error('Anzahl der Ebenen: ganze Zahl von 1 bis 8.');
        return { ...base, count: 1, per_row: 1, object_type: 'shelf', shape: 'rectangle', levels, width: insertNumber(st.shelf.width, 'Breite je Ebene'), depth: insertNumber(st.shelf.depth, 'Tiefe je Ebene'), gap: Number(st.shelf.gap) || 0 };
    }
    const t = cat.own.find(x => x.id === st.own);
    if (!t)
        throw Error('Bitte eine Vorlage wählen.');
    return { ...base, object_type: 'pot', template_id: t.id, template_version: t.version };
}

// Erste Auswahl der Topfgröße: 7 cm, sonst der kleinste Eintrag, ohne Katalog die freie Eingabe
function insertDefaultPot(cat, shape) {
    const list = cat.pots[shape];
    return (list.find(t => t.width === 7) || list[0])?.id || 'custom';
}

function insertDialog(sc, anchor = null, multiple = false) {
    const cat = insertCatalogue(db.templates);
    const kinds = insertKinds.filter(([k]) => !(multiple && k === 'shelf') && !(k === 'own' && !cat.own.some(t => !multiple || !t.blueprint)));
    openDialog('<h2>' + (multiple ? 'Mehrere Behälter anlegen' : 'Behälter anlegen') + '</h2>');
    const family0 = insertFamilies.find(f => cat.plates[f]) || 'Standard';
    const st = {
        kind: kinds.some(([k]) => k === insertLastKind) ? insertLastKind : 'pot', name: '',
        col: anchor?.col ?? (sc.bounded ? sc.width + 20 : 0), row: anchor?.row || 0, count: multiple ? 10 : 1, perRow: multiple ? 5 : 1, gap: 0,
        pot: { shape: 'square', preset: insertDefaultPot(cat, 'square'), width: 7 },
        plate: { family: family0, cells: '', model: '' }, size: { table: { width: 100, depth: 60 }, tray: { width: 53, depth: 31 } },
        shelf: { levels: 8, width: 80, depth: 35, gap: 4 }, own: cat.own.find(t => !multiple || !t.blueprint)?.id || ''
    };
    const f = document.createElement('form');
    f.className = 'formgrid insert-form';
    body.append(f);
    const kindBar = document.createElement('div'), panel = document.createElement('div'), common = document.createElement('div'), hint = document.createElement('p');
    kindBar.className = 'segmented full';
    kindBar.setAttribute('role', 'group');
    kindBar.setAttribute('aria-label', 'Art des Behälters');
    panel.className = 'insert-panel full formgrid';
    common.className = 'insert-common full formgrid';
    hint.className = 'notice full';

    const labeled = (title, control, cls = '') => {
        const l = document.createElement('label'), c = document.createElement('span');
        c.className = 'fieldcaption';
        c.textContent = title;
        l.className = cls;
        l.append(c, control);
        return l;
    };
    const num = (value, set, min = .1, max = 3000, step = 'any') => {
        const i = document.createElement('input');
        Object.assign(i, { type: 'number', value, min, max, step, required: true });
        i.oninput = () => {
            set(i.value);
            hintText();
        };
        return i;
    };
    const select = (items, value, set) => {
        const s = document.createElement('select');
        for (const [v, t] of items)
            s.append(new Option(t, v));
        s.value = value;
        s.onchange = () => set(s.value);
        return s;
    };
    const segmented = (items, value, set, label) => {
        const bar = document.createElement('div');
        bar.className = 'segmented';
        bar.setAttribute('role', 'group');
        bar.setAttribute('aria-label', label);
        for (const [v, t] of items) {
            const b = button(t, () => set(v), 'secondary');
            b.setAttribute('aria-pressed', String(v === value));
            bar.append(b);
        }
        return bar;
    };
    function hintText() {
        const sizeOf = () => st.kind === 'plate' && !st.plate.cells ? workFamilySize(st.plate.family) : null;
        hint.textContent = ({
            pot: 'Töpfe behalten diese Außenmaße beim Verschieben.',
            plate: st.plate.cells ? 'Das Modell legt Größe und Zellenraster fest. Es lässt sich später in den Eigenschaften wechseln.' : 'Planungshülle ' + (sizeOf() || []).join(' × ') + ' cm aus der häufigsten Außenabmessung dieser Maßfamilie. Das Modell kannst du später in den Eigenschaften wählen.',
            table: 'Außenmaße in cm. Ein Tisch hat eine freie Innenfläche für Töpfe und Trays.',
            tray: 'Außenmaße in cm. Ein Tray hat eine freie Innenfläche für Töpfe.',
            shelf: 'Gleich große Ebenen übereinander. Im Standort belegt das Regal nur seine Grundfläche von ' + st.shelf.width + ' × ' + st.shelf.depth + ' cm (eine Ebene); die Ebenen siehst du in der Ansicht des Regals. Insgesamt ' + st.shelf.levels + ' Ebenen, später in den Eigenschaften ein- und ausschaltbar.',
            own: 'Angelegt wird eine Kopie der Struktur der Vorlage ohne Pflanzen.'
        })[st.kind];
    }
    function renderPanel() {
        panel.replaceChildren();
        if (st.kind === 'pot') {
            const sizes = cat.pots[st.pot.shape].map(t => [t.id, st.pot.shape === 'round' ? 'Ø ' + t.width + ' cm' : t.width + ' × ' + t.width + ' cm']);
            panel.append(
                labeled('Form', segmented([['square', 'Quadratisch'], ['round', 'Rund']], st.pot.shape, v => {
                    st.pot.shape = v;
                    st.pot.preset = insertDefaultPot(cat, v);
                    renderPanel();
                }, 'Form des Topfs')),
                labeled('Größe', select([...sizes, ['custom', 'Eigene Größe …']], st.pot.preset, v => {
                    st.pot.preset = v;
                    renderPanel();
                })));
            if (st.pot.preset === 'custom')
                panel.append(labeled(st.pot.shape === 'round' ? 'Durchmesser in cm' : 'Seitenlänge in cm', num(st.pot.width, v => st.pot.width = v)));
        }
        else if (st.kind === 'plate') {
            const fams = insertFamilies.filter(x => cat.plates[x]);
            const counts = Object.keys(cat.plates[st.plate.family] || {}).map(Number).sort((a, b) => a - b);
            const models = cat.plates[st.plate.family]?.[st.plate.cells] || [];
            panel.append(
                labeled('Maßfamilie', segmented(fams.map(x => [x, x === 'Standard' ? 'Standardmaß' : x]), st.plate.family, v => {
                    st.plate = { family: v, cells: '', model: '' };
                    renderPanel();
                }, 'Maßfamilie')),
                labeled('Zellenzahl', select([['', 'Noch nicht festlegen (Modell später wählen)'], ...counts.map(n => [String(n), n + ' Zellen' + (cat.plates[st.plate.family][n].length > 1 ? ' · ' + cat.plates[st.plate.family][n].length + ' Modelle' : '')])], String(st.plate.cells), v => {
                    st.plate.cells = v;
                    st.plate.model = (cat.plates[st.plate.family]?.[v] || [])[0]?.id || '';
                    renderPanel();
                })));
            if (models.length)
                panel.append(labeled('Modell', select(models.map(t => [t.id, t.name + ' · ' + t.width + ' × ' + t.depth + ' cm']), st.plate.model, v => st.plate.model = v)));
        }
        else if (st.kind === 'table' || st.kind === 'tray')
            panel.append(labeled('Breite in cm', num(st.size[st.kind].width, v => st.size[st.kind].width = v)), labeled('Tiefe in cm', num(st.size[st.kind].depth, v => st.size[st.kind].depth = v)));
        else if (st.kind === 'shelf')
            panel.append(
                labeled('Anzahl der Ebenen (1 bis 8)', num(st.shelf.levels, v => st.shelf.levels = v, 1, 8, 1)),
                labeled('Breite je Ebene in cm', num(st.shelf.width, v => st.shelf.width = v)),
                labeled('Tiefe je Ebene in cm', num(st.shelf.depth, v => st.shelf.depth = v)),
                labeled('Abstand zwischen den Ebenen in cm', num(st.shelf.gap, v => st.shelf.gap = v, 0, 100)));
        else
            panel.append(labeled('Vorlage', select(cat.own.filter(t => !multiple || !t.blueprint).map(t => [t.id, t.name + (t.width ? ' · ' + t.width + (t.depth ? ' × ' + t.depth : '') + ' cm' : '')]), st.own, v => st.own = v)));
        hintText();
    }
    function renderKinds() {
        kindBar.replaceChildren();
        for (const [k, t] of kinds) {
            const b = button(t, () => {
                st.kind = k;
                insertLastKind = k;
                renderKinds();
                renderPanel();
            }, 'secondary');
            b.setAttribute('aria-pressed', String(k === st.kind));
            kindBar.append(b);
        }
    }
    const name = document.createElement('input');
    name.value = st.name;
    name.oninput = () => st.name = name.value;
    const position = document.createElement('details');
    position.className = 'full insert-position';
    position.innerHTML = '<summary>Position' + (multiple ? ' und Anordnung' : '') + '</summary>';
    const posGrid = document.createElement('div');
    posGrid.className = 'formgrid';
    posGrid.append(labeled('Position x in cm', num(st.col, v => st.col = v, 0, 100000)), labeled('Position y in cm', num(st.row, v => st.row = v, 0, 100000)));
    if (multiple)
        posGrid.append(labeled('Anzahl', num(st.count, v => st.count = v, 1, 500, 1)), labeled('Objekte je Reihe', num(st.perRow, v => st.perRow = v, 1, 500, 1)), labeled('Abstand zwischen Objekten in cm', num(st.gap, v => st.gap = v, 0, 1000)));
    position.append(posGrid);
    common.append(labeled('Name (optional)', name), position);
    const submit = document.createElement('button');
    submit.textContent = multiple ? 'Behälter anlegen' : 'Behälter anlegen';
    f.append(kindBar, panel, common, hint, submit, button('Abbrechen', close, 'secondary'));
    renderKinds();
    renderPanel();
    f.oninput = () => dirty = true;
    f.onsubmit = async (e) => {
        e.preventDefault();
        submit.disabled = true;
        try {
            const v = insertPayload(st, cat);
            v.target = { location_id: sc.id, col: Number(st.col), row: Number(st.row), loose: sc.bounded && (Number(st.col) >= sc.width || Number(st.row) >= sc.depth) };
            await api('planner-workspace-create', v);
            dirty = false;
            await load();
            board();
        }
        catch (err) {
            fail(err);
        }
        finally {
            submit.disabled = false;
        }
    };
}
