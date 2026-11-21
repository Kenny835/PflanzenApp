'use strict';
const templateTypes = {
    pot: 'Topf', quickpot: 'QuickPot · feste Zellen', tray: 'Tray · einzelne Töpfe'
};
function templateMeasure(t) {
    return t.shape === 'round' ? 'Ø ' + t.width + ' cm' : t.width + ' × ' + t.depth + ' ' + (t.unit === 'slots' ? 'Plätze' : 'cm');
}

function templateEdit(t = {}, duplicate = false) {
    openDialog('<h2>' + (!t.id || duplicate ? 'Eigene Vorlage anlegen' : 'Vorlage bearbeiten') + '</h2><p>Außenmaße am oberen Rand bestimmen den Platzbedarf. Bereits platzierte Objekte bleiben unverändert.</p>');
    const values = {
        unit: 'cm', type: 'pot', shape: 'square', width: 7, depth: 7, rows: 6, cols: 8, ...t
    };
    if (duplicate)
        values.name = t.name + ' · eigene Variante';
    const f = document.createElement('form');
    f.className = 'template-form';
    const grid = document.createElement('div');
    grid.className = 'formgrid';
    f.append(grid);
    for (const spec of [['name', 'Name *'], ['type', 'Typ', 'select', Object.entries(templateTypes)], ['shape', 'Form', 'select', [['square', 'Quadratisch'], ['round', 'Rund'], ['rectangle', 'Rechteckig']]], ['unit', 'Einheit', 'select', [['cm', 'cm'], ['slots', 'Rasterplätze']]], ['width', 'Breite / Durchmesser *'], ['depth', 'Tiefe *'], ['rows', 'Reihen (nur Platten)'], ['cols', 'Spalten (nur Platten)'], ['notes', 'Notiz', 'textarea']])
        grid.append(field(spec, values));
    for (const k of ['width', 'depth', 'rows', 'cols']) {
        const el = f.elements[k];
        el.type = 'number';
        el.min = ['rows', 'cols'].includes(k) ? 1 : .1;
        el.max = 3000;
        el.step = ['rows', 'cols'].includes(k) ? 1 : 'any';
    }
    f.elements.name.required = true;
    for (const k of ['type', 'shape', 'unit'])
        f.elements[k].required = true;
    const hint = document.createElement('p');
    hint.className = 'notice';
    f.append(hint);
    const sync = () => {
        const plate = f.elements.type.value !== 'pot', equal = !plate && f.elements.shape.value !== 'rectangle';
        if (plate) {
            f.elements.shape.value = 'rectangle';
            f.elements.unit.value = 'cm';
        }
        f.elements.shape.disabled = plate;
        f.elements.unit.disabled = plate;
        if (equal)
            f.elements.depth.value = f.elements.width.value;
        f.elements.depth.readOnly = equal;
        for (const k of ['rows', 'cols']) {
            f.elements[k].closest('label').hidden = !plate;
            f.elements[k].required = plate;
        }
        hint.textContent = plate ? 'Zellzahl: ' + (Number(f.elements.rows.value) * Number(f.elements.cols.value)) + ' · Das Innenraster verwaltet die Plätze, die Außenmaße den Platz auf dem Tisch.' : 'Runde Töpfe verwenden ihren tatsächlichen Kreisrand für die Kollisionsprüfung.';
    };
    f.oninput = () => {
        dirty = true;
        sync();
    };
    sync();
    f.append(button('Topfmaße auf nächste 0,5 cm aufrunden', () => {
        if (f.elements.type.value !== 'pot')
            return;
        for (const k of ['width', 'depth']) {
            const n = Number(f.elements[k].value);
            if (n > 0)
                f.elements[k].value = Math.ceil((n - 1e-9) * 2) / 2;
        }
        dirty = true;
        sync();
    }, 'secondary'));
    const submit = document.createElement('button');
    submit.textContent = 'Vorlage speichern';
    f.append(submit);
    body.append(f);
    f.onsubmit = async (e) => {
        e.preventDefault();
        submit.disabled = true;
        try {
            const v = {
                ...values, ...Object.fromEntries(new FormData(f)), shape: f.elements.shape.value, unit: f.elements.unit.value
            };
            if (!t.id || duplicate) {
                for (const k of ['id', 'version', 'catalogue_key', 'source_url', 'checked_on', 'verified', 'manufacturer_grid', 'manufacturer_outer_mm', 'cell_height_mm', 'cell_top_mm', 'cell_volume_ml'])
                    delete v[k];
                v.family = 'Eigene Vorlagen';
                v.dimension_basis = 'Eigene Planungsmaße';
                v.hidden = false;
            }
            await api('save', {
                kind: 'templates', id: duplicate ? undefined : t.id, values: v
            });
            dirty = false;
            await load();
            modal.close();
            go('templates');
        }
        catch (err) {
            fail(err);
        }
        finally {
            submit.disabled = false;
        }
    };
}

