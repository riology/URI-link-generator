# VPN Link & Subscription Generator

A single-deployment VPN link parser, normalizer, and live subscription generator for **Hiddify**, **Sing-box**, and **Xray-core (v2rayNG / v2rayN / Streisand / NekoBox)** — built to run directly on **Cloudflare Workers** with zero database or KV setup required.

## How It Works

1. Paste raw server text (`vless://`, `ss://`, `vmess://`, `trojan://`, `hy2://`, `tuic://`, Base64 subscription text, or JSON outbounds).
2. The Worker parses, normalizes, deduplicates, and compresses your node list directly into a live `/sub/<token>` URL (`?target=singbox`, `?target=xray`, `?target=singbox-json`).
3. Copy the generated subscription URL, scan the QR code, or click **Import to Hiddify** / **Import to v2rayNG**.

## Project Structure

```text
link-generator/
├── public/                  # Web UI assets (served by Cloudflare Workers Assets)
│   ├── vendor/
│   │   └── vpnCore.js       # Browser bundle of src/vpnCore.js
│   ├── app.js               # Frontend logic
│   ├── index.html           # Web UI
│   └── styles.css           # Stylesheet
├── src/
│   └── vpnCore.js           # Core parser & config generator
├── cli.js                   # Command-line interface
├── server.js                # Optional local Express server
├── test.js                  # Automated test suite
├── worker.js                # Cloudflare Worker entry point (UI + /api/parse + /sub/:token)
├── wrangler.toml            # Cloudflare Worker configuration
└── package.json
```

## Deploy to Cloudflare (Zero Setup)

### Option A: Connect GitHub in Cloudflare Dashboard (No CLI needed)

1. Go to the **Cloudflare Dashboard** → **Workers & Pages** → **Create**.
2. Choose **Import a repository** and select `riology/URI-link-generator`.
3. Leave the build command as `npm run build` (or empty) and deploy — Cloudflare automatically reads `wrangler.toml`, serves `./public`, and runs `worker.js`.

### Option B: Deploy from Terminal

```bash
npx wrangler login
npx wrangler deploy
```

## Local Development & Testing

```bash
npm install
npm test
npm start
```

## License

MIT
