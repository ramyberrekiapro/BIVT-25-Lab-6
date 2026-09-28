// Public like counts for menu items.
//   GET  /api/likes                                    -> { counts: { "<item-id>": n, ... } }
//   POST /api/likes  { item, voter, like: true|false } -> { item, count, liked }
//
// One like per device per item: the page sends a random "voter" id kept in the
// visitor's browser. Needs a D1 database binding named DB in the Pages project;
// the table is created automatically on first use.

const ITEM_RE = /^[a-z0-9-]{1,60}$/;
const VOTER_RE = /^[A-Za-z0-9-]{16,64}$/;
const ACTIONS_PER_WINDOW = 60;   // like/unlike actions per IP ...
const WINDOW_S = 600;            // ... per 10 minutes

let schemaReady = null;
function ensureSchema(db) {
  if (!schemaReady) {
    schemaReady = db.batch([
      db.prepare(
        "CREATE TABLE IF NOT EXISTS likes (item TEXT NOT NULL, voter TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (item, voter))"
      ),
      db.prepare(
        "CREATE TABLE IF NOT EXISTS like_actions (ip TEXT NOT NULL, at INTEGER NOT NULL)"
      ),
      db.prepare("CREATE INDEX IF NOT EXISTS like_actions_ip ON like_actions (ip, at)"),
    ]).catch((e) => { schemaReady = null; throw e; });
  }
  return schemaReady;
}

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...extra },
  });
}

async function ipKey(request) {
  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("lopez:" + ip));
  return [...new Uint8Array(digest)].slice(0, 12).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function onRequestGet({ env }) {
  if (!env.DB) return json({ error: "database_not_configured" }, 503);
  await ensureSchema(env.DB);
  const { results } = await env.DB.prepare("SELECT item, COUNT(*) AS n FROM likes GROUP BY item").all();
  const counts = {};
  for (const r of results) counts[r.item] = r.n;
  return json({ counts }, 200, { "cache-control": "public, max-age=10" });
}

export async function onRequestPost({ request, env }) {
  if (!env.DB) return json({ error: "database_not_configured" }, 503);
  let body;
  try { body = await request.json(); } catch { return json({ error: "bad_request" }, 400); }
  const item = typeof body.item === "string" ? body.item : "";
  const voter = typeof body.voter === "string" ? body.voter : "";
  if (!ITEM_RE.test(item) || !VOTER_RE.test(voter) || typeof body.like !== "boolean") {
    return json({ error: "bad_request" }, 400);
  }
  await ensureSchema(env.DB);

  const now = Math.floor(Date.now() / 1000);
  const ip = await ipKey(request);
  const recent = await env.DB
    .prepare("SELECT COUNT(*) AS n FROM like_actions WHERE ip = ? AND at > ?")
    .bind(ip, now - WINDOW_S)
    .first("n");
  if (recent >= ACTIONS_PER_WINDOW) return json({ error: "too_many_actions" }, 429);

  const write = body.like
    ? env.DB.prepare("INSERT OR IGNORE INTO likes (item, voter, created_at) VALUES (?, ?, ?)").bind(item, voter, now)
    : env.DB.prepare("DELETE FROM likes WHERE item = ? AND voter = ?").bind(item, voter);
  const res = await env.DB.batch([
    write,
    env.DB.prepare("INSERT INTO like_actions (ip, at) VALUES (?, ?)").bind(ip, now),
    env.DB.prepare("DELETE FROM like_actions WHERE at < ?").bind(now - WINDOW_S),
    env.DB.prepare("SELECT COUNT(*) AS n FROM likes WHERE item = ?").bind(item),
  ]);
  const count = res[3].results[0].n;
  return json({ item, count, liked: body.like });
}
