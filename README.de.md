# NeoMods

Ein Hub für Mods und Plugins für [NeoLegacy](https://git.neolegacy.dev/neoStudiosLCE/neoLegacy).
Die Seite läuft kostenlos auf GitHub Pages. Entwickler laden ihre Mods **direkt auf der Seite** hoch, ohne Konto.
Der Eintrag erscheint sofort. Nur du kannst Einträge verstecken oder löschen.

Betreiber: [@Loliflo](https://github.com/loliflo22)

## So funktioniert es

| Wer | Was | Wie |
| --- | --- | --- |
| Besucher | ansehen, suchen, herunterladen | direkt auf der Seite |
| Entwickler | Mod oder Plugin hochladen | Seite „Upload“, kein Konto nötig |
| Entwickler | neue Version hinzufügen | mit dem **Bearbeitungsschlüssel**, den es nach dem Upload gibt |
| **Du** | verstecken, löschen, aufräumen | `https://loliflo22.github.io/NeoMods/#/admin` |

Die Seite selbst bleibt statisch auf GitHub. Dateien und Einträge liegen bei **Supabase** (kostenloser Tarif reicht zum Start).
Die Sicherheitsregeln stehen in `backend/schema.sql`. Dort ist auch festgelegt, dass nur du löschen darfst.

## Einrichtung (einmalig, ca. 15 Minuten)

### 1. Supabase-Projekt anlegen
1. Auf [supabase.com](https://supabase.com) registrieren und **New project** klicken.
2. Name zum Beispiel `neomods`, eine Region in Europa (Frankfurt), ein Datenbank-Passwort vergeben und speichern.

### 2. Datenbank einrichten
1. Links **SQL Editor → New query**.
2. Den kompletten Inhalt von `backend/schema.sql` einfügen und **Run** klicken. Es muss „Success“ erscheinen.
   Die Datei darf bei Updates jederzeit noch einmal ausgeführt werden.

### 3. Dein Admin-Konto
1. **Authentication → Users → Add user → Create new user.** E-Mail und Passwort eintragen, „Auto Confirm User“ anhaken.
2. **Authentication → Sign In / Providers** (je nach Version „Settings“) und **„Allow new users to sign up“ ausschalten.**
3. Im **SQL Editor** diese Zeile mit **deiner** E-Mail ausführen:

```sql
insert into public.admins (user_id) select id from auth.users where email = 'deine@mail.de';
```

### 4. Seite mit Supabase verbinden
1. **Project Settings → API** (oder oben **Connect**). Dort stehen die **Project URL** (`https://xxxx.supabase.co`) und der **anon public key** bzw. **Publishable key**.
2. Beides in `config.json` eintragen:

```json
"supabase": {
  "url": "https://xxxx.supabase.co",
  "anonKey": "dein-key"
}
```

Der Key ist dafür gedacht, öffentlich zu sein. Geheim bleibt **nur** der `service_role`-Key, den du nirgends einträgst.

### 5. Auf GitHub hochladen
Wie bisher: den Inhalt des Ordners ins Repository laden (inklusive des versteckten Ordners `.github`) und auf den grünen Haken unter **Actions** warten. Danach mit **Strg+Shift+R** neu laden.

### 6. Testen
1. Auf der Seite **Upload** öffnen und einen Test-Mod hochladen.
2. `…/#/admin` öffnen, mit deinem Konto anmelden und den Test-Eintrag **Delete**n.

## Täglicher Betrieb

- **Nichts tun.** Neue Einträge erscheinen von selbst.
- **Mist hochgeladen?** `…/#/admin` → beim Eintrag **Hide** (nur verstecken, rückgängig machbar) oder **Delete** (löscht Eintrag samt Dateien). Eine einzelne Version löschst du über **Releases**.
- **Aufräumen:** Bricht jemand einen Upload ab, bleiben Dateien übrig. **Clean up unused files** im Admin-Bereich löscht sie mit einem Klick. Dateien jünger als eine Stunde werden nie angefasst.
- Der Admin-Link steht nirgends auf der Seite. Setze dir ein Lesezeichen.

## Schutz vor Missbrauch

- Besucher dürfen keine Tabelle direkt ändern. Sie können nur Einträge über geprüfte Funktionen anlegen. Jedes Feld, jeder Dateityp und jede Größe wird noch einmal **auf dem Server** geprüft.
- Erlaubte Dateien: ZIP, JAR, DLL, 7Z, RAR (bis 50 MB) und Bilder PNG, JPG, WEBP, GIF (bis 2 MB). Keine SVG und kein HTML.
- Pro Netzwerk höchstens **5 neue Einträge pro Stunde** und **20 neue Versionen pro Tag**.
- Der Bearbeitungsschlüssel wird nur als Hash gespeichert. Er erlaubt **nur das Hinzufügen neuer Versionen**, kein Löschen.
- Texte werden immer escaped, Links nur mit `https://` akzeptiert.
- Hinweis: Hochgeladene Dateien sind nicht auf Viren geprüft. Der Footer der Seite weist darauf hin.

## Neue Plugin-Software (neben FourKit) hinzufügen

In `config.json` unter `platforms` eine Zeile ergänzen, sonst ist nichts nötig:

```json
"platforms": [
  { "id": "fourkit", "name": "FourKit" },
  { "id": "meinserver", "name": "MeinServer" },
  { "id": "other", "name": "Other" }
]
```

`id` nur mit Kleinbuchstaben, Zahlen und Bindestrichen. Der Eintrag erscheint sofort im Upload-Formular und im Filter.

## Weitere Einstellungen (`config.json`)

- `versions`: NeoLegacy-Versionen, **neueste zuerst**. Neue Version oben eintragen.
- `categories`: Kategorien (Englisch). Bei neuen Kategorien die Übersetzungen unter `cats` in `assets/i18n.js` ergänzen.
- `owner`: dein Name und Link im Footer.
- `limits`: Hinweise im Formular. Die echten Grenzen stehen in `backend/schema.sql` (50 MB, 2 MB). Ändere beides gemeinsam.

Sprachen: `assets/i18n.js` und `assets/i18n.upload.js`. Ein Sprachblock genügt, fehlende Texte fallen auf Englisch zurück.

## Feste Einträge ohne Datenbank (optional)

Ordner `mods/dein-mod/` mit `mod.json` und Bildern werden weiter angezeigt (siehe `mods/example-gem-tools`). Praktisch für Einträge, die du selbst pflegst. Die drei `example-…`-Ordner kannst du löschen.

## Gut zu wissen

- Der kostenlose Supabase-Tarif hat begrenzten Speicher und Datenverkehr und pausiert Projekte, die lange keine Anfragen bekommen. Ist die Seite plötzlich leer, im Supabase-Dashboard auf **Restore** klicken. Aktuelle Grenzen: supabase.com/pricing.
- Lokal ansehen: `node scripts/build-index.mjs`, dann `python3 -m http.server` und `http://localhost:8000` öffnen.
- Die Datenbank-Regeln wurden mit 69 automatischen Tests auf einer echten PostgreSQL geprüft.
