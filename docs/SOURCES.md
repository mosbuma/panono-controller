# Sources & references

Where Panono Control comes from and what we relied on to build it.

## Panono camera API

Reverse-engineered from open-source clients and validated on firmware **4.2.x** / API **4.23**:

| Project | Language | Use |
|---------|----------|-----|
| [florianl/panonoctl](https://github.com/florianl/panonoctl) | Python | JSON-RPC methods, SSDP discovery |
| [trumank/panonoctl-rs](https://github.com/trumank/panonoctl-rs) | Rust | `UpfInfo` fields, HTTP panorama paths |

Documented in this repo: [PANONO-API.md](../PANONO-API.md).

The camera speaks **JSON-RPC 2.0 over WebSocket** (`ws://`, port assigned at runtime) and serves `.upf` files over **HTTP** on port 80.

## UPF format & stitching

| Source | Contribution |
|--------|----------------|
| Panono `.upf` ZIP layout | `manifest.json`, per-camera JPEGs, `vignetting_coeffs.txt`, IMU logs |
| [sihagm/makeRGB](https://github.com/sihagm/makeRGB) | PTGui export naming (`img1.jpg` … `img36.jpg`) |
| [Maenpää et al. 2018](https://onlinelibrary.wiley.com/doi/full/10.1111/phor.12230) | MPC36 calibration background — [docs/reference/README.md](../reference/README.md) |
| In-repo stitcher (`lib/stitcher/`) | Equirect projection, vignetting, exposure, multiband blend (server / flat preview) |

PTGui workflow: [docs/reference/ptgui-export.md](../reference/ptgui-export.md).

## Web app stack

| Package | Role |
|---------|------|
| [Next.js](https://nextjs.org/) | App framework, API routes |
| [Serwist](https://serwist.pages.dev/) | Service Worker / offline precache |
| [Three.js](https://threejs.org/) | 360° mesh viewer |
| [JSZip](https://stuk.github.io/jszip/) | UPF unpack, PTGui ZIP in browser |
| [sharp](https://sharp.pixelplumbing.com/) | Server-side stitcher only (optional API routes) |

## Deployment patterns

| Reference | Use |
|-----------|-----|
| [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/) | Dev HTTPS testing — [CLOUDFLARED.md](../CLOUDFLARED.md) |
| Synology Reverse Proxy + Let's Encrypt | Production HTTPS — [deployment/DEPLOYMENT.md](./deployment/DEPLOYMENT.md) |

## Not from Panono GmbH

This project is **not** affiliated with or endorsed by Panono. Protocol details are inferred from community tools and hardware behaviour; firmware may differ.

## Related community projects

| Project | Notes |
|---------|--------|
| [gleitz/panono-equirectangular](https://github.com/gleitz/panono-equirectangular) | Panono **cloud** equirectangular tiles (not on-camera LAN API) |
| [VidePano](https://github.com/search?q=panono) | Various Panono utilities — search GitHub for `panono upf` |

## Licence

This repository is released under the [MIT License](../LICENSE).

Third-party code and references (e.g. [florianl/panonoctl](https://github.com/florianl/panonoctl) — Apache-2.0) remain under their respective licences; see [Attribution](../PANONO-API.md#attribution) in `PANONO-API.md`.
