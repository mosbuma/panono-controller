# PTGui settings for Panono

Verified lens and sensor settings for stitching Panono full-resolution UPF exports in [PTGui](https://www.ptgui.com/). Use with the bundled template [`panono.pts`](./panono.pts).

For export steps (ZIP from the web app, image naming), see [docs/reference/ptgui-export.md](../reference/ptgui-export.md).

---

## Quick reference

| Setting | Value |
| -------- | ----- |
| **Lens type** | **Rectilinear** (normal lens — **not** fisheye) |
| **Image size** | **2064 × 1552** px |
| **Focal length** | **1863 px** (use `1862.857` from UPF if PTGui accepts decimals) |
| **Focal length (mm)** | **3.26 mm** (physical; optional if PTGui asks in mm) |
| **f-number** | **2.8** |
| **HFOV** | **~58°** (57.97° from UPF) |
| **VFOV** | **~45°** (45.23° from UPF) |
| **Sensor size** | **3.61 × 2.72 mm** (width × height) |
| **Sensor diagonal** | **4.52 mm** |
| **Crop factor** | **~9.6** (9.57) |
| **Number of images** | **36** (`img1.jpg` … `img36.jpg`) |
| **Template** | [`docs/ptgui/panono.pts`](./panono.pts) |

When PTGui shows **“Camera Sensor Size”** (no EXIF on Panono JPEGs), enter **any one** of sensor size, diagonal, or crop factor above. Check **“Always use this data for Unknown camera”** so you are not prompted 36 times.

---

## Workflow

1. **Export** — In Panono Control, download **PTGui ZIP (full)** from a full UPF (~30 MB, 2064×1552). Use the 36 merged RGB JPEGs, not 108 channel files.
2. **New project** — **File → New project** → add all `img1.jpg` … `img36.jpg`.
3. **Lens / sensor** — When prompted, set **Rectilinear** and the values in the table above.
4. **Apply template** — **File → Apply Template…** → choose [`panono.pts`](./panono.pts). This places all 36 lenses on the sphere; auto-align alone usually leaves holes.
5. **Align** — **Project → Align Images** (fine-tune; template does most of the work).
6. **Level** — In the **Panorama Editor**, rotate so floor is down and ceiling is up (see [Fixing rotation](#fixing-rotation)).
7. **Stitch** — **Create Panorama** → projection **Equirectangular** (360×180), then export JPEG or TIFF.

### PTGui Pro CLI (optional)

```text
PTGui -createproject img1.jpg img2.jpg ... img36.jpg \
  -output shot.pts \
  -template docs/ptgui/panono.pts \
  -stitchnogui shot.pts
```

---

## Where the numbers come from

### UPF `manifest.json` (authoritative)

Each of the 36 cameras in a Panono UPF includes calibration fields. Example from a full UPF:

```json
"imageWidth": 2064,
"imageHeight": 1552,
"f-Number": 2.8,
"intrinsicMatrix": [
  [1862.857, 0, 1032],
  [0, 1862.857, 776],
  [0, 0, 1]
]
```

| Quantity | Formula / source |
| -------- | ---------------- |
| Focal length (px) | `intrinsicMatrix[0][0]` → **1862.857** |
| Principal point | **(1032, 776)** — image centre |
| HFOV | `2 × atan(imageWidth / (2 × fx))` → **57.97°** |
| VFOV | `2 × atan(imageHeight / (2 × fy))` → **45.23°** |
| Sensor width (mm) | `(imageWidth / fx) × focal_mm` |
| Sensor height (mm) | `(imageHeight / fy) × focal_mm` |
| Crop factor | `43.27 / sensor_diagonal` (35 mm full-frame diagonal) |

Physical focal length **3.26 mm** per lens comes from Panono hardware specs (1/4″-type CMOS module). Combined with the UPF intrinsics:

```text
sensor width  = (2064 / 1862.857) × 3.26 = 3.61 mm
sensor height = (1552 / 1862.857) × 3.26 = 2.72 mm
diagonal      = 4.52 mm
crop factor   = 9.57
```

Preview UPFs (512×384) use different intrinsics — always stitch from **full** UPFs.

### `panono.pts` template

The template is a **binary PTGui project file** (header: `# PTGui Trial Project File`, body encrypted/compressed). Settings are **not** stored as plain text, so they cannot be read out reliably from the file alone.

What the template **does** contain (from PTGui’s project model and Panono forum practice):

- **Relative placement** of all 36 lenses on the sphere (yaw / pitch / roll per image).
- **Linking hints** so PTGui knows which images overlap — critical for Panono.

What you still set **manually when importing** new JPEGs:

- Lens type (**Rectilinear**).
- Image size, focal length, and sensor size / crop factor (table above).

A heuristic scan of the binary template shows float values consistent with those intrinsics (per-image focal lengths roughly **1858–1874 px**, HFOV roughly **57–59°**, crop factor roughly **9.2–10.0**), i.e. in the same ballpark as the UPF-derived values. Slight per-lens variation in the template is normal after alignment on a reference scene; start from the UPF numbers above for new exports.

**Provenance:** [`panono.pts`](./panono.pts) is a working Panono template (derived from the PTGui community / Joost Nieuwenhuijse thread). Keep it as the master template and **File → Apply Template** for every new panorama.

---

## Fixing rotation

Stitching can be correct while the panorama is **rotated** (e.g. floor on the left, ceiling on the right). PTGui does not read Panono IMU files (`LIS3DSH_ACCELEROMETER.dat`, etc.).

1. Open the **Panorama Editor**.
2. Use **Set center point** — click the desired centre, drag so “up” in the scene points to the top of the frame.
3. Or set **Yaw / Pitch / Roll** under panorama settings (often **±90° roll** if nadir/zenith are on the sides).
4. Re-check in the editor, then create the final panorama.

Panono Control’s built-in viewer can optionally level using accelerometer data; PTGui cannot.

---

## Troubleshooting

| Issue | What to do |
| ----- | ----------- |
| Holes / missing images | **Apply Template** — do not rely on align-only. |
| Wrong projection / warped seams | Lens type must be **Rectilinear**, not fisheye. |
| Repeated sensor-size prompts | Enable **Always use this data for Unknown camera**. |
| Seams on nearby objects | Parallax (~11 cm ball); use a pole/tripod, shoot in open spaces. |
| 108 images instead of 36 | Wrong export — use merged RGB ZIP from the app. |
| Colour / exposure bands | PTGui Pro HDR/exposure tools, or pre-grade in Lightroom. |

---

## Related

- [PTGui workflow (export)](../reference/ptgui-export.md)
- [Panono UPF format](../PANONO-API.md#upf-file-format-brief)
- [PTGui Panono — template fix (Joost)](https://groups.google.com/g/ptgui/c/-b2_cGtGLQo)
- [PTGui Panono — parallax & templates (Erik Krause)](https://groups.google.com/g/ptgui/c/qfmU_qS6jRI)
- [makeRGB reference exporter](https://github.com/sihagm/makeRGB)
