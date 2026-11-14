# VPN Link & Subscription Generator

A single-deployment VPN link parser, normalizer, and live subscription generator for **Hiddify**, **Sing-box**, and **Xray-core (v2rayNG / v2rayN / Streisand / NekoBox)** — built for **Cloudflare Workers** with built-in **Telegram Bot & Telegram Short-Link Storage**.

## Features

- **Web UI (`/*`)**: Paste raw links (`vless://`, `ss://`, `vmess://`, `trojan://`, `hy2://`, `tuic://`), Base64 subscriptions, or JSON outbounds to generate live subscription URLs, QR codes, and one-click Hiddify / v2rayNG imports.
- **Telegram Bot (`/api/telegram/webhook`)**: Send or forward raw VPN links, Base64 text, or `.txt`/`.json` files directly to your Telegram bot — it replies with live subscription URLs + attached `clean-links.txt` and `sing-box-profile.json` files.
- **Short Links via Telegram Storage**: When `TG_BOT_TOKEN` and `TG_CHAT_ID` are set, the Worker stores snapshots as documents in your Telegram chat and serves short `/sub/<message_id>` URLs (e.g. `https://<worker>.workers.dev/sub/42?target=singbox`), with automatic fallback to stateless compressed URLs if Telegram isn't configured yet.

## Telegram Setup on Cloudflare (3 Steps)

1. **Create a Bot in Telegram:**
   - Message `@BotFather` → `/newbot` and copy your bot token (`TG_BOT_TOKEN`).
2. **Add Environment Variables in Cloudflare:**
   - Go to **Cloudflare Dashboard → Workers & Pages → your Worker → Settings → Variables and Secrets**.
   - Add `TG_BOT_TOKEN` = your bot token from `@BotFather`.
   - *(Optional at first)* Redeploy, then open `https://<your-worker>.workers.dev/api/telegram/setup` in your browser once to register the Telegram webhook.
3. **Get Your Storage Chat ID (`TG_CHAT_ID`):**
   - Open your bot in Telegram and send `/id` (or add the bot as an admin to a private storage channel/group and send `/id`).
   - The bot replies with your `Chat ID`.
   - Add `TG_CHAT_ID` = that Chat ID in your Cloudflare Worker Variables and Secrets.
   - *(Optional)* Set `TG_ALLOWED_USERS` to a comma-separated list of Telegram User IDs if you ever want to restrict who can message the bot.

## Local Development & Testing

```bash
npm install
npm test
npm start
```

## License

MIT
