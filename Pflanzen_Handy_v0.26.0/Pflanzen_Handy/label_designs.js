'use strict';
/* Etiketten aus Bausteinen (0.21): Entwürfe, Darstellung und Gestaltungsseite (Sonstiges › Etiketten).
   Ein Entwurf: Name, Größe in mm, Lage des QR-Codes und eine Liste von Bausteinen (Feld, Vorsatz, Schriftgröße, fett).
   Die Vorlagen unten sind fest eingebaut; eigene Entwürfe liegen auf dem Server (gemeinsam für alle Geräte).
   Die Darstellung (labelRender) wird von qr_labels.js für Einzel- und Sammeldruck benutzt. */
const labelFields = [
    ['label', 'Kennung (ID)'], ['name', 'Name'], ['genus', 'Gattung'], ['species', 'Art'], ['variety', 'Varietät'], ['clone_name', 'Klonname'], ['clone_code', 'Züchtercode'],
    ['category', 'Fachgruppe'], ['acquired', 'Eingangsdatum'], ['year', 'Jahr'], ['source', 'Herkunft / Bezugsquelle'], ['breeder', 'Züchter'], ['natural_site', 'Naturstandort'],
    ['original_name', 'Ursprungsbezeichnung'], ['pot', 'Topfgröße'], ['location', 'Standort'], ['text', 'Freitext']
];
const labelQrPositions = [['left', 'QR-Code links'], ['right', 'QR-Code rechts'], ['top', 'QR-Code oben'], ['none', 'ohne QR-Code']];
const labelBlock = (field, size, bold = false, prefix = '', text = '') => ({ field, prefix, text, size, bold });
const labelBuiltins = [
    { id: 'S', name: 'Klein · 24 × 28 mm', width: 24, height: 28, qr: 'top', border: true, builtin: true, blocks: [labelBlock('label', 5.5, true), labelBlock('name', 5)] },
    { id: 'M', name: 'Mittel · 50 × 25 mm', width: 50, height: 25, qr: 'left', border: true, builtin: true, blocks: [labelBlock('label', 8, true), labelBlock('name', 7)] },
    { id: 'L', name: 'Groß · 70 × 35 mm', width: 70, height: 35, qr: 'left', border: true, builtin: true, blocks: [labelBlock('label', 11, true), labelBlock('name', 9)] },
    { id: 'D', name: 'Mit Details · 70 × 35 mm', width: 70, height: 35, qr: 'left', border: true, builtin: true, blocks: [labelBlock('label', 10, true), labelBlock('name', 8.5, true), labelBlock('clone_name', 8, false, 'Klon: '), labelBlock('acquired', 8, false, 'Eingang: '), labelBlock('location', 7)] }
];
let labelCustom = [], labelLoaded = false;
const labelAll = () => [...labelBuiltins, ...labelCustom];
const labelById = id => labelAll().find(d => d.id === id) || labelBuiltins[1];
const labelSelectedKey = 'pflanzenEtikett';
function labelSelected() {
    try {
        return labelById(localStorage.getItem(labelSelectedKey)).id;
    }
    catch (e) {
        return 'M';
    }
}
function labelSelect(id) {
    try {
        localStorage.setItem(labelSelectedKey, id);
    }
    catch (e) { }
}
// Eigene Entwürfe vom Server holen; ohne Verbindung bleiben die eingebauten Vorlagen nutzbar.
async function labelLoad(force = false) {
    if (labelLoaded && !force)
        return labelCustom;
    try {
        labelCustom = (await api('label-designs')).designs || [];
        labelLoaded = true;
    }
    catch (e) {
        labelCustom = [];
    }
    return labelCustom;
}
async function labelSaveCustom(list) {
    const r = await api('label-designs', { designs: list });
    labelCustom = r.designs;
    labelLoaded = true;
    return labelCustom;
}

// --- Reine Funktionen (getestet)
function labelDate(v) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v ?? '').trim());
    return m ? m[3] + '.' + m[2] + '.' + m[1] : String(v ?? '').trim();
}
// Wert eines Bausteins für eine Pflanze (kind 'plant') oder einen Behälter (kind 'loc').
// Beim Behälter ist „Kennung“ der Behältername, „Name“ das Wort „Behälter“ und „Standort“ der übergeordnete Ort.
function labelValue(block, kind, obj) {
    const f = block.field;
    if (f === 'text')
        return String(block.text ?? '').trim();
    if (kind === 'loc') {
        if (f === 'label')
            return obj.name || 'Behälter';
        if (f === 'name')
            return 'Behälter';
        return f === 'location' && obj.parent_id ? locationPath(obj.parent_id) : '';
    }
    if (f === 'acquired')
        return labelDate(obj.acquired);
    if (f === 'location')
        return obj.location_id ? locationPath(obj.location_id) : '';
    return String(obj[f] ?? '').trim();
}
// Sichtbare Zeilen: leere Angaben entfallen samt Vorsatz
function labelLines(design, kind, obj) {
    const lines = [];
    for (const b of design.blocks || []) {
        const v = labelValue(b, kind, obj);
        if (v)
            lines.push({ text: (b.prefix || '') + v, size: Number(b.size) || 8, bold: !!b.bold });
    }
    return lines;
}
// Größe des QR-Codes in mm: so groß wie es die Etikettenseite erlaubt, aber nicht größer als die halbe Breite (links/rechts) bzw. 55 % der Höhe (oben)
function labelQrSize(design) {
    const pad = 3, w = Number(design.width), h = Number(design.height);
    if (design.qr === 'none')
        return 0;
    const mm = v => Math.round(Math.max(6, v) * 10) / 10;
    if (design.qr === 'top')
        return mm(Math.min(w - pad, h * .55));
    return mm(Math.min(h - pad, w * .5));
}
// Grobe Prüfung: passt der Text? (Zeilenhöhe 1,15 × Schriftgröße; 1 pt = 0,3528 mm)
function labelFits(design) {
    const lines = design.blocks || [];
    const need = lines.reduce((s, b) => s + (Number(b.size) || 8) * .3528 * 1.15, 0) + 3;
    const room = design.qr === 'top' ? Number(design.height) - labelQrSize(design) - 1 : Number(design.height);
    return need <= room;
}

// --- Darstellung
function labelRender(design, kind, obj, base) {
    const el = document.createElement('div');
    el.className = 'qr-label qr-design' + (design.border === false ? ' no-border' : '');
    el.style.width = design.width + 'mm';
    el.style.height = design.height + 'mm';
    el.style.flexDirection = design.qr === 'top' ? 'column' : design.qr === 'right' ? 'row-reverse' : 'row';
    const size = labelQrSize(design);
    if (size) {
        const code = document.createElement('div');
        code.className = 'qr-code';
        code.style.width = code.style.height = size + 'mm';
        code.style.flex = '0 0 ' + size + 'mm';
        code.innerHTML = qrSvg(qrUrl(base, kind, obj), { label: 'QR-Code ' + (kind === 'plant' ? obj.label : obj.name || 'Behälter') });
        el.append(code);
    }
    const text = document.createElement('div');
    text.className = 'qr-text';
    if (design.qr === 'top')
        text.style.textAlign = 'center';
    for (const line of labelLines(design, kind, obj)) {
        const d = document.createElement('div');
        d.className = 'qr-line';
        d.textContent = line.text;
        d.style.fontSize = line.size + 'pt';
        d.style.fontWeight = line.bold ? '700' : '400';
        text.append(d);
    }
    el.append(text);
    return el;
}
function labelSheet(items, base, design) {
    const sheet = document.createElement('div');
    sheet.className = 'qr-sheet qr-design-sheet';
    sheet.style.gridTemplateColumns = 'repeat(auto-fill, ' + design.width + 'mm)';
    for (const { kind, obj } of items)
        sheet.append(labelRender(design, kind, obj, base));
    return sheet;
}

// --- Gestaltungsseite
let labelEditId = null, labelDraft = null;
const labelNewId = () => 'e' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const labelClone = d => JSON.parse(JSON.stringify({ ...d, builtin: undefined }));
let labelSampleId = '';
function labelSample() {
    const p = (db.plants || []).find(p => p.id === labelSampleId) || (db.plants || []).find(p => p.status === 'active') || (db.plants || [])[0];
    return p || { id: 'x'.repeat(32), label: 'SAR-FLA-2026-001', name: 'Sarracenia flava var. rugelii', genus: 'Sarracenia', species: 'flava', clone_name: 'Cobra', acquired: '2026-03-14', year: '2026', source: 'Gärtnerei Muster' };
}
async function labelDesignerPage() {
    app.innerHTML = '<section class="panel"><h2>Etiketten gestalten</h2><p class="help">Stelle ein Etikett aus Bausteinen zusammen: Größe, Lage des QR-Codes und beliebige Angaben aus deinen Pflanzendaten. Gedruckt wird in Meine Pflanzen (Pflanzen markieren › QR-Etiketten drucken) oder im Dialog „QR-Code“ einer Pflanze.</p><div id="labelBody"></div></section>';
    await labelLoad(true);
    labelDesignerRender();
}
function labelDesignerRender() {
    const host = $('#labelBody');
    host.replaceChildren();
    const picker = document.createElement('div');
    picker.className = 'actions';
    for (const d of labelAll()) {
        const b = button(d.name, () => {
            if (!canLeave())
                return;
            dirty = false;
            labelEditId = d.id;
            labelDraft = labelClone(d);
            labelDesignerRender();
        }, d.id === labelEditId ? '' : 'secondary');
        picker.append(b);
    }
    picker.append(button('＋ Neues Etikett', () => {
        if (!canLeave())
            return;
        dirty = false;
        labelEditId = null;
        labelDraft = { id: labelNewId(), name: 'Neues Etikett', width: 50, height: 25, qr: 'left', border: true, blocks: [labelBlock('label', 8, true), labelBlock('name', 7)] };
        labelDesignerRender();
    }, 'secondary'));
    host.append(picker);
    if (!labelDraft) {
        host.append(Object.assign(document.createElement('p'), { className: 'notice', textContent: 'Wähle oben ein Etikett zum Ansehen oder Ändern, oder lege ein neues an. Die eingebauten Vorlagen lassen sich nicht ändern, aber als Kopie speichern.' }));
        return;
    }
    labelEditor(host);
}
function labelEditor(host) {
    const d = labelDraft, builtin = !!labelBuiltins.find(b => b.id === d.id);
    const grid = document.createElement('div');
    grid.className = 'label-editor';
    const form = document.createElement('div');
    form.className = 'label-form';
    const side = document.createElement('div');
    side.className = 'label-side';
    grid.append(form, side);
    host.append(grid);
    const touch = () => {
        dirty = true;
        drawPreview();
    };
    const field = (caption, input) => {
        const l = document.createElement('label');
        l.innerHTML = '<span class="fieldcaption">' + esc(caption) + '</span>';
        l.append(input);
        return l;
    };
    const num = (value, min, max, step, onInput) => {
        const i = document.createElement('input');
        i.type = 'number';
        i.min = min;
        i.max = max;
        i.step = step;
        i.value = value;
        i.oninput = () => {
            onInput(i.value === '' ? '' : Number(i.value));
            touch();
        };
        return i;
    };
    const name = document.createElement('input');
    name.value = d.name;
    name.maxLength = 60;
    name.setAttribute('aria-label', 'Name des Etiketts');
    name.oninput = () => {
        d.name = name.value;
        dirty = true;
    };
    const qr = document.createElement('select');
    qr.setAttribute('aria-label', 'Lage des QR-Codes');
    for (const [v, t] of labelQrPositions)
        qr.append(new Option(t, v));
    qr.value = d.qr;
    qr.onchange = () => {
        d.qr = qr.value;
        touch();
    };
    const border = document.createElement('input');
    border.type = 'checkbox';
    border.checked = d.border !== false;
    border.onchange = () => {
        d.border = border.checked;
        touch();
    };
    const row = document.createElement('div');
    row.className = 'label-row';
    row.append(field('Breite (mm)', num(d.width, 15, 200, 1, v => d.width = v)), field('Höhe (mm)', num(d.height, 10, 200, 1, v => d.height = v)), field('QR-Code', qr));
    const bl = document.createElement('label');
    bl.className = 'checkline';
    bl.append(border, ' Rahmen drucken (Schneidehilfe)');
    form.append(field('Name', name), row, bl);
    const list = document.createElement('div');
    list.className = 'label-blocks';
    const blocksTitle = document.createElement('h3');
    blocksTitle.textContent = 'Bausteine (von oben nach unten)';
    form.append(blocksTitle, list);
    const drawBlocks = () => {
        list.replaceChildren();
        d.blocks.forEach((b, i) => {
            const r = document.createElement('div');
            r.className = 'label-block';
            const sel = document.createElement('select');
            sel.setAttribute('aria-label', 'Angabe ' + (i + 1));
            for (const [v, t] of labelFields)
                sel.append(new Option(t, v));
            sel.value = b.field;
            const pre = document.createElement('input');
            pre.placeholder = b.field === 'text' ? 'Text' : 'Vorsatz, z. B. „Klon: “';
            pre.setAttribute('aria-label', b.field === 'text' ? 'Freitext' : 'Vorsatz');
            pre.maxLength = b.field === 'text' ? 80 : 40;
            pre.value = b.field === 'text' ? b.text : b.prefix;
            pre.oninput = () => {
                b[b.field === 'text' ? 'text' : 'prefix'] = pre.value;
                touch();
            };
            sel.onchange = () => {
                b.field = sel.value;
                pre.placeholder = b.field === 'text' ? 'Text' : 'Vorsatz, z. B. „Klon: “';
                pre.value = b.field === 'text' ? b.text : b.prefix;
                touch();
            };
            const size = num(b.size, 4, 40, .5, v => b.size = v);
            size.setAttribute('aria-label', 'Schriftgröße in pt');
            size.className = 'label-size';
            const bold = document.createElement('input');
            bold.type = 'checkbox';
            bold.checked = !!b.bold;
            bold.setAttribute('aria-label', 'fett');
            bold.onchange = () => {
                b.bold = bold.checked;
                touch();
            };
            const bl2 = document.createElement('label');
            bl2.className = 'checkline';
            bl2.append(bold, ' fett');
            const move = (by) => () => {
                const j = i + by;
                if (j < 0 || j >= d.blocks.length)
                    return;
                [d.blocks[i], d.blocks[j]] = [d.blocks[j], d.blocks[i]];
                dirty = true;
                drawBlocks();
                drawPreview();
            };
            const up = button('↑', move(-1), 'secondary'), down = button('↓', move(1), 'secondary'), del = button('✕', () => {
                d.blocks.splice(i, 1);
                dirty = true;
                drawBlocks();
                drawPreview();
            }, 'secondary');
            up.setAttribute('aria-label', 'nach oben');
            down.setAttribute('aria-label', 'nach unten');
            del.setAttribute('aria-label', 'Baustein entfernen');
            r.append(sel, pre, size, bl2, up, down, del);
            list.append(r);
        });
    };
    form.append(button('＋ Baustein hinzufügen', () => {
        if (d.blocks.length >= 12)
            return message('Höchstens 12 Bausteine je Etikett.', true);
        d.blocks.push(labelBlock('name', 8));
        dirty = true;
        drawBlocks();
        drawPreview();
    }, 'secondary'));
    const actions = document.createElement('div');
    actions.className = 'actions label-actions';
    const save = async (asCopy) => {
        try {
            const copy = labelClone(d);
            if (asCopy || builtin) {
                copy.id = labelNewId();
                if (asCopy && !/Kopie/.test(copy.name))
                    copy.name = copy.name + ' (Kopie)';
            }
            const list2 = labelCustom.filter(x => x.id !== copy.id).concat([copy]);
            await labelSaveCustom(list2);
            dirty = false;
            labelEditId = copy.id;
            labelDraft = labelClone(labelCustom.find(x => x.id === copy.id));
            labelSelect(copy.id);
            message('Etikett „' + copy.name + '“ gespeichert.');
            labelDesignerRender();
        }
        catch (e) {
            fail(e);
        }
    };
    actions.append(button(builtin ? 'Als eigenes Etikett speichern' : 'Speichern', () => save(false)));
    if (!builtin)
        actions.append(button('Als Kopie speichern', () => save(true), 'secondary'), button('Löschen', async () => {
            if (!confirm('Etikett „' + d.name + '“ löschen?'))
                return;
            try {
                await labelSaveCustom(labelCustom.filter(x => x.id !== d.id));
                dirty = false;
                labelEditId = null;
                labelDraft = null;
                if (labelSelected() === d.id)
                    labelSelect('M');
                message('Etikett gelöscht.');
                labelDesignerRender();
            }
            catch (e) {
                fail(e);
            }
        }, 'secondary'));
    actions.append(button('Probedruck', async () => {
        try {
            const s = await qrLoad();
            qrPrint([{ kind: 'plant', obj: labelSample() }], s.base, labelClone(d));
        }
        catch (e) {
            fail(e);
        }
    }, 'secondary'));
    form.append(actions);
    const sampleTitle = document.createElement('h3');
    sampleTitle.textContent = 'Vorschau';
    const note = document.createElement('p');
    note.className = 'notice';
    const preview = document.createElement('div');
    preview.className = 'label-preview';
    const sampleNote = document.createElement('p');
    sampleNote.className = 'help';
    const sampleSelect = document.createElement('select');
    sampleSelect.setAttribute('aria-label', 'Vorschau mit Pflanze');
    for (const p of (db.plants || []).filter(p => p.status === 'active').slice(0, 200))
        sampleSelect.append(new Option((p.label || '') + ' · ' + (p.name || ''), p.id));
    if (sampleSelect.options.length) {
        sampleSelect.value = labelSample().id;
        sampleSelect.onchange = () => {
            labelSampleId = sampleSelect.value;
            drawPreview();
        };
        side.append(sampleTitle, field('Vorschau mit Pflanze', sampleSelect), preview, note, sampleNote);
    }
    else
        side.append(sampleTitle, preview, note, sampleNote);
    let base = 'http://192.168.1.20:8766';
    qrLoad().then(s => {
        base = s.base;
        drawPreview();
    }).catch(() => { });
    function drawPreview() {
        const sample = labelSample();
        const dd = { ...d, width: Number(d.width) || 50, height: Number(d.height) || 25 };
        preview.replaceChildren();
        const stage = document.createElement('div');
        stage.className = 'label-stage';
        // Vergrößerung so wählen, dass das Etikett in die Spalte passt (1 mm ≈ 3,78 px), höchstens doppelt
        const scale = Math.max(.5, Math.min(2, ((preview.clientWidth || 400) - 30) / (dd.width * 3.78)));
        stage.style.width = dd.width * scale + 'mm';
        stage.style.height = dd.height * scale + 'mm';
        const inner = labelRender(dd, 'plant', sample, base);
        inner.style.transform = 'scale(' + scale + ')';
        inner.style.transformOrigin = '0 0';
        stage.append(inner);
        preview.append(stage);
        note.hidden = labelFits(dd);
        note.textContent = 'Achtung: So viel Text passt vermutlich nicht auf das Etikett. Verkleinere die Schrift, entferne Bausteine oder vergrößere das Etikett.';
        sampleNote.textContent = 'Vorschau vergrößert mit „' + (sample.name || sample.label) + '“. Leere Angaben fallen weg.';
    }
    drawBlocks();
    drawPreview();
}
