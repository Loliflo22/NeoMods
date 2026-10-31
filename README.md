# NeoMods

A hub for mods and plugins for [NeoLegacy](https://git.neolegacy.dev/neoStudiosLCE/neoLegacy). The site is plain HTML, CSS and JavaScript and runs for free on GitHub Pages. A German version of this guide is in `README.de.md`.

Owner: [@Loliflo](https://github.com/loliflo22)

## Put it on GitHub

1. **Create a repository:** On github.com click **+ → New repository**. Name it for example `neomods` and set it to **Public**. Don't let GitHub add a README.
2. **Upload the files:** Unzip the download. In the new repository click **uploading an existing file** and drag in the **contents** of the folder. The hidden folder `.github` and the file `.nojekyll` must be included. Then click **Commit changes**.
   - With Git: `git init`, `git add .`, `git commit -m "NeoMods"`, `git branch -M main`, `git remote add origin <your-repo-url>`, `git push -u origin main`.
3. **Turn on Pages:** Go to **Settings → Pages** and choose **GitHub Actions** as the **Source**.
4. **Wait:** Under **Actions** the workflow "Publish NeoMods" runs. After a minute or two the address appears under Settings → Pages, for you `https://loliflo22.github.io/NeoMods/`.
5. **Repo name:** `config.json` already points to `loliflo22/NeoMods`. If you rename the repository, change `"repo"` there, otherwise the "Submit as GitHub issue" button opens the wrong page.
6. **Remove the examples:** Delete the three folders `mods/example-…` once you have real entries.

## Languages

English is the default. Visitors can switch the language in the top right (English, Deutsch, Español, Français, Português, Italiano) and the site remembers their choice.

All texts are in `assets/i18n.js`. To add a language, add an entry to `languages` and a block with the same code under `strings`. Keys you leave out fall back to English. Category names in `mod.json` stay in English, only their display is translated.

## Owner link

The footer shows your name and link. Change it in `config.json` under `owner`.

## View it locally

```
node scripts/build-index.mjs
python3 -m http.server
```

Then open `http://localhost:8000`. The site does not work if you just double-click `index.html`, because the browser blocks loading the data that way.

## Add a mod

Create a folder `mods/my-mod/` (lowercase letters, numbers and hyphens only) with these files:

- `mod.json` with the details
- `icon.png` (square, ideally 128×128)
- Screenshots, for example `screenshot1.png`
- Optionally the mod file itself. A link to a GitHub release is better.

```json
{
  "name": "My Mod",
  "type": "mod",
  "summary": "One sentence about what the mod does.",
  "description": "Longer text.\n\nLists work like this:\n- Point one\n- Point two",
  "author": "YourName",
  "categories": ["Gameplay"],
  "icon": "icon.png",
  "screenshots": ["screenshot1.png"],
  "versions": [
    {
      "version": "1.0.0",
      "neolegacy": ["1.1.2", "1.1.1"],
      "file": "https://github.com/YourName/my-mod/releases/download/v1.0.0/my-mod.zip",
      "date": "2026-10-31",
      "changelog": "First release."
    }
  ],
  "links": { "source": "https://github.com/YourName/my-mod" }
}
```

`type` is `mod` or `plugin`. After you save, the GitHub Action checks and publishes everything automatically. On a pull request it reports errors right in the PR.

## Change versions and categories

Everything is in `config.json`. List `versions` from newest to oldest: the first one is shown as "latest". `1.1.2` is set as the newest, the ones below are only placeholders. Change them to the real NeoLegacy versions. Add a new version at the very top.

Categories are in English in `config.json` and `mod.json`. If you add one, also add its translations under `cats` in `assets/i18n.js`.

## How submissions from others arrive

1. Someone fills in the form on the site and sends it as a GitHub issue.
2. You review the entry, especially the download link and the images.
3. You create the `mods/…` folder with the `mod.json` from the issue and add the icon and screenshots.

This is manual on purpose: nothing unchecked ends up on the site. Downloads stay with the authors, the site only links to them.

## Later

Real uploads with login, download counters or ratings need a backend, for example Supabase. The site can stay static and just talk to it.
