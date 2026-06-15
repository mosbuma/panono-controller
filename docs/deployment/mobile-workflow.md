# Mobile & field workflow

How to use Panono Control on a phone in the field. Your server hosts the installable app; the **camera connection is always phone → Panono** over the camera's WiFi.

## Before you leave (online)

1. Open **`https://<your-hostname>`** (your production HTTPS URL) on the phone.
2. **Add to Home Screen** (Safari: Share → Add to Home Screen; Chrome: menu → Install app / Add to Home Screen).
3. Confirm the Service Worker installed (optional: DevTools if tethered).
4. Note the version in the app header — after updates, open the site once online to refresh the cache.

## In the field (camera WiFi)

1. Join the **Panono's WiFi** on the phone.
2. Open the **home screen icon** (not a stale browser tab from a different network, if you can avoid it).
3. Enter or confirm the WebSocket URL (`ws://192.168.x.x:port/` — run `npm run discover` from a laptop on the same WiFi if needed).
4. Tap **Connect**.
5. If the browser shows **local network access** (Chromium): tap **Allow**. Without this, `ws://` and camera `http://` fetches may fail from an HTTPS page.
6. Press the button on the camera if **auth** is pending.
7. Capture, download UPFs, PTGui ZIP, 360° viewer — all client-side.

### HTTPS + camera WiFi

| Connection | Works? |
|------------|--------|
| WebSocket `ws://` to camera | Yes, after **local network access** (Chromium) |
| Download UPF / preview | Yes — direct to camera, or via `/api/upf` when dev server is on same WiFi |
| Reach home server | **No** — camera AP has no route to your home network (by design) |

### Fallbacks

- **Keep one tab open** on camera WiFi; avoid refresh if the offline shell already loaded.
- **Last URL** is stored in `localStorage` (`panono.lastUrl`).
- If previews are slow, leave **Show preview** off; use **View 360°** instead.
- **Download all UPFs** triggers one file at a time — allow multiple downloads when prompted.

## Browser notes

| Browser | Service Worker | `ws://` from HTTPS |
|---------|----------------|---------------------|
| Chrome Android | Yes | Local Network Access prompt (grant once per site) |
| Safari iOS | Yes | Test on your iOS version; LNA behaviour differs from Chrome |
| Desktop Chrome | Yes | Useful for dev via [CLOUDFLARED.md](../CLOUDFLARED.md) |

Safari may not expose the same LNA prompt wording as Chrome. If connect fails on iOS, try staying on a tab that was opened while on camera WiFi, or use HTTP on LAN for local dev only.

## Bulk download

**Download all UPFs** fetches each full `.upf` sequentially (~30 MB each) and saves via the download API. The browser will ask to **allow multiple downloads** — accept once. Uses the same fetch path as single **Download UPF** (works through `/api/upf` when needed).

## Optional flat previews

Enable **Show preview** to stitch 360×180 gallery thumbnails in the browser (cached in IndexedDB). Default is **off** to save time and battery. Cached previews remain on the device when toggled off; they are not deleted.

## Dev testing without production deploy

On a laptop with Cloudflare tunnel:

```bash
npm run dev
npm run cloudflare:up
```

Open `https://<your-tunnel-hostname>`, join camera WiFi on the phone, grant LNA, connect. Set `NEXT_DEV_TUNNEL_HOST=<your-tunnel-hostname>` in `.env.local`. See [CLOUDFLARED.md](../CLOUDFLARED.md).
