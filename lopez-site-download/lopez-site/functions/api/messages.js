// Customer messages for Lopez, stored in D1 (binding DB).
//   POST   /api/messages          public  - a customer sends a message
//   GET    /api/messages          owner   - list messages (newest first, 200 max)
//   PATCH  /api/messages?id=...   owner   - mark read / unread  { read: true|false }
//   DELETE /api/messages?id=...   owner   - delete a message

import { json, noDb, requireAdmin, ipKey } from "../../lib/admin.js";

const LIMITS = { name: 80, contact: 120, message: 1500 };
const SEND_PER_WINDOW = 5;          // messages per IP ...
const SEND_WINDOW_S = 600;          // ... per 10 minutes
const ID_RE = /^[0-9a-f-]{36}$/;

let schemaReady = null;
function ensureSchema(db) {
  if (!schemaReady) {
    schemaReady = db.batch([
      db.prepare(`CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY, name TEXT, contact TEXT, message TEXT NOT NULL, lang TEXT,
        date TEXT NOT NULL, read INTEGER NOT NULL DEFAULT 0)`),
      db.prepare("CREATE TABLE IF NOT EXISTS message_rate (ip TEXT NOT NULL, at INTEGER NOT NULL)"),
      db.prepare("CREATE INDEX IF NOT EXISTS message_rate_ip ON message_rate (ip, at)"),
    ]).catch((e) => { schemaReady = null; throw e; });
  }
  return schemaReady;
}

function clean(v, max) {
  return typeof v === "string" ? v.replace(/\u0000/g, "").trim().slice(0, max) : "";
}

export async function onRequestPost({ request, env }) {
  if (!env.DB) return noDb();
  let body;
  try { body = await request.json(); } catch { return json({ error: "bad_request" }, 400); }

  // Honeypot: real visitors never fill the hidden "website" field.
  if (clean(body.website, 200)) return json({ ok: true });

  const msg = {
    name: clean(body.name, LIMITS.name),
    contact: clean(body.contact, LIMITS.contact),
    message: clean(body.message, LIMITS.message),
    lang: body.lang === "en" ? "en" : "fr",
  };
  if (msg.message.length < 2) return json({ error: "empty_message" }, 400);

  await ensureSchema(env.DB);
  const now = Math.floor(Date.now() / 1000);
  const ip = await ipKey(request, "msg");
  const recent = await env.DB.prepare("SELECT COUNT(*) AS n FROM message_rate WHERE ip = ? AND at > ?")
    .bind(ip, now - SEND_WINDOW_S).first("n");
  if (recent >= SEND_PER_WINDOW) return json({ error: "too_many_messages" }, 429);

  await env.DB.batch([
    env.DB.prepare("INSERT INTO messages (id, name, contact, message, lang, date, read) VALUES (?, ?, ?, ?, ?, ?, 0)")
      .bind(crypto.randomUUID(), msg.name, msg.contact, msg.message, msg.lang, new Date().toISOString()),
    env.DB.prepare("INSERT INTO message_rate (ip, at) VALUES (?, ?)").bind(ip, now),
    env.DB.prepare("DELETE FROM message_rate WHERE at < ?").bind(now - SEND_WINDOW_S),
  ]);
  return json({ ok: true });
}

export async function onRequestGet({ request, env }) {
  const denied = await requireAdmin(request, env);
  if (denied) return denied;
  await ensureSchema(env.DB);
  const { results } = await env.DB.prepare(
    "SELECT id, name, contact, message, lang, date, read FROM messages ORDER BY date DESC LIMIT 201"
  ).all();
  const more = results.length > 200;
  const messages = results.slice(0, 200).map((m) => ({ ...m, read: !!m.read }));
  return json({ messages, more });
}

async function withMessage(request, env, fn) {
  const denied = await requireAdmin(request, env);
  if (denied) return denied;
  const id = new URL(request.url).searchParams.get("id") || "";
  if (!ID_RE.test(id)) return json({ error: "bad_id" }, 400);
  await ensureSchema(env.DB);
  return fn(id);
}

export async function onRequestPatch({ request, env }) {
  return withMessage(request, env, async (id) => {
    let body = {};
    try { body = await request.json(); } catch {}
    const r = await env.DB.prepare("UPDATE messages SET read = ? WHERE id = ?").bind(body.read !== false ? 1 : 0, id).run();
    if (!r.meta.changes) return json({ error: "not_found" }, 404);
    return json({ ok: true });
  });
}

export async function onRequestDelete({ request, env }) {
  return withMessage(request, env, async (id) => {
    await env.DB.prepare("DELETE FROM messages WHERE id = ?").bind(id).run();
    return json({ ok: true });
  });
}
