'use strict';
/* Handy-Version: „Sicherung einspielen“ unter Einstellungen › Daten sichern. */
settingsExtras.push(host => {
    const box = document.createElement('div');
    box.className = 'phone-restore';
    box.innerHTML = '<h3>Sicherung einspielen</h3><p class="help">Wähle eine zuvor heruntergeladene Sicherung (ZIP). <b>Die jetzigen Daten werden dabei ersetzt.</b> Vorher wird automatisch eine Notsicherung im App-Speicher abgelegt.</p><label>Sicherungsdatei<input type="file" accept=".zip,application/zip"></label><div class="actions"></div><p class="notice" role="status"></p>';
    const input = box.querySelector('input'), note = box.querySelector('.notice');
    box.querySelector('.actions').append(button('Sicherung einspielen', async () => {
        const file = input.files[0];
        if (!file)
            throw Error('Bitte zuerst eine Sicherungsdatei wählen.');
        if (!confirm('Die jetzigen Daten werden durch die Sicherung „' + file.name + '“ ersetzt. Fortfahren?'))
            return;
        await window.phoneRestore(file);
        note.textContent = 'Sicherung eingespielt. Die App wird neu geladen …';
        setTimeout(() => location.reload(), 800);
    }, 'secondary'));
    host.append(box);
});
