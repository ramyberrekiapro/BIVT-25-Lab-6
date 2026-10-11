-- Optional demo content so the site is not empty on first run.
-- Replace or delete everything from /admin once real products are ready.
-- Apply with: npx wrangler d1 execute chemex-dz --local --file=seed/demo.sql

INSERT INTO categories (name, description, sort_order) VALUES
  ('Hot coffee',  'Espresso-based drinks and slow brews from the bar.', 1),
  ('Cold drinks', 'Iced and cold-brew options.',                       2),
  ('Coffee beans','Whole-bean coffee to brew at home.',                3),
  ('Equipment',   'Brewers, filters and accessories.',                 4);

INSERT INTO products (category_id, name, description, price, unit, featured, sort_order) VALUES
  (1, 'Chemex pour-over', 'Clean, bright and aromatic. Brewed to order with a single-origin coffee of the day.', 450, 'For one', 1, 1),
  (1, 'Espresso',         'Short, dense and balanced with a thick crema.',                                       200, 'Single', 0, 2),
  (1, 'Flat white',       'Double ristretto with silky micro-foamed milk.',                                      350, 'Cup',    0, 3),
  (2, 'Cold brew',        'Steeped for 18 hours. Smooth, low acidity, naturally sweet.',                         400, 'Glass',  1, 1),
  (2, 'Iced latte',       'Espresso over ice with cold milk.',                                                   380, 'Glass',  0, 2),
  (3, 'Ethiopia Yirgacheffe', 'Floral and citrus notes with a tea-like body. Ideal for pour-over.',             2400, '250 g', 1, 1),
  (3, 'Brazil Cerrado',   'Chocolate, hazelnut and caramel. Great for espresso and moka pot.',                  1900, '250 g', 0, 2),
  (4, 'Chemex Classic 6-cup', 'The iconic hourglass brewer in borosilicate glass with wood collar.',            12500, '6 cups', 1, 1),
  (4, 'Bonded paper filters', 'Thick filters that remove oils and fines for an exceptionally clean cup.',        1800, '100 pcs', 0, 2);
