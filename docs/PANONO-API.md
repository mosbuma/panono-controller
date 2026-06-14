# Panono camera API

Reverse-engineered documentation for the Panono 360° ball camera control protocol. This is **not** an official Panono specification.

**Primary sources:** [florianl/panonoctl](https://github.com/florianl/panonoctl) (Python, API v4.23 / firmware 4.2.873), [trumank/panonoctl-rs](https://github.com/trumank/panonoctl-rs) (Rust), and validation in this repo (`lib/panono.ts`, `scripts/*`).

**Tested in this project:** API **v4.23**, firmware **4.2.x** (e.g. 4.2.873). Older or newer firmware may expose fewer methods or different option sets.

---

## Overview

The camera runs a small embedded server when its WiFi access point is active (or when reachable on a shared LAN). Clients use:

| Channel | Protocol | Purpose |
|---------|----------|---------|
| **WebSocket** | JSON-RPC 2.0 over `ws://` | Control, status, gallery metadata, capture |
| **HTTP** | Plain `http://` on port **80** | Download `.upf` panorama files, firmware-related URLs |
| **SSDP** | UDP multicast | Discover WebSocket URL and API version |

There is **no `wss://`** on hardware tested with `npm run test-wss` and `npm run scan-ports` (full TCP 1–65535 scan: only ports **80** and the dynamic WebSocket port are open).

---

## Network & discovery

### Typical WiFi AP mode

When the phone or laptop joins the camera’s WiFi:

| Item | Typical value |
|------|----------------|
| Camera IP | `192.168.80.80` (DHCP server on camera) |
| WebSocket port | **Dynamic** — assigned at boot, announced via SSDP (often `42345`, not fixed) |
| WebSocket path | `/` (current SSDP) or `/8086` (legacy alternate path to the same API) |
| Example URL | `ws://192.168.80.80:42345/` |

Run `npm run discover` on the same network to print the current `LOCATION` URL.

### SSDP

| Field | Value |
|-------|--------|
| Multicast | `239.255.255.250:1900` |
| Search target | `panono:ball-camera` (`NT` / `ST`) |

**M-SEARCH** (from `scripts/discover.mjs`):

```http
M-SEARCH * HTTP/1.1
HOST: 239.255.255.250:1900
MAN: "ssdp:discover"
MX: 5
NT: panono:ball-camera
ST: panono:ball-camera
```

**Useful response headers:**

| Header | Meaning |
|--------|---------|
| `LOCATION` | WebSocket URL, e.g. `ws://192.168.80.80:42345/` |
| `APIVERSION` | API version string, e.g. `4.23` |
| `USN` | Unique service name |
| `SERVER` | Firmware / product string |

Browsers cannot send SSDP (no UDP multicast from the web platform). Use the Node discover script or enter the URL manually.

---

## WebSocket transport

### Connection

- Scheme: **`ws://` only** (use `connect_insecure()` in panonoctl-rs).
- Subprotocol: clients may send `rust-websocket`; the camera accepts standard WebSocket upgrades without requiring a specific subprotocol in practice.
- **WiFi only** for JSON-RPC in panonoctl-rs testing; HTTP/UPF may also work over USB-tethered LAN, but the control WebSocket was not observed there.

### Message framing

- Payloads are **UTF-8 JSON**.
- One WebSocket message may contain **multiple JSON objects separated by newlines** (`\n`). Clients must split and parse line-by-line (`lib/panono.ts`).

### JSON-RPC 2.0

**Request:**

```json
{ "jsonrpc": "2.0", "id": 1, "method": "get_status" }
```

With parameters:

```json
{ "jsonrpc": "2.0", "id": 2, "method": "auth", "params": { "device": "my-client", "force": "my-client" } }
```

**Success response:**

```json
{ "jsonrpc": "2.0", "id": 1, "result": { ... } }
```

**Error response:**

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "error": {
    "code": 309,
    "message": "...",
    "details": { ... },
    "request": { ... }
  }
}
```

**Notification** (no `id`, server → client):

```json
{ "jsonrpc": "2.0", "method": "status_update", "params": { "capture_available": true } }
```

Optional **warning** on success responses (observed in panonoctl-rs types):

```json
{ "jsonrpc": "2.0", "id": 1, "result": { ... }, "warning": { "code": 0, "message": "..." } }
```

### Recommended session flow

1. Connect WebSocket to SSDP `LOCATION` (or known URL).
2. Call **`auth`** (may require pressing the physical button on the ball; `is_auth` becomes true).
3. Optionally call **`get_status`** for full snapshot.
4. Subscribe implicitly to **`status_update`** notifications on the same socket.
5. Use **`capture`**, **`get_upf_infos`**, options methods, etc.

Commands may be ignored until **`auth`** succeeds (panonoctl documentation).

---

## RPC methods

Methods confirmed across panonoctl, panonoctl-rs, and this webapp. Method names use **snake_case**.

### `auth`

Authenticate the WebSocket session.

**Params:**

| Field | Type | Notes |
|-------|------|--------|
| `device` | string | Client identifier (arbitrary string) |
| `force` | string | Second client identifier; panonoctl uses the same value as `device` |

**Result:** `CameraStatus` object (see [Status object](#status-object)). Key field: `is_auth: boolean`.

**Example:**

```json
→ { "jsonrpc": "2.0", "id": 1, "method": "auth", "params": { "device": "panono-webapp", "force": "panono-webapp" } }
← { "jsonrpc": "2.0", "id": 1, "result": { "is_auth": true, "capture_available": true, ... } }
```

---

### `get_auth_token`

Alternative auth helper in panonoctl (same `device` / `force` params). Returns a token-oriented result on some firmware paths. Prefer **`auth`** for interactive control.

---

### `get_status`

**Params:** none

**Result:** Full [`CameraStatus`](#status-object) snapshot.

---

### `capture`

Trigger a 360° capture. The camera processes internally; preview/full UPF entries appear in **`get_upf_infos`** when ready.

**Params:** none

**Result (example shape from panonoctl-rs):**

```json
{
  "capture_available": false,
  "options": {
    "AutoExposure": true,
    "ColorTemperature": "5500",
    "ExposureTime": 1.0,
    "ISO": "200",
    "TriggerDelay": 0
  }
}
```

While processing, `capture_available` is typically false; **`status_update`** notifications reflect readiness.

---

### `upf_infos_update` (notification)

Push notification when a panorama entry is created or updated on the camera (no JSON-RPC `id`).

**Params:**

```json
{
  "upf_infos": [
    {
      "image_id": "f06149545a99399c1dc447d6…",
      "capture_date": "2026-06-14 11:24:38,000"
    }
  ]
}
```

The webapp uses this to link user-entered subject names (Register info) to `image_id` immediately after capture, before `get_upf_infos` is polled.

---

### `get_option_list`

**Params:** none

**Result:**

```json
{
  "options": [
    {
      "name": "AutoExposure",
      "type": "Boolean",
      "constraints": [{ "constraint": "values", "value": [true, false] }]
    }
  ]
}
```

**Option types:** `Boolean`, `Enumeration`, `Number`, `Integer`.

**Constraint kinds:** `values` (allowed set), `min`, `max`.

---

### `get_options`

**Params:** none

**Result:** Object map of option name → current value (all options at once).

```json
{
  "AutoExposure": true,
  "ColorTemperature": "5500",
  "ExposureTime": 1.0,
  "ISO": "200",
  "TriggerDelay": 0
}
```

---

### `get_option`

**Params:**

| Field | Type |
|-------|------|
| `name` | string |

**Result:**

```json
{ "name": "ISO", "value": "200" }
```

`value` may be string, number, or boolean depending on option type.

---

### `set_option`

**Params:**

| Field | Type |
|-------|------|
| `name` | string |
| `value` | string \| number \| boolean |

**Result:** implementation-specific; often an empty or updated option acknowledgement.

Used by this webapp (`lib/panono.ts`); not wrapped in panonoctl-rs’s published `Method` enum but part of the live API.

---

### `get_upf_infos`

List panoramas stored on the camera.

**Params:** none

**Result:**

```json
{
  "is_full": false,
  "upf_infos": [
    {
      "capture_date": "2026-06-13T08:00:00.000Z",
      "image_id": "4fd70dfc074340296cc2ebb92158a18d",
      "preview_url": "/panoramas/preview_....upf",
      "preview_status": "...",
      "size": 1048576,
      "upf_size": 31457280,
      "upf_url": "/panoramas/full_....upf",
      "upf_status": "...",
      "serial_number": "...",
      "trigger": "...",
      "location": { "lat": 52.0, "lng": 5.0 }
    }
  ]
}
```

| Field | Meaning |
|-------|---------|
| `is_full` | Storage full — may not accept new captures |
| `preview_url` | HTTP path to ~1 MB preview UPF |
| `upf_url` | HTTP path to full-resolution UPF (~30 MB) |
| `size` | Preview file size (bytes) |
| `upf_size` | Full UPF size (bytes) |
| `image_id` | Opaque ID for `delete_upf` |

URLs are often **relative**; resolve against the WebSocket origin (`ws://host:port` → `http://host:port`) — see `lib/util.ts` `resolveCameraUrl()`.

---

### `delete_upf`

**Params:**

| Field | Type |
|-------|------|
| `image_id` | string |

**Result:**

```json
{ "panorama": true, "preview": true }
```

Booleans indicate which files were deleted. On failure, error code **309** has been observed with nested `details.panorama` / `details.preview` messages such as `no_panorama` / `no_preview`.

---

## Notifications

### `status_update`

Server push when status fields change (no JSON-RPC `id`).

**Params:** Partial [`CameraStatus`](#status-object) — only changed fields may be present.

**Example:**

```json
{ "jsonrpc": "2.0", "method": "status_update", "params": { "capture_available": false } }
```

Clients should merge into local state. This webapp handles it in `PanonoClient` (`lib/panono.ts`).

---

## Status object

Fields observed on **`auth`**, **`get_status`**, and **`status_update`** (`lib/types.ts`, panonoctl-rs):

| Field | Type | Notes |
|-------|------|--------|
| `auth_token` | string | Session token when authenticated |
| `api_version` | string | e.g. `4.23` |
| `capture_available` | boolean | `true` when ready to capture |
| `current_time` | string | ISO-like camera clock |
| `device_id` | string | Hardware identifier |
| `firmware_version` | string | e.g. `4.2.873` |
| `firmware_update_url` | string | HTTP URL for firmware updates |
| `is_auth` | boolean | Session authenticated |
| `serial_number` | string | Serial |
| `battery_value` | number | 0–100; **-1** on external power (percentage unknown) |
| `charging_status` | string | e.g. `charging`, `not_charging` |
| `auto_poweroff_count_down` | number | Seconds until auto power-off |
| `storage` | object | Map of volume name → `{ total, usage }` (bytes) |
| `update_ready` | boolean | Firmware update staged |

Additional keys may appear; treat as forward-compatible.

---

## Known camera options

From panonoctl-rs test fixtures and capture responses (names are **PascalCase**):

| Name | Type | Constraints / values |
|------|------|----------------------|
| `AutoExposure` | Boolean | `true`, `false` |
| `ColorTemperature` | Enumeration | `"0"`, `"3000"`, `"4500"`, `"5500"`, `"6500"`, `"8000"` |
| `ExposureTime` | Number | min `0.25`, max `2000` |
| `ISO` | Enumeration | `"50"`, `"100"`, `"200"`, `"400"`, `"800"` |
| `TriggerDelay` | Integer | min `0`, max `10000` |

Use **`get_option_list`** on your device for the authoritative list.

---

## HTTP file access

Panorama files are **not** transferred over JSON-RPC. After **`get_upf_infos`**, download via **GET**:

```http
GET /panoramas/preview_<image_id>.upf HTTP/1.1
Host: 192.168.80.80
```

Paths vary by firmware; trust `preview_url` and `upf_url` from `get_upf_infos`. Typical pattern:

- Preview: `/panoramas/preview_….upf` (~1 MB)
- Full: `/panoramas/full_….upf` (~30 MB)

**Content:** ZIP archive (see below). No authentication headers observed for LAN HTTP downloads in panonoctl-rs.

**Port 80** serves HTTP. Resolve relative URLs with the same host/port as the WebSocket connection.

---

## UPF file format (brief)

A `.upf` file is a **ZIP** containing:

| Entry | Purpose |
|-------|---------|
| `manifest.json` | 36-camera calibration (`intrinsicMatrix`, `rotationMatrix`, `translationVector`) |
| `imageset0_cameraNN.jpg` | Per-sensor images (preview: one JPEG per camera; full: separate R/G0/G1/B channel JPEGs) |
| `LIS3DSH_ACCELEROMETER.dat` | IMU samples |
| `vignetting_coeffs.txt` | Per-camera vignetting correction |

See `lib/manifest.ts` and [reference/ptgui-export.md](reference/ptgui-export.md) for export/stitching usage.

---

## Error codes

The API is not fully documented. Known examples:

| Code | Context | Notes |
|------|---------|--------|
| `309` | `delete_upf` | Missing panorama/preview; see `error.details` |

Other codes may indicate auth required, invalid parameters, or busy camera. Inspect `error.message` and `error.details` in the JSON-RPC log.

---

## Methods not in this doc

panonoctl’s **`experimental(method, params)`** sends arbitrary method names — the official mobile app likely uses additional RPCs (firmware update progress, WiFi config, etc.) not verified here. trumank/panonoctl-rs notes that decompiled app methods often return “method not found” on older firmware.

To probe unknown methods, use the JSON-RPC log in the web UI or send raw requests with incrementing `id`.

---

## Validation tools (this repo)

| Command | Purpose |
|---------|---------|
| `npm run discover` | SSDP → print WebSocket URL |
| `npm run test-wss` | Compare `ws://` vs `wss://` on camera port |
| `npm run scan-ports` | TCP port scan + TLS/HTTP/WebSocket probes |

Implementation reference: [`lib/panono.ts`](../lib/panono.ts), [`lib/types.ts`](../lib/types.ts).

---

## Attribution

- **This project** — [MIT](../LICENSE)
- [florianl/panonoctl](https://github.com/florianl/panonoctl) — Apache-2.0
- [trumank/panonoctl-rs](https://github.com/trumank/panonoctl-rs)
- Panono / Panono GmbH — hardware and undocumented firmware API
