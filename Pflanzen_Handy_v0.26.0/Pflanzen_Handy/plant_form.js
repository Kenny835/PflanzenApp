/* Pflanze hinzufügen und bearbeiten.
   Neu anlegen: Gattung, Art, Sorte/Klonname, Anzahl und Standort sind sofort sichtbar; die Bezeichnung entsteht automatisch.
   Alles Weitere ist in einklappbaren Abschnitten, deren Überschrift die aktuellen Angaben zusammenfasst.
   Eine neue Pflanze übernimmt die Angaben der zuletzt angelegten Pflanze (außer den Einzelangaben wie Name und Klon).
   Eigenständiges Modul: ersetzt die frühere Form aus app.js, features.js und planner.js. */
const plantFields = [
    ['Identität', [['name', 'Vollständige Bezeichnung *'], ['genus', 'Gattung *', 'suggest'], ['taxon_type', 'Einordnung', 'select', [['species', 'Bekannte Art'], ['hybrid', 'Hybride (HYB)'], ['unknown', 'Unbekannt (UNK)']]], ['species', 'Art / Species', 'suggest'], ['variety', 'Unterart / Varietät'], ['clone_name', 'Sorten- / Klonname'], ['clone_code', 'Fremd- / Züchtercode'], ['category', 'Fachgruppe', 'suggest'], ['clone_key', 'Gleicher Klon wie …', 'clone']]],
    ['Zugang & Herkunft', [['year', 'Zugangs- / Teilungsjahr *', 'number'], ['acquired', 'Zugangsdatum (Tag, Monat/Jahr oder Jahr)'], ['accession_type', 'Zugangsart', 'select', [['purchase', 'Kauf'], ['exchange', 'Tausch'], ['gift', 'Geschenk'], ['division', 'Eigene Teilung'], ['propagation', 'Eigene Vermehrung']]], ['source', 'Bezugsquelle', 'suggest'], ['breeder', 'Ursprünglicher Züchter'], ['natural_site', 'Naturstandort'], ['price', 'Preis in € (optional)'], ['original_name', 'Ursprungsbezeichnung / Etikett'], ['hybrid_formula', 'Hybridformel'], ['mother', 'Mutterpflanze der Kreuzung (Bezeichnung)'], ['father', 'Vaterpflanze der Kreuzung (Bezeichnung)']]],
    ['Standort & Pflege', [['location_id', 'Standort', 'locations'], ['position', 'Genauer Platz (ohne Rasterzuordnung)'], ['group_id', 'Pflegegruppe', 'groups'], ['role', 'Funktion', 'select', Object.entries(roles)], ['pot', 'Topfgröße'], ['substrate', 'Substrat'], ['status', 'Bestandsstatus', 'select', Object.entries(statusNames)], ['status_date', 'Datum der Abgabe / des Eingehens (optional)'], ['recipient', 'Empfänger (optional)'], ['cause', 'Ursache (optional)']]],
    ['Notizen', [['notes', 'Freie Notizen', 'textarea']]]
];

// Felddefinitionen nach Schlüssel
const plantSpecs = Object.fromEntries(plantFields.flatMap(([, specs]) => specs).map(spec => [spec[0], spec]));
plantSpecs.name = ['name', 'Bezeichnung *'];

// Gruppierung der Felder: [Überschrift, Felder, nur beim Bearbeiten?]
const plantLayout = {
    quick: ['genus', 'species', 'clone_name'],
    sections: [
        ['Weitere Namensangaben', ['taxon_type', 'variety', 'clone_code', 'category', 'clone_key']],
        ['Herkunft', ['accession_type', 'year', 'acquired', 'source', 'breeder', 'natural_site', 'price', 'original_name', 'hybrid_formula', 'mother', 'father']],
        ['Pflege', ['group_id', 'role', 'pot', 'substrate']],
        ['Status', ['status', 'status_date', 'recipient', 'cause'], true],
        ['Notizen', ['notes']]
    ]
};
// Diese Angaben übernimmt eine neue Pflanze von der zuletzt angelegten. Name, Sorte/Klon, Züchtercode, Klonzuordnung,
// Preis, Ursprungsbezeichnung, Kreuzungsangaben, Notizen und Fotos gehören jeder Pflanze einzeln und bleiben leer.
// Jahr und Zugangsdatum werden nie übernommen: Das Jahr ist immer das laufende, damit die ID (…-2026-…) stimmt.
// (Das Zugangsdatum bliebe sonst aus einem früheren Jahr stehen und widerspräche dem Jahr.)
const plantCarried = ['genus', 'species', 'variety', 'taxon_type', 'category', 'accession_type', 'source', 'breeder', 'natural_site', 'location_id', 'group_id', 'role', 'pot', 'substrate'];
const plantCrossFields = ['hybrid_formula', 'mother', 'father'];

// Reine Funktionen (getestet)
function plantCarryOver(last) {
    const out = {};
    for (const key of plantCarried)
        if (last && last[key] !== undefined && last[key] !== null && last[key] !== '')
            out[key] = last[key];
    return out;
}
// Bezeichnung aus Gattung, Art, Unterart und Sorte: Sarracenia flava var. cuprea „Klonname“
function plantComposeName(v) {
    const base = [v.genus, v.species, v.variety].map(s => String(s ?? '').trim()).filter(Boolean).join(' ');
    const clone = String(v.clone_name ?? '').trim();
    return base + (clone ? (base ? ' ' : '') + '„' + clone + '“' : '');
}
// Gattung und Art aus einem Namen wie „Cephalotus follicularis“ ableiten (für Wünsche, die nur einen Namen haben)
function plantNameParts(name) {
    const m = String(name ?? '').trim().match(/^([A-ZÄÖÜ][A-Za-zÄÖÜäöüß.-]*)(?:\s+([a-zäöüß][A-Za-zÄÖÜäöüß-]*))?/);
    return { genus: m ? m[1] : '', species: m?.[2] || '' };
}
// Kreuzungsangaben nur bei Hybriden oder eigener Vermehrung
const plantShowsCross = v => v.taxon_type === 'hybrid' || v.accession_type === 'propagation';

function plantForm(target, p = null, extras = {}, options = {}) {
    const plain = !p && !Object.keys(extras).length;
    const last = plain && !options.noCarry ? db.plants[db.plants.length - 1] : null;
    const carried = plantCarryOver(last);
    const v = Object.assign({ year: year(), status: 'active', role: 'unspecified', taxon_type: 'species', category: 'Karnivoren', count: 1 }, carried, p || {}, extras);
    if (!p) {
        v.location_id = carried.location_id || '';
        v.position = '';
    }
    target.innerHTML = '<h2>' + (p ? 'Pflanze bearbeiten' : extras.parent_id ? 'Teilung erfassen' : 'Pflanze hinzufügen') + '</h2>' + (p ? '<p class="badge">' + esc(p.label) + ' · Inventar-ID bleibt fest</p>' : '<p class="muted">Gattung und Art genügen. Jeder eigenständige Horst erhält automatisch eine ID, alle weiteren Angaben lassen sich später ergänzen.</p>');
    const f = document.createElement('form');
    target.append(f);
    if (extras.parent_id) {
        const par = find('plants', extras.parent_id);
        const n = document.createElement('p');
        n.className = 'notice';
        n.textContent = 'Teilung von ' + par.label + ' · Klonzuordnung wird übernommen.';
        f.append(n);
    }
    if (last) {
        const n = document.createElement('p');
        n.className = 'notice';
        n.append('Angaben von ' + last.label + ' (' + last.name + ') übernommen. Bezeichnung, Sorte, Klon, Notizen und Fotos sind frei. ');
        n.append(button('Leeres Formular', () => plantForm(target, null, {}, { noCarry: true }), 'secondary'));
        f.append(n);
    }
    // Schnellerfassung
    const quick = document.createElement('fieldset');
    quick.className = 'plant-quick';
    quick.innerHTML = '<legend>Pflanze</legend><div class="formgrid"></div>';
    const grid = quick.firstElementChild.nextElementSibling;
    for (const key of plantLayout.quick)
        grid.append(field(plantSpecs[key], v, 'plant'));
    if (!p) {
        const l = field(['count', 'Anzahl eigenständiger Horste *'], v, 'plant');
        const input = l.querySelector('input');
        input.type = 'number';
        input.min = 1;
        input.max = 100;
        grid.append(l);
    }
    const nameLabel = field(plantSpecs.name, v, 'plant');
    nameLabel.classList.add('full');
    const nameNote = document.createElement('small');
    nameNote.className = 'help';
    nameNote.textContent = 'Entsteht aus Gattung, Art, Unterart und Sorte, solange du sie nicht selbst änderst.';
    nameLabel.append(nameNote);
    grid.append(nameLabel);
    f.append(quick);
    // Standort und Platz bleiben ein eigenes, immer sichtbares Element (Platzwahl mit Raster)
    const hidden = document.createElement('div');
    hidden.hidden = true;
    hidden.append(field(plantSpecs.location_id, v, 'plant'), field(plantSpecs.position, v, 'plant'));
    f.append(hidden);
    // Weitere Angaben in einklappbaren Abschnitten
    const digests = [];
    const openAll = !!p || !plain;
    for (const [title, keys, editOnly] of plantLayout.sections) {
        if (editOnly && !p)
            continue;
        const d = document.createElement('details');
        d.className = 'plant-section';
        d.open = openAll;
        d.innerHTML = '<summary><b>' + title + '</b><span class="digest"></span></summary><div class="formgrid"></div>';
        const inner = d.lastElementChild;
        for (const key of keys) {
            const l = field(plantSpecs[key], v, 'plant');
            if (key === 'clone_key' && extras.parent_id)
                l.querySelector('select').disabled = true;
            inner.append(l);
        }
        if (title === 'Pflege') {
            const care = d.querySelector('[name=group_id]');
            care.options[0].textContent = 'Standort-/Zonenvorgabe verwenden';
            const note = document.createElement('p');
            note.className = 'help';
            note.textContent = 'Eine hier ausgewählte Pflegegruppe ist eine eigene Vorgabe und bleibt beim Umstellen bestehen. Die leere Auswahl übernimmt Zone oder Standort.';
            care.closest('label').append(note);
        }
        f.append(d);
        digests.push([d, keys]);
    }
    if (!p) {
        // Neue Pflanzen sind automatisch „Im Bestand“; Abgabe oder Abgang folgen später beim Bearbeiten.
        for (const [key, value] of [['status', 'active'], ['status_date', ''], ['recipient', ''], ['cause', '']]) {
            const i = document.createElement('input');
            i.type = 'hidden';
            i.name = key;
            i.value = value;
            f.append(i);
        }
    }
    const photoSection = document.createElement('details');
    photoSection.className = 'plant-section';
    photoSection.innerHTML = '<summary><b>Fotos</b><span class="digest"></span></summary><div class="photo-host"></div>';
    f.append(photoSection);
    const photos = photoQueue(photoSection.lastElementChild, !!p && db.photos.some(x => x.plant_id === p.id));
    const hint = document.createElement('p');
    hint.className = 'help';
    hint.textContent = 'Bei mehreren neuen Horsten gehören diese Fotos ausschließlich zum ersten Horst. Weitere Horste können anschließend eigene Bilder erhalten.';
    photos.section.prepend(hint);
    f.savePhotos = id => photos.save({ plant_id: id });
    if (!p && !extras.parent_id) {
        const info = document.createElement('p');
        info.className = 'help';
        info.textContent = 'Mehrere Horste erhalten gemeinsame Angaben und dieselbe Klonzuordnung, aber jeweils eine eigene Inventar-ID.';
        f.append(info);
    }
    const preview = document.createElement('p');
    preview.className = 'notice';
    f.append(preview);
    attachPlacement(f, p, v);
    const placement = f.querySelector('.placementsection');
    placement.querySelector('legend').textContent = 'Standort (optional)';
    f.insertBefore(placement, quick.nextSibling);
    // Bezeichnung automatisch bilden, bis jemand sie selbst ändert
    const name = f.elements.name;
    let auto = !p && !extras.name;
    const compose = () => {
        if (auto)
            name.value = plantComposeName(Object.fromEntries(['genus', 'species', 'variety', 'clone_name'].map(k => [k, f.elements[k].value])));
    };
    name.addEventListener('input', () => {
        auto = name.value.trim() === '';
        if (auto)
            compose();
    });
    compose();
    const crossLabels = plantCrossFields.map(k => f.elements[k].closest('label'));
    const digestText = keys => keys.map(k => {
        const el = f.elements[k];
        if (!el || el.value === '' || el.closest('label')?.hidden || k === 'role' && el.value === 'unspecified' || k === 'taxon_type' && el.value === 'species')
            return '';
        if (el.tagName === 'SELECT')
            return el.selectedOptions[0]?.textContent || '';
        return el.value;
    }).filter(Boolean).join(' · ');
    const update = () => {
        const g = f.elements.genus.value.replace(/[^a-z]/ig, '').slice(0, 3).toUpperCase(), s = f.elements.taxon_type.value === 'hybrid' ? 'HYB' : f.elements.taxon_type.value === 'unknown' || !f.elements.species.value ? 'UNK' : f.elements.species.value.replace(/[^a-z]/ig, '').slice(0, 3).toUpperCase();
        preview.textContent = p ? 'Feste Inventar-ID: ' + p.label : 'ID-Vorschau: ' + (g || '???') + '-' + (s || 'UNK') + '-' + f.elements.year.value + '-… (freie Nummer beim Speichern)';
        const showCross = plantShowsCross({ taxon_type: f.elements.taxon_type.value, accession_type: f.elements.accession_type.value });
        crossLabels.forEach(l => l.hidden = !showCross);
        if (p) {
            const open = f.elements.status.value !== 'active';
            for (const k of ['status_date', 'recipient', 'cause'])
                f.elements[k].closest('label').hidden = !open;
        }
        for (const [d, keys] of digests)
            d.querySelector('.digest').textContent = digestText(keys);
    };
    update();
    f.oninput = () => {
        dirty = true;
        compose();
        update();
    };
    f.onchange = () => {
        dirty = true;
        compose();
        update();
    };
    // Ungültige Felder in eingeklappten Abschnitten: Abschnitt öffnen
    f.addEventListener('invalid', e => e.target.closest('details')?.setAttribute('open', ''), true);
    const a = actions(f, [['Abbrechen', () => {
                if (!canLeave())
                    return;
                dirty = false;
                if (p)
                    detail(p.id);
                else if (modal.open) {
                    modal.close();
                    render();
                }
                else
                    go('plants');
            }, 'secondary']]);
    const submit = document.createElement('button');
    submit.type = 'submit';
    submit.textContent = p ? 'Änderungen speichern' : 'Horst / Horste anlegen';
    a.prepend(submit);
    const requestKey = 'create-' + Date.now() + '-' + Math.random().toString(36).slice(2);
    let savedRows = null;
    f.onsubmit = async (e) => {
        e.preventDefault();
        if (submit.disabled)
            return;
        submit.disabled = true;
        submit.textContent = 'Wird gespeichert …';
        try {
            const vals = Object.fromEntries(new FormData(f));
            const placements = f.getPlacements();
            if (placements)
                vals.placements = placements;
            if (p) {
                vals.version = p.version;
                vals.parent_id = p.parent_id || '';
                if (p.parent_deleted)
                    vals.parent_deleted = p.parent_deleted;
            }
            if (extras.parent_id)
                vals.parent_id = extras.parent_id;
            if (extras.wish_id)
                vals.wish_id = extras.wish_id;
            const rows = savedRows || await api('save', {
                kind: 'plants', id: p?.id, values: vals, request_key: requestKey
            });
            savedRows = rows;
            for (const el of f.querySelectorAll('fieldset input,fieldset select,fieldset textarea,details input,details select,details textarea'))
                el.disabled = true;
            if (f.savePhotos)
                await f.savePhotos(rows[0].id);
            dirty = false;
            await load();
            if (page !== 'locations')
                page = 'plants';
            render();
            detail(rows[0].id);
            message(rows.length === 1 ? 'Pflanze gespeichert.' : rows.length + ' Horste angelegt. Standort und Funktion können einzeln angepasst werden.');
        }
        catch (e) {
            fail(e);
        }
        finally {
            submit.disabled = false;
            submit.textContent = savedRows ? 'Fotos erneut speichern (Pflanze bereits angelegt)' : 'Horst / Horste speichern';
        }
    };
}
