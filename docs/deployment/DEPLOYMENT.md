# Deployment (Docker + Synology HTTPS)

Production delivery is a **self-hosted Next.js container** behind **HTTPS** on your host. The phone loads the app once (Service Worker precaches it), then talks to the Panono **directly** over the camera WiFi — the server is not in the camera data path.

## What you need

| Item | Notes |
|------|--------|
| Docker host (e.g. Synology NAS) | DSM 7+ with Container Manager, or any Linux host |
| Public hostname | A DNS name you control, e.g. `app.example.com` |
| TLS certificate | Let's Encrypt via Synology reverse proxy, Caddy, Traefik, etc. |
| DNS | `A`/`AAAA` or CNAME pointing at your host (or Tailscale hostname) |

Replace `<your-hostname>` below with your chosen FQDN.

## Build and run (Docker Compose)

On the host or a build machine:

```bash
git clone <your-repo-url> panono-webapp
cd panono-webapp
docker compose build
docker compose up -d
```

The app listens on **port 3000** inside the container. Terminate TLS at the reverse proxy — do not expose plain HTTP to the internet.

The Dockerfile uses **`node:22-alpine`** (same as `reference/removedoubles`). Synology builds often need **`network: host`** during `docker compose build` so `npm ci` can reach the registry — see `docker-compose.yml` and `scripts/build.sh`.

If `npm ci` still fails with `Exit handler never called!`, retry with host networking explicitly:

```bash
docker build --network=host -t panono-webapp:latest .
```

Ensure the NAS has enough free RAM during the build (~2 GB+).

### Diagnose `npm ci` (verbose)

To see **which package npm was working on** when the build fails, rebuild with verbose logging:

```bash
NPM_CI_VERBOSE=1 npm run docker:build
```

Or in Container Manager / compose:

```bash
docker compose build --build-arg NPM_CI_LOGLEVEL=verbose --progress=plain --no-cache
```

The last lines before `Exit handler never called!` usually show the failing fetch or lifecycle script (often **`sharp`** postinstall or a registry timeout — not a specific app dependency bug). Save the full log from DSM **Container Manager → Image → Build log**.

### Verify locally

```bash
curl -sI http://127.0.0.1:3000/ | head
```

## Synology reverse proxy (HTTPS)

1. **Control Panel → Login Portal → Advanced → Reverse Proxy → Create**
2. **Source:** `https`, hostname `<your-hostname>`, port `443`
3. **Destination:** `http`, hostname `127.0.0.1` (or container host IP), port `3000`
4. Enable **HSTS** and **Let's Encrypt** for `<your-hostname>`
5. Save and test: `https://<your-hostname>`

### Firewall

- Allow **443** (HTTPS) from the internet if you want remote install/update of the PWA
- Port **3000** only needs to be reachable on localhost/LAN from the reverse proxy

## Service Worker / PWA

After HTTPS works:

1. Open `https://<your-hostname>` in Chrome or Safari on the phone
2. **Add to Home Screen**
3. DevTools → Application → Service Workers — confirm `sw.js` is active
4. Optional: enable airplane mode, reopen the home-screen icon — offline shell should load

See [mobile-workflow.md](./mobile-workflow.md) for field use on camera WiFi.

## Development tunnel (optional)

For HTTPS testing before production deploy, use a Cloudflare tunnel on a dev machine — see [CLOUDFLARED.md](../CLOUDFLARED.md).

Copy `.env.example` to `.env.local` and set `NEXT_DEV_TUNNEL_HOST` to the hostname in your tunnel config when using `npm run dev` through the tunnel.

## Environment variables

| Variable | Where | Purpose |
|----------|--------|---------|
| `NEXT_DEV_TUNNEL_HOST` | `.env.local` (dev only) | Comma-separated hostnames for Next.js `allowedDevOrigins` |
| `DISABLE_SW=1` | dev | Skip service worker generation |
| `NEXT_PUBLIC_APP_VERSION` | build (auto from `package.json`) | Shown in UI title bar |

Production Docker image bakes the app version at `npm run build` time.

## Server routes in production

| Route | Used by UI? | Purpose |
|-------|-------------|---------|
| `/api/upf?url=…` | Yes | Same-origin proxy when the page is HTTPS and the camera is `http://` on LAN |
| `/api/stitch/*` | No | Legacy server stitcher (kept for future use) |
| `/api/export/stitcher-zip` | No | Legacy server PTGui export |

The `/api/upf` proxy helps when the **browser and Next.js server share a network with the camera** (typical: dev laptop on camera WiFi). When the phone uses a remote-hosted app on camera WiFi, UPF fetch goes through the phone's path to the camera; the host server is unreachable anyway.

## Updating

```bash
cd panono-webapp
git pull
docker compose build
docker compose up -d
```

Users get the new version on the next online visit (Service Worker update). The version in the app header helps confirm which build is cached.

## Troubleshooting

| Symptom | Check |
|---------|--------|
| 502 on `/api/upf` | Server cannot reach camera IP (expected on remote host when phone is on camera AP) |
| SW not registering | Page must be HTTPS (or localhost) |
| `ws://` fails from HTTPS PWA | Grant **local network access** (Chromium); see mobile workflow doc |
| Container exits on start | `docker compose logs`; ensure `npm run build` succeeded in image |
