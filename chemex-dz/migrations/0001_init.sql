-- Chemex DZ — initial schema
-- Apply with: npx wrangler d1 migrations apply chemex-dz [--local | --remote]

PRAGMA foreign_keys = ON;

-- Key/value store for every piece of business information shown on the site.
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS categories (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL,
  description TEXT    NOT NULL DEFAULT '',
  sort_order  INTEGER NOT NULL DEFAULT 0,
  visible     INTEGER NOT NULL DEFAULT 1 CHECK (visible IN (0, 1)),
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS products (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  name        TEXT    NOT NULL,
  description TEXT    NOT NULL DEFAULT '',
  price       INTEGER,                         -- whole dinars; NULL = "price on request"
  unit        TEXT    NOT NULL DEFAULT '',     -- e.g. "250 g", "Cup", "6 cups"
  image_key   TEXT,                            -- key in R2 bucket or media table
  featured    INTEGER NOT NULL DEFAULT 0 CHECK (featured IN (0, 1)),
  visible     INTEGER NOT NULL DEFAULT 1 CHECK (visible IN (0, 1)),
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_categories_order  ON categories(sort_order);

-- Image storage fallback, used only when no R2 bucket is bound as MEDIA.
CREATE TABLE IF NOT EXISTS media (
  key          TEXT PRIMARY KEY,
  content_type TEXT    NOT NULL,
  size         INTEGER NOT NULL,
  data         BLOB    NOT NULL,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Failed admin login attempts, for brute-force throttling.
CREATE TABLE IF NOT EXISTS login_attempts (
  ip TEXT    NOT NULL,
  ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_login_attempts ON login_attempts(ip, ts);

-- Default business information (all editable from /admin).
INSERT OR IGNORE INTO settings (key, value) VALUES
  ('brand_name',     'Chemex DZ'),
  ('tagline',        'Slow coffee, done properly.'),
  ('hero_eyebrow',   'Specialty coffee · Algeria'),
  ('hero_title',     'Coffee brewed with patience and precision.'),
  ('hero_subtitle',  'Carefully sourced beans, clean pour-over brewing and equipment chosen for people who take their cup seriously.'),
  ('hero_cta',       'Explore the selection'),
  ('hero_image',     ''),
  ('about_title',    'Built around the perfect pour'),
  ('about_text',     'Chemex DZ started with a simple idea: great coffee does not need to be complicated, it needs to be done right. We select our beans with care, brew with clean, controlled methods and share everything we know so you can enjoy the same cup at home.'),
  ('about_image',    ''),
  ('products_title', 'Our selection'),
  ('products_intro', 'From the bar to your kitchen — everything we serve and sell, in one place.'),
  ('featured_title', 'Signature picks'),
  ('why_title',      'Why Chemex DZ'),
  ('highlights',     '[{"title":"Carefully sourced","text":"Beans chosen for clarity, sweetness and consistency — never for volume."},{"title":"Brewed with method","text":"Measured doses, controlled water and clean filters in every cup."},{"title":"Honest advice","text":"We help you pick the right beans and gear for the way you actually drink coffee."},{"title":"Fair prices","text":"Premium quality without the inflated markup."}]'),
  ('contact_title',  'Come by or get in touch'),
  ('phone',          ''),
  ('email',          ''),
  ('address',        ''),
  ('city',           'Algeria'),
  ('hours',          ''),
  ('instagram',      'https://www.instagram.com/chemex_dz/'),
  ('maps_url',       ''),
  ('currency',       'DA'),
  ('footer_note',    'Specialty coffee and brewing equipment.');
