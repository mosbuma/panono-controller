# Cloudflare tunnel — HTTPS dev testing

Use a [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) to expose your local Next.js dev server over **HTTPS**. That lets you test **Service Worker** offline caching and **Local Network Access** (`ws://` to the camera) on a phone or another machine before production deployment.

**Typical layout:** `https://dev.example.com` → `http://127.0.0.1:3000` on your dev machine.

| Setting | You choose |
|---------|------------|
| **Cloudflare zone** | A domain you control (e.g. `example.com`) |
| **Public hostname** | e.g. `dev.example.com` (any hostname in your Cloudflare zone) |
| **Tunnel name** | e.g. `panono-webapp-dev-tunnel` (must match `tunnel:` in config) |
| **Config file** | e.g. `~/.cloudflared/config-panono-webapp.yaml` |
| **Local Next.js** | `http://127.0.0.1:3000` (`npm run dev`) |

Install docs: [Cloudflare — Install cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation/).

---

## Intentions

This setup exists so you can develop and test the Panono webapp under **real HTTPS** on a laptop, without deploying to a NAS or production domain first. A Cloudflare Tunnel publishes your local `npm run dev` server at a hostname you control (e.g. `https://dev.example.com`). That secure origin is required for **Service Worker** registration and offline precaching. The same HTTPS page can still talk to the camera over **`ws://`** on the local network when the browser grants **Local Network Access** (test on your target phone/browser). The tunnel does **not** proxy camera traffic; it only exposes the Next.js app. Day to day: run the dev server, start the tunnel with `npm run cloudflare:up`, open your tunnel URL, verify the SW installs, then test offline mode and camera control. Stop the tunnel with `npm run cloudflare:down` when finished.

---

## One-time setup

1. **Cloudflare:** Your zone is **Active**. **SSL/TLS** → **Overview** → **Full** (not *Flexible*).

2. **Install `cloudflared`** (Ubuntu example):

   ```bash
   wget https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
   sudo dpkg -i cloudflared-linux-amd64.deb
   ```

3. **Login and create a tunnel** (pick a name — example uses `panono-webapp-dev-tunnel`):

   ```bash
   cloudflared tunnel login
   cloudflared tunnel create panono-webapp-dev-tunnel
   ```

   Note the credentials path, e.g. `~/.cloudflared/<UUID>.json`.

4. **Config file:** copy the template from this repo and edit it:

   ```bash
   cp cloudflare/config.yaml.example ~/.cloudflared/config-panono-webapp.yaml
   ```

   Set **`credentials-file:`** to your tunnel JSON, **`tunnel:`** to your tunnel name, and **`hostname:`** to your public dev hostname. Keep **`service: http://127.0.0.1:3000`** (not `https://`).

5. **DNS** — create a proxied CNAME for your hostname:

   ```bash
   cloudflared tunnel list
   # Find your tunnel → note its UUID (see “Multiple tunnels” below if this looks wrong)
   cloudflared tunnel route dns <UUID> dev.example.com
   ```

   If the record already exists:

   ```bash
   cloudflared tunnel route dns --overwrite-dns <UUID> dev.example.com
   ```

   **Dashboard fallback:** DNS → your zone → hostname → Target = `<UUID>.cfargotunnel.com`, **Proxy** on.

6. **Next.js dev origin** — if you use Next.js 15+ with `next dev` over the tunnel, add your hostname to `.env.local`:

   ```bash
   NEXT_DEV_TUNNEL_HOST=dev.example.com
   ```

   `next.config.ts` reads this for `allowedDevOrigins`. Restart `npm run dev` after changing it.

---

## Multiple tunnels on one machine

If you run several projects with Cloudflare, give **each project its own config file** (e.g. `config-panono-webapp.yaml`, `config-other-app.yaml`). Do not reuse another project’s `~/.cloudflared/config.yml` unless that file is meant for this app.

Many `cloudflared` subcommands read **`~/.cloudflared/config.yml` by default** when you omit `--config`. That can make `tunnel info <name>` report the **wrong UUID** even when the name is correct.

Always pass **`--config`** (or use the npm scripts, which do this for you):

```bash
# List all tunnels in your account (safe — no default config)
cloudflared tunnel list

# Project-specific commands — always use your config file
cloudflared tunnel --config ~/.cloudflared/config-panono-webapp.yaml info panono-webapp-dev-tunnel
cloudflared tunnel --config ~/.cloudflared/config-panono-webapp.yaml run panono-webapp-dev-tunnel

# Or use the UUID from `tunnel list` / the credentials filename
cloudflared tunnel info <UUID>
```

`npm run cloudflare:up` / `cloudflare:down` use `CLOUDFLARED_CONFIG` (default `~/.cloudflared/config-panono-webapp.yaml`).

---

## Daily dev workflow

Terminal 1 — Next.js:

```bash
npm run dev
```

Terminal 2 — Cloudflare tunnel:

```bash
npm run cloudflare:up
```

Open your configured **HTTPS** hostname (e.g. `https://dev.example.com`).

Stop the tunnel:

```bash
npm run cloudflare:down
```

**Log:** `tail -f scripts/cloudflare/tunnel.log`

---

## Service Worker testing

The app uses [Serwist](https://serwist.pages.dev/) (`app/sw.ts` → `public/sw.js`). Service workers require a **secure context** (HTTPS or localhost), so the tunnel is the right way to test SW on a real phone or desktop browser.

1. Open your tunnel URL once while online.
2. DevTools → **Application** → **Service Workers** — confirm `sw.js` is activated.
3. DevTools → **Network** → **Offline**, refresh — app shell should load from cache.
4. On a phone: **Add to Home Screen**, then test with camera WiFi (see deployment docs for LNA / `ws://` notes).

Disable the service worker locally: `DISABLE_SW=1 npm run dev`

---

## Environment overrides

| Variable | Default | Purpose |
|----------|---------|---------|
| `CLOUDFLARED_TUNNEL_NAME` | `panono-webapp-dev-tunnel` | Tunnel name passed to `cloudflared tunnel run` |
| `CLOUDFLARED_CONFIG` | `~/.cloudflared/config-panono-webapp.yaml` | Tunnel config path |
| `NEXT_DEV_TUNNEL_HOST` | *(unset)* | Hostname for Next.js `allowedDevOrigins` in dev |

Examples:

```bash
CLOUDFLARED_CONFIG=$HOME/.cloudflared/config-panono-webapp.yaml npm run cloudflare:up
```

```bash
# .env.local
NEXT_DEV_TUNNEL_HOST=dev.example.com
```

---

## Troubleshooting

| Problem | Check |
|---------|--------|
| 502 / connection refused | Is `npm run dev` running on port 3000? |
| Wrong tunnel / DNS | Use tunnel **UUID** from `cloudflared tunnel list` |
| `tunnel info` shows wrong UUID | Default `config.yml` is another project — use `--config` or the UUID |
| SW not registering | Must use **HTTPS** tunnel URL, not `http://127.0.0.1:3000` from another device |
| Next dev blocked | Set `NEXT_DEV_TUNNEL_HOST` to your tunnel hostname and restart dev |
| Tunnel already running | `npm run cloudflare:down` then `cloudflare:up` |

---

## Files in this repo

| Path | Purpose |
|------|---------|
| [`cloudflare/config.yaml.example`](../cloudflare/config.yaml.example) | Template for your `~/.cloudflared/` config |
| [`scripts/cloudflare/cloudflare-up.sh`](../scripts/cloudflare/cloudflare-up.sh) | Background tunnel (`npm run cloudflare:up`) |
| [`scripts/cloudflare/cloudflare-down.sh`](../scripts/cloudflare/cloudflare-down.sh) | Stop tunnel (`npm run cloudflare:down`) |
| [`app/sw.ts`](../app/sw.ts) | Service worker source |
| [`components/SwRegister.tsx`](../components/SwRegister.tsx) | Client-side SW registration |

Tunnel credentials (`~/.cloudflared/*.json`, `cert.pem`) stay **outside** the repo.
