// Cloudflare Worker API for URI Link Generator.
// Provides public, persistent subscription URLs backed by Cloudflare KV.
import vpnCore from '../../src/vpnCore.js';

const { processRawInput, toShareUri, safeBase64Encode } = vpnCore;

const ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const MAX_INPUT_BYTES = 256 * 1024;
const KEY_PREFIX = 'sub:';

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') || '';
  const allowed = String(env.ALLOWED_ORIGINS || '*')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  let allow = '*';
  if (!allowed.includes('*')) {
    allow = allowed.includes(origin) ? origin : allowed[0] || '';
  }
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function json(data, status, cors) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...cors },
  });
}

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function buildUrls(origin, id, subName) {
  const base = `${origin}/sub/${id}`;
  return {
    universalSub: base,
    singBoxSub: `${base}?target=singbox`,
    xraySub: `${base}?target=xray`,
    singBoxJsonUrl: `${base}?target=singbox-json`,
    xrayJsonUrl: `${base}?target=xray-json`,
    rawListUrl: `${base}?target=raw`,
    hiddifyDeepLink: `hiddify://import/${base}?target=singbox#${encodeURIComponent(subName || 'Hiddify-Sub')}`,
    v2rayNgDeepLink: `v2rayng://install-config?url=${encodeURIComponent(`${base}?target=xray`)}`,
  };
}

async function readJsonBody(request) {
  const text = await request.text();
  if (text.length > MAX_INPUT_BYTES + 4096) {
    return { error: 'Request body too large', status: 413 };
  }
  try {
    return { body: JSON.parse(text || '{}') };
  } catch {
    return { error: 'Invalid JSON body', status: 400 };
  }
}

async function handleParse(request, env, cors) {
  const { body, error, status } = await readJsonBody(request);
  if (error) return json({ ok: false, error }, status, cors);

  const {
    rawInput = '',
    targetCore = 'all',
    deduplicate = false,
    remarkPrefix = '',
    renumberRemarks = false,
    subId = '',
    subToken = '',
    subName = 'My VPN Subscription',
    saveToSub = false,
  } = body || {};

  if (typeof rawInput !== 'string' || rawInput.length > MAX_INPUT_BYTES) {
    return json({ ok: false, error: 'Input must be text under 256 KB' }, 413, cors);
  }

  const options = {
    targetCore: ['all', 'singbox', 'xray'].includes(targetCore) ? targetCore : 'all',
    deduplicate: Boolean(deduplicate),
    remarkPrefix: String(remarkPrefix || '').slice(0, 64),
    renumberRemarks: Boolean(renumberRemarks),
  };
  const name = String(subName || 'My VPN Subscription').slice(0, 100);
  const result = processRawInput(rawInput, options);

  let saved = false;
  if (saveToSub && result.nodes.length > 0) {
    if (!ID_RE.test(subId) || typeof subToken !== 'string' || subToken.length < 16) {
      return json({ ok: false, error: 'Missing or invalid subscription ID/token' }, 400, cors);
    }
    const tokenHash = await sha256Hex(subToken);
    const key = KEY_PREFIX + subId;
    const existing = await env.SUBS.get(key, 'json');
    if (existing && existing.tokenHash !== tokenHash) {
      return json(
        { ok: false, code: 'TOKEN_MISMATCH', error: 'This subscription ID belongs to someone else' },
        403,
        cors
      );
    }
    const unchanged =
      existing &&
      existing.rawInput === rawInput &&
      existing.name === name &&
      JSON.stringify(existing.options) === JSON.stringify(options);
    if (!unchanged) {
      await env.SUBS.put(
        key,
        JSON.stringify({ name, rawInput, options, tokenHash, updatedAt: new Date().toISOString() })
      );
    }
    saved = true;
  }

  const origin = new URL(request.url).origin;
  const validId = ID_RE.test(subId) ? subId : null;

  return json(
    {
      ok: true,
      subId: validId,
      subName: name,
      saved,
      urls: validId ? buildUrls(origin, validId, name) : {},
      stats: result.stats,
      nodes: result.nodes,
      errors: result.errors,
      outputs: result.outputs,
    },
    200,
    cors
  );
}

async function handleDelete(request, env, cors, id) {
  if (!ID_RE.test(id)) return json({ ok: false, error: 'Invalid subscription ID' }, 400, cors);
  const { body, error, status } = await readJsonBody(request);
  if (error) return json({ ok: false, error }, status, cors);
  const key = KEY_PREFIX + id;
  const existing = await env.SUBS.get(key, 'json');
  if (!existing) return json({ ok: true, deleted: false }, 200, cors);
  const tokenHash = await sha256Hex(String((body && body.subToken) || ''));
  if (existing.tokenHash !== tokenHash) {
    return json({ ok: false, code: 'TOKEN_MISMATCH', error: 'Not allowed' }, 403, cors);
  }
  await env.SUBS.delete(key);
  return json({ ok: true, deleted: true }, 200, cors);
}

async function handleSubscription(request, env, id) {
  if (!ID_RE.test(id)) return new Response('Subscription not found', { status: 404 });
  const sub = await env.SUBS.get(KEY_PREFIX + id, 'json');
  if (!sub) return new Response('Subscription not found', { status: 404 });

  const url = new URL(request.url);
  const queryTarget = (url.searchParams.get('target') || url.searchParams.get('format') || '').toLowerCase();
  const ua = (request.headers.get('User-Agent') || '').toLowerCase();

  let targetCore = (sub.options && sub.options.targetCore) || 'all';
  if (queryTarget.startsWith('singbox')) {
    targetCore = 'singbox';
  } else if (queryTarget.startsWith('xray')) {
    targetCore = 'xray';
  } else if (targetCore === 'all' && (ua.includes('sing-box') || ua.includes('sfi') || ua.includes('sfa'))) {
    targetCore = 'singbox';
  }

  const processed = processRawInput(sub.rawInput, { ...sub.options, targetCore });

  const headers = {
    'Profile-Title': `base64:${safeBase64Encode(sub.name || 'VPN Subscription')}`,
    'Profile-Update-Interval': '12',
    'Subscription-Userinfo': 'upload=0; download=0; total=10737418240000; expire=2145916800',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store',
  };

  if (queryTarget === 'singbox-json') {
    return new Response(processed.outputs.singBoxJson, {
      headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8' },
    });
  }
  if (queryTarget === 'xray-json') {
    return new Response(processed.outputs.xrayJson, {
      headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8' },
    });
  }
  if (queryTarget === 'raw') {
    return new Response(processed.outputs.rawUris, {
      headers: { ...headers, 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
  return new Response(processed.outputs.base64, {
    headers: { ...headers, 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request, env);
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    try {
      if (path === '/api/health' && request.method === 'GET') {
        return json({ ok: true, mode: 'worker' }, 200, cors);
      }
      if (path === '/api/parse' && request.method === 'POST') {
        return await handleParse(request, env, cors);
      }
      if (path === '/api/node/rebuild' && request.method === 'POST') {
        const { body, error, status } = await readJsonBody(request);
        if (error) return json({ ok: false, error }, status, cors);
        if (!body || !body.node) return json({ ok: false, error: 'Missing node object' }, 400, cors);
        return json({ ok: true, uri: toShareUri(body.node) }, 200, cors);
      }
      const subDelete = path.match(/^\/api\/sub\/([^/]+)$/);
      if (subDelete && request.method === 'DELETE') {
        return await handleDelete(request, env, cors, subDelete[1]);
      }
      const subGet = path.match(/^\/sub\/([^/]+)$/);
      if (subGet && request.method === 'GET') {
        return await handleSubscription(request, env, subGet[1]);
      }
      if (path === '/') {
        return new Response('URI Link Generator API is running', {
          headers: { 'Content-Type': 'text/plain; charset=utf-8', ...cors },
        });
      }
      return json({ ok: false, error: 'Not found' }, 404, cors);
    } catch (err) {
      return json({ ok: false, error: (err && err.message) || 'Internal error' }, 500, cors);
    }
  },
};
