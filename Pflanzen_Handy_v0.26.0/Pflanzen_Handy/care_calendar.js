'use strict';
const careDays = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
const dayMillis = 86400000;
// Zufällige Kennung für einen neuen Pflegetermin (funktioniert auch ohne gesicherte Verbindung, anders als crypto.randomUUID)
function careEventId() {
    return Array.from(crypto.getRandomValues(new Uint32Array(4))).join('-');
}
function addWateringDays(form, group) {
    const fieldset = document.createElement('fieldset');
    fieldset.className = 'care-days';
    fieldset.innerHTML = '<legend>Gießkalender · Wochentage</legend>';
    careDays.forEach((name, index) => {
        const label = document.createElement('label');
        label.className = 'inlinecheck';
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.dataset.waterDay = '';
        input.value = index + 1;
        input.checked = (group?.watering_days || []).includes(index + 1);
        label.append(input, name);
        fieldset.append(label);
    });
    form.append(fieldset);
}

// ISO-Kalendertage in UTC rechnen, damit die Zeitumstellung keinen Tag verschiebt.
function wateringDue(group, now) {
    if (!group.watering_days?.length || !group.watering_start)
        return null;
    const start = Math.max(Date.parse(group.watering_start), group.watered_on ? Date.parse(group.watered_on) + dayMillis : 0);
    for (let offset = 0; offset < 7; offset++) {
        const stamp = start + offset * dayMillis;
        if (stamp > Date.parse(now))
            return null;
        if (group.watering_days.includes(new Date(stamp).getUTCDay() || 7))
            return new Date(stamp).toISOString().slice(0, 10);
    }
    return null;
}

async function saveCare(group, values, showGroup) {
    await api('save', {kind: 'groups', id: group.id, values: {...values, version: group.version}});
    dirty = false;
    await load();
    if (modal.open) modal.close();
    render();
    if (showGroup) showCareGroup(find('groups', group.id), 'events');
}

const careSections = [
    ['Bewässerung', ['watering']],
    ['Standort und Substrat', ['light', 'substrate']],
    ['Temperatur und Winterruhe', ['growing_temperature', 'winter_rest', 'temperature']],
    ['Weitere Pflegehinweise', ['care']]
];

function careFold(title) {
    const details = document.createElement('details');
    details.className = 'care-fold';
    const summary = document.createElement('summary');
    summary.textContent = title;
    details.append(summary);
    return details;
}

function arrangeCareForm(form, grid, group) {
    form.classList.add('care-form');
    for (const [title, keys] of careSections) {
        const fold = careFold(title);
        const fields = document.createElement('div');
        fields.className = 'formgrid';
        for (const key of keys) {
            const field = grid.querySelector('[name="' + key + '"]')?.closest('label');
            if (field) fields.append(field);
        }
        fold.append(fields);
        form.append(fold);
    }
    const schedule = document.createElement('div');
    addWateringDays(schedule, group);
    const calendar = document.createElement('section');
    grid.after(schedule, calendar);
    const draft = {id: group?.id || Symbol(), care_events: (group?.care_events || []).map(event => ({...event}))};
    showGroupCalendar(draft, calendar, true);
    return draft.care_events;
}

function showCareGroup(group, section = 'watering') {
    openDialog('<h2>' + esc(group.name) + '</h2><div id="careGroupActions"></div><section id="groupCalendar"></section>');
    actions($('#careGroupActions'), [['Gruppe bearbeiten', () => simpleForm('groups', group)], ['Löschen', () => remove('groups', group), 'secondary']]);
    const host = $('#groupCalendar');
    const navigation = document.createElement('div');
    navigation.className = 'actions';
    navigation.setAttribute('role', 'group');
    navigation.setAttribute('aria-label', 'Kalender auswählen');
    host.before(navigation);
    const sections = [['watering', 'Gießkalender'], ['events', 'Ereigniskalender']];
    function switchCalendar(key) {
        for (const control of navigation.children)
            control.setAttribute('aria-pressed', String(control.dataset.section === key));
        if (key === 'events') {
            showGroupCalendar(group, host);
        } else {
            const days = (group.watering_days || []).map(day => careDays[day - 1]);
            host.innerHTML = '<h3>Gießkalender</h3><p>' + (days.join(' · ') || 'Keine Gießtage festgelegt.') + '</p>';
            actions(host, [['Gießtage bearbeiten', () => simpleForm('groups', group), 'secondary']]);
        }
    }
    for (const [key, title] of sections) {
        const control = button(title, () => switchCalendar(key), 'secondary care-switch');
        control.dataset.section = key;
        navigation.append(control);
    }
    switchCalendar(section);
    const notes = careFold('Pflegeprofil');
    for (const [key, title] of configs.groups) {
        if (key !== 'name' && group[key])
            notes.insertAdjacentHTML('beforeend', '<p><b>' + esc(title) + '</b><br>' + esc(group[key]) + '</p>');
    }
    if (notes.children.length === 1) notes.insertAdjacentHTML('beforeend', '<p>Noch keine Pflegeangaben.</p>');
    const plants = db.plants.filter(plant => plant.group_id === group.id);
    const members = careFold('Zugeordnete Horste (' + plants.length + ')');
    for (const plant of plants) members.append(contact(plant));
    body.append(notes, members);
}

// ISO-Daten in UTC berechnen, unabhängig von Sommerzeit und Client-Zeitzone.
function careMonth(isoDate, offset = 0) {
    const first = new Date(isoDate + 'T00:00:00Z');
    first.setUTCDate(1);
    first.setUTCMonth(first.getUTCMonth() + offset);
    const next = new Date(first);
    next.setUTCMonth(next.getUTCMonth() + 1);
    return {start: first.toISOString().slice(0, 10), gap: (first.getUTCDay() + 6) % 7, length: (next - first) / dayMillis};
}

const careSelectedDates = new Map();

function showGroupCalendar(group, host, editing = false) {
    const now = today();
    const selected = careSelectedDates.get(group.id) || now;
    const month = careMonth(selected);
    host.innerHTML = '<h3>Ereigniskalender</h3>';
    function selectDate(date) {
        careSelectedDates.set(group.id, date);
        showGroupCalendar(group, host, editing);
    }
    const toolbar = document.createElement('div');
    toolbar.className = 'care-month-bar';
    const caption = document.createElement('strong');
    caption.textContent = new Date(month.start).toLocaleDateString('de-DE', {month:'long', year:'numeric', timeZone:'UTC'});
    toolbar.append(button('‹', () => selectDate(careMonth(selected, -1).start), 'secondary'), caption,
        button('›', () => selectDate(careMonth(selected, 1).start), 'secondary'), button('Heute', () => selectDate(now), 'secondary'));
    toolbar.firstChild.setAttribute('aria-label', 'Vorheriger Monat');
    toolbar.children[2].setAttribute('aria-label', 'Nächster Monat');
    const grid = document.createElement('div');
    grid.className = 'care-month';
    for (const weekday of careDays) {
        const heading = document.createElement('small');
        heading.textContent = weekday;
        grid.append(heading);
    }
    const events = sortedCareEvents(group);
    for (let day = 1; day <= month.length; day++) {
        const date = month.start.slice(0, 8) + String(day).padStart(2, '0');
        const entries = events.filter(event => event.date === date);
        const cell = button(String(day), () => selectDate(date), 'care-day secondary');
        if (day === 1) cell.style.gridColumnStart = month.gap + 1;
        cell.setAttribute('aria-pressed', String(date === selected));
        if (date === now) cell.setAttribute('aria-current', 'date');
        if (entries.length) {
            const badge = document.createElement('small');
            badge.textContent = String(entries.length);
            cell.append(badge);
        }
        cell.title = [date, ...entries.map(event => event.title)].join(' · ');
        cell.setAttribute('aria-label', cell.title);
        grid.append(cell);
    }
    host.append(toolbar, grid);
    const dayLabel = new Date(selected).toLocaleDateString('de-DE', {day:'numeric', month:'long', year:'numeric', timeZone:'UTC'});
    const dayEvents = events.filter(event => event.date === selected);
    host.insertAdjacentHTML('beforeend', '<h4>' + esc(dayLabel) + ' · ' + (dayEvents.length || 'Keine') + ' ' + (dayEvents.length === 1 ? 'Ereignis' : 'Ereignisse') + '</h4>');
    if (editing) {
        const refresh = () => showGroupCalendar(group, host, true);
        actions(host, [['Ereignis anlegen', () => {
            const id = careEventId();
            group.care_events.push({id, date: selected, title: '', note: ''});
            dirty = true;
            refresh();
            host.querySelectorAll('[data-event-title]')[dayEvents.length]?.focus();
        }]]);
        for (const event of dayEvents) {
            const row = document.createElement('fieldset');
            row.className = 'care-entry';
            row.innerHTML = '<legend>' + (event.done ? 'Erledigtes Ereignis' : 'Ereignis') + '</legend><label>Titel<input data-event-title required></label><label>Notiz<textarea></textarea></label>';
            const title = row.querySelector('input'), note = row.querySelector('textarea');
            title.value = event.title;
            note.value = event.note || '';
            title.oninput = () => { event.title = title.value; };
            note.oninput = () => { event.note = note.value; };
            if (!event.title) {
                actions(row, [['Eintrag verwerfen', () => {
                    group.care_events.splice(group.care_events.indexOf(event), 1);
                    dirty = true;
                    refresh();
                }, 'secondary']]);
            }
            host.append(row);
        }
        return;
    }
    actions(host, [['Ereignis anlegen', () => editCareEvent(group, null, true, selected)]]);
    for (const event of dayEvents) showCareEvent(host, group, event, true);
}

function sortedCareEvents(group) {
    return [...(group.care_events || [])].sort((a, b) => a.date.localeCompare(b.date));
}

function editCareEvent(group, event, showGroup, date = today()) {
    openDialog('<h2>' + (event ? 'Pflegetermin bearbeiten' : 'Pflegetermin anlegen') + ' · ' + esc(group.name) +
        '</h2><form id="careEventForm"><label>Datum<input name="date" type="date" required></label><label>Titel<input name="title" required></label><label>Notiz<textarea name="note"></textarea></label><button>Speichern</button></form>');
    const form = $('#careEventForm');
    form.elements.date.value = event?.date || date;
    form.elements.title.value = event?.title || '';
    form.elements.note.value = event?.note || '';
    form.oninput = () => dirty = true;
    form.onsubmit = async e => {
        e.preventDefault();
        const values = Object.fromEntries(new FormData(form));
        const updated = {...event, ...values, id: event?.id || careEventId()};
        const events = (group.care_events || []).filter(item => item.id !== updated.id);
        try {
            if (showGroup) careSelectedDates.set(group.id, updated.date);
            await saveCare(group, {care_events: [...events, updated]}, showGroup);
        } catch (error) {
            fail(error);
        }
    };
}

function showCareEvent(host, group, event, showGroup) {
    const row = document.createElement('article');
    row.className = 'care-entry';
    const dateLabel = event.date.split('-').reverse().join('.');
    row.innerHTML = '<strong>' + esc(showGroup ? event.title : group.name + ' · ' + event.title) + '</strong> · ' + esc(dateLabel) +
        (event.done ? ' · Erledigt' : '') + (event.note ? '<p>' + esc(event.note) + '</p>' : '');
    if (!event.done) {
        actions(row, [
            ['Erledigt', () => saveCare(group, {care_events: group.care_events.map(item => item.id === event.id ? {...item, done: true} : item)}, showGroup)],
            ['Verschieben / Bearbeiten', () => editCareEvent(group, event, showGroup), 'secondary']
        ]);
    }
    host.append(row);
}

function showCareToday() {
    const host = $('#careToday');
    const now = today();
    host.replaceChildren();
    host.dataset.date = now;
    host.insertAdjacentHTML('beforeend', '<h3>Heute gießen</h3>');
    let waterCount = 0;
    for (const group of db.groups) {
        const due = wateringDue(group, now);
        if (!due) continue;
        const late = (Date.parse(now) - Date.parse(due)) / dayMillis;
        const row = document.createElement('article');
        row.className = 'care-entry';
        row.innerHTML = '<strong>' + esc(group.name) + '</strong>' + (late ? '<small class="care-late">Gießen seit ' + late + (late === 1 ? ' Tag' : ' Tagen') + ' überfällig</small>' : '');
        actions(row, [['Ist gegossen', () => saveCare(group, {watered_on: today()}, false)]]);
        host.append(row);
        waterCount++;
    }
    if (!waterCount) host.insertAdjacentHTML('beforeend', '<p class="muted">Heute ist keine Gießrunde offen.</p>');
    host.insertAdjacentHTML('beforeend', '<h3>Pflegetermine</h3>');
    const dueEvents = db.groups.flatMap(group => sortedCareEvents(group)
        .filter(event => !event.done && event.date <= now).map(event => ({group, event})));
    dueEvents.sort((a, b) => a.event.date.localeCompare(b.event.date));
    for (const {group, event} of dueEvents)
        showCareEvent(host, group, event, false);
    if (!dueEvents.length) host.insertAdjacentHTML('beforeend', '<p class="muted">Keine fälligen Pflegetermine.</p>');
}

// Auch bei über Nacht geöffneter Startseite auf den neuen Kalendertag wechseln.
setInterval(() => {
    const host = $('#careToday');
    if (host && host.dataset.date !== today()) showCareToday();
}, 30000);
