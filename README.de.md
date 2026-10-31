# NeoMods

Ein Hub für Mods und Plugins für [NeoLegacy](https://git.neolegacy.dev/neoStudiosLCE/neoLegacy). Die Seite besteht nur aus HTML, CSS und JavaScript und läuft kostenlos auf GitHub Pages.

## Auf GitHub bringen

1. **Repository anlegen:** Auf github.com oben rechts auf **+ → New repository**. Name zum Beispiel `neomods`, auf **Public** stellen. Keine README anlegen lassen.
2. **Dateien hochladen:** Entpacke das ZIP. Im neuen Repository auf **uploading an existing file** klicken und den **Inhalt** des Ordners hineinziehen. Wichtig: auch die versteckten Ordner `.github` und die Datei `.nojekyll` müssen mit. Dann **Commit changes**.
   - Wenn du Git benutzt: `git init`, `git add .`, `git commit -m "NeoMods"`, `git branch -M main`, `git remote add origin <deine-repo-url>`, `git push -u origin main`.
3. **Pages einschalten:** Im Repository auf **Settings → Pages**. Bei **Source** die Option **GitHub Actions** wählen.
4. **Warten:** Unter **Actions** läuft jetzt „NeoMods veröffentlichen“. Nach ein bis zwei Minuten steht die Adresse unter Settings → Pages, meistens `https://YOUR-NAME.github.io/neomods/`.
5. **Repo-Namen eintragen:** Öffne `config.json` und ersetze bei `"repo"` den Wert `YOUR-NAME/neomods` durch deinen echten Namen. Erst dann funktioniert der Button „Als GitHub-Issue einreichen“.
6. **Beispiele löschen:** Entferne die drei Ordner `mods/example-…`, sobald du echte Einträge hast.

## Lokal ansehen

```
node scripts/build-index.mjs
python3 -m http.server
```

Dann `http://localhost:8000` öffnen. Die Seite funktioniert nicht, wenn du `index.html` einfach per Doppelklick öffnest, weil der Browser dann die Daten nicht laden darf.

## Einen Mod hinzufügen

Lege einen Ordner `mods/mein-mod/` an (nur Kleinbuchstaben, Zahlen und Bindestriche) mit diesen Dateien:

- `mod.json` mit den Angaben
- `icon.png` (quadratisch, am besten 128×128)
- Screenshots, zum Beispiel `screenshot1.png`
- Optional die Mod-Datei selbst. Besser ist ein Link auf ein GitHub-Release.

```json
{
  "name": "Mein Mod",
  "type": "mod",
  "summary": "Ein Satz, was der Mod macht.",
  "description": "Längerer Text.\n\nListen gehen so:\n- Punkt eins\n- Punkt zwei",
  "author": "DeinName",
  "categories": ["Gameplay"],
  "icon": "icon.png",
  "screenshots": ["screenshot1.png"],
  "versions": [
    {
      "version": "1.0.0",
      "neolegacy": ["1.1.2", "1.1.1"],
      "file": "https://github.com/DeinName/mein-mod/releases/download/v1.0.0/mein-mod.zip",
      "date": "2026-10-31",
      "changelog": "Erste Version."
    }
  ],
  "links": { "source": "https://github.com/DeinName/mein-mod" }
}
```

`type` ist `mod` oder `plugin`. Nach dem Speichern prüft und veröffentlicht die GitHub Action alles automatisch. Bei einem Pull Request meldet sie Fehler direkt im PR.

## Versionen und Kategorien ändern

Alles steht in `config.json`. Die Liste `versions` gehört von neu nach alt: die erste Version wird als „neueste“ angezeigt. Ich habe `1.1.2` als neueste eingetragen und die darunter nur als Platzhalter. Passe sie an die echten NeoLegacy-Versionen an. Eine neue Version trägst du ganz oben ein.

## So kommen Einreichungen von anderen an

1. Jemand füllt auf der Seite das Formular aus und schickt es als GitHub-Issue ab.
2. Du schaust den Eintrag an, besonders den Download-Link und die Bilder.
3. Du legst den Ordner `mods/…` mit der `mod.json` aus dem Issue an und lädst Icon und Screenshots dazu.

Das ist bewusst von Hand: So landet nichts Ungeprüftes auf der Seite. Die Downloads liegen bei den Autoren, die Seite verlinkt sie nur.

## Später ausbauen

Echte Uploads mit Login, Download-Zähler oder Bewertungen brauchen ein Backend, zum Beispiel Supabase. Die Seite kann dabei statisch bleiben.

## Hinweis

Die Seite ist jetzt standardmäßig auf Englisch und hat eine Sprachauswahl (Englisch, Deutsch, Spanisch, Französisch, Portugiesisch, Italienisch). Die Kategorien in `config.json` und `mod.json` sind englisch (z. B. `World & Biomes`). Alle Texte stehen in `assets/i18n.js`. Dein Name steht im Footer, änderbar in `config.json` unter `owner`.
