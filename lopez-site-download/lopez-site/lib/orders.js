// Orders shared by the staff API (/api/orders) and the customer API (/api/order).
// Tables: orders (one row per order) and order_items (one row per line). The price of each line
// is taken from the current menu on the server (lib/menu.js) and stored with the order.

import { json } from "./admin.js";
import { ensureMenuSchema } from "../functions/api/menu.js";
import { orderableItems } from "./menu.js";

export const MAX_LINES = 50, MAX_PRICE = 1_000_000;

let schemaReady = null;
export function ensureOrdersSchema(db) {
  if (!schemaReady) {
    schemaReady = (async () => {
      await db.batch([
        db.prepare(`CREATE TABLE IF NOT EXISTS orders (
          id INTEGER PRIMARY KEY AUTOINCREMENT, table_no TEXT NOT NULL, status TEXT NOT NULL,
          total INTEGER NOT NULL, cash_received INTEGER, change_given INTEGER, paid_at INTEGER,
          created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`),
        db.prepare("CREATE INDEX IF NOT EXISTS orders_updated ON orders (updated_at)"),
        db.prepare("CREATE INDEX IF NOT EXISTS orders_status ON orders (status, id)"),
        db.prepare(`CREATE TABLE IF NOT EXISTS order_items (
          order_id INTEGER NOT NULL, line INTEGER NOT NULL, item_id TEXT NOT NULL,
          name_fr TEXT NOT NULL, name_en TEXT NOT NULL, unit_price INTEGER NOT NULL, qty INTEGER NOT NULL,
          PRIMARY KEY (order_id, line))`),
      ]);
      // "staff" (taken in /admin/) or "customer" (placed from the menu); added after the first version
      const { results } = await db.prepare("PRAGMA table_info(orders)").all();
      if (!results.some((c) => c.name === "source")) {
        await db.prepare("ALTER TABLE orders ADD COLUMN source TEXT NOT NULL DEFAULT 'staff'").run();
      }
    })().catch((e) => { schemaReady = null; throw e; });
  }
  return schemaReady;
}

export const COLS = "id, table_no, status, total, cash_received, change_given, paid_at, source, created_at, updated_at";

// orders rows -> API objects with their items
export async function withItems(db, rows) {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const { results } = await db.prepare(
    `SELECT order_id, item_id, name_fr, name_en, unit_price, qty FROM order_items
     WHERE order_id IN (${ids.map(() => "?").join(",")}) ORDER BY order_id, line`
  ).bind(...ids).all();
  const byOrder = new Map(ids.map((id) => [id, []]));
  for (const r of results) {
    byOrder.get(r.order_id).push({
      item_id: r.item_id, name_fr: r.name_fr, name_en: r.name_en,
      unit_price: r.unit_price, qty: r.qty, line_total: r.unit_price * r.qty,
    });
  }
  return rows.map((r) => ({
    id: r.id, table: r.table_no, status: r.status, total: r.total,
    cash_received: r.cash_received, change: r.change_given, paid_at: r.paid_at, source: r.source,
    created_at: r.created_at, updated_at: r.updated_at, items: byOrder.get(r.id),
  }));
}

export async function getOrder(db, id) {
  const row = await db.prepare(`SELECT ${COLS} FROM orders WHERE id = ?`).bind(id).first();
  return row ? (await withItems(db, [row]))[0] : null;
}

const int = (v) => (typeof v === "number" && Number.isInteger(v) ? v : NaN);

// Creates an order from { table, items: [{ id, qty, price? }] }.
//   source        "staff" | "customer"
//   maxQty        largest quantity per line
//   manualPrice   true: items without a numeric menu price ("Prix sur place") take the price
//                 sent with the line (staff); false: such items cannot be ordered (customers)
// Returns { order } or { error: Response }.
export async function createOrder(request, env, b, { source, maxQty, manualPrice }) {
  const table = b && typeof b.table === "string" ? b.table.replace(/[\u0000-\u001f]/g, "").trim() : "";
  if (!table || table.length > 12) return { error: json({ error: "table_required" }, 400) };
  if (!Array.isArray(b.items) || b.items.length === 0) return { error: json({ error: "items_required" }, 400) };
  if (b.items.length > MAX_LINES) return { error: json({ error: "too_many_items" }, 400) };

  await ensureMenuSchema(env.DB);
  await ensureOrdersSchema(env.DB);
  const menu = await orderableItems(request, env);
  const lines = [];
  const ids = new Set();
  for (const l of b.items) {
    const it = l && typeof l.id === "string" ? menu.get(l.id) : null;
    if (!it || ids.has(it.id)) return { error: json({ error: "item_unavailable", id: l && l.id }, 400) };
    ids.add(it.id);
    const qty = int(l.qty);
    if (!(qty >= 1 && qty <= maxQty)) return { error: json({ error: "bad_qty", id: it.id }, 400) };
    let price = it.price;
    if (price === null) {
      if (!manualPrice) return { error: json({ error: "item_unavailable", id: it.id }, 400) };
      price = int(l.price);
      if (!(price >= 0 && price <= MAX_PRICE)) return { error: json({ error: "price_required", id: it.id }, 400) };
    }
    lines.push({ ...it, qty, price });
  }
  const total = lines.reduce((s, l) => s + l.price * l.qty, 0);
  const now = Date.now();
  // one transaction; inside it MAX(id) is the order just inserted
  const res = await env.DB.batch([
    env.DB.prepare("INSERT INTO orders (table_no, status, total, source, created_at, updated_at) VALUES (?, 'new', ?, ?, ?, ?)")
      .bind(table, total, source, now, now),
    ...lines.map((l, i) => env.DB.prepare(
      `INSERT INTO order_items (order_id, line, item_id, name_fr, name_en, unit_price, qty)
       VALUES ((SELECT MAX(id) FROM orders), ?, ?, ?, ?, ?, ?)`
    ).bind(i, l.id, l.name_fr, l.name_en || l.name_fr, l.price, l.qty)),
    env.DB.prepare("SELECT MAX(id) AS id FROM orders"),
  ]);
  return { order: await getOrder(env.DB, res[res.length - 1].results[0].id) };
}
