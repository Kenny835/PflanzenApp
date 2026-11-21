/* Shared photo decoding: handles missing MIME labels and large camera files. */
async function preparePhoto(file) {
    if (!file || !file.size)
        throw Error('Die gewählte Datei ist leer.');
    if (file.size > 40 * 1024 * 1024)
        throw Error('Das Originalfoto darf höchstens 40 MB groß sein.');
    if (file.type && !file.type.startsWith('image/'))
        throw Error('Bitte eine Bilddatei auswählen.');
    const data = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.onerror = () => reject(Error('Das Foto konnte nicht gelesen werden. Bitte erneut auswählen.'));
        r.readAsDataURL(file);
    });
    return new Promise((resolve, reject) => {
        const img = new Image();
        const timer = setTimeout(() => reject(Error('Das Foto konnte nicht rechtzeitig geladen werden. Bitte als JPEG oder PNG auswählen.')), 30000);
        img.onerror = () => {
            clearTimeout(timer);
            reject(Error('Dieses Bildformat kann der Browser nicht öffnen. Bitte JPEG, PNG oder WebP verwenden; HEIC/HEIF gegebenenfalls vorher umwandeln.'));
        };
        img.onload = () => {
            clearTimeout(timer);
            try {
                const ratio = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight)), canvas = document.createElement('canvas');
                canvas.width = Math.max(1, Math.round(img.naturalWidth * ratio));
                canvas.height = Math.max(1, Math.round(img.naturalHeight * ratio));
                const ctx = canvas.getContext('2d');
                if (!ctx)
                    throw Error('Bildverarbeitung ist in diesem Browser nicht verfügbar.');
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                const png = file.type === 'image/png' || /\.png$/i.test(file.name || ''), result = canvas.toDataURL(png ? 'image/png' : 'image/jpeg', .85);
                if (!result.startsWith('data:image/'))
                    throw Error('Das Foto konnte nicht verarbeitet werden.');
                if (result.length > 19 * 1024 * 1024)
                    throw Error('Das verarbeitete Foto ist noch zu groß. Bitte ein kleineres Foto wählen.');
                resolve(result);
            }
            catch (e) {
                reject(e);
            }
        };
        img.src = data;
    });
}
