// netlify/functions/claude-proxy.js
// Server-side proxy for Anthropic API calls.
// Keeps the API key server-side and avoids CORS issues.
// The key is stored as a Netlify environment variable: ANTHROPIC_API_KEY

exports.handler = async (event) => {
  // Only allow POST
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  // Only allow calls from your own site
  const origin = event.headers.origin || '';
  const allowed = [
    'https://miami-ride-companion.netlify.app',
    'http://localhost:8888', // for local Netlify dev testing
  ];
  if (!allowed.includes(origin)) {
    return { statusCode: 403, body: JSON.stringify({ error: 'Forbidden origin' }) };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': origin },
      body: JSON.stringify({ error: 'ANTHROPIC_API_KEY environment variable not set. Add it in Netlify → Site settings → Environment variables.' })
    };
  }

  try {
    const body = JSON.parse(event.body);

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: body.model || 'claude-sonnet-4-20250514',
        max_tokens: body.max_tokens || 1000,
        messages: body.messages,
      }),
    });

    const data = await response.json();

    return {
      statusCode: response.status,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': origin,
      },
      body: JSON.stringify(data),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': origin },
      body: JSON.stringify({ error: err.message }),
    };
  }
};
