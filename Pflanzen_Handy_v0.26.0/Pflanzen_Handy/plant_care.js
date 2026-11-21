'use strict';
/* Pflanzenansicht (0.24): schnelle Pflegeeinträge, Verlauf als Zeitleiste (Pflege, Notizen, Standort, Fotos) und
   Pflegehinweise je Gattung oder Art. Eigenständiges Modul; wird aus detail() in app.js aufgerufen. */
const careTypes = [['water', 'Gegossen', false], ['fertilize', 'Gedüngt', false], ['repot', 'Umgetopft', true], ['bloom', 'Blüte', true], ['pest', 'Schädling / Krankheit', true]];
const careTypeNames = Object.fromEntries(careTypes.map(t => [t[0], t[1]]));
const careFilters = [['all', 'Alles'], ['care', 'Pflege'], ['note', 'Notizen'], ['system', 'Standort & Status'], ['photo', 'Fotos']];
const careFields = [['water', 'Wasser'], ['light', 'Licht'], ['substrate', 'Substrat'], ['climate', 'Temperatur / Winterruhe'], ['fertilizer', 'Düngung'], ['notes', 'Weiteres']];
let careProfiles = [], careProfilesLoaded = false, careFilter = 'all';

// --- Reine Funktionen (getestet)
// Sortierschlüssel aus einem Datum, das auch ungenau sein darf („2026“, „2026-11“, „unbekannt“)
function plantDateKey(s) {
    const t = String(s ?? '').trim();
    let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
    if (m)
        return m[1] + '-' + m[2] + '-' + m[3];
    if (m = /^(\d{4})-(\d{2})$/.exec(t))
        return m[1] + '-' + m[2] + '-00';
    if (m = /^(\d{4})$/.exec(t))
        return m[1] + '-00-00';
    return '0000-00-00';
}
function careDate(s) {
    const t = String(s ?? '').trim(), m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
    return m ? m[3] + '.' + m[2] + '.' + m[1] : t || 'Datum offen';
}
// Gruppe eines Eintrags für die Filter: care, note, system, photo
function careGroup(entry) {
    return entry.kind === 'photo' ? 'photo' : entry.kind === 'system' ? 'system' : careTypeNames[entry.type] && entry.type !== 'note' ? 'care' : 'note';
}
// Alle Einträge einer Pflanze, neueste zuerst: Ereignisse (Pflege, Notizen, Standortwechsel) und Fotos
function plantTimeline(p, data) {
    const out = [];
    (data.events || []).forEach((e, i) => {
        if (e.plant_id === p.id)
            out.push({ kind: e.kind === 'system' ? 'system' : 'event', type: e.type || 'note', date: e.date, text: e.notes, event: e, order: i });
    });
    (data.photos || []).forEach((x, i) => {
        if (x.plant_id === p.id)
            out.push({ kind: 'photo', type: 'photo', date: x.date, text: x.description || (x.main ? 'Hauptbild' : 'Foto'), photo: x, order: 100000 + i });
    });
    for (const e of out)
        e.key = plantDateKey(e.date);
    out.sort((a, b) => a.key < b.key ? 1 : a.key > b.key ? -1 : b.order - a.order);
    return out;
}
// Welche Pflegehinweise gelten für die Pflanze: die für Gattung und Art, sonst die für die Gattung allein
function careProfileFor(p, profiles) {
    const g = String(p.genus ?? '').trim().toLocaleLowerCase('de'), sp = String(p.species ?? '').trim().toLocaleLowerCase('de');
    if (!g)
        return null;
    const list = profiles || [];
    return (sp && list.find(x => x.genus.toLocaleLowerCase('de') === g && x.species.toLocaleLowerCase('de') === sp)) || list.find(x => x.genus.toLocaleLowerCase('de') === g && !x.species) || null;
}
const careNewId = () => 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

// --- Pflegehinweise laden und speichern
async function careLoad(force = false) {
    if (careProfilesLoaded && !force)
        return careProfiles;
    try {
        careProfiles = (await api('care-profiles')).profiles || [];
        careProfilesLoaded = true;
    }
    catch (e) {
        careProfiles = [];
    }
    return careProfiles;
}
async function careSave(list) {
    careProfiles = (await api('care-profiles', { profiles: list })).profiles;
    careProfilesLoaded = true;
    return careProfiles;
}

// --- Schnelle Pflegeeinträge
function plantQuickCare(host, p) {
    host.replaceChildren();
    const title = document.createElement('h3');
    title.textContent = 'Schnell eintragen';
    const row = document.createElement('div');
    row.className = 'actions quick-care';
    const info = document.createElement('p');
    info.className = 'notice';
    info.setAttribute('role', 'status');
    const form = document.createElement('div');
    host.append(title, row, form, info);
    const refresh = () => {
        plantTimelineView($('#timeline'), p);
    };
    const save = async (type, text, date) => {
        const r = await api('save', { kind: 'events', values: { plant_id: p.id, kind: 'note', type, date: date || today(), notes: text } });
        await load();
        refresh();
        info.textContent = '';
        info.append(careTypeNames[type] + ' am ' + careDate(date || today()) + ' eingetragen. ');
        info.append(button('Rückgängig', async () => {
            try {
                await api('delete', { kind: 'events', id: r[0].id, confirm: 'löschen' });
                await load();
                refresh();
                info.textContent = 'Eintrag zurückgenommen.';
            }
            catch (e) {
                fail(e);
            }
        }, 'secondary'));
    };
    for (const [type, text, ask] of careTypes) {
        row.append(button(text, async () => {
            form.replaceChildren();
            if (!ask)
                return save(type, text);
            const f = document.createElement('form');
            f.className = 'quick-form';
            f.innerHTML = '<label>Datum<input name="date" type="date" required></label><label>Notiz (optional)<input name="notes" maxlength="300" placeholder="' + (type === 'repot' ? 'z. B. in 11-cm-Topf, neues Substrat' : type === 'bloom' ? 'z. B. erste Blüte, 3 Blüten' : 'z. B. Thripse, behandelt mit …') + '"></label><button>' + esc(text) + ' eintragen</button>';
            f.elements.date.value = today();
            f.onsubmit = async (e) => {
                e.preventDefault();
                try {
                    await save(type, f.elements.notes.value.trim() ? text + ': ' + f.elements.notes.value.trim() : text, f.elements.date.value);
                    form.replaceChildren();
                }
                catch (err) {
                    fail(err);
                }
            };
            form.append(f);
            f.elements.notes.focus();
        }, 'secondary'));
    }
}

// --- Verlauf
function plantTimelineView(host, p) {
    if (!host)
        return;
    host.replaceChildren();
    const entries = plantTimeline(p, db);
    const bar = document.createElement('div');
    bar.className = 'actions timeline-filter';
    const list = document.createElement('div');
    list.className = 'timeline-list';
    const draw = () => {
        list.replaceChildren();
        const shown = entries.filter(e => careFilter === 'all' || careGroup(e) === careFilter);
        if (!shown.length) {
            const none = document.createElement('p');
            none.className = 'notice';
            none.textContent = 'Noch keine Einträge in dieser Ansicht.';
            list.append(none);
        }
        for (const e of shown) {
            const row = document.createElement('div');
            row.className = 'timeline-row tl-' + careGroup(e);
            const date = document.createElement('span');
            date.className = 'tl-date';
            date.textContent = careDate(e.date);
            const tag = document.createElement('span');
            tag.className = 'tl-tag';
            tag.textContent = e.kind === 'photo' ? 'Foto' : e.kind === 'system' ? 'Standort / Status' : careTypeNames[e.type] && e.type !== 'note' ? careTypeNames[e.type] : 'Notiz';
            const text = document.createElement('span');
            text.className = 'tl-text';
            text.textContent = e.text || '';
            row.append(date, tag, text);
            if (e.photo) {
                const a = document.createElement('a');
                a.href = 'photos/' + e.photo.file;
                a.target = '_blank';
                a.rel = 'noopener';
                a.innerHTML = '<img class="tl-thumb" loading="lazy" alt="">';
                a.firstChild.src = 'photos/' + e.photo.file;
                row.append(a);
            }
            else if (e.kind !== 'system') {
                const b = button('Ändern', () => eventEdit(e.event), 'secondary');
                b.className += ' tl-edit';
                row.append(b);
            }
            list.append(row);
        }
    };
    for (const [id, text] of careFilters) {
        const count = id === 'all' ? entries.length : entries.filter(e => careGroup(e) === id).length;
        const b = button(text + ' (' + count + ')', () => {
            careFilter = id;
            plantTimelineView(host, p);
        }, careFilter === id ? '' : 'secondary');
        b.setAttribute('aria-pressed', String(careFilter === id));
        bar.append(b);
    }
    host.append(bar, list);
    draw();
}

// --- Pflegehinweise je Gattung/Art in der Pflanzenansicht
async function plantCareProfileView(host, p) {
    if (!host)
        return;
    await careLoad();
    host.replaceChildren();
    const profile = careProfileFor(p, careProfiles);
    const title = document.createElement('h3');
    title.textContent = 'Pflegehinweise';
    host.append(title);
    if (profile) {
        const src = document.createElement('p');
        src.className = 'badge';
        src.textContent = 'Für ' + profile.genus + (profile.species ? ' ' + profile.species : ' (Gattung)');
        host.append(src);
        const dl = document.createElement('div');
        dl.className = 'detailgrid';
        for (const [k, name] of careFields)
            if (profile[k]) {
                const d = document.createElement('dl');
                const dt = document.createElement('dt'), dd = document.createElement('dd');
                dt.textContent = name;
                dd.textContent = profile[k];
                d.append(dt, dd);
                dl.append(d);
            }
        host.append(dl);
    }
    else
        host.append(Object.assign(document.createElement('p'), { className: 'help', textContent: p.genus ? 'Für ' + p.genus + (p.species ? ' ' + p.species : '') + ' sind noch keine Pflegehinweise hinterlegt.' : 'Ohne Gattung gibt es keine Pflegehinweise.' }));
    const g = (p.group_id || p.effective_care?.group_id) && find('groups', p.group_id || p.effective_care.group_id);
    if (g && (g.watering || g.light || g.substrate || g.winter_rest || g.care)) {
        const gp = document.createElement('details');
        gp.innerHTML = '<summary>Pflegegruppe „' + esc(g.name) + '“</summary>';
        for (const [k, name] of [['watering', 'Wasser'], ['light', 'Licht'], ['substrate', 'Substrat'], ['winter_rest', 'Winterruhe'], ['care', 'Weiteres']])
            if (g[k])
                gp.insertAdjacentHTML('beforeend', '<p><b>' + name + ':</b> ' + esc(g[k]) + '</p>');
        host.append(gp);
    }
    if (p.genus)
        host.append(button(profile ? 'Hinweise bearbeiten' : 'Hinweise für ' + p.genus + ' anlegen', () => careProfileEditor(profile, { genus: p.genus, species: p.species || '' }, () => detail(p.id)), 'secondary'));
}
// Bearbeiten (profile gesetzt) oder Anlegen (profile null, start = Gattung/Art zum Vorbelegen)
function careProfileEditor(profile, start, after) {
    openDialog('<h2>' + (profile ? 'Pflegehinweise bearbeiten' : 'Pflegehinweise anlegen') + '</h2><p class="help">Gelten für alle Pflanzen dieser Gattung. Mit Art gelten sie nur für diese Art und gehen den Hinweisen der Gattung vor.</p>');
    const f = document.createElement('form');
    f.className = 'formgrid';
    const cur = profile || { id: careNewId(), genus: start?.genus || '', species: start?.species || '' };
    f.innerHTML = '<label>Gattung *<input name="genus" required maxlength="80"></label><label>Art (freiwillig)<input name="species" maxlength="80"></label>' + careFields.map(([k, name]) => '<label class="full">' + esc(name) + '<textarea name="' + k + '" maxlength="600" rows="2"></textarea></label>').join('');
    for (const k of ['genus', 'species', ...careFields.map(x => x[0])])
        f.elements[k].value = cur[k] || '';
    f.oninput = () => dirty = true;
    const row = document.createElement('div');
    row.className = 'actions full';
    row.append(Object.assign(document.createElement('button'), { textContent: 'Speichern' }));
    if (profile)
        row.append(button('Löschen', async () => {
            if (!confirm('Pflegehinweise für ' + profile.genus + (profile.species ? ' ' + profile.species : '') + ' löschen?'))
                return;
            try {
                await careSave(careProfiles.filter(x => x.id !== profile.id));
                dirty = false;
                modal.close();
                message('Pflegehinweise gelöscht.');
                after?.();
            }
            catch (e) {
                fail(e);
            }
        }, 'secondary'));
    f.append(row);
    f.onsubmit = async (e) => {
        e.preventDefault();
        try {
            const item = { id: cur.id };
            for (const k of ['genus', 'species', ...careFields.map(x => x[0])])
                item[k] = f.elements[k].value;
            await careSave(careProfiles.filter(x => x.id !== cur.id).concat([item]));
            dirty = false;
            modal.close();
            message('Pflegehinweise gespeichert.');
            after?.();
        }
        catch (err) {
            fail(err);
        }
    };
    body.append(f);
}

// --- Übersicht unter Sonstiges
async function careTipsPage() {
    app.innerHTML = '<section class="panel"><h2>Pflegehinweise je Gattung und Art</h2><p class="help">Diese Hinweise erscheinen in der Ansicht jeder passenden Pflanze. Neue legst du direkt in einer Pflanze an („Hinweise anlegen“) oder hier.</p><div id="tipsList"></div></section>';
    await careLoad(true);
    const host = $('#tipsList');
    host.append(button('＋ Neue Pflegehinweise', () => careProfileEditor(null, null, careTipsPage)));
    if (!careProfiles.length) {
        host.append(Object.assign(document.createElement('p'), { className: 'notice', textContent: 'Noch keine Pflegehinweise angelegt.' }));
        return;
    }
    const list = document.createElement('div');
    list.className = 'list';
    for (const x of [...careProfiles].sort((a, b) => (a.genus + ' ' + a.species).localeCompare(b.genus + ' ' + b.species, 'de'))) {
        const n = db.plants.filter(p => careProfileFor(p, [x]) === x && p.status === 'active').length;
        const b = button('', () => careProfileEditor(x, null, careTipsPage), 'secondary');
        b.innerHTML = '<b>' + esc(x.genus + (x.species ? ' ' + x.species : '')) + '</b> <small>' + n + (n === 1 ? ' Pflanze' : ' Pflanzen') + '</small>';
        list.append(b);
    }
    host.append(list);
}
