'use strict';

const buckets = new Map();

function plainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function bodyBytes(value) {
  try { return Buffer.byteLength(JSON.stringify(value), 'utf8'); }
  catch { return Number.POSITIVE_INFINITY; }
}

function validateDataEnvelope(body, { allowedFields, maxBytes = 8192, allowConfirmations = false } = {}) {
  if (!plainObject(body) || bodyBytes(body) > maxBytes) return { ok: false };
  const topLevel = new Set(['data', ...(allowConfirmations ? ['confirmations'] : [])]);
  if (Object.keys(body).some((key) => !topLevel.has(key)) || !plainObject(body.data)) return { ok: false };
  if (allowedFields && Object.keys(body.data).some((key) => !allowedFields.includes(key))) return { ok: false };
  if (allowConfirmations && body.confirmations !== undefined && !plainObject(body.confirmations)) return { ok: false };
  return { ok: true, data: body.data };
}

function requesterKey(ctx) {
  const userId = ctx.state?.user?.id;
  if (userId !== undefined && userId !== null) return `user:${userId}`;
  return `ip:${ctx.request?.ip || ctx.ip || 'unknown'}`;
}

function consumeRateLimit(ctx, scope, { limit, windowMs, now = Date.now() }) {
  if (buckets.size > 10_000) {
    for (const [candidateKey, candidate] of buckets) {
      if (now >= candidate.resetAt) buckets.delete(candidateKey);
    }
    while (buckets.size > 10_000) buckets.delete(buckets.keys().next().value);
  }
  const key = `${scope}:${requesterKey(ctx)}`;
  const existing = buckets.get(key);
  const bucket = !existing || now >= existing.resetAt ? { count: 0, resetAt: now + windowMs } : existing;
  bucket.count += 1;
  buckets.set(key, bucket);
  if (bucket.count <= limit) return true;
  ctx.set?.('Retry-After', String(Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))));
  ctx.status = 429;
  ctx.body = { error: { status: 429, name: 'TooManyRequestsError', message: 'Too many requests. Please try again later.' } };
  return false;
}

function resetRateLimits() {
  buckets.clear();
}

module.exports = { bodyBytes, consumeRateLimit, plainObject, resetRateLimits, validateDataEnvelope };
