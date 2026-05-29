// functions/api/claude-proxy.js
// Cloudflare Pages Function — proxies Anthropic API calls server-side.
// Keeps the API key out of the browser. Set ANTHROPIC_API_KEY in:
//   Cloudflare Dashboard → Pages → your project → Settings → Environment Variables

const CORS_HEADERS = (origin) => ({
  'Access-Control-Allow-Origin': origin || '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
});

function isAllowedOrigin(origin, env) {
  if (!origin) return true; // same-origin requests have no Origin header
  if (origin.endsWith('.pages.dev')) return true;
  // Allow any loopback origin on any port — safe because loopback is
  // unreachable from outside the machine running Wrangler.
  try {
    const u = new URL(origin);
    if (u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '[::1]') {
      return true;
    }
  } catch { /* fall through to denial */ }
  if (env.ALLOWED_ORIGIN && origin === env.ALLOWED_ORIGIN) return true;
  return false;
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

  if (!isAllowedOrigin(origin, env)) {
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
          'ANTHROPIC_API_KEY is not set. Add it in Cloudflare Dashboard → Pages → your project → Settings → Environment Variables.',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS(origin) },
      }
    );
  }

  try {
    const body = await request.json();

    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: body.model || 'claude-sonnet-4-6',
        max_tokens: body.max_tokens || 1000,
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
