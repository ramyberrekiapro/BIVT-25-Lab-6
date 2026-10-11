// Small HTTP helpers shared by all Pages Functions.

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...headers,
    },
  });
}

export function errorResponse(err) {
  if (err instanceof HttpError) return json({ error: err.message }, err.status);
  console.error(err);
  return json({ error: 'Internal server error' }, 500);
}

export async function readJson(request) {
  const type = request.headers.get('content-type') || '';
  if (!type.includes('application/json')) throw new HttpError(415, 'Expected JSON body');
  try {
    return await request.json();
  } catch {
    throw new HttpError(400, 'Invalid JSON body');
  }
}

// ---- input validation ----

export function str(value, field, { max = 500, required = false } = {}) {
  const s = value == null ? '' : String(value).trim();
  if (required && !s) throw new HttpError(400, `${field} is required`);
  if (s.length > max) throw new HttpError(400, `${field} is too long (max ${max} characters)`);
  return s;
}

export function bool(value) {
  return value === true || value === 1 || value === '1' || value === 'true' ? 1 : 0;
}

export function price(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 100_000_000) throw new HttpError(400, 'Price must be a positive number');
  return Math.round(n);
}

export function id(value, field = 'id') {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, `Invalid ${field}`);
  return n;
}

export function idList(value) {
  if (!Array.isArray(value) || value.length > 1000) throw new HttpError(400, 'Expected a list of ids');
  return value.map((v) => id(v));
}
