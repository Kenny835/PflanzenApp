'use strict';
/* Handy (0.22): Tippt man in den Standorten auf einen Behälter oder eine Pflanze, öffnet sich ein Aktionsfenster mit großen Knöpfen,
   statt die Auswahl unter der Fläche zu zeigen. Verschieben geht dann per Zielwahl („Verschieben …“), das Ziehen bleibt zusätzlich möglich.
   Am PC (breiter als 850 px) bleibt alles wie bisher. Aufgerufen aus workSelect (desktop.js). */
const workPhoneQuery = '(max-width: 850px)';
function workPhone() {
    try {
        return !!(window.matchMedia && window.matchMedia(workPhoneQuery).matches);
    }
    catch (e) {
        return false;
    }
}
// Welche Knöpfe das Fenster für ein Objekt zeigt (reine Beschreibung, getestet): [Beschriftung, Aktion, Stil]
function workActionList(item, sc, obj) {
    const list = [];
    if (item.kind === 'container') {
        const pot = obj.type === 'pot';
        const plant = db.plants.find(p => p.location_id === obj.id && (p.status || 'active') === 'active');
        if (plant) {
            list.push(['Pflanze ansehen', 'plant-detail']);
            if (pot)
                list.push(['Pflanze verschieben …', 'plant-move']);
        }
        list.push([pot ? 'Topf bearbeiten' : 'Öffnen (Inhalt anzeigen)', 'open']);
        list.push(['Behälter verschieben …', 'move']);
        if (sc.id)
            list.push(['Auf den Parkplatz stellen', 'park', 'secondary']);
        list.push(['Eigenschaften', 'properties', 'secondary'], ['QR-Code', 'qr', 'secondary'], ['Dokumentation', 'doc', 'secondary'], ['Behälter löschen', 'delete', 'danger']);
        return list;
    }
    if (item.kind === 'plant' && !item.sowing_id) {
        return [['Pflanze ansehen', 'plant-detail'], ['Pflanze verschieben …', 'move'], ['Aus dem Planer entfernen', 'unassign', 'secondary'], ['QR-Code', 'qr', 'secondary']];
    }
    return null;
}
async function workParkContainer(obj) {
    const parking = (await api('planner-workspace-scenes', { ids: [''] }))[0];
    await api('planner-workspace-place', {
        kind: 'container', id: obj.id, version: obj.version, target: { location_id: '', col: 0, row: Math.max(0, ...parking.items.map(i => i.row + i.depth)) + 5 }
    });
    await load();
    await board();
    message('„' + obj.name + '“ steht jetzt auf dem Parkplatz.');
}
// Öffnet das Fenster; gibt false zurück, wenn es für dieses Objekt keines gibt (dann gilt das bisherige Verhalten)
function workActionSheet(item, sc, side) {
    const obj = workObject(item);
    const list = obj && workActionList(item, sc, obj);
    if (!list)
        return false;
    const plant = item.kind === 'plant' ? obj : db.plants.find(p => p.location_id === obj.id && (p.status || 'active') === 'active');
    const plantItem = plant && { kind: 'plant', object_id: plant.id, object_version: plant.version, name: plant.name, width: 1, depth: 1 };
    openDialog('<h2></h2><p class="help sheet-info"></p><div class="action-sheet"></div>');
    body.querySelector('h2').textContent = item.name || obj.name;
    const info = item.kind === 'container' ? [obj.type === 'pot' ? 'Topf' : 'Behälter', locationPath(sc.id) || 'Parkplatz', plant ? 'Pflanze: ' + plant.name : '']
        : [obj.label || '', locationPath(sc.id) || 'Parkplatz'];
    body.querySelector('.sheet-info').textContent = info.filter(Boolean).join(' · ');
    const close2 = () => modal.close();
    const actions = {
        'plant-detail': () => detail(plant.id),
        'plant-move': () => workPlaceDialog(plantItem),
        open: () => workOpen(item, side),
        move: () => workPlaceDialog(item.kind === 'plant' ? plantItem || item : item),
        park: () => workParkContainer(obj),
        properties: () => {
            desktopSelection = null;
            workProperties(obj);
        },
        qr: () => qrDialog(item.kind === 'plant' ? 'plant' : 'loc', obj),
        doc: () => locationDetail(obj.id),
        delete: () => workDeleteContainer(obj),
        unassign: () => workUnassignPlants([obj])
    };
    const box = body.querySelector('.action-sheet');
    for (const [text, key, cls] of list) {
        const b = button(text, async () => {
            // Dialoge, die selbst eines öffnen (Eigenschaften, QR-Code, Pflanze), ersetzen dieses; für die übrigen schließen wir es zuerst
            if (!['properties', 'qr', 'doc', 'plant-detail', 'delete'].includes(key))
                close2();
            try {
                await actions[key]();
            }
            catch (e) {
                fail(e);
            }
        }, cls || '');
        box.append(b);
    }
    return true;
}
