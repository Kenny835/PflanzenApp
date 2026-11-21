/* Expliziter Start nach allen Funktionsmodulen. */
(async () => {
    try {
        if (typeof sowingList !== 'function' || typeof builderStart !== 'function')
            throw Error('Module fehlen. Bitte die Version ' + window.APP_VERSION + ' vollständig entpacken und Strg+F5 drücken.');
        // Läuft noch ein älteres Serverprogramm, obwohl die Dateien schon ausgetauscht wurden?
        const info = await fetch('api/version', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).catch(() => null);
        if (info && info.server !== window.APP_VERSION)
            throw Error('Die Oberfläche gehört zu Version ' + window.APP_VERSION + ', der laufende Server aber zu Version ' + info.server + '. Serverfenster schließen und Start_Pflanzen.bat neu starten.');
        await load();
        if (!Array.isArray(db.sowings))
            throw Error('Die Serverversion passt nicht zur Oberfläche. Serverfenster schließen und Start_Pflanzen.bat neu starten.');
        render();
        if (typeof qrOpenFromHash === 'function')
            qrOpenFromHash();
    }
    catch (e) {
        message('Startfehler: ' + e.message, true);
    }
})();
