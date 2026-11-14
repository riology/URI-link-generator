const zlib = require('zlib');
const {
  safeBase64Encode,
  toShareUri,
  processRawInput,
} = require('./src/vpnCore');

// In-memory store for /sub/default or short IDs within the active isolate
const memoryStore = new Map();

function encodeSubToken(rawUris, name = 'VPN Subscription') {
  const payload = JSON.stringify({ u: rawUris, n: name });
  return zlib.deflateRawSync(Buffer.from(payload, 'utf8'), { level: 9 }).toString('base64url');
}

function decodeSubToken(token) {
  try {
    const json = zlib.inflateRawSync(Buffer.from(token, 'base64url')).toString('utf8');
    const parsed = JSON.parse(json);
    if (parsed && typeof parsed.u === 'string') {
      return { rawInput: parsed.u, name: parsed.n || 'VPN Subscription', options: { targetCore: 'all' } };
    }
  } catch {
    // Not a compressed token
  }
  return null;
}

function buildUrls(baseUrl, token, subName) {
  const subUrl = `${baseUrl}/sub/${token}`;
  return {
    universalSub: subUrl,
    singBoxSub: `${subUrl}?target=singbox`,
    xraySub: `${subUrl}?target=xray`,
    singBoxJsonUrl: `${subUrl}?target=singbox-json`,
    xrayJsonUrl: `${subUrl}?target=xray-json`,
    rawListUrl: `${subUrl}?target=raw`,
    hiddifyDeepLink: `hiddify://import/${subUrl}?target=singbox#${encodeURIComponent(
      subName || 'Hiddify-Sub'
    )}`,
    v2rayNgDeepLink: `v2rayng://install-config?url=${encodeURIComponent(
      `${subUrl}?target=xray`
    )}`,
  };
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

module.exports = {
  async fetch(request, env) {
    const url = new URL(request.url);
    const pathname = url.pathname.replace(/\/+$/, '') || '/';

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      });
    }

    if (pathname === '/api/health' && request.method === 'GET') {
      return jsonResponse({ ok: true });
    }

    if (pathname === '/api/parse' && request.method === 'POST') {
      try {
        const body = await request.json().catch(() => ({}));
        const {
          rawInput = '',
          targetCore = 'all',
          deduplicate = false,
          remarkPrefix = '',
          renumberRemarks = false,
          subName = 'My VPN Profile',
        } = body || {};

        const result = processRawInput(rawInput, {
          targetCore,
          deduplicate,
          remarkPrefix,
          renumberRemarks,
        });

        // Normalize all nodes (with dedup/prefix/renumber applied) so the stateless token
        // works for both ?target=singbox and ?target=xray on /sub/:token
        const normalizedAll = processRawInput(rawInput, {
          targetCore: 'all',
          deduplicate,
          remarkPrefix,
          renumberRemarks,
        });

        let urls = {};
        if (normalizedAll.nodes.length > 0) {
          const token = encodeSubToken(normalizedAll.outputs.rawUris, subName);
          memoryStore.set('default', {
            rawInput: normalizedAll.outputs.rawUris,
            name: subName,
            options: { targetCore: 'all' },
          });
          urls = buildUrls(url.origin, token, subName);
        }

        return jsonResponse({
          ok: true,
          subName,
          urls,
          ...result,
        });
      } catch (err) {
        return jsonResponse({ ok: false, error: err.message || 'Failed to parse input' }, 400);
      }
    }

    if (pathname === '/api/node/rebuild' && request.method === 'POST') {
      try {
        const body = await request.json().catch(() => ({}));
        if (!body || !body.node) {
          return jsonResponse({ ok: false, error: 'Missing node object' }, 400);
        }
        return jsonResponse({ ok: true, uri: toShareUri(body.node) });
      } catch (err) {
        return jsonResponse({ ok: false, error: err.message }, 400);
      }
    }

    const subMatch = pathname.match(/^\/sub\/([^/]+)$/);
    if (subMatch && request.method === 'GET') {
      const token = decodeURIComponent(subMatch[1]);
      const sub = decodeSubToken(token) || memoryStore.get(token) || memoryStore.get('default');
      if (!sub) {
        return new Response('Subscription not found', { status: 404 });
      }

      const queryTarget = (url.searchParams.get('target') || url.searchParams.get('format') || '').toLowerCase();
      const ua = (request.headers.get('user-agent') || '').toLowerCase();

      let targetCore = sub.options?.targetCore || 'all';
      if (queryTarget === 'singbox' || queryTarget === 'singbox-b64' || queryTarget === 'singbox-json') {
        targetCore = 'singbox';
      } else if (queryTarget === 'xray' || queryTarget === 'xray-b64' || queryTarget === 'xray-json') {
        targetCore = 'xray';
      } else if (targetCore === 'all' && (ua.includes('sing-box') || ua.includes('sfi') || ua.includes('sfa'))) {
        targetCore = 'singbox';
      }

      const processed = processRawInput(sub.rawInput, {
        ...sub.options,
        targetCore,
      });

      const titleBase64 = safeBase64Encode(sub.name || 'VPN Subscription');
      const headers = {
        'Profile-Title': `base64:${titleBase64}`,
        'Profile-Update-Interval': '12',
        'Subscription-Userinfo': 'upload=0; download=0; total=10737418240000; expire=2145916800',
        'Access-Control-Allow-Origin': '*',
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

    if (env && env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response('Not found', { status: 404 });
  },
};
