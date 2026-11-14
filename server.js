const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const QRCode = require('qrcode');
const {
  safeBase64Encode,
  toShareUri,
  toSingBoxProfile,
  toXrayConfig,
  processRawInput,
} = require('./src/vpnCore');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const SUB_FILE = path.join(DATA_DIR, 'subscriptions.json');

app.use(express.json({ limit: '5mb' }));
app.use(express.text({ limit: '5mb', type: ['text/*'] }));
app.use(express.static(path.join(__dirname, 'public')));

function ensureDataStore() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(SUB_FILE)) {
    fs.writeFileSync(SUB_FILE, JSON.stringify({}, null, 2), 'utf8');
  }
}

function loadSubscriptions() {
  ensureDataStore();
  try {
    return JSON.parse(fs.readFileSync(SUB_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function saveSubscriptions(store) {
  ensureDataStore();
  fs.writeFileSync(SUB_FILE, JSON.stringify(store, null, 2), 'utf8');
}

// Health check for server mode detection
app.get('/api/health', (req, res) => {
  res.json({ ok: true });
});

// Parse & generate links/configs from raw input
app.post('/api/parse', async (req, res) => {
  try {
    const {
      rawInput = '',
      targetCore = 'all',
      deduplicate = false,
      remarkPrefix = '',
      renumberRemarks = false,
      subId = 'default',
      subName = 'My VPN Subscription',
      saveToSub = true,
    } = req.body || {};

    const result = processRawInput(rawInput, {
      targetCore,
      deduplicate,
      remarkPrefix,
      renumberRemarks,
    });

    // Save/update subscription so live URL is immediately updated
    const cleanId = (subId || 'default').replace(/[^a-zA-Z0-9_-]/g, '') || 'default';
    if (saveToSub && result.nodes.length > 0) {
      const store = loadSubscriptions();
      store[cleanId] = {
        id: cleanId,
        name: subName || 'My VPN Subscription',
        rawInput,
        options: { targetCore, deduplicate, remarkPrefix, renumberRemarks },
        updatedAt: new Date().toISOString(),
      };
      saveSubscriptions(store);
    }

    const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
    const host = req.headers['x-forwarded-host'] || req.get('host') || `localhost:${PORT}`;
    const baseUrl = `${protocol}://${host}`;

    const urls = {
      universalSub: `${baseUrl}/sub/${cleanId}`,
      singBoxSub: `${baseUrl}/sub/${cleanId}?target=singbox`,
      xraySub: `${baseUrl}/sub/${cleanId}?target=xray`,
      singBoxJsonUrl: `${baseUrl}/sub/${cleanId}?target=singbox-json`,
      xrayJsonUrl: `${baseUrl}/sub/${cleanId}?target=xray-json`,
      rawListUrl: `${baseUrl}/sub/${cleanId}?target=raw`,
      hiddifyDeepLink: `hiddify://import/${baseUrl}/sub/${cleanId}?target=singbox#${encodeURIComponent(
        subName || 'Hiddify-Sub'
      )}`,
      v2rayNgDeepLink: `v2rayng://install-config?url=${encodeURIComponent(
        `${baseUrl}/sub/${cleanId}?target=xray`
      )}`,
    };

    const qrSubSvg = await QRCode.toString(urls.universalSub, {
      type: 'svg',
      margin: 1,
      width: 220,
      color: { dark: '#0f172a', light: '#ffffff' },
    });

    res.json({
      ok: true,
      subId: cleanId,
      subName,
      urls,
      qrSubSvg,
      ...result,
    });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message || 'Failed to parse input' });
  }
});

// Generate QR code for any link or node URI
app.post('/api/qr', async (req, res) => {
  try {
    const { text = '' } = req.body || {};
    if (!text) return res.status(400).json({ ok: false, error: 'Missing text' });
    const svg = await QRCode.toString(text, {
      type: 'svg',
      margin: 1,
      width: 240,
      color: { dark: '#0f172a', light: '#ffffff' },
    });
    res.json({ ok: true, svg });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// Rebuild a single edited node URI
app.post('/api/node/rebuild', (req, res) => {
  try {
    const { node } = req.body || {};
    if (!node) return res.status(400).json({ ok: false, error: 'Missing node object' });
    const uri = toShareUri(node);
    res.json({ ok: true, uri });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// Live Subscription Endpoint for Hiddify, v2rayNG, Sing-box, Streisand, NekoBox
app.get('/sub/:id', (req, res) => {
  const store = loadSubscriptions();
  const id = req.params.id || 'default';
  const sub = store[id] || store.default;

  if (!sub) {
    return res.status(404).send('Subscription not found');
  }

  const queryTarget = (req.query.target || req.query.format || '').toLowerCase();
  const ua = (req.headers['user-agent'] || '').toLowerCase();

  // Determine effective core filter
  let targetCore = sub.options?.targetCore || 'all';
  if (queryTarget === 'singbox' || queryTarget === 'singbox-b64' || queryTarget === 'singbox-json') {
    targetCore = 'singbox';
  } else if (queryTarget === 'xray' || queryTarget === 'xray-b64' || queryTarget === 'xray-json') {
    targetCore = 'xray';
  } else if (targetCore === 'all') {
    // Auto-detect pure sing-box / Hiddify User-Agent if no explicit target set
    if (ua.includes('sing-box') || ua.includes('sfi') || ua.includes('sfa')) {
      targetCore = 'singbox';
    }
  }

  const processed = processRawInput(sub.rawInput, {
    ...sub.options,
    targetCore,
  });

  // Set Hiddify / V2Ray subscription metadata headers
  const titleBase64 = safeBase64Encode(sub.name || 'VPN Subscription');
  res.setHeader('Profile-Title', `base64:${titleBase64}`);
  res.setHeader('Profile-Update-Interval', '12');
  res.setHeader('Subscription-Userinfo', 'upload=0; download=0; total=10737418240000; expire=2145916800');
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (queryTarget === 'singbox-json') {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.send(processed.outputs.singBoxJson);
  }

  if (queryTarget === 'xray-json') {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.send(processed.outputs.xrayJson);
  }

  if (queryTarget === 'raw') {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.send(processed.outputs.rawUris);
  }

  // Default: Base64 encoded subscription payload (universal for Hiddify, v2rayNG, v2rayN, NekoBox, Streisand)
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  return res.send(processed.outputs.base64);
});

ensureDataStore();

if (require.main === module) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`VPN Link & Subscription Generator running at http://localhost:${PORT}`);
  });
}

module.exports = app;
