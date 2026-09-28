// Customer messages for Lopez.
//   POST   /api/messages          public  - a customer sends a message
//   GET    /api/messages          admin   - list messages (newest first)
//   PATCH  /api/messages?id=...   admin   - mark read / unread  { read: true|false }
//   DELETE /api/messages?id=...   admin   - delete a message
//
// Needs, in the Cloudflare Pages project settings:
//   - KV namespace binding named MESSAGES
//   - secret ADMIN_PASSWORD

import { json, requireAdmin } from "../../lib/admin.js";

const LIMITS = { name: 80, contact: 120, message: 1500 };
const SEND_PER_WINDOW = 5;          // messages per IP ...
const SEND_WINDOW_S = 600;          // ... per 10 minutes

function clean(v, max) {
  return typeof v === "string" ? v.replace(/\u0000/g, "").trim().slice(0, max) : "";
}

// Newest first: KV lists keys in ascending order, so invert the timestamp.
function newKey() {
  const inv = String(9999999999999 - Date.now()).padStart(13, "0");
  return `msg:${inv}:${crypto.randomUUID().slice(0, 8)}`;
}

async function bump(env, key, ttl) {
  const n = parseInt((await env.MESSAGES.get(key)) || "0", 10) + 1;
  await env.MESSAGES.put(key, String(n), { expirationTtl: ttl });
  return n;
}

export async function onRequestPost({ request, env }) {
  if (!env.MESSAGES) return json({ error: "storage_not_configured" }, 503);
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

  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  if ((await bump(env, `rate:${ip}`, SEND_WINDOW_S)) > SEND_PER_WINDOW) {
    return json({ error: "too_many_messages" }, 429);
  }

  const key = newKey();
  const record = { ...msg, id: key, date: new Date().toISOString(), read: false };
  await env.MESSAGES.put(key, JSON.stringify(record));
  return json({ ok: true });
}

export async function onRequestGet({ request, env }) {
  if (!env.MESSAGES) return json({ error: "storage_not_configured" }, 503);
  const denied = await requireAdmin(request, env);
  if (denied) return denied;

  const list = await env.MESSAGES.list({ prefix: "msg:", limit: 200 });
  const items = await Promise.all(
    list.keys.map(async (k) => {
      const v = await env.MESSAGES.get(k.name);
      try { return v ? JSON.parse(v) : null; } catch { return null; }
    })
  );
  return json({ messages: items.filter(Boolean), more: !list.list_complete });
}

async function adminUpdate(request, env, fn) {
  if (!env.MESSAGES) return json({ error: "storage_not_configured" }, 503);
  const denied = await requireAdmin(request, env);
  if (denied) return denied;
  const id = new URL(request.url).searchParams.get("id") || "";
  if (!/^msg:\d{13}:[0-9a-f]{8}$/.test(id)) return json({ error: "bad_id" }, 400);
  return fn(id);
}

export async function onRequestPatch({ request, env }) {
  return adminUpdate(request, env, async (id) => {
    const v = await env.MESSAGES.get(id);
    if (!v) return json({ error: "not_found" }, 404);
    let body = {};
    try { body = await request.json(); } catch {}
    const rec = JSON.parse(v);
    rec.read = body.read !== false;
    await env.MESSAGES.put(id, JSON.stringify(rec));
    return json({ ok: true });
  });
}

export async function onRequestDelete({ request, env }) {
  return adminUpdate(request, env, async (id) => {
    await env.MESSAGES.delete(id);
    return json({ ok: true });
  });
}
