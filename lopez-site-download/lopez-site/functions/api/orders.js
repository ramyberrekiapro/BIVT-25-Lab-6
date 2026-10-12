// Café orders (staff, signed in on /admin/). Cash only. Stored in D1 (binding DB).
//
//   GET   /api/orders?view=active|all&before=<id>   list (newest first, 50 per page)
//   GET   /api/orders?since=<ms>                    orders created or changed since <ms>
//                                                   (the admin polls this to show new orders)
//   POST  /api/orders  { table, items: [{ id, qty, price? }] }   create an order
//            price is only read for items whose menu price is not a number ("Prix sur place");
//            every other price comes from the menu on the server.
//   PATCH /api/orders?id=<n>  { status }            new | preparing | ready | paid | completed
//   PATCH /api/orders?id=<n>  { cash_received }     record a cash payment; the change is
//                                                   calculated here and the order becomes "paid"
//
// Every response that returns orders gives { orders: [...], now } with each order as
// { id, table, status, total, cash_received, change, paid_at, created_at, updated_at,
//   items: [{ item_id, name_fr, name_en, unit_price, qty, line_total }] }.
// Amounts are whole Algerian dinars (DA).

import { json, requireAdmin } from "../../lib/admin.js";
import { ensureMenuSchema } from "./menu.js";
import { orderableItems } from "../../lib/menu.js";

export const STATUSES = ["new", "preparing", "ready", "paid", "completed"];
const NEEDS_PAYMENT = new Set(["paid", "completed"]);
const ACTIVE = ["new", "preparing", "ready", "paid"];
const MAX_LINES = 50, MAX_QTY = 99, MAX_PRICE = 1_000_000, MAX_CASH = 100_000_000;
const PAGE = 50;

let schemaReady = null;
function ensureSchema(db) {
  if (!schemaReady) {
    schemaReady = db.batch([
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
    ]).catch((e) => { schemaReady = null; throw e; });
  }
  return schemaReady;
}

const int = (v) => (typeof v === "number" && Number.isInteger(v) ? v : NaN);

// orders rows -> API objects with their items
async function withItems(db, rows) {
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
    cash_received: r.cash_received, change: r.change_given, paid_at: r.paid_at,
    created_at: r.created_at, updated_at: r.updated_at, items: byOrder.get(r.id),
  }));
}

const COLS = "id, table_no, status, total, cash_received, change_given, paid_at, created_at, updated_at";

async function getOrder(db, id) {
  const row = await db.prepare(`SELECT ${COLS} FROM orders WHERE id = ?`).bind(id).first();
  return row ? (await withItems(db, [row]))[0] : null;
}

export async function onRequestGet({ request, env }) {
  const denied = await requireAdmin(request, env);
  if (denied) return denied;
  await ensureSchema(env.DB);
  const q = new URL(request.url).searchParams;
  const now = Date.now();
  let rows;
  if (q.has("since")) {
    const since = parseInt(q.get("since"), 10);
    if (!Number.isFinite(since) || since < 0) return json({ error: "bad_request" }, 400);
    ({ results: rows } = await env.DB.prepare(
      `SELECT ${COLS} FROM orders WHERE updated_at >= ? ORDER BY id DESC LIMIT 200`
    ).bind(since).all());
  } else {
    const before = q.has("before") ? parseInt(q.get("before"), 10) : 2 ** 53;
    if (!Number.isFinite(before)) return json({ error: "bad_request" }, 400);
    const active = q.get("view") !== "all";
    ({ results: rows } = await env.DB.prepare(
      `SELECT ${COLS} FROM orders WHERE id < ? ${active ? `AND status IN (${ACTIVE.map(() => "?").join(",")})` : ""}
       ORDER BY id DESC LIMIT ${PAGE + 1}`
    ).bind(before, ...(active ? ACTIVE : [])).all());
  }
  const more = !q.has("since") && rows.length > PAGE;
  return json({ orders: await withItems(env.DB, rows.slice(0, PAGE)), more, now });
}

export async function onRequestPost({ request, env }) {
  const denied = await requireAdmin(request, env);
  if (denied) return denied;
  let b;
  try { b = await request.json(); } catch { return json({ error: "bad_request" }, 400); }
  const table = typeof b.table === "string" ? b.table.replace(/[\u0000-\u001f]/g, "").trim() : "";
  if (!table || table.length > 12) return json({ error: "table_required" }, 400);
  if (!Array.isArray(b.items) || b.items.length === 0) return json({ error: "items_required" }, 400);
  if (b.items.length > MAX_LINES) return json({ error: "too_many_items" }, 400);

  await ensureMenuSchema(env.DB);
  await ensureSchema(env.DB);
  const menu = await orderableItems(request, env);
  const lines = [];
  for (const l of b.items) {
    const it = l && typeof l.id === "string" ? menu.get(l.id) : null;
    if (!it) return json({ error: "item_unavailable", id: l && l.id }, 400);
    const qty = int(l.qty);
    if (!(qty >= 1 && qty <= MAX_QTY)) return json({ error: "bad_qty", id: it.id }, 400);
    let price = it.price;
    if (price === null) { // "Prix sur place": the staff enters the price
      price = int(l.price);
      if (!(price >= 0 && price <= MAX_PRICE)) return json({ error: "price_required", id: it.id }, 400);
    }
    lines.push({ ...it, qty, price });
  }
  const total = lines.reduce((s, l) => s + l.price * l.qty, 0);
  const now = Date.now();
  // one transaction; inside it MAX(id) is the order just inserted
  const stmts = [
    env.DB.prepare("INSERT INTO orders (table_no, status, total, created_at, updated_at) VALUES (?, 'new', ?, ?, ?)")
      .bind(table, total, now, now),
    ...lines.map((l, i) => env.DB.prepare(
      `INSERT INTO order_items (order_id, line, item_id, name_fr, name_en, unit_price, qty)
       VALUES ((SELECT MAX(id) FROM orders), ?, ?, ?, ?, ?, ?)`
    ).bind(i, l.id, l.name_fr, l.name_en || l.name_fr, l.price, l.qty)),
    env.DB.prepare("SELECT MAX(id) AS id FROM orders"),
  ];
  const res = await env.DB.batch(stmts);
  const id = res[res.length - 1].results[0].id;
  return json({ ok: true, order: await getOrder(env.DB, id) }, 201);
}

export async function onRequestPatch({ request, env }) {
  const denied = await requireAdmin(request, env);
  if (denied) return denied;
  const id = parseInt(new URL(request.url).searchParams.get("id") || "", 10);
  if (!(id > 0)) return json({ error: "bad_id" }, 400);
  let b;
  try { b = await request.json(); } catch { return json({ error: "bad_request" }, 400); }
  await ensureSchema(env.DB);
  const order = await env.DB.prepare(`SELECT ${COLS} FROM orders WHERE id = ?`).bind(id).first();
  if (!order) return json({ error: "not_found" }, 404);
  const now = Date.now();

  if (b.cash_received !== undefined) {
    const cash = int(b.cash_received);
    if (!(cash >= 0 && cash <= MAX_CASH)) return json({ error: "bad_amount" }, 400);
    if (cash < order.total) return json({ error: "not_enough_cash", total: order.total }, 400);
    if (order.status === "completed") return json({ error: "order_completed" }, 409);
    await env.DB.prepare(
      "UPDATE orders SET cash_received = ?, change_given = ?, paid_at = ?, status = 'paid', updated_at = ? WHERE id = ?"
    ).bind(cash, cash - order.total, now, now, id).run();
  } else if (typeof b.status === "string") {
    if (!STATUSES.includes(b.status)) return json({ error: "bad_status" }, 400);
    if (NEEDS_PAYMENT.has(b.status) && order.paid_at == null) return json({ error: "payment_required" }, 409);
    await env.DB.prepare("UPDATE orders SET status = ?, updated_at = ? WHERE id = ?").bind(b.status, now, id).run();
  } else {
    return json({ error: "bad_request" }, 400);
  }
  return json({ ok: true, order: await getOrder(env.DB, id) });
}
