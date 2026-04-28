# SUS · FluidShare

**Drop. Share. Done.** — Peer-to-peer encrypted file transfer, directly in your browser.

FluidShare lets you send files between two browsers with zero uploads, zero servers storing your data, and optional AES-256 encryption. Files travel directly from sender to receiver via WebRTC.

---

## Features

- **P2P Transfer** — Files go directly between browsers. No server ever stores your data.
- **AES-256-GCM Encryption** — Set a password and every chunk is encrypted with AES-256-GCM before transmission. Derived via PBKDF2 (310K iterations).
- **Chunked Streaming** — Large files are sliced into 64 KB chunks and streamed lazily. Only one chunk is in memory at a time.
- **ACK-Based Flow Control** — Each chunk is acknowledged before the next is sent, preventing buffer overflow.
- **Real-Time Progress** — Live progress bar, transfer speed (MB/s), and ETA on both sender and receiver sides.
- **QR Code Sharing** — After creating a room, a scannable QR code is generated for quick mobile access.
- **Share Link** — One-click copy of a direct receive link (`/receive.html?room=YOUR_CODE`).
- **No File Size Limit** — Transfer files of any size. The only limit is your connection.
- **Works Behind NATs** — Uses STUN/TURN servers (Google, Twilio, Metered relay) for NAT traversal.

## How It Works

1. **Sender** opens the Send page, picks a file, sets a share code and optional password, and clicks "Start Sharing".
2. **Sender** shares the code (or QR / link) with the receiver.
3. **Receiver** opens the Receive page, enters the share code and password, and clicks "Connect to Sender".
4. The file transfers directly between the two browsers. Done.

## Pages

| Page | Purpose |
|------|---------|
| `index.html` | Landing page with hero, how-it-works strip, and send/receive navigation |
| `send.html` | Sender interface — file picker, share code, password, QR, progress |
| `receive.html` | Receiver interface — share code input, password, progress, download |

## Tech Stack

- **WebRTC** via [PeerJS](https://peerjs.com/) for peer-to-peer data channels
- **Web Crypto API** for AES-256-GCM encryption and PBKDF2 key derivation
- **Vanilla HTML/CSS/JS** — no frameworks, no build step
- **QR Code** via [qrcode.js](https://github.com/davidshimjs/qrcodejs)
- **Fonts**: Syne, Inter, DM Mono (Google Fonts)

## Running Locally

Just open `index.html` in a browser. No server or build step required.

For local development with live reload, you can use any static server:

```bash
npx serve .
```

## Deployment

This is a static site. Deploy to any static host:
- GitHub Pages
- Vercel
- Netlify
- Cloudflare Pages

## Security Notes

- Encryption is **optional** — only active when sender sets a password.
- When enabled, AES-256-GCM with per-chunk random IVs is used.
- Keys are derived via PBKDF2 with 310,000 iterations (OWASP recommended).
- The password **never** leaves either browser. There is no server-side component.
- Without a password, data still travels over WebRTC's built-in DTLS encryption.

---

**crafted by Aditya Vikram** · Secure University Systems
