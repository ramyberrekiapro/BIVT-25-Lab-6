# Lopez — menu website + owner's admin

- **Customer website** `/` — menu (French / English), likes, message form.
- **Owner's admin** `/admin/` — separate private page, not linked anywhere on the customer site,
  hidden from search engines, password required: Messages, Menu (items and categories), Likes,
  Contact (Instagram, Google Maps link, phone number).

Both use the same server API (`/api/...`) and the same Cloudflare **D1** database:

```
Customer website (/)          Owner's admin (/admin/)
        │                             │  session cookie (after password)
        └──────────►  /api/...  ◄─────┘
                         │
                     D1 database (DB)
```

It is a **Cloudflare Pages** project: static files in `public/`, server code in `functions/`.

## Project structure

```
public/                   website files
  index.html              customer menu
  admin/index.html        owner's admin
  img/                    menu photos
  menu-data.json          original menu data (used by the admin)
  _headers                no-index / no-cache / no-framing for /admin/
functions/api/            server routes
  likes.js                /api/likes            like counts
  messages.js             /api/messages         send (public) / read, mark, delete (owner)
  menu.js                 /api/menu             menu changes + categories: read (public) / write (owner)
  sections.js             /api/sections         categories: add, remove, rename, reorder (owner)
  site.js                 /api/site             contact details: read (public) / write (owner)
  photo.js                /api/photo            photos uploaded in the admin
  admin/login.js          /api/admin/login      sign in -> session cookie
  admin/logout.js         /api/admin/logout
  admin/session.js        /api/admin/session    signed in? must change password?
  admin/password.js       /api/admin/password   change the owner's password
  _middleware.js          turns unexpected errors into JSON errors for the admin
lib/admin.js              password + session checks shared by all routes
lib/sections.js           categories: built-in list + owner's changes
tools/                    maintenance scripts (not needed to run the site)
```

No build step, no npm packages, no `wrangler.toml` (bindings are set in the dashboard).

## Password and security

- **Initial password**: the Cloudflare secret `ADMIN_PASSWORD` (for the first setup: `0000`).
  It only lets the owner into a "choose your password" screen; nothing else opens until a new
  password is set.
- **Owner's password**: chosen in the admin (8+ characters). Stored in D1 only as a salted
  PBKDF2-SHA256 hash. From that moment `ADMIN_PASSWORD` (0000) no longer works.
- The password is never in the website files, in GitHub, or in browser storage. After signing in
  the browser holds only a random session token in an HttpOnly, Secure, SameSite=Strict cookie
  (12 hours); D1 stores only a hash of it. Changing the password signs out all other devices.
- 10 wrong passwords from one connection lock sign-in for 15 minutes.

## Deploy on Cloudflare Pages (from GitHub)

1. Put these files at the top level of your GitHub repository.
2. Cloudflare → **Workers & Pages** → **Create** → **Pages** → **Connect to Git** → your repository.
3. Framework preset **None**, Build command *(empty)*, Build output directory `public`,
   Root directory *(empty)*, Production branch `main` → **Save and Deploy**.
4. Project → **Settings**:
   - **Bindings** → **+ Add** → **D1 database** → name `DB` → your database (e.g. `lopez-db`).
   - **Variables and Secrets** → **+ Add** → Type **Secret**, name `ADMIN_PASSWORD`, value `0000`.
5. **Deployments** → **⋯** → **Retry deployment**.

Check: `/api/likes` → `{"counts":{...}}`, then open `/admin/`.

## First login and changing the password

1. Open `https://<your-address>/admin/`, enter `0000` → **Entrer / Sign in**.
2. The "Choisissez votre mot de passe / Choose your password" screen opens:
   current password `0000`, new password twice (8+ characters) → **Enregistrer / Save**.
3. The admin opens. From now on sign in with the new password.
4. To change it later: **Mot de passe / Password** button (top of the admin) → current password,
   new password twice → **Enregistrer / Save**.

## Forgotten password

Cloudflare → **Storage & Databases** → **D1** → your database → **Console**, run:

```sql
DELETE FROM admin_settings WHERE key = 'password';
```

Then sign in with `ADMIN_PASSWORD` (e.g. `0000`) and choose a new password.
(To use a different temporary password, change the `ADMIN_PASSWORD` secret and retry the deployment.)

## Categories

Admin → **Menu** → **Catégories / Categories**: rename (French and English), reorder with ↑ ↓,
add, remove, then **Enregistrer / Save**. To move an item to another category: **Modifier / Edit**
→ **Catégorie / Category**. A category can only be removed once it is empty (the server refuses
otherwise), so no menu item or photo is ever lost. A new category stays hidden on the menu until
it has a visible item. Stored in the D1 table `menu_sections`.

## Contact details

Admin → **Contact**: Instagram (@name or link), Google Maps link, phone number. They appear in the
"Écrivez-nous / Write to us" section (phone as a tap-to-call link) and Instagram / Location at the
top of the menu. An empty field is hidden. Until saved, the built-in Instagram and Google Maps links
are used and no phone number is shown. Stored in the D1 table `site_settings`.

## Where menu changes are stored

Every change made in **Menu** on `/admin/` (added items, prices, names, descriptions, hidden /
shown, photos) is written to the D1 table `menu_items` before the admin says
**Enregistré / Saved**. The admin and the public menu then read it back from D1 (`GET /api/menu`,
not cached), so changes are still there after a reload, on any device.

To see the saved rows: Cloudflare → **Storage & Databases** → **D1** → your database → **Console**:

```sql
SELECT id, section, is_new, name_fr, price, hidden FROM menu_items;
SELECT * FROM menu_sections ORDER BY position;
SELECT * FROM site_settings;
```

If the admin shows "Base D1 non configurée / D1 binding DB missing", the `DB` binding is missing
on the **Production** environment of the Pages project (Settings → Bindings), or the deployment
was not retried after adding it.

## Updating

Push to the production branch; Cloudflare redeploys automatically. Menu changes, messages, likes
and the owner's password live in D1 and survive redeploys.

## Run locally (optional, needs Node.js)

```
npx wrangler pages dev public --d1 DB --binding ADMIN_PASSWORD=0000
```
