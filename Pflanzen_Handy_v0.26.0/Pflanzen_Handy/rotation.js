/* Außenfläche um 90° drehen; lokale Zelladressen bleiben stabil. */
function canRotateObject(obj) {
    return obj && ['pot', 'tray', 'table', 'tub', 'shelf', 'other', 'bed'].includes(obj.type) && obj.shape !== 'round' && obj.footprint?.width && obj.footprint?.depth;
}

const potBeforeRotation = potEditor;
potEditor = function (obj) {
    potBeforeRotation(obj);
    if (canRotateObject(obj))
        $('#locationContent').append(rotationButton(obj, () => potEditor(find('locations', obj.id))));
};
const detailBeforeRotation = locationDetail;
locationDetail = function (id) {
    detailBeforeRotation(id);
    const obj = find('locations', id);
    if (obj?.type !== 'pot' && canRotateObject(obj)) {
        $('#locActions .actions').append(rotationButton(obj, () => locationDetail(id)));
        const info = document.createElement('p');
        info.textContent = 'Aktuelle Stellfläche: ' + obj.footprint.width + ' × ' + obj.footprint.depth + ' ' + (obj.footprint.unit === 'cm' ? 'cm' : 'Plätze') + '. Beim Drehen bleibt die obere linke Ecke fest. Das Innenraster behält seine Zelladressen.';
        $('#locInfo').append(info);
    }
};

// Auch während der Platzwahl drehen, bevor ein zu breites Objekt eingesetzt wird.
const sizeBeforeRotation = sizeFields;
sizeFields = function (form, loc, values) {
    sizeBeforeRotation(form, loc, values);
    form.lastElementChild.append(button('↻ Stellfläche um 90° drehen', () => {
        const w = form.elements.width.value;
        form.elements.width.value = form.elements.depth.value;
        form.elements.depth.value = w;
        form.dispatchEvent(new Event('input', { bubbles: true }));
    }, 'secondary'));
};
function parentRotationControl(plane, obj, area, scale) {
    if (selectionMode || !canRotateObject(obj) || area.width * scale < 28 || area.depth * scale < 28)
        return;
    const control = rotationButton(obj, board);
    control.classList.add('parent-rotation');
    control.textContent = '↻';
    control.title = obj.name + ' um 90° drehen';
    control.setAttribute('aria-label', control.title);
    Object.assign(control.style, { left: (area.col + area.width) * scale - Math.min(28, area.width * scale) + 'px', top: area.row * scale + 'px' });
    control.onpointerdown = e => e.stopPropagation();
    control.ondblclick = e => {
        e.preventDefault();
        e.stopPropagation();
    };
    const rotate = control.onclick;
    control.onclick = e => {
        e.stopPropagation();
        return rotate(e);
    };
    plane.append(control);
}
