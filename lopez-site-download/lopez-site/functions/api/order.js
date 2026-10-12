// Customers place an order from the menu (public, no sign-in).
//   POST /api/order  { table, items: [{ id, qty }], website: "" }
//     -> 201 { ok, order: { id, table, total, created_at, items: [...] } }
// The order is saved with source "customer" and status "new"; it appears on /admin/ (Orders)
// like any other order and is paid in cash to the staff. Prices come from the menu on the
// server; items without a numeric price ("Prix sur place") cannot be ordered here.
// "website" is a hidden field that people leave empty (spam bots fill it in).

import { json, noDb, ipKey } from "../../lib/admin.js";
import { createOrder } from "../../lib/orders.js";

const MAX_QTY = 20;
const ORDERS_PER_WINDOW = 30;   // per connection (a café Wi-Fi is one connection for everyone) ...
const WINDOW_S = 600;           // ... per 10 minutes

let schemaReady = null;
function ensureRateSchema(db) {
  if (!schemaReady) {
    schemaReady = db.batch([
      db.prepare("CREATE TABLE IF NOT EXISTS order_rate (ip TEXT NOT NULL, at INTEGER NOT NULL)"),
      db.prepare("CREATE INDEX IF NOT EXISTS order_rate_ip ON order_rate (ip, at)"),
    ]).catch((e) => { schemaReady = null; throw e; });
  }
  return schemaReady;
}

export async function onRequestPost({ request, env }) {
  if (!env.DB) return noDb();
  let b;
  try { b = await request.json(); } catch { return json({ error: "bad_request" }, 400); }
  if (!b || typeof b !== "object") return json({ error: "bad_request" }, 400);
  if (b.website) return json({ error: "bad_request" }, 400);

  await ensureRateSchema(env.DB);
  const ip = await ipKey(request, "order");
  const t = Math.floor(Date.now() / 1000);
  const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM order_rate WHERE ip = ? AND at > ?")
    .bind(ip, t - WINDOW_S).first("n");
  if (n >= ORDERS_PER_WINDOW) return json({ error: "too_many_orders" }, 429);

  const r = await createOrder(request, env, b, { source: "customer", maxQty: MAX_QTY, manualPrice: false });
  if (r.error) return r.error;
  await env.DB.batch([
    env.DB.prepare("INSERT INTO order_rate (ip, at) VALUES (?, ?)").bind(ip, t),
    env.DB.prepare("DELETE FROM order_rate WHERE at < ?").bind(t - WINDOW_S),
  ]);
  const o = r.order;
  return json({
    ok: true,
    order: {
      id: o.id, table: o.table, total: o.total, created_at: o.created_at,
      items: o.items.map((i) => ({ name_fr: i.name_fr, name_en: i.name_en, qty: i.qty, unit_price: i.unit_price, line_total: i.line_total })),
    },
  }, 201);
}
