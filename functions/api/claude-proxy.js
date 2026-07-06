// functions/api/claude-proxy.js
// Cloudflare Worker route (functions/api/*, routed via src/index.js) — proxies
// Anthropic API calls server-side, keeping the API key out of the browser.
// Set ANTHROPIC_API_KEY as an encrypted SECRET in:
//   Cloudflare Dashboard → your Worker → Settings → Variables and Secrets
// (Use a Secret, NOT a plain-text var — `wrangler deploy` on git push wipes
//  plain vars not declared in wrangler.jsonc, but Secrets persist. The Build
//  tab's variables are build-time only; the Worker never sees them.)
//
// ─── Abuse hardening ─────────────────────────────────────────────────────────
// This endpoint spends Abdullah's Anthropic credits, so an open proxy is a
// direct billing-drain risk. Defense in depth, cheapest first:
//   1. Origin gate  — only same-origin (the editor calling its own Worker),
//                     loopback (dev), or an explicit ALLOWED_ORIGIN may call.
//                     Blocks drive-by bots and cross-site pages. NOTE: a
//                     determined attacker can spoof the Origin header from a
//                     non-browser client, so this is a first-line filter, not
//                     the sole control — layers 2–4 bound the damage anyway.
//   2. Model pin    — the model is forced to an allowlist server-side, so a
//                     caller can't request the most expensive model.
//   3. Token cap    — max_tokens is clamped to MAX_TOKENS, and the prompt size
//                     is capped, so a single call can't be amplified.
//   4. Rate limit   — per-IP hourly cap in KV (env.BIZCARD_STATS, reused),
//                     which bounds total spend even if Origin is spoofed.

// Models this proxy is willing to bill for. The editor asks for Sonnet; anything
// off-list (or absent) falls back to DEFAULT_MODEL rather than being honored.
const ALLOWED_MODELS = new Set([
  'claude-sonnet-4-6',
  'claude-haiku-4-5-20251001',
]);
const DEFAULT_MODEL = 'claude-sonnet-4-6';

const MAX_TOKENS = 4096;          // hard ceiling on a single response
const MAX_PROMPT_CHARS = 24000;   // hard ceiling on total input text per call
const RATE_LIMIT_PER_HOUR = 40;   // per-IP calls/hour (generous for editor use)

const CORS_HEADERS = (origin) => ({
  'Access-Control-Allow-Origin': origin || '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
});

// origin      — the request's Origin header ('' when absent)
// env         — Worker env (ALLOWED_ORIGIN optional)
// selfOrigin  — the Worker's own origin (new URL(request.url).origin)
//
// Only a browser making a same-origin POST reliably sends Origin, and it always
// matches selfOrigin — that's the editor calling its own Worker. A missing
// Origin means a non-browser client (curl, bot), which we now reject on POST.
function isAllowedOrigin(origin, env, selfOrigin) {
  if (!origin) return false; // POST from a browser always carries Origin
  if (selfOrigin && origin === selfOrigin) return true; // same-origin editor
  if (env && env.ALLOWED_ORIGIN && origin === env.ALLOWED_ORIGIN) return true;
  // Any loopback origin on any port — safe because loopback is unreachable from
  // outside the machine running Wrangler.
  try {
    const u = new URL(origin);
    if (u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '[::1]') {
      return true;
    }
  } catch { /* malformed Origin → deny */ }
  return false;
}

// Fixed-window per-IP rate limit. Returns true when the caller is over budget.
// Best-effort: KV read-modify-write can race under bursts, but that only lets a
// few extra calls through — fine for abuse-bounding. Fails open if KV is absent
// (e.g. local dev without the binding) so it never blocks legitimate use.
async function isRateLimited(env, ip) {
  const kv = env && env.BIZCARD_STATS;
  if (!kv || !ip) return false;
  const bucket = Math.floor(Date.now() / 3600000); // hour bucket
  const key = `rl:proxy:${ip}:${bucket}`;
  try {
    const n = parseInt((await kv.get(key)) || '0', 10);
    if (n >= RATE_LIMIT_PER_HOUR) return true;
    // TTL a bit over an hour so the bucket self-expires.
    await kv.put(key, String(n + 1), { expirationTtl: 4000 });
    return false;
  } catch {
    return false; // never let a KV hiccup block the editor
  }
}

// Total character count across all message content — guards against a caller
// smuggling a huge prompt through to run up input-token cost.
function promptChars(messages) {
  if (!Array.isArray(messages)) return Infinity;
  let total = 0;
  for (const m of messages) {
    if (typeof m?.content === 'string') {
      total += m.content.length;
    } else if (Array.isArray(m?.content)) {
      for (const part of m.content) total += (part?.text || '').length;
    }
  }
  return total;
}

// Handle CORS preflight
export async function onRequestOptions({ request }) {
  const origin = request.headers.get('origin') || '';
  return new Response(null, {
    status: 204,
    headers: CORS_HEADERS(origin),
  });
}

export async function onRequestPost({ request, env }) {
  const origin = request.headers.get('origin') || '';
  const selfOrigin = new URL(request.url).origin;

  if (!isAllowedOrigin(origin, env, selfOrigin)) {
    return new Response(JSON.stringify({ error: 'Forbidden origin' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return new Response(
      JSON.stringify({
        error:
          'ANTHROPIC_API_KEY is not set. Add it as an encrypted Secret in Cloudflare Dashboard → your Worker → Settings → Variables and Secrets.',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS(origin) },
      }
    );
  }

  // Per-IP rate limit — the real backstop against a spoofed Origin.
  const ip = request.headers.get('cf-connecting-ip') || '';
  if (await isRateLimited(env, ip)) {
    return new Response(
      JSON.stringify({ error: 'Rate limit exceeded — try again later.' }),
      {
        status: 429,
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS(origin) },
      }
    );
  }

  try {
    const body = await request.json();

    if (!Array.isArray(body.messages) || body.messages.length === 0) {
      return new Response(JSON.stringify({ error: 'messages[] required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS(origin) },
      });
    }
    if (promptChars(body.messages) > MAX_PROMPT_CHARS) {
      return new Response(JSON.stringify({ error: 'Prompt too large' }), {
        status: 413,
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS(origin) },
      });
    }

    // Force model + token ceiling server-side — never trust the client's ask.
    const model = ALLOWED_MODELS.has(body.model) ? body.model : DEFAULT_MODEL;
    const maxTokens = Math.min(
      Math.max(1, parseInt(body.max_tokens, 10) || 1000),
      MAX_TOKENS
    );

    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        messages: body.messages,
      }),
    });

    const data = await upstream.json();

    return new Response(JSON.stringify(data), {
      status: upstream.status,
      headers: {
        'Content-Type': 'application/json',
        ...CORS_HEADERS(origin),
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS(origin) },
    });
  }
}

// Test-only exports (see tests/backend.spec.js) — the origin allowlist and the
// input-size guard are the security-sensitive bits worth guarding; harmless to
// the bundler.
export { isAllowedOrigin, promptChars };
