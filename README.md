# VPN Link & Subscription Generator

A full-featured VPN link parser, normalizer, and subscription generator for **Hiddify**, **Sing-box**, and **Xray-core (v2rayNG / v2rayN / Streisand / NekoBox)**.

Works in two modes:
- **Static / GitHub Pages Mode**: 100% client-side in the browser—parse, fix, filter, inspect, edit, and export URIs, Base64 subscriptions, Sing-box JSON, Xray-core JSON, and QR codes with zero backend required.
- **Node.js Server Mode**: Includes an Express server providing live `/sub/:id` subscription endpoints and one-click deep-link imports (`hiddify://`, `v2rayng://`).

## Features

- **Multi-Format Input**: Accepts raw share URIs, Base64-encoded subscriptions (padded or unpadded), mixed raw + Base64 text, or Sing-box / Xray-core JSON configs.
- **Protocol Support**: `VLESS` (TCP, Reality, WS, gRPC, XHTTP), `VMess`, `Shadowsocks (ss://)`, `Trojan`, `Hysteria2 (hy2://)`, and `TUIC`.
- **Core Compatibility Filtering**:
  - **Sing-box / Hiddify**: Automatically filters out Xray-only transports (such as `xhttp`) when targeting Sing-box.
  - **Xray-core / v2rayNG**: Preserves all Xray-compatible nodes including `xhttp`, `grpc`, `tcp`, and `reality`.
- **Automatic Fixes & Cleanup**: Normalizes missing parameters, deduplicates identical nodes, adds remark prefixes, and supports sequential renumbering.
- **Interactive Node Inspector & Builder**: Search/filter parsed nodes, view compatibility badges, copy individual URIs, generate QR codes, or edit/build custom nodes in a modal editor.
- **CLI Tool**: Process node lists directly from the terminal.

## Project Structure

```text
link-generator/
├── .github/
│   └── workflows/
│       └── deploy.yml       # GitHub Actions workflow for GitHub Pages
├── data/
│   └── subscriptions.json   # Local subscription store (Node server mode)
├── public/                  # Static frontend (deployed to GitHub Pages)
│   ├── vendor/
│   │   └── vpnCore.js       # Browser-compatible copy of src/vpnCore.js
│   ├── app.js               # Frontend logic (auto-switches Server / Static mode)
│   ├── index.html           # Web UI
│   └── styles.css           # Stylesheet
├── src/
│   └── vpnCore.js           # Universal (Node + Browser) parser & config generator
├── cli.js                   # Command-line interface
├── server.js                # Express server & live /sub/:id endpoints
├── test.js                  # Automated test suite
├── .gitignore
├── package.json
└── README.md
```

## Quick Start

### 1. Run Locally (Node.js Server)

Requires **Node.js >= 18**.

```bash
npm install
npm start
```

Open `http://localhost:3000` in your browser.

### 2. Run Tests

```bash
npm test
```

### 3. CLI Usage

```bash
node cli.js nodes.txt --core singbox --format base64
node cli.js nodes.txt --core xray --format xray-json --dedup --prefix "Fast-"
```

### 4. Live Subscription Endpoints (Server Mode)

When running `npm start`, the server exposes live subscription URLs:

- `/sub/default` — Universal Base64 subscription (auto-detects `sing-box` User-Agent)
- `/sub/default?target=singbox` — Base64 subscription filtered for Sing-box / Hiddify
- `/sub/default?target=xray` — Base64 subscription for Xray-core / v2rayNG
- `/sub/default?target=singbox-json` — Full Sing-box JSON profile (`selector` + `urltest`)
- `/sub/default?target=xray-json` — Full Xray-core JSON config
- `/sub/default?target=raw` — Plain-text normalized share URIs

## Deploying to GitHub Pages

This repository includes `.github/workflows/deploy.yml` for automatic deployment:

1. Push the repository to GitHub on the `main` branch.
2. Go to **Settings → Pages** in your GitHub repository.
3. Under **Build and deployment**, set **Source** to **GitHub Actions**.
4. The workflow will automatically sync `src/vpnCore.js` to `public/vendor/vpnCore.js` and deploy `./public` to GitHub Pages.

## License

MIT

