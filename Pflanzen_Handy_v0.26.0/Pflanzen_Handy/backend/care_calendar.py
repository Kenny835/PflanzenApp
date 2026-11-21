"""Prüfung der Kalenderdaten im bestehenden Pflegegruppen-Datensatz (Gießtage und Pflegetermine).

Die Daten bleiben im Gruppen-Datensatz (Felder watering_days, watering_start, watered_on, care_events).
validate() prüft und bereinigt sie vor dem Speichern, damit weder fehlerhafte Eingaben noch unbegrenzt viele
oder überlange Einträge in die Datenbank gelangen."""
from datetime import date

MAX_EVENTS = 500
MAX_TITLE = 200
MAX_NOTE = 2000
MAX_ID = 80
DATE_MESSAGE = 'Bitte ein gültiges Datum eingeben (Jahr-Monat-Tag).'


def check_date(value, message=DATE_MESSAGE):
    """Nur echte Kalendertage im Format JJJJ-MM-TT; technische Python-Meldungen erreichen die Anzeige nicht."""
    try:
        if not isinstance(value, str) or date.fromisoformat(value).isoformat() != value:
            raise ValueError(message)
    except ValueError:
        raise ValueError(message) from None


def clean_event(event, seen):
    if not isinstance(event, dict):
        raise ValueError('Ungültiger Pflegetermin.')
    title = event.get('title')
    if not isinstance(title, str) or not title.strip():
        raise ValueError('Titel des Pflegetermins fehlt.')
    title = title.strip()
    if len(title) > MAX_TITLE:
        raise ValueError('Der Titel des Pflegetermins darf höchstens %d Zeichen haben.' % MAX_TITLE)
    note = event.get('note', '')
    if note is None:
        note = ''
    if not isinstance(note, str):
        raise ValueError('Ungültige Notiz beim Pflegetermin.')
    if len(note) > MAX_NOTE:
        raise ValueError('Die Notiz des Pflegetermins darf höchstens %d Zeichen haben.' % MAX_NOTE)
    check_date(event.get('date'), 'Bitte für den Pflegetermin ein gültiges Datum eingeben (Jahr-Monat-Tag).')
    ident = event.get('id')
    if not isinstance(ident, str) or not ident or len(ident) > MAX_ID or ident in seen:
        raise ValueError('Ungültige Terminkennung.')
    seen.add(ident)
    cleaned = {'id': ident, 'date': event['date'], 'title': title, 'note': note}
    if event.get('done'):
        cleaned['done'] = True
    return cleaned


def validate(group, old):
    days = group.get('watering_days', [])
    if not isinstance(days, list) or any(type(day) is not int or not 1 <= day <= 7 for day in days):
        raise ValueError('Ungültiger Gießtag.')
    days = sorted(set(days))
    group['watering_days'] = days
    start = group.get('watering_start')
    if days and (days != (old or {}).get('watering_days', []) or not start):
        # Ein neuer oder geänderter Wochenplan gilt ab heute; ohne Startdatum ließe sich nie eine Fälligkeit berechnen.
        group['watering_start'] = date.today().isoformat()
    elif start:
        check_date(start, 'Ungültiges Startdatum des Gießplans.')
    if group.get('watered_on'):
        check_date(group['watered_on'], 'Bitte ein gültiges Datum für „zuletzt gegossen“ eingeben (Jahr-Monat-Tag).')
    events = group.get('care_events', [])
    if not isinstance(events, list):
        raise ValueError('Ungültige Pflegetermine.')
    if len(events) > MAX_EVENTS:
        raise ValueError('Pro Pflegegruppe sind höchstens %d Pflegetermine möglich. Bitte erledigte Termine löschen.' % MAX_EVENTS)
    seen = set()
    group['care_events'] = [clean_event(event, seen) for event in events]
