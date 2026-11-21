/* 0.20 — Sonstiges (Sammelseite), Einstellungen: Schriftgröße, Farbkonzept, Sicherung, Export, Speicherorte.
   Darstellung gilt je Gerät und Browser (localStorage) und wird sofort beim Laden angewendet. */
const appearanceKey = 'pflanzenAussehen';
const appearanceSizes = [['klein', 'Klein', 14], ['normal', 'Normal', 16], ['gross', 'Groß', 18], ['sehrgross', 'Sehr groß', 20]];
// Neues Farbkonzept: einfach einen Eintrag ergänzen. Alle Farben der Oberfläche hängen an diesen sechs Werten.
const appearanceThemes = {
    gruen: { name: 'Grün (Standard)', vars: { '--green': '#285640', '--head': '#234c3c', '--head-sub': '#cddbc8', '--soft': '#edf3e5', '--bg': '#f3f4ee', '--ink': '#203d31' } },
    blau: { name: 'Blau', vars: { '--green': '#255f7e', '--head': '#1f4a63', '--head-sub': '#c9dbe6', '--soft': '#e4eef4', '--bg': '#eef2f5', '--ink': '#1b3445' } },
    erde: { name: 'Erde', vars: { '--green': '#8a4b33', '--head': '#6b3a2a', '--head-sub': '#ead6c9', '--soft': '#f5e8de', '--bg': '#f6f1ec', '--ink': '#3d2a22' } },
    beere: { name: 'Beere', vars: { '--green': '#7a3560', '--head': '#5c2849', '--head-sub': '#e6cddd', '--soft': '#f3e6ee', '--bg': '#f5eff3', '--ink': '#3a2233' } }
};
function appearanceLoad() {
    try {
        const v = JSON.parse(localStorage.getItem(appearanceKey) || '{}');
        return v && typeof v === 'object' ? v : {};
    }
    catch (e) {
        return {};
    }
}
// Symbol im Browser-Tab in der Farbe des Farbkonzepts (Logo als Maske); ohne Canvas bleibt das feste Symbol
let appearanceLogo = null;
function appearanceFavicon(color) {
    try {
        const link = document.getElementById && document.getElementById('favicon');
        if (!link || typeof Image !== 'function' || !document.createElement)
            return;
        const draw = () => {
            const c = document.createElement('canvas');
            c.width = c.height = 64;
            const g = c.getContext('2d');
            g.drawImage(appearanceLogo, 0, 0, 64, 64);
            g.globalCompositeOperation = 'source-in';
            g.fillStyle = color;
            g.fillRect(0, 0, 64, 64);
            link.type = 'image/png';
            link.href = c.toDataURL('image/png');
        };
        if (appearanceLogo && appearanceLogo.complete && appearanceLogo.naturalWidth)
            return draw();
        appearanceLogo = new Image();
        appearanceLogo.onload = () => {
            try {
                draw();
            }
            catch (e) { }
        };
        appearanceLogo.src = 'logo.png';
    }
    catch (e) { }
}
function appearanceApply(v = appearanceLoad()) {
    const root = document.documentElement;
    if (!root)
        return;
    const size = appearanceSizes.find(s => s[0] === v.size) || appearanceSizes[1];
    const theme = appearanceThemes[v.theme] || appearanceThemes.gruen;
    root.style.fontSize = size[2] + 'px';
    for (const [k, val] of Object.entries(theme.vars))
        root.style.setProperty(k, val);
    root.dataset.size = size[0];
    appearanceFavicon(theme.vars['--green']);
    root.dataset.theme = appearanceThemes[v.theme] ? v.theme : 'gruen';
}
function appearanceSet(change) {
    const v = { ...appearanceLoad(), ...change };
    try {
        localStorage.setItem(appearanceKey, JSON.stringify(v));
    }
    catch (e) { }
    appearanceApply(v);
}
try {
    appearanceApply();
}
catch (e) { }

function moreTile(icon, title, hint, fn) {
    const b = button('', fn, 'tile');
    b.innerHTML = '<span class="icon">' + icon + '</span><b>' + esc(title) + '</b><span>' + esc(hint) + '</span>';
    return b;
}
function moreHub() {
    app.innerHTML = '<section class="panel"><h2>Sonstiges</h2><p class="help">Dinge, die du seltener brauchst.</p><div class="tiles" id="moreTiles"></div></section>';
    $('#moreTiles').append(moreTile('▤', 'Behälterbibliothek', 'Topfgrößen und Plattenvorlagen verwalten', () => go('templates')), moreTile('☘', 'Pflegehinweise', 'Hinweise je Gattung und Art', () => go('caretips')), moreTile('▭', 'Etiketten gestalten', 'QR-Etiketten aus Bausteinen zusammenstellen', () => go('labels')), moreTile('⚙', 'Einstellungen', 'Schrift, Farben, Sicherung, Export, Speicherorte', () => go('settings')));
}

const byteText = n => n > 1048576 ? (n / 1048576).toFixed(1).replace('.', ',') + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';
function settingsPage() {
    app.innerHTML = '<section class="panel" id="setLook"></section><section class="panel" id="setData"></section><section class="panel" id="setPlaces"></section>';
    settingsLook($('#setLook'));
    settingsData($('#setData'));
    settingsPlaces($('#setPlaces'));
}
function settingsLook(host) {
    const cur = appearanceLoad();
    host.innerHTML = '<h2>Darstellung</h2><p class="help">Gilt nur für dieses Gerät und diesen Browser. Handy und PC können unterschiedlich eingestellt sein. Das Logo oben links und das Symbol im Browser-Tab passen sich dem Farbkonzept an. Für ein Symbol auf dem Desktop: <b>Desktop_Verknuepfung_erstellen.bat</b> im Programmordner starten (Symbole liegen im Ordner <b>icons</b>).</p><h3>Schriftgröße</h3><div class="actions" id="sizeRow" role="radiogroup" aria-label="Schriftgröße"></div><h3>Farbkonzept</h3><div class="theme-grid" id="themeRow" role="radiogroup" aria-label="Farbkonzept"></div>';
    const sizes = host.querySelector('#sizeRow');
    const mark = () => {
        const v = appearanceLoad(), size = v.size || 'normal', theme = appearanceThemes[v.theme] ? v.theme : 'gruen';
        for (const b of host.querySelectorAll('[data-size]'))
            b.className = b.dataset.size === size ? '' : 'secondary', b.setAttribute('aria-checked', String(b.dataset.size === size));
        for (const b of host.querySelectorAll('[data-theme]'))
            b.classList.toggle('chosen-theme', b.dataset.theme === theme), b.setAttribute('aria-checked', String(b.dataset.theme === theme));
    };
    for (const [id, name, px] of appearanceSizes) {
        const b = button(name, () => {
            appearanceSet({ size: id });
            mark();
        });
        b.dataset.size = id;
        b.setAttribute('role', 'radio');
        b.style.fontSize = px + 'px';
        sizes.append(b);
    }
    const row = host.querySelector('#themeRow');
    for (const [id, t] of Object.entries(appearanceThemes)) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'theme-card';
        b.dataset.theme = id;
        b.setAttribute('role', 'radio');
        b.innerHTML = '<span class="swatches"><i style="background:' + t.vars['--head'] + '"></i><i style="background:' + t.vars['--green'] + '"></i><i style="background:' + t.vars['--soft'] + '"></i></span><b>' + esc(t.name) + '</b>';
        b.onclick = () => {
            appearanceSet({ theme: id });
            mark();
        };
        row.append(b);
    }
    mark();
}
// Handy-Version: zusätzliche Bausteine (z. B. „Sicherung einspielen“) hängen sich hier an; am PC bleibt die Liste leer.
const settingsExtras = [];
function settingsData(host) {
    const restore = window.APP_PHONE ? 'Zum Zurückspielen unten „Sicherung einspielen“ wählen.' : 'Zum Zurückspielen: Server beenden, die Sicherung entpacken und den Ordner <b>data</b> ersetzen.';
    host.innerHTML = '<h2>Daten sichern und exportieren</h2><p class="help">Eine Sicherung enthält die Datenbank und alle Fotos. ' + restore + '</p><div class="actions" id="dataActions"></div><p id="dataNote" class="notice" role="status"></p>';
    const actions = host.querySelector('#dataActions');
    const link = (text, href) => {
        const a = document.createElement('a');
        a.className = 'button secondary';
        a.href = href;
        a.textContent = text;
        return a;
    };
    actions.append(button('Sicherung jetzt im Sicherungsordner ablegen', async () => {
        try {
            const r = await api('backup-now', {});
            host.querySelector('#dataNote').textContent = 'Sicherung ' + r.made.name + ' (' + byteText(r.made.size) + ') abgelegt in ' + r.storage.backup_dir + '.';
            settingsPlaces($('#setPlaces'), r.storage);
        }
        catch (e) {
            fail(e);
        }
    }), link('Sicherung herunterladen (ZIP)', 'api/backup'), link('Pflanzenliste für Excel (CSV)', 'api/export-plants.csv'), link('Alle Daten (JSON)', 'api/export'));
    if (window.APP_PHONE)
        actions.firstChild.remove();
    for (const extra of settingsExtras)
        extra(host);
}
async function settingsPlaces(host, info) {
    host.innerHTML = '<h2>Speicherorte</h2><p class="notice">Lade …</p>';
    try {
        info = info || await api('storage');
    }
    catch (e) {
        host.innerHTML = '<h2>Speicherorte</h2>';
        return fail(e);
    }
    if (window.APP_PHONE) {
        host.innerHTML = '<h2>Speicherort</h2><p class="help">Alle Daten und Fotos liegen nur in diesem Handy-Browser (kein Server, kein Netz nötig). Wenn du die Browserdaten löschst oder die App entfernst, sind sie weg. Lege deshalb regelmäßig eine Sicherung (ZIP) an und speichere sie z. B. in Dateien oder in der Cloud.</p><dl class="paths"></dl>';
        const dl = host.querySelector('.paths');
        for (const [name, value] of [['Datenbank', 'lokal im Browser (IndexedDB)'], ['Fotos', 'lokal im Browser'], ['Größe', byteText(info.photo_bytes ?? 0) + ' Fotos']]) {
            const dt = document.createElement('dt'), dd = document.createElement('dd');
            dt.textContent = name;
            dd.textContent = value;
            dl.append(dt, dd);
        }
        return;
    }
    host.innerHTML = '<h2>Speicherorte</h2><dl class="paths"></dl><h3>Sicherungsordner</h3><p class="help">Beim Start und bei „Sicherung jetzt“ wird hier eine Sicherung abgelegt. Es bleiben die neuesten ' + info.keep + ' automatisch benannten Sicherungen erhalten, ältere werden entfernt. Geeignet ist z. B. ein USB-Stick oder ein Cloud-Ordner. Der Ordner muss auf dem Rechner liegen, auf dem der Server läuft.</p><form id="dirForm" class="inline-form"><label>Ordner (vollständiger Pfad, leer = Standard)<input name="dir" type="text" autocomplete="off" spellcheck="false"></label><button>Speichern</button></form><h3>Vorhandene Sicherungen</h3><div id="backupList"></div>';
    const dl = host.querySelector('.paths');
    for (const [name, value] of [['Datenordner', info.data_dir], ['Datenbank', info.database], ['Fotos', info.photos_dir], ['Sicherungsordner' + (info.backup_dir_custom ? ' (eigener)' : ' (Standard)'), info.backup_dir]]) {
        const dt = document.createElement('dt'), dd = document.createElement('dd');
        dt.textContent = name;
        dd.textContent = value;
        dl.append(dt, dd);
    }
    const form = host.querySelector('#dirForm');
    form.elements.dir.value = info.backup_dir_custom ? info.backup_dir : '';
    form.onsubmit = async (e) => {
        e.preventDefault();
        try {
            const r = await api('backup-dir', { dir: form.elements.dir.value });
            message(form.elements.dir.value.trim() ? 'Sicherungsordner gespeichert.' : 'Standard-Sicherungsordner wiederhergestellt.');
            settingsPlaces(host, r);
        }
        catch (err) {
            fail(err);
        }
    };
    const list = host.querySelector('#backupList');
    if (!info.backups.length)
        list.innerHTML = '<p class="notice">In diesem Ordner liegen noch keine Sicherungen.</p>';
    else {
        const ul = document.createElement('ul');
        ul.className = 'backup-list';
        for (const b of info.backups) {
            const li = document.createElement('li');
            li.textContent = b.time + ' · ' + b.name + ' · ' + byteText(b.size);
            ul.append(li);
        }
        list.append(ul);
    }
}
