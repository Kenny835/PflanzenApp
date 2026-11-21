# Pflanzen-App fürs Handy (Offline-Web-App)

Die Handy-Version enthält dieselbe Oberfläche und dieselbe Logik wie die PC-Version. Sie braucht **keinen Server**:
Python läuft als WebAssembly im Browser (Pyodide), die Datenbank und die Fotos liegen **nur auf dem Handy** (Browserspeicher, IndexedDB).
Nach dem ersten Öffnen funktioniert sie auch ohne Internet.

## Wichtig vorweg
- Die Daten der Handy-Version sind **getrennt** von denen am PC. Austausch nur über **Sicherung (ZIP)**: am PC oder am Handy unter Einstellungen › „Sicherung herunterladen“, auf dem anderen Gerät „Sicherung einspielen“. Dabei werden die dortigen Daten ersetzt.
- Es gibt **keine automatische Sicherung**. Bitte regelmäßig eine Sicherung herunterladen und in „Dateien“ oder einer Cloud ablegen.
- Löschst du die Browserdaten oder entfernst die App, sind die Daten weg. Auf dem iPhone (Safari) räumt iOS Websitedaten, die lange nicht benutzt werden, nach einigen Tagen auf – deshalb dort **unbedingt „Zum Home-Bildschirm“** hinzufügen (dann gilt das nicht) und Sicherungen machen.
- Ändert sich die Internetadresse der App, sind die Daten unter der neuen Adresse leer (Sicherung einspielen).
- QR-Etiketten aus der PC-Version öffnen die PC-Adresse, nicht die Handy-App.

## Ausprobieren am PC (Windows)
1. Ordner `Pflanzen_Handy` entpacken, Python muss installiert sein (wie für die PC-Version).
2. `Start_Handy_Test_am_PC.bat` starten; der Browser öffnet http://localhost:8000. Die erste Ladung dauert einige Sekunden.

## Auf das Handy bringen
Handys erlauben die Offline-Funktion nur bei einer **https-Adresse**. Die App-Dateien enthalten keine persönlichen Daten, du brauchst also nur einen Webspeicher, der den Ordner `Pflanzen_Handy` ausliefert:
- **GitHub Pages** (kostenlos): neues Repository anlegen, den **Inhalt** von `Pflanzen_Handy` hochladen, unter Settings › Pages „Deploy from a branch“ (main, Ordner /root) wählen. Adresse: `https://<name>.github.io/<repo>/`.
- **Netlify Drop** (netlify.com/drop) oder **Cloudflare Pages**: Ordner per Ziehen und Ablegen hochladen.
Dann die Adresse **einmal mit Internet** am Handy öffnen (Laden dauert, rund 16 MB) und
- Android (Chrome): Menü ⋮ › „App installieren“ bzw. „Zum Startbildschirm“.
- iPhone (Safari): Teilen › „Zum Home-Bildschirm“.

## Update
Neue Version des Ordners an derselben Adresse hochladen. Beim nächsten Öffnen mit Internet lädt die App die neuen Dateien (einmal neu öffnen, wenn „Version“ unten noch die alte zeigt). Die Daten bleiben erhalten.

## Selbst bauen
`python build_phone.py <Pyodide-0.27-Ordner>` erzeugt `Pflanzen_Handy` aus der PC-Version (Pyodide: github.com/pyodide/pyodide/releases, Datei `pyodide-0.27.x.tar.bz2`; benötigt werden `pyodide.js`, `pyodide.asm.js`, `pyodide.asm.wasm`, `python_stdlib.zip`, `pyodide-lock.json`, `sqlite3-*.whl`).
