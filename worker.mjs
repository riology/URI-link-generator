import crypto from 'node:crypto';
import zlib from 'node:zlib';
import vpnCore from './src/vpnCore.js';

const {
  safeBase64Encode,
  toShareUri,
  processRawInput,
} = vpnCore;

// In-memory caches within the active Worker isolate
const memoryStore = new Map();
const hashToTokenCache = new Map();

function sha256Short(text) {
  return crypto.createHash('sha256').update(String(text), 'utf8').digest('hex').slice(0, 12);
}

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
    // Not a compressed stateless token
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
    clashUrl: `${subUrl}?target=clash`,
    rawListUrl: `${subUrl}?target=raw`,
    hiddifyDeepLink: `hiddify://import/${subUrl}?target=singbox#${encodeURIComponent(
      subName || 'Hiddify-Sub'
    )}`,
    v2rayNgDeepLink: `v2rayng://install-config?url=${encodeURIComponent(
      `${subUrl}?target=xray`
    )}`,
    clashDeepLink: `clash://install-config?url=${encodeURIComponent(
      `${subUrl}?target=clash`
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

// --- Cloudflare Edge Cache Helpers ---

function edgeCacheRequest(origin, token) {
  return new Request(`${origin}/__sub_cache/${encodeURIComponent(token)}`, { method: 'GET' });
}

async function putEdgeCache(origin, token, subObj) {
  memoryStore.set(String(token), subObj);
  if (typeof caches === 'undefined' || !caches.default) return;
  try {
    const res = new Response(JSON.stringify(subObj), {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'public, max-age=2592000',
      },
    });
    await caches.default.put(edgeCacheRequest(origin, token), res);
  } catch {
    // Ignore edge cache errors in local/test environments
  }
}

async function getEdgeCache(origin, token) {
  const key = String(token);
  if (memoryStore.has(key)) return memoryStore.get(key);
  if (typeof caches === 'undefined' || !caches.default) return null;
  try {
    const match = await caches.default.match(edgeCacheRequest(origin, key));
    if (match) {
      const data = await match.json();
      if (data && typeof data.rawInput === 'string') {
        memoryStore.set(key, data);
        return data;
      }
    }
  } catch {
    // Ignore
  }
  return null;
}

// --- Telegram Bot & Storage Helpers ---

async function tgApi(botToken, method, body) {
  const res = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function tgSendDocument(botToken, chatId, filename, contentString, caption = '', parseMode = '') {
  const form = new FormData();
  form.append('chat_id', String(chatId));
  form.append('document', new Blob([contentString], { type: 'application/octet-stream' }), filename);
  if (caption) form.append('caption', caption);
  if (parseMode) form.append('parse_mode', parseMode);
  form.append('disable_notification', 'true');

  const res = await fetch(`https://api.telegram.org/bot${botToken}/sendDocument`, {
    method: 'POST',
    body: form,
  });
  return res.json();
}

async function tgDownloadFile(botToken, fileId) {
  const info = await tgApi(botToken, 'getFile', { file_id: fileId });
  if (!info || !info.ok || !info.result || !info.result.file_path) return null;
  const fileRes = await fetch(`https://api.telegram.org/file/bot${botToken}/${info.result.file_path}`);
  if (!fileRes.ok) return null;
  return fileRes.text();
}

/**
 * Save subscription payload to Telegram Storage Chat and return short message_id token.
 */
async function saveSubToTelegram(env, origin, rawUris, subName, fallbackChatId = null, ctx = null) {
  const botToken = (env && env.TG_BOT_TOKEN) ? String(env.TG_BOT_TOKEN).trim() : '';
  const storageChatId = (env && env.TG_CHAT_ID) ? String(env.TG_CHAT_ID).trim() : (fallbackChatId ? String(fallbackChatId) : '');
  if (!botToken || !storageChatId) return null;

  const contentHash = sha256Short(`${storageChatId}:${subName}:${rawUris}`);
  if (hashToTokenCache.has(contentHash)) {
    return hashToTokenCache.get(contentHash);
  }

  const subObj = {
    rawInput: rawUris,
    name: subName || 'VPN Subscription',
    options: { targetCore: 'all' },
  };
  const payloadJson = JSON.stringify({ u: rawUris, n: subObj.name });

  try {
    const sent = await tgSendDocument(
      botToken,
      storageChatId,
      `sub-${contentHash}.json`,
      payloadJson,
      `Subscription: ${subObj.name} (${rawUris.split('\n').filter(Boolean).length} nodes)`
    );
    if (sent && sent.ok && sent.result && sent.result.message_id) {
      const msgId = String(sent.result.message_id);
      const fileId = sent.result.document?.file_id || '';
      hashToTokenCache.set(contentHash, msgId);
      await putEdgeCache(origin, msgId, subObj);
      if (fileId) {
        await putEdgeCache(origin, fileId, subObj);
      }
      if (env && env.SUBS && typeof env.SUBS.put === 'function') {
        const kvTask = env.SUBS.put(`sub:${msgId}`, JSON.stringify(subObj));
        if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(kvTask);
        else await kvTask;
      }
      return msgId;
    }
  } catch {
    // Fallback to stateless token if Telegram API is unreachable
  }
  return null;
}

/**
 * Load subscription from cache, KV, or Telegram (by numeric message_id or file_id).
 */
async function loadSubByToken(env, origin, token, ctx = null) {
  const cached = await getEdgeCache(origin, token);
  if (cached) return cached;

  if (env && env.SUBS && typeof env.SUBS.get === 'function') {
    try {
      const kvSub = await env.SUBS.get(`sub:${token}`, 'json');
      if (kvSub && typeof kvSub.rawInput === 'string') {
        await putEdgeCache(origin, token, kvSub);
        return kvSub;
      }
    } catch {
      // Ignore KV errors
    }
  }

  const stateless = decodeSubToken(token);
  if (stateless) return stateless;

  const botToken = (env && env.TG_BOT_TOKEN) ? String(env.TG_BOT_TOKEN).trim() : '';
  const storageChatId = (env && env.TG_CHAT_ID) ? String(env.TG_CHAT_ID).trim() : '';
  if (!botToken) return null;

  let fileId = null;

  // Numeric token = message_id in TG_CHAT_ID
  if (/^\d+$/.test(token) && storageChatId) {
    try {
      const fwd = await tgApi(botToken, 'forwardMessage', {
        chat_id: storageChatId,
        from_chat_id: storageChatId,
        message_id: Number(token),
        disable_notification: true,
      });
      if (fwd && fwd.ok && fwd.result) {
        fileId = fwd.result.document?.file_id || null;
        const tempMsgId = fwd.result.message_id;
        if (tempMsgId) {
          const delPromise = tgApi(botToken, 'deleteMessage', {
            chat_id: storageChatId,
            message_id: tempMsgId,
          }).catch(() => {});
          if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(delPromise);
          else await delPromise;
        }
      }
    } catch {
      // Ignore
    }
  } else if (/^[A-Za-z0-9_-]{20,}$/.test(token)) {
    fileId = token;
  }

  if (!fileId) return null;

  try {
    const rawFile = await tgDownloadFile(botToken, fileId);
    if (!rawFile) return null;
    const parsed = JSON.parse(rawFile);
    if (parsed && typeof parsed.u === 'string') {
      const subObj = {
        rawInput: parsed.u,
        name: parsed.n || 'VPN Subscription',
        options: { targetCore: 'all' },
      };
      await putEdgeCache(origin, token, subObj);
      return subObj;
    }
  } catch {
    // Ignore
  }
  return null;
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

async function handleTelegramWebhook(request, env, origin, ctx) {
  const botToken = (env && env.TG_BOT_TOKEN) ? String(env.TG_BOT_TOKEN).trim() : '';
  if (!botToken) {
    return jsonResponse({ ok: false, error: 'TG_BOT_TOKEN not configured' }, 400);
  }

  const update = await request.json().catch(() => null);

  // Handle inline button clicks (3 client buttons -> send QR + link for selected client)
  if (update?.callback_query) {
    const cq = update.callback_query;
    const cbChatId = cq.message?.chat?.id;
    const data = String(cq.data || '');

    await tgApi(botToken, 'answerCallbackQuery', {
      callback_query_id: cq.id,
    }).catch(() => {});

    if (cbChatId && data.startsWith('c:')) {
      const parts = data.split(':');
      const clientCode = parts[1];
      const token = parts.slice(2).join(':');
      const urls = buildUrls(origin, token, 'VPN Subscription');

      const clientMap = {
        sb: { title: 'Hiddify / Sing-box Subscription', url: urls.singBoxSub },
        xr: { title: 'Xray-core / v2rayNG Subscription', url: urls.xraySub },
        sj: { title: 'Sing-box JSON Profile', url: urls.singBoxJsonUrl },
        cl: { title: 'Clash / Mihomo YAML Profile', url: urls.clashUrl },
      };
      const chosen = clientMap[clientCode];
      if (chosen) {
        const caption = `<b>${escapeHtml(chosen.title)}</b>\n\n<code>${escapeHtml(chosen.url)}</code>`;
        const qrPhotoUrl = `https://api.qrserver.com/v1/create-qr-code/?size=360x360&margin=12&data=${encodeURIComponent(chosen.url)}`;
        const photoRes = await tgApi(botToken, 'sendPhoto', {
          chat_id: cbChatId,
          photo: qrPhotoUrl,
          caption,
          parse_mode: 'HTML',
        }).catch(() => null);

        if (!photoRes || !photoRes.ok) {
          await tgApi(botToken, 'sendMessage', {
            chat_id: cbChatId,
            text: caption,
            parse_mode: 'HTML',
            disable_web_page_preview: true,
          });
        }
      }
    }
    return jsonResponse({ ok: true });
  }

  const msg = update?.message || update?.channel_post;
  if (!msg || !msg.chat) {
    return jsonResponse({ ok: true });
  }

  const chatId = msg.chat.id;
  const userId = msg.from?.id;
  const text = (msg.text || msg.caption || '').trim();

  // Check optional TG_ALLOWED_USERS whitelist
  const allowedRaw = (env && env.TG_ALLOWED_USERS) ? String(env.TG_ALLOWED_USERS).trim() : '';
  if (allowedRaw) {
    const allowedIds = allowedRaw.split(',').map((s) => s.trim()).filter(Boolean);
    if (allowedIds.length > 0 && !allowedIds.includes(String(userId)) && !allowedIds.includes(String(chatId))) {
      await tgApi(botToken, 'sendMessage', {
        chat_id: chatId,
        text: `Unauthorized. Your User ID is <code>${escapeHtml(userId)}</code> and Chat ID is <code>${escapeHtml(chatId)}</code>.`,
        parse_mode: 'HTML',
      });
      return jsonResponse({ ok: true });
    }
  }

  if (text.startsWith('/id')) {
    await tgApi(botToken, 'sendMessage', {
      chat_id: chatId,
      text: [
        `<b>Telegram IDs</b>`,
        `Chat ID: <code>${escapeHtml(chatId)}</code>`,
        `User ID: <code>${escapeHtml(userId || 'N/A')}</code>`,
        ``,
        `Set <code>TG_CHAT_ID</code> to <code>${escapeHtml(chatId)}</code> in your Cloudflare Worker variables to use this chat for short-link storage.`,
      ].join('\n'),
      parse_mode: 'HTML',
    });
    return jsonResponse({ ok: true });
  }

  if (text.startsWith('/start') || text.startsWith('/help')) {
    const storageReady = Boolean(env && env.TG_CHAT_ID);
    await tgApi(botToken, 'sendMessage', {
      chat_id: chatId,
      text: [
        `<b>VPN Link &amp; Subscription Generator</b>`,
        ``,
        `Send or forward any message containing:`,
        `• Raw links (<code>vless://</code>, <code>ss://</code>, <code>vmess://</code>, <code>trojan://</code>, <code>hy2://</code>, <code>tuic://</code>)`,
        `• Base64 subscription text`,
        `• A <code>.txt</code> or <code>.json</code> file`,
        ``,
        `I will parse, normalize, and reply with your live Hiddify / Sing-box &amp; Xray subscription URLs and config files.`,
        ``,
        `• Web UI: ${escapeHtml(origin)}`,
        `• Your Chat ID: <code>${escapeHtml(chatId)}</code> ${storageReady ? '(Storage configured)' : '(Set as TG_CHAT_ID in Cloudflare for short links)'}`,
      ].join('\n'),
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    });
    return jsonResponse({ ok: true });
  }

  // Extract input from message text or uploaded document
  let rawInput = text;
  if (msg.document && msg.document.file_id) {
    const downloaded = await tgDownloadFile(botToken, msg.document.file_id);
    if (downloaded) {
      rawInput = downloaded;
    }
  }

  const parsed = processRawInput(rawInput, {
    targetCore: 'all',
    deduplicate: true,
  });

  if (!parsed.nodes || parsed.nodes.length === 0) {
    await tgApi(botToken, 'sendMessage', {
      chat_id: chatId,
      text: `No valid VPN links or Base64 subscription nodes found. Send raw <code>vless://</code>, <code>ss://</code>, <code>vmess://</code> links or Base64 text.`,
      parse_mode: 'HTML',
    });
    return jsonResponse({ ok: true });
  }

  const subName = msg.from?.first_name ? `${msg.from.first_name} VPN` : 'Telegram VPN';
  let shortToken = await saveSubToTelegram(env, origin, parsed.outputs.rawUris, subName, chatId, ctx);
  if (!shortToken) {
    shortToken = sha256Short(parsed.outputs.rawUris);
    await putEdgeCache(origin, shortToken, {
      rawInput: parsed.outputs.rawUris,
      name: subName,
      options: { targetCore: 'all' },
    });
  }

  const replyLines = [
    `<b>Summary</b>`,
    `• Active nodes: <b>${parsed.stats.activeCount}</b>`,
    `• Sing-box / Hiddify ready: <b>${parsed.stats.singBoxCompatibleCount}</b>`,
    `• Xray-only (xhttp): <b>${parsed.stats.xrayOnlyCount}</b>`,
    `• Auto-fixes applied: <b>${parsed.stats.fixesAppliedCount}</b>`,
    ``,
    `Select your client below to get the QR code and subscription link:`,
  ];

  await tgApi(botToken, 'sendMessage', {
    chat_id: chatId,
    text: replyLines.join('\n'),
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    reply_markup: {
      inline_keyboard: [
        [{ text: 'Hiddify / Sing-box', callback_data: `c:sb:${shortToken}` }],
        [{ text: 'Xray-core / v2rayNG', callback_data: `c:xr:${shortToken}` }],
        [{ text: 'Sing-box JSON Profile', callback_data: `c:sj:${shortToken}` }],
        [{ text: 'Clash / Mihomo', callback_data: `c:cl:${shortToken}` }],
      ],
    },
  });

  return jsonResponse({ ok: true });
}

export default {
  async fetch(request, env, ctx) {
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
      return jsonResponse({
        ok: true,
        telegramConfigured: Boolean(env && env.TG_BOT_TOKEN && env.TG_CHAT_ID),
      });
    }

    // One-click Telegram Webhook setup
    if (pathname === '/api/telegram/setup' && request.method === 'GET') {
      const botToken = (env && env.TG_BOT_TOKEN) ? String(env.TG_BOT_TOKEN).trim() : '';
      if (!botToken) {
        return jsonResponse(
          { ok: false, error: 'Set TG_BOT_TOKEN in your Cloudflare Worker environment variables first' },
          400
        );
      }
      const webhookUrl = `${url.origin}/api/telegram/webhook`;
      const hookRes = await tgApi(botToken, 'setWebhook', {
        url: webhookUrl,
        allowed_updates: ['message', 'channel_post', 'callback_query'],
      });
      await tgApi(botToken, 'setMyCommands', {
        commands: [
          { command: 'start', description: 'How to generate VPN subscription links' },
          { command: 'id', description: 'Show your Chat ID and User ID' },
        ],
      });
      return jsonResponse({
        ok: Boolean(hookRes && hookRes.ok),
        webhookUrl,
        telegramResponse: hookRes,
      });
    }

    if (pathname === '/api/telegram/webhook' && request.method === 'POST') {
      return handleTelegramWebhook(request, env, url.origin, ctx);
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
          saveShortLink = true,
        } = body || {};

        const result = processRawInput(rawInput, {
          targetCore,
          deduplicate,
          remarkPrefix,
          renumberRemarks,
        });

        const normalizedAll = processRawInput(rawInput, {
          targetCore: 'all',
          deduplicate,
          remarkPrefix,
          renumberRemarks,
        });

        let urls = {};
        if (normalizedAll.nodes.length > 0) {
          let token = null;
          if (saveShortLink) {
            token = await saveSubToTelegram(env, url.origin, normalizedAll.outputs.rawUris, subName, null, ctx);
          }
          if (!token) {
            token = sha256Short(normalizedAll.outputs.rawUris);
            await putEdgeCache(url.origin, token, {
              rawInput: normalizedAll.outputs.rawUris,
              name: subName,
              options: { targetCore: 'all' },
            });
          }
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
      const sub = (await loadSubByToken(env, url.origin, token, ctx)) || memoryStore.get('default');
      if (!sub) {
        return new Response('Subscription not found', { status: 404 });
      }

      const queryTarget = (url.searchParams.get('target') || url.searchParams.get('format') || '').toLowerCase();
      const ua = (request.headers.get('user-agent') || '').toLowerCase();

      let targetCore = sub.options?.targetCore || 'all';
      if (queryTarget === 'singbox' || queryTarget === 'singbox-b64' || queryTarget === 'singbox-json' || queryTarget === 'clash') {
        targetCore = 'singbox';
      } else if (queryTarget === 'xray' || queryTarget === 'xray-b64' || queryTarget === 'xray-json') {
        targetCore = 'xray';
      } else if (targetCore === 'all' && (ua.includes('sing-box') || ua.includes('sfi') || ua.includes('sfa') || ua.includes('clash') || ua.includes('mihomo'))) {
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

      if (queryTarget === 'clash') {
        return new Response(processed.outputs.clashYaml, {
          headers: { ...headers, 'Content-Type': 'text/yaml; charset=utf-8' },
        });
      }
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
