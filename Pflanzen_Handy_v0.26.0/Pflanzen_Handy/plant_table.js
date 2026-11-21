'use strict';
/* Meine Pflanzen als Tabelle mit Seiten (50 oder 100 Einträge) und sortierbaren Spalten.
   Eigenständiges Modul: app.js ruft renderPlantTable() aus listResults() auf.
   Reine Funktionen (plantValue, plantSortRows, plantPageInfo) sind getestet; der Rest baut nur die Tabelle. */
const plantPageSizes = [50, 100];
// Zusatzspalten (0.25) sind zunächst ausgeblendet; „hidden“ enthält die Schlüssel der ausgeblendeten Spalten.
const plantExtraColumns = ['clone', 'source', 'pot', 'role'];
const plantView = { sort: 'name', dir: 'asc', page: 1, size: 50, hidden: [...plantExtraColumns] };
// [Schlüssel, Überschrift, nur auf breiten Bildschirmen]
const plantColumns = [['select', ''], ['label', 'ID', 'col-label'], ['name', 'Name'], ['species', 'Gattung / Art', 'narrow-hide'], ['place', 'Standort'], ['group', 'Pflegegruppe', 'narrow-hide'], ['status', 'Status', 'narrow-hide'], ['year', 'Zugang', 'narrow-hide'], ['clone', 'Klon / Sorte', 'narrow-hide'], ['source', 'Bezugsquelle', 'narrow-hide'], ['pot', 'Topf', 'narrow-hide'], ['role', 'Funktion', 'narrow-hide']];
const plantShownColumns = view => plantColumns.filter(c => c[0] === 'select' || c[0] === 'name' || !(view.hidden || plantExtraColumns).includes(c[0]));

// Wert einer Pflanze für die Sortierung (Zahl bei „Zugang“, sonst Text)
function plantValue(p, key) {
    if (key === 'species')
        return ((p.genus || '') + ' ' + (p.species || '')).trim();
    if (key === 'place')
        return place(p);
    if (key === 'group') {
        const g = p.effective_care?.group_id || p.group_id;
        return g ? label('groups', g) : '';
    }
    if (key === 'status')
        return statusNames[p.status] || '';
    if (key === 'year')
        return Number(p.year) || 0;
    if (key === 'clone')
        return p.clone_name || '';
    if (key === 'role')
        return (typeof roles === 'object' && roles[p.role]) || p.role || '';
    return p[key] || '';
}

// Sortiert stabil und deutsch (Zahlen in IDs richtig geordnet); leere Werte stehen immer am Ende, Gleiche nach Name und ID.
function plantSortRows(rows, view, valueOf = plantValue) {
    const sign = view.dir === 'desc' ? -1 : 1;
    const values = new Map(rows.map(p => [p.id, valueOf(p, view.sort)]));
    const empty = v => v === '' || v === 0 || v === undefined || v === null;
    const compare = (a, b) => typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b), 'de', { numeric: true, sensitivity: 'base' });
    return [...rows].sort((a, b) => {
        const x = values.get(a.id), y = values.get(b.id);
        if (empty(x) !== empty(y))
            return empty(x) ? 1 : -1;
        return sign * compare(x, y) || String(a.name || '').localeCompare(String(b.name || ''), 'de') || String(a.label || '').localeCompare(String(b.label || ''), 'de', { numeric: true });
    });
}

// Welche Zeilen gehören auf die aktuelle Seite? Seite und Größe werden auf gültige Werte begrenzt.
function plantPageInfo(total, view) {
    const size = plantPageSizes.includes(Number(view.size)) ? Number(view.size) : plantPageSizes[0];
    const pages = Math.max(1, Math.ceil(total / size));
    const page = Math.min(Math.max(1, Math.floor(Number(view.page)) || 1), pages);
    const from = total ? (page - 1) * size : 0;
    return { size, pages, page, from, to: Math.min(total, from + size) };
}

const plantNumber = n => Number(n).toLocaleString('de-DE');

function plantPager(info, total) {
    const bar = document.createElement('div');
    bar.className = 'pager';
    bar.setAttribute('role', 'navigation');
    bar.setAttribute('aria-label', 'Seiten der Pflanzenliste');
    const count = document.createElement('span');
    count.className = 'pager-count';
    count.textContent = 'Horste ' + plantNumber(info.from + 1) + '–' + plantNumber(info.to) + ' von ' + plantNumber(total);
    const go = (page) => {
        plantView.page = page;
        listResults();
    };
    const nav = (text, aria, page, disabled) => {
        const b = button(text, () => go(page), 'secondary');
        b.setAttribute('aria-label', aria);
        b.disabled = disabled;
        return b;
    };
    const at = document.createElement('span');
    at.className = 'pager-at';
    at.textContent = 'Seite ' + plantNumber(info.page) + ' von ' + plantNumber(info.pages);
    const size = document.createElement('select');
    size.setAttribute('aria-label', 'Einträge je Seite');
    for (const n of plantPageSizes)
        size.append(new Option(n + ' je Seite', n));
    size.value = String(info.size);
    size.onchange = () => {
        plantView.size = Number(size.value);
        plantView.page = 1;
        listResults();
    };
    bar.append(count, nav('«', 'Erste Seite', 1, info.page === 1), nav('‹ Zurück', 'Vorherige Seite', info.page - 1, info.page === 1), at, nav('Weiter ›', 'Nächste Seite', info.page + 1, info.page === info.pages), nav('»', 'Letzte Seite', info.pages, info.page === info.pages), size);
    if (total > info.to - info.from)
        bar.append(button('Alle ' + plantNumber(total) + ' auswählen', () => {
            for (const id of detailOrder)
                selected.add(id);
            listResults();
        }, 'secondary'));
    return bar;
}

function plantTable(rows, view) {
    const table = document.createElement('table');
    table.className = 'plant-table';
    const caption = document.createElement('caption');
    caption.className = 'sr-only';
    caption.textContent = 'Pflanzenliste, sortiert nach ' + (plantColumns.find(c => c[0] === view.sort)?.[1] || 'Name') + (view.dir === 'desc' ? ' absteigend' : ' aufsteigend');
    table.append(caption);
    const boxes = [];
    const headBox = document.createElement('input');
    const syncHead = () => {
        const chosen = rows.filter(p => selected.has(p.id)).length;
        headBox.checked = rows.length > 0 && chosen === rows.length;
        headBox.indeterminate = chosen > 0 && chosen < rows.length;
    };
    const thead = document.createElement('thead'), hr = document.createElement('tr');
    for (const [key, title, cls] of plantShownColumns(view)) {
        const th = document.createElement('th');
        th.scope = 'col';
        th.className = (cls || '') + ' col-' + key;
        if (key === 'select') {
            headBox.type = 'checkbox';
            headBox.setAttribute('aria-label', 'Alle Pflanzen dieser Seite auswählen');
            headBox.onchange = () => {
                rows.forEach((p, i) => {
                    headBox.checked ? selected.add(p.id) : selected.delete(p.id);
                    boxes[i].checked = headBox.checked;
                    boxes[i].closest('tr').classList.toggle('selected', headBox.checked);
                });
                bulkBar();
            };
            th.append(headBox);
        }
        else {
            const active = view.sort === key;
            th.setAttribute('aria-sort', active ? (view.dir === 'desc' ? 'descending' : 'ascending') : 'none');
            const b = button(title, () => {
                view.dir = active && view.dir === 'asc' ? 'desc' : 'asc';
                view.sort = key;
                view.page = 1;
                listResults();
            }, 'sort');
            b.setAttribute('aria-label', 'Nach ' + title + ' sortieren');
            th.append(b);
        }
        hr.append(th);
    }
    thead.append(hr);
    const tbody = document.createElement('tbody');
    for (const p of rows) {
        const tr = document.createElement('tr');
        tr.className = selected.has(p.id) ? 'selected' : '';
        for (const [key, , cls] of plantShownColumns(view)) {
            const td = document.createElement('td');
            td.className = (cls || '') + ' col-' + key;
            if (key === 'select') {
                const cb = document.createElement('input');
                cb.type = 'checkbox';
                cb.checked = selected.has(p.id);
                cb.setAttribute('aria-label', p.name + ' auswählen');
                cb.onchange = () => {
                    cb.checked ? selected.add(p.id) : selected.delete(p.id);
                    tr.classList.toggle('selected', cb.checked);
                    syncHead();
                    bulkBar();
                };
                boxes.push(cb);
                td.append(cb);
            }
            else if (key === 'name') {
                const open = button('', () => detail(p.id), 'plant-open');
                open.innerHTML = thumb(p) + '<span><strong>' + esc(p.name) + '</strong><small class="name-id">' + esc(p.label) + '</small><small class="name-where">' + esc(plantValue(p, 'place')) + (p.status !== 'active' ? ' · ' + esc(statusNames[p.status] || '') : '') + '</small></span>';
                td.append(open);
            }
            else if (key === 'year')
                td.textContent = p.year || '';
            else
                td.textContent = plantValue(p, key);
            tr.append(td);
        }
        tr.onclick = e => {
            if (!e.target.closest('input, button'))
                detail(p.id);
        };
        tbody.append(tr);
    }
    table.append(thead, tbody);
    syncHead();
    return table;
}

// Sortiert, teilt in Seiten und zeigt die aktuelle Seite in #plants
function renderPlantTable(all) {
    const sorted = plantSortRows(all, plantView);
    detailOrder = sorted.map(p => p.id);
    const info = plantPageInfo(sorted.length, plantView);
    plantView.page = info.page;
    plantView.size = info.size;
    const host = $('#plants');
    host.replaceChildren();
    if (!sorted.length) {
        host.innerHTML = empty('Keine passenden Pflanzen. Neue Horste über „Pflanze hinzufügen“ erfassen.');
        return;
    }
    const scroll = document.createElement('div');
    scroll.className = 'table-scroll';
    scroll.append(plantTable(sorted.slice(info.from, info.to), plantView));
    host.append(plantPager(info, sorted.length), scroll, plantPager(info, sorted.length));
}
