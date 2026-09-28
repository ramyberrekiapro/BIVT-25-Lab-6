# Lopez — menu website + owner's admin

- **Customer website** `/` — menu (French / English), likes, message form.
- **Owner's admin** `/admin/` — separate private page, not linked anywhere on the customer site,
  hidden from search engines, password required: Messages, Menu management, Likes.

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
  menu.js                 /api/menu             menu changes: read (public) / write (owner)
  photo.js                /api/photo            photos uploaded in the admin
  admin/login.js          /api/admin/login      sign in -> session cookie
  admin/logout.js         /api/admin/logout
  admin/session.js        /api/admin/session    signed in? must change password?
  admin/password.js       /api/admin/password   change the owner's password
lib/admin.js              password + session checks shared by all routes
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

## Updating

Push to the production branch; Cloudflare redeploys automatically. Menu changes, messages, likes
and the owner's password live in D1 and survive redeploys.

## Run locally (optional, needs Node.js)

```
npx wrangler pages dev public --d1 DB --binding ADMIN_PASSWORD=0000
```
