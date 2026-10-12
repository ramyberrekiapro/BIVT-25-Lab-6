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
// Customers place orders from the menu with POST /api/order (see order.js); they arrive here
// with source "customer".
// Every response that returns orders gives { orders: [...], now } with each order as
// { id, table, status, total, cash_received, change, paid_at, source ("staff" | "customer"),
//   created_at, updated_at,
//   items: [{ item_id, name_fr, name_en, unit_price, qty, line_total }] }.
// Amounts are whole Algerian dinars (DA).

import { json, requireAdmin } from "../../lib/admin.js";
import { ensureOrdersSchema as ensureSchema, COLS, withItems, getOrder, createOrder } from "../../lib/orders.js";

export const STATUSES = ["new", "preparing", "ready", "paid", "completed"];
const NEEDS_PAYMENT = new Set(["paid", "completed"]);
const ACTIVE = ["new", "preparing", "ready", "paid"];
const MAX_CASH = 100_000_000;
const PAGE = 50;

const int = (v) => (typeof v === "number" && Number.isInteger(v) ? v : NaN);

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
  const r = await createOrder(request, env, b, { source: "staff", maxQty: 99, manualPrice: true });
  return r.error || json({ ok: true, order: r.order }, 201);
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
