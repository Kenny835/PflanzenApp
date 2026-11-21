'use strict';
/* QR-Codes für Pflanzen und Behälter: Dialog mit Code und Serveradresse, Etikettendruck, Öffnen per Scan.
   Der Code enthält die Adresse der App und die Inventar-ID einer Pflanze (oder den Anfang der Kennung eines Behälters),
   z. B. http://192.168.1.20:8766/q/SAR-FLA-2026-001. Der Server leitet beim Scannen zur Pflanze oder zum Behälter weiter.
   Eigenständiges Modul; die Erzeugung des Codes steht in qr.js. */
// Etiketten-Entwürfe und ihre Darstellung stehen in label_designs.js

// Reine Funktionen (getestet)
const qrCodeOf = (kind, obj) => kind === 'plant' ? obj.label : obj.id.slice(0, 12);
const qrUrl = (base, kind, obj) => String(base).replace(/\/+$/, '') + '/q/' + qrCodeOf(kind, obj);
const qrLocalOnly = base => /^https?:\/\/(localhost|127\.|\[::1\])/i.test(String(base));

async function qrLoad() {
    const s = await api('qr-base');
    if (!s || !s.base)
        throw Error('Die Adresse für QR-Codes konnte nicht gelesen werden.');
    return s;
}

// Ein Etikett und ein Blatt Etiketten nach einem Entwurf (label_designs.js)
const qrLabel = (kind, obj, base, design = labelById(labelSelected())) => labelRender(design, kind, obj, base);
const qrSheet = (items, base, design = labelById(labelSelected())) => labelSheet(items, base, design);

// Druckt die Etiketten über den Druckdialog des Browsers; das Blatt wird danach wieder entfernt.
function qrPrint(items, base, design = labelById(labelSelected())) {
    const sheet = qrSheet(items, base, design);
    document.body.append(sheet);
    const done = () => {
        sheet.remove();
        window.removeEventListener('afterprint', done);
    };
    window.addEventListener('afterprint', done);
    window.print();
}

// Eingabe der Serveradresse (gilt für alle QR-Codes) mit Warnung, wenn sie nur am PC selbst funktioniert
function qrAddressForm(settings, onChange) {
    const box = document.createElement('div');
    box.className = 'qr-address';
    const warn = document.createElement('p');
    warn.className = 'notice';
    const label = document.createElement('label');
    label.innerHTML = '<span class="fieldcaption">Adresse der App im Heimnetz (gilt für alle QR-Codes)</span>';
    const input = document.createElement('input');
    input.value = settings.base;
    input.setAttribute('aria-label', 'Adresse der App im Heimnetz');
    label.append(input);
    const refresh = () => {
        warn.hidden = !qrLocalOnly(input.value);
        warn.textContent = 'Diese Adresse gilt nur an diesem Rechner. Ein Handy kann den Code damit nicht öffnen. Trage die Adresse dieses Rechners im WLAN ein, zum Beispiel ' + settings.guessed + '.';
    };
    const save = async value => {
        try {
            const result = await api('qr-base', { base: value });
            settings.base = result.base;
            settings.custom = result.custom;
            input.value = result.base;
            refresh();
            onChange(result.base);
            message('Adresse gespeichert.');
        }
        catch (e) {
            fail(e);
        }
    };
    const row = document.createElement('div');
    row.className = 'actions';
    row.append(button('Adresse speichern', () => save(input.value.trim() || settings.guessed), 'secondary'), button('Vorschlag verwenden', () => save(''), 'secondary'));
    input.oninput = refresh;
    refresh();
    box.append(warn, label, row);
    return box;
}

// Auswahl des Etiketts (eingebaute Vorlagen und eigene Entwürfe); die Wahl wird je Gerät gemerkt
const qrDesignSelect = onChange => {
    const l = document.createElement('label');
    l.innerHTML = '<span class="fieldcaption">Etikett</span>';
    const s = document.createElement('select');
    s.setAttribute('aria-label', 'Etikett');
    for (const d of labelAll())
        s.append(new Option(d.name, d.id));
    s.value = labelSelected();
    s.onchange = () => {
        labelSelect(s.value);
        onChange();
    };
    l.append(s);
    return l;
};

// Dialog für eine Pflanze (kind 'plant') oder einen Behälter (kind 'loc')
async function qrDialog(kind, obj) {
    let settings;
    try {
        settings = await qrLoad();
        await labelLoad();
    }
    catch (e) {
        return fail(e);
    }
    openDialog('<h2>QR-Code</h2>');
    const wrap = document.createElement('div');
    wrap.className = 'qr-dialog';
    const preview = document.createElement('div');
    preview.className = 'qr-preview';
    const info = document.createElement('div');
    info.className = 'qr-info';
    const draw = () => {
        const url = qrUrl(settings.base, kind, obj);
        preview.innerHTML = qrSvg(url, { label: 'QR-Code ' + qrCodeOf(kind, obj) });
        info.querySelector('.qr-url').textContent = url;
    };
    info.innerHTML = '<h3></h3><p class="badge"></p><p class="qr-url help"></p>';
    info.querySelector('h3').textContent = kind === 'plant' ? obj.name : obj.name || 'Behälter';
    info.querySelector('.badge').textContent = kind === 'plant' ? obj.label : 'Behälter · ' + qrCodeOf(kind, obj);
    const print = document.createElement('div');
    print.className = 'actions';
    print.append(button('Etikett drucken', () => qrPrint([{ kind, obj }], settings.base, labelById(labelSelected()))));
    info.append(qrDesignSelect(() => { }), print);
    wrap.append(preview, info);
    body.append(wrap, qrAddressForm(settings, draw), button('Schließen', close, 'secondary'));
    draw();
}

// Dialog zum Drucken mehrerer Etiketten (items: [{ kind, obj }])
async function qrLabelDialog(items) {
    if (!items.length)
        return;
    let settings;
    try {
        settings = await qrLoad();
        await labelLoad();
    }
    catch (e) {
        return fail(e);
    }
    openDialog('<h2>QR-Etiketten drucken</h2><p>' + items.length + (items.length === 1 ? ' Etikett' : ' Etiketten') + ' nach dem gewählten Etikett. Eigene Etiketten gestaltest du unter Sonstiges › Etiketten. Auf Etikettenpapier oder normales Papier zum Ausschneiden.</p>');
    const prev = document.createElement('div');
    prev.className = 'qr-sheet-preview';
    const draw = () => {
        prev.replaceChildren(qrSheet(items.slice(0, 6), settings.base));
        prev.firstChild.classList.add('qr-preview-sheet');
        if (items.length > 6) {
            const more = document.createElement('p');
            more.className = 'help';
            more.textContent = '… und ' + (items.length - 6) + ' weitere';
            prev.append(more);
        }
    };
    const actions2 = document.createElement('div');
    actions2.className = 'actions';
    actions2.append(button('Drucken', () => qrPrint(items, settings.base)), button('Schließen', close, 'secondary'));
    body.append(qrDesignSelect(draw), prev, qrAddressForm(settings, draw), actions2);
    draw();
}

// Wurde die App über einen QR-Code geöffnet (…/#plant=<Kennung> oder …/#loc=<Kennung>)? Dann dorthin springen.
function qrOpenFromHash() {
    const m = /^#(plant|loc)=([0-9a-f]{32})$/.exec(location.hash);
    if (!m)
        return false;
    history.replaceState(null, '', location.pathname + location.search);
    if (m[1] === 'plant') {
        if (!find('plants', m[2])) {
            message('Die Pflanze zu diesem QR-Code gibt es nicht mehr.', true);
            return true;
        }
        page = 'plants';
        render();
        detail(m[2]);
        return true;
    }
    if (!find('locations', m[2])) {
        message('Den Behälter zu diesem QR-Code gibt es nicht mehr.', true);
        return true;
    }
    page = 'locations';
    locationView = { mode: 'board', id: 'left' };
    render();
    locationVisit(m[2]);
    return true;
}
