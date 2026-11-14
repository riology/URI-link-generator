const assert = require('assert');
const http = require('http');
const app = require('./server');
const { processRawInput, safeBase64Encode, safeBase64Decode } = require('./src/vpnCore');

const USER_RAW_SAMPLE = `vless://d9274255-edf4-4944-bc62-6ef35cd2de40@194.87.109.106:443?security=tls&alpn=h2,http/1.1&encryption=none&insecure=0&headerType=none&fp=chrome&type=tcp&allowInsecure=0&sni=currant.asynchronous.site#mlmvpn2406
vless://7b03cd1c-8734-4051-8de6-de6335182f56@162.55.242.208:2096?encryption=none&fp=chrome&pbk=4-STTPXh4hoyInAny-P08XYPyQDEh-GYHQ1LMbjL7yA&security=reality&sid=f362c741c17f477e&sni=www.cloudflare.com&type=tcp#mlmvpn3447
vless://e50e6851-a29a-45a1-811d-1e9230c1512a@fi1.slowframe.org:8443?flow=xtls-rprx-vision&encryption=none&security=reality&sni=fi1.slowframe.org&fp=chrome&pbk=lQn0k9GCrG7Hh34b8ezAyVjc9KBCxQm3oP0xdxKGy0U&sid=35cb85e41b041622&type=tcp&headerType=none#mlmvpn1106
vless://549766c3-fa5f-471e-8031-ffc1f8d5064f@95.85.232.83:2087?fp=edge&sid=3258252d44113e23&encryption=none&type=xhttp&sni=trips.blog-forme.ru&path=%2Fv2%2Fsync%2F6e9367&pbk=mbi4BZAuiq_L6pfhG2xxWmtosq0Z1Pzf18fvNSWKMxY&security=reality&host=trips.blog-forme.ru#mlmvpn602
vless://a6f77c9a-6e0e-4a8f-8f12-3462b49bc222@212.69.135.226:8443?encryption=none&flow=xtls-rprx-vision&fp=chrome&pbk=FdZlh9FC4ay9OGnKG6K_iNqhz1I3tWDfNZhxrDYuQl8&security=reality&sid=7da3ba09a037e956&sni=uk-room05.filesnap.tech&type=tcp#mlmvpn8115
vless://ccb8ff48-3934-4250-b4ec-bb76b95d154f@pl3.fox-lisa.ru:443?security=reality&encryption=none&pbk=NaCZ-sS4poEbFwKmD7ePAVyc5OhHxsD9nkAStjXkoWs&headerType=&fp=firefox&type=tcp&flow=xtls-rprx-vision&sni=pl3.fox-lisa.ru&sid=027af64166562b09#mlmvpn4663
vless://976f82d9-0e6b-40ed-9c09-cafd06c4bc98@187.7.206.49:443?flow=xtls-rprx-vision&security=reality&sni=de166.mech-pro.online&fp=chrome&pbk=jbiddtGRgeBvlkjbuA3aU-WPjKgEX87tOVh1mFfvOUI&sid=16e0f049#mlmvpn3789
vless://11512726-b692-406f-ab49-7b28f44a8294@80.96.108.29:443?path=/ae1b809ceb77&security=reality&encryption=none&pbk=_LNT4Kf7pPmeEBAnmJ7xsBu3y6Kih0Ew9AFVoDa3QSg&fp=chrome&type=xhttp&sni=md.gorobsub.com&sid=3242cfd7#mlmvpn8398
vless://11512726-b692-406f-ab49-7b28f44a8294@80.96.108.29:8443?mode=auto&path=/ae1b809ceb77&security=reality&encryption=none&pbk=_LNT4Kf7pPmeEBAnmJ7xsBu3y6Kih0Ew9AFVoDa3QSg&fp=chrome&type=xhttp&sni=md.gorobsub.com#mlmvpn9730
vless://976f82d9-0e6b-40ed-9c09-cafd06c4bc98@de166.mech-pro.online:443?security=reality&encryption=none&pbk=jbiddtGRgeBvlkjbuA3aU-WPjKgEX87tOVh1mFfvOUI&headerType=none&fp=chrome&type=tcp&flow=xtls-rprx-vision&sni=de166.mech-pro.online&sid=16e0f049#mlmvpn2899
ss://YWVzLTI1Ni1nY206WlJwZ2FCZUd4dEVOSVhndmhwa1pCS3o5R25XUlMyZFljeDlPK2EyaXdOND0@202.50.253.90:19999#mlmvpn7281
vless://f8cb3c89-32af-4255-bebc-d90aad175069@185.117.89.74:443?security=reality&encryption=none&pbk=pR39Vv5qhk8r6akOicoy6mMs4-ppSWUez8MyAXG7wwQ&fp=chrome&type=grpc&serviceName=neurex&sni=seb.kosmosapp.net&sid=27350908de933e09#mlmvpn7844
vless://664f65f4-33b3-43a3-b9e5-68192d1d428e@201.4.73.21:443?security=reality&encryption=none&pbk=ql7l6Vw5DFt5ZJeGE6ZxsM1kcIvZabxQVr8zkoPJoUE&headerType=none&fp=firefox&type=tcp&flow=xtls-rprx-vision&sni=granite-orchard.cdn.cachefleet.com&sid=8691df964f0bebcb#mlmvpn7052
ss://YWVzLTI1Ni1nY206WlJwZ2FCZUd4dEVOSVhndmhwa1pCS3o5R25XUlMyZFljeDlPK2EyaXdOND0@202.50.253.18:19999#mlmvpn3117
vless://e83bc3fd-5732-4b64-8f91-19fc7aa0edb0@144.31.225.114:443?security=reality&encryption=none&pbk=ua6CK4GeIj_7Ae90bUHORFUFH2RRt9BksP9CmN-2VlU&fp=chrome&type=xhttp&sni=static-nl.song69.fun&path=/static/v2/media&mode=auto#mlmvpn1420
ss://YWVzLTI1Ni1nY206WlJwZ2FCZUd4dEVOSVhndmhwa1pCS3o5R25XUlMyZFljeDlPK2EyaXdOND0@202.50.253.45:19999#mlmvpn2662
vless://fa937345-6d3e-4ff4-8127-1a836987a0db@195.63.128.21:2443?type=tcp&security=reality&flow=xtls-rprx-vision&fp=chrome&pbk=q_MJ5Zo2vcnePWq3KY653QUPX8mNSvapLpqXU4NuPho&sid=464db718e17e4107&sni=germany.cloudhouse1.ru#mlmvpn1554`;

async function runTests() {
  console.log('1. Testing raw URI parsing of all 17 sample nodes...');
  const resAll = processRawInput(USER_RAW_SAMPLE, { targetCore: 'all' });
  assert.strictEqual(resAll.stats.inputType, 'raw');
  assert.strictEqual(resAll.stats.totalExtracted, 17);
  assert.strictEqual(resAll.stats.singBoxCompatibleCount, 13);
  assert.strictEqual(resAll.stats.xrayOnlyCount, 4);
  assert(resAll.stats.fixesAppliedCount > 0, 'Expected automatic fixes to be recorded');

  // Verify Shadowsocks node decoded properly
  const ssNode = resAll.nodes.find((n) => n.protocol === 'ss');
  assert(ssNode, 'Expected Shadowsocks node');
  assert.strictEqual(ssNode.method, 'aes-256-gcm');
  assert.strictEqual(ssNode.password, 'ZRpgaBeGxtENIXgvhpkZBKz9GnWRS2dYcx9O+a2iwN4=');

  // Verify gRPC node
  const grpcNode = resAll.nodes.find((n) => n.transport === 'grpc');
  assert(grpcNode, 'Expected gRPC node');
  assert.strictEqual(grpcNode.serviceName, 'neurex');

  console.log('2. Testing Base64 subscription input...');
  const b64Input = safeBase64Encode(USER_RAW_SAMPLE);
  // Also test unpadded base64 input
  const unpaddedB64 = b64Input.replace(/=+$/, '');
  const resB64 = processRawInput(unpaddedB64, { targetCore: 'singbox' });
  assert.strictEqual(resB64.stats.inputType, 'base64');
  assert.strictEqual(resB64.nodes.length, 13, 'Sing-box filter should return 13 compatible nodes');

  console.log('3. Testing Sing-box & Xray JSON config generation...');
  const sbJson = JSON.parse(resB64.outputs.singBoxJson);
  assert(Array.isArray(sbJson.outbounds));
  // 13 nodes + selector + urltest + direct + block = 17 outbounds
  assert.strictEqual(sbJson.outbounds.length, 17);

  const xrayJson = JSON.parse(resAll.outputs.xrayJson);
  // 17 nodes + direct + block = 19 outbounds
  assert.strictEqual(xrayJson.outbounds.length, 19);

  console.log('4. Testing HTTP Server & Subscription endpoints...');
  const server = app.listen(0);
  const port = server.address().port;

  try {
    const parseRes = await fetch(`http://127.0.0.1:${port}/api/parse`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rawInput: USER_RAW_SAMPLE,
        targetCore: 'all',
        subId: 'default',
        subName: 'Test Subscription',
        saveToSub: true,
      }),
    });
    assert.strictEqual(parseRes.status, 200);

    const subRes = await fetch(`http://127.0.0.1:${port}/sub/default?target=singbox`);
    assert.strictEqual(subRes.status, 200);
    const subText = await subRes.text();
    const decodedSub = safeBase64Decode(subText);
    const lines = decodedSub.trim().split('\n');
    assert.strictEqual(lines.length, 13);

    const sbProfileRes = await fetch(`http://127.0.0.1:${port}/sub/default?target=singbox-json`);
    assert.strictEqual(sbProfileRes.status, 200);
    const sbProfile = await sbProfileRes.json();
    assert.strictEqual(sbProfile.outbounds[0].type, 'selector');
  } finally {
    server.close();
  }

  console.log('5. Testing Cloudflare Worker stateless subscription link...');
  const { default: worker } = await import('./worker.mjs');
  const workerParseRes = await worker.fetch(
    new Request('https://vpn.example.workers.dev/api/parse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rawInput: USER_RAW_SAMPLE,
        targetCore: 'all',
        subName: 'Cloudflare Sub',
      }),
    }),
    {}
  );
  assert.strictEqual(workerParseRes.status, 200);
  const workerParsed = await workerParseRes.json();
  assert(workerParsed.urls && workerParsed.urls.singBoxSub, 'Expected generated stateless singBoxSub URL');

  const workerSubRes = await worker.fetch(new Request(workerParsed.urls.singBoxSub), {});
  assert.strictEqual(workerSubRes.status, 200);
  const workerSubLines = safeBase64Decode(await workerSubRes.text()).trim().split('\n');
  assert.strictEqual(workerSubLines.length, 13);

  console.log('6. Testing Telegram Bot webhook & Telegram short-link storage...');
  const origFetch = globalThis.fetch;
  const tgCalls = [];
  globalThis.fetch = async (input, init) => {
    const urlStr = typeof input === 'string' ? input : input.url;
    if (urlStr.startsWith('https://api.telegram.org/botTEST_TOKEN/')) {
      const method = urlStr.split('/').pop();
      tgCalls.push({ method, init });
      if (method === 'sendDocument') {
        return new Response(
          JSON.stringify({
            ok: true,
            result: { message_id: 77, document: { file_id: 'DOC_FILE_ID_77777777777777777777' } },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response(JSON.stringify({ ok: true, result: {} }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return origFetch(input, init);
  };

  try {
    const tgEnv = { TG_BOT_TOKEN: 'TEST_TOKEN', TG_CHAT_ID: '-100123456789' };
    const shortParseRes = await worker.fetch(
      new Request('https://vpn.example.workers.dev/api/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rawInput: USER_RAW_SAMPLE,
          targetCore: 'all',
          subName: 'TG Short Sub',
          saveShortLink: true,
        }),
      }),
      tgEnv
    );
    const shortParsed = await shortParseRes.json();
    assert.strictEqual(shortParsed.urls.singBoxSub, 'https://vpn.example.workers.dev/sub/77?target=singbox');

    const shortSubGet = await worker.fetch(new Request(shortParsed.urls.singBoxSub), tgEnv);
    assert.strictEqual(shortSubGet.status, 200);
    assert.strictEqual(safeBase64Decode(await shortSubGet.text()).trim().split('\n').length, 13);

    // Test Telegram Bot webhook receiving raw links
    const webhookRes = await worker.fetch(
      new Request('https://vpn.example.workers.dev/api/telegram/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: {
            message_id: 1,
            chat: { id: 999888 },
            from: { id: 999888, first_name: 'TestUser' },
            text: USER_RAW_SAMPLE,
          },
        }),
      }),
      tgEnv
    );
    assert.strictEqual(webhookRes.status, 200);
    assert(tgCalls.some((c) => c.method === 'sendMessage'), 'Expected bot to reply with summary & 3 buttons');

    // Test clicking one of the 3 client buttons (callback_query)
    const cbRes = await worker.fetch(
      new Request('https://vpn.example.workers.dev/api/telegram/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          callback_query: {
            id: 'cb1',
            message: { chat: { id: 999888 } },
            data: 'c:sb:77',
          },
        }),
      }),
      tgEnv
    );
    assert.strictEqual(cbRes.status, 200);
    assert(tgCalls.some((c) => c.method === 'sendPhoto'), 'Expected bot to send QR photo + link on button click');
  } finally {
    globalThis.fetch = origFetch;
  }

  console.log('✅ All tests passed!');
}

runTests().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
