// Runs the Worker's fetch handler in Node with an in-memory KV mock.
import assert from 'node:assert';
import worker from './src/index.js';

class MemoryKV {
  constructor() {
    this.map = new Map();
  }
  async get(key, type) {
    const v = this.map.get(key);
    if (v === undefined) return null;
    return type === 'json' ? JSON.parse(v) : v;
  }
  async put(key, value) {
    this.map.set(key, value);
  }
  async delete(key) {
    this.map.delete(key);
  }
}

const env = { SUBS: new MemoryKV(), ALLOWED_ORIGINS: 'https://riology.github.io' };
const BASE = 'https://api.example.workers.dev';
const NODES = [
  'vless://11111111-2222-4333-8444-555555555555@203.0.113.10:443?security=reality&encryption=none&pbk=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA&fp=chrome&type=tcp&flow=xtls-rprx-vision&sni=example.com&sid=abcd1234#node-a',
  'vless://11111111-2222-4333-8444-666666666666@203.0.113.11:443?security=reality&encryption=none&pbk=BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB&fp=chrome&type=xhttp&path=/x&sni=example.org&sid=abcd5678#node-b',
].join('\n');

const call = (path, init = {}) =>
  worker.fetch(new Request(BASE + path, { headers: { Origin: 'https://riology.github.io' }, ...init }), env);

const post = (path, body) =>
  call(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://riology.github.io' },
    body: JSON.stringify(body),
  });

const health = await call('/api/health');
assert.strictEqual(health.status, 200);
assert.strictEqual(health.headers.get('Access-Control-Allow-Origin'), 'https://riology.github.io');

const subId = 'testSub12345';
const subToken = 'token-0123456789abcdef';
const parse = await post('/api/parse', { rawInput: NODES, subId, subToken, saveToSub: true, subName: 'Test' });
assert.strictEqual(parse.status, 200);
const parsed = await parse.json();
assert.strictEqual(parsed.saved, true);
assert.strictEqual(parsed.nodes.length, 2);
assert.strictEqual(parsed.urls.universalSub, `${BASE}/sub/${subId}`);

const hijack = await post('/api/parse', { rawInput: NODES, subId, subToken: 'other-token-000000000', saveToSub: true });
assert.strictEqual(hijack.status, 403);

const sb = await call(`/sub/${subId}?target=singbox`);
assert.strictEqual(sb.status, 200);
const sbLines = Buffer.from(await sb.text(), 'base64').toString('utf8').trim().split('\n');
assert.strictEqual(sbLines.length, 1, 'xhttp node should be filtered for sing-box');

const xray = await call(`/sub/${subId}?target=xray`);
const xrayLines = Buffer.from(await xray.text(), 'base64').toString('utf8').trim().split('\n');
assert.strictEqual(xrayLines.length, 2);

const sbJson = await (await call(`/sub/${subId}?target=singbox-json`)).json();
assert.strictEqual(sbJson.outbounds[0].type, 'selector');

const missing = await call('/sub/doesNotExist1');
assert.strictEqual(missing.status, 404);

const del = await call(`/api/sub/${subId}`, {
  method: 'DELETE',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ subToken }),
});
assert.strictEqual((await del.json()).deleted, true);
assert.strictEqual((await call(`/sub/${subId}`)).status, 404);

console.log('✅ Worker tests passed');
