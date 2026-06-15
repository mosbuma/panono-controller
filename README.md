# Panono Control (web)

A [Next.js](https://nextjs.org/) PWA to control a [Panono](https://en.wikipedia.org/wiki/Panono) 360° camera over WiFi. The browser talks to the camera **directly** (WebSocket + HTTP). Downloads, PTGui export, flat previews, and the 360° viewer run **client-side**.

Protocol notes: [docs/PANONO-API.md](docs/PANONO-API.md). Sources: [docs/SOURCES.md](docs/SOURCES.md). License: [MIT](LICENSE).

## Features

- Connect & authenticate over **WebSocket JSON-RPC**
- Live status (battery, storage, capture-ready, `status_update` push)
- **Capture**, camera **options**, UPF **gallery**, **delete**
- **Download UPF** / **Download all UPFs** (sequential, browser downloads)
- **PTGui ZIP** export in the browser ([workflow](docs/reference/ptgui-export.md), [lens settings](docs/ptgui/PTGUI.md))
- **360° mesh viewer** (preview or full-res UPF)
- Optional **flat gallery previews** (client stitch + IndexedDB cache; off by default)
- **Service Worker** for offline shell — install via **Add to Home Screen**
- JSON-RPC debug log

Legacy **server stitch** routes (`/api/stitch`) remain in the repo but are not used by the UI.

## Architecture

| Layer | Role |
| ----- | ---- |
| **Browser** | WebSocket to camera; fetches UPFs; stitches thumbs; Three.js viewer |
| **Next.js server** | Serves the PWA; **`/api/upf`** proxies camera HTTP when page is HTTPS and server can reach LAN |

The NAS/host **does not** relay live camera control. In the field the phone joins camera WiFi and talks to the ball directly.

## Quick start (development)

```bash
npm install
npm run dev
```

Open `http://<host>:3000`, join camera WiFi, connect (default `ws://192.168.80.80:42345/` or `npm run discover`).

### HTTPS dev tunnel

```bash
npm run dev
npm run cloudflare:up   # see docs/CLOUDFLARED.md
```

Set `NEXT_DEV_TUNNEL_HOST` in `.env.local` to the hostname in your tunnel config (see [docs/CLOUDFLARED.md](docs/CLOUDFLARED.md)).

## Production (Docker + HTTPS)

```bash
docker compose build
docker compose up -d
```

Put **HTTPS** reverse proxy in front (Synology Let's Encrypt recommended). Full guide: [docs/deployment/DEPLOYMENT.md](docs/deployment/DEPLOYMENT.md).

**Mobile / field workflow:** [docs/deployment/mobile-workflow.md](docs/deployment/mobile-workflow.md)

## Important constraints

- **HTTPS + Service Worker** for reliable offline install; camera still uses **`ws://`** — grant **local network access** when Chromium asks.
- **WiFi only** for the camera link (not USB).
- On camera WiFi the phone usually **cannot reach your NAS**; capture and download work offline with the cached app.
- **`/api/upf`** only helps when the Next server shares a network with the camera (typical: dev laptop, not phone-on-NAS in field).

## Scripts

| Command | Purpose |
| ------- | ------- |
| `npm run dev` | Dev server (`0.0.0.0:3000`) |
| `npm run build` / `start` | Production |
| `npm run discover` | SSDP → WebSocket URL |
| `npm run cloudflare:up` / `down` | Dev HTTPS tunnel |

## Protocol (summary)

| Method | Purpose |
| ------ | ------- |
| `auth` | Authenticate |
| `get_status` | Battery, storage, firmware |
| `capture` | Take panorama |
| `get_option_list` / `get_options` / `set_option` | Camera settings |
| `get_upf_infos` | List panoramas |
| `delete_upf` | Delete panorama |

## UPF format

A `.upf` is a ZIP: `manifest.json`, 36 camera JPEGs, optional `vignetting_coeffs.txt`, IMU logs. See [docs/PANONO-API.md](docs/PANONO-API.md).

## Reference

- [docs/reference/CONVERTER.md](docs/reference/CONVERTER.md) — official UPF Converter colour pipeline (Bayer recombine, white balance, sRGB), reverse-engineered from the binary
- [docs/reference/ptgui-export.md](docs/reference/ptgui-export.md) — PTGui export workflow
- [docs/reference/](docs/reference/) — stitching notes, calibration paper index
- [docs/ptgui/PTGUI.md](docs/ptgui/PTGUI.md) — PTGui lens/sensor settings + bundled template
- [docs/CLOUDFLARED.md](docs/CLOUDFLARED.md) — Cloudflare tunnel for dev

## License

[MIT](LICENSE) — see also [docs/SOURCES.md](docs/SOURCES.md) for upstream attributions.
