// GET /api/photo?id=<item-id>&v=<version>  public - a photo the owner uploaded on /admin/.
// The version changes with every upload, so the response can be cached for a long time.

import { ensureMenuSchema } from "./menu.js";

export async function onRequestGet({ request, env }) {
  if (!env.DB) return new Response("Not found", { status: 404 });
  const id = new URL(request.url).searchParams.get("id") || "";
  if (!/^[a-z0-9-]{1,60}$/.test(id)) return new Response("Not found", { status: 404 });
  await ensureMenuSchema(env.DB);
  const photo = await env.DB.prepare("SELECT photo FROM menu_items WHERE id = ?").bind(id).first("photo");
  const m = typeof photo === "string" && photo.match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/);
  if (!m) return new Response("Not found", { status: 404 });
  const bytes = Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0));
  return new Response(bytes, {
    headers: { "content-type": m[1], "cache-control": "public, max-age=31536000, immutable" },
  });
}
