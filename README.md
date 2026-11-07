# NeoMods

A hub for mods and plugins for [NeoLegacy](https://git.neolegacy.dev/neoStudiosLCE/neoLegacy).
The site is static and runs on GitHub Pages. Developers upload their mod **on the site itself**, no account needed, and it
shows up right away. Only the owner can hide or delete entries. A German guide with the same content is in `README.de.md`.

Owner: [@Loliflo](https://github.com/loliflo22)

## How it works

| Who | What | How |
| --- | --- | --- |
| Visitors | browse, search, download | on the site |
| Developers | upload a mod or plugin | "Upload" page, no account |
| Developers | add a new version | with the **edit key** shown after the upload |
| **Owner** | hide, delete, clean up | `https://loliflo22.github.io/NeoMods/#/admin` |

Files and entries live in **Supabase** (the free plan is enough to start). The security rules are in `backend/schema.sql`.

## Setup (once, about 15 minutes)

1. **Create a project** at [supabase.com](https://supabase.com) (pick a region close to your users, save the database password).
2. **SQL Editor → New query:** paste all of `backend/schema.sql` and click **Run**. You can run it again after updates.
3. **Admin account:** Authentication → Users → *Add user* (e-mail + password, auto confirm). Then turn **off** "Allow new users to sign up" under Authentication → Sign In / Providers. Then run this in the SQL editor with your e-mail:
   ```sql
   insert into public.admins (user_id) select id from auth.users where email = 'you@example.com';
   ```
4. **Connect the site:** Project Settings → API. Copy the *Project URL* and the *anon public* (or *publishable*) key into `config.json`:
   ```json
   "supabase": { "url": "https://xxxx.supabase.co", "anonKey": "your-key" }
   ```
   This key is meant to be public. Never put the `service_role` key anywhere.
5. **Upload the files to GitHub** (including the hidden `.github` folder) and wait for the green check under Actions. Reload with Ctrl+Shift+R.
6. **Test:** upload a test mod on the site, then open `…/#/admin`, sign in and delete it.

## Daily use

- Nothing to do. New entries appear by themselves.
- Bad upload: `…/#/admin` → **Hide** (reversible) or **Delete** (removes the entry and its files). Single versions are under **Releases**.
- **Clean up unused files** deletes files from failed or abandoned uploads. Files younger than an hour are never touched.
- The admin link is not shown anywhere on the site. Bookmark it.

## Abuse protection

- Visitors cannot write to any table. They can only create entries through checked functions, and every field, file type and size is checked again **on the server**.
- Allowed: ZIP, JAR, DLL, 7Z, RAR (up to 50 MB) and PNG, JPG, WEBP, GIF (up to 2 MB). No SVG, no HTML.
- At most **5 new entries per hour** and **20 new versions per day** per network.
- The edit key is stored only as a hash. It can **only add versions**, never delete.
- All text is escaped and only `https://` links are accepted.
- Uploaded files are not virus-scanned. The footer says so.

## Adding another plugin platform (besides FourKit)

Add one line to `platforms` in `config.json`:

```json
"platforms": [
  { "id": "fourkit", "name": "FourKit" },
  { "id": "myserver", "name": "MyServer" },
  { "id": "other", "name": "Other" }
]
```

`id` may only use lowercase letters, numbers and hyphens. It shows up in the upload form and the filter immediately.

## Other settings (`config.json`)

- `versions`: NeoLegacy versions, **newest first**.
- `categories`: in English. For a new one, add translations under `cats` in `assets/i18n.js`.
- `owner`: your name and link in the footer.
- `limits`: the hints shown in the form. The real limits are in `backend/schema.sql` (50 MB, 2 MB). Change both together.

Languages: `assets/i18n.js` and `assets/i18n.upload.js`. Missing texts fall back to English.

## Built-in entries without the database (optional)

Folders like `mods/my-mod/` with a `mod.json` and images are still shown (see `mods/example-gem-tools`). The three `example-…`
folders can be deleted.

## Good to know

- The free Supabase plan has limited storage and traffic and pauses projects that get no requests for a long time. If the site is suddenly empty, click **Restore** in the Supabase dashboard. Current limits: supabase.com/pricing.
- View locally: `node scripts/build-index.mjs`, then `python3 -m http.server` and open `http://localhost:8000`.
- The database rules were checked with 69 automated tests on a real PostgreSQL.
