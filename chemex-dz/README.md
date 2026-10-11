# Chemex DZ — website & admin panel

Customer-facing website for Chemex DZ plus an admin panel to manage products,
categories, prices, photos and business information without touching code.

Built for **Cloudflare Pages + Pages Functions + D1** (optional R2 for images).
No front-end framework or build step: plain HTML, CSS and JavaScript.

## Structure

```
chemex-dz/
├── public/                     Static site (Pages output directory)
│   ├── index.html              Customer website
│   ├── admin/index.html        Admin panel (/admin)
│   ├── assets/css/             site.css, admin.css
│   ├── assets/js/              site.js, admin.js
│   ├── assets/img/mark.svg     Logo mark / favicon
│   ├── _headers                Security + caching headers
│   └── robots.txt
├── functions/                  Pages Functions (server code)
│   ├── index.js                GET /  — fills page with live content (SEO, fast first paint)
│   ├── api/site.js             GET /api/site — public content
│   ├── api/admin/[[path]].js   /api/admin/* — all admin endpoints
│   └── media/[key].js          GET /media/:key — uploaded images
├── src/lib/                    Shared server code (auth, validation, queries, media)
├── migrations/                 D1 schema (0001_init.sql)
├── seed/demo.sql               Optional demo products
└── wrangler.toml
```

## How content flows

- Everything shown on the site — products, categories, prices, photos, texts,
  contact info, opening hours — lives in D1. Nothing is hard-coded.
- `GET /` renders `index.html` with the current texts already inserted and
  embeds the full catalogue as JSON, so the page needs no extra request.
  `site.js` then renders categories, products, highlights and contact cards.
- Hidden products and products in hidden categories never leave the server.
- Products without a category appear under “Other”.

## Admin panel (`/admin`)

| Section        | What the admin can do |
|----------------|-----------------------|
| Products       | Add, edit, delete; name, description, price (empty = “On request”), size/unit, photo upload/replace/remove, show/hide, mark as Signature (featured), reorder within category, search and filter |
| Categories     | Create, rename, describe, show/hide, reorder, delete (products are kept, moved to “Other”) |
| Homepage       | Hero texts + image, story text + image, section titles, “Why choose us” points |
| Business info  | Name, tagline, currency label, phone, email, address, city, opening hours, Instagram, Google Maps link, footer text |

Photos are resized (max 1600 px) and converted to WebP in the browser before
upload. Replaced or deleted photos are removed from storage.

Security: single admin password (Cloudflare secret), HMAC-signed HttpOnly
`SameSite=Strict` session cookie (12 h), login throttling (8 failures / 15 min
per IP), same-origin check on writes, server-side validation of every field,
image type checked by file signature (no SVG), all output escaped.

## Local development

```bash
npm install
cp .dev.vars.example .dev.vars          # set ADMIN_PASSWORD and SESSION_SECRET
npm run db:migrate:local
npm run db:seed:local                    # optional demo content
npm run dev                              # http://localhost:8788 , admin at /admin
```

## Deploying to Cloudflare

1. Create the database and put its id into `wrangler.toml`:
   ```bash
   npx wrangler d1 create chemex-dz
   npm run db:migrate:remote
   ```
2. Create the Pages project (either way):
   - **Git integration:** Cloudflare dashboard → Workers & Pages → Create → Pages →
     connect this repository. Root directory: `chemex-dz` (if the project stays in a
     sub-folder), build command: *none*, output directory: `public`.
   - **Direct upload:** `npm run deploy`.
3. Set secrets (Pages project → Settings → Variables and secrets, or CLI):
   ```bash
   npx wrangler pages secret put ADMIN_PASSWORD
   npx wrangler pages secret put SESSION_SECRET   # long random string, e.g. `openssl rand -hex 32`
   ```
4. Bindings are read from `wrangler.toml` (`DB`). If you configure them in the
   dashboard instead, bind the D1 database as `DB`.

### Image storage

By default images are stored in D1 (max ~1.8 MB each after compression — plenty
for WebP product photos). For a large catalogue, create an R2 bucket and
uncomment the `[[r2_buckets]]` block in `wrangler.toml` (binding `MEDIA`); new
uploads then go to R2 automatically. Images already in D1 keep working.

Changing `ADMIN_PASSWORD` or `SESSION_SECRET` signs out every admin session.
