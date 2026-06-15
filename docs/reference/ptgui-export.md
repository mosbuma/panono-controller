# PTGui workflow for Panono UPFs

PTGui is the practical external stitcher for Panono: the rig geometry is **fixed** (36 lenses, same layout every shot), so you use a **project template** instead of letting PTGui guess image pairs. Without a template, you get holes and orphan images even when geometry is correct ([PTGui forum thread](https://groups.google.com/g/ptgui/c/-b2_cGtGLQo)).

## 1. Export JPEGs from this app

In the gallery, click **PTGui ZIP (full)**:

- 36 merged RGB files: `img1.jpg` … `img36.jpg`
- `manifest.json` (calibration)
- Naming follows [sihagm/makeRGB](https://github.com/sihagm/makeRGB)

Use the **full UPF** export (2064×1552). The four half-res Bayer planes (`_red`, `_green0`, `_green1`, `_blue`) are interleaved into the full RGGB mosaic, bilinear-demosaiced to 2064×1552, and white-balanced — not preview (512×384). This matches the official Panono converter (unlike [makeRGB](https://github.com/sihagm/makeRGB), which stacks half-res planes and produces a half-size, green-cast image).

**Important:** Use these **36 RGB JPEGs**, not 108 separate channel files (_red / _green0 / _blue).

## 2. Get a Panono PTGui template

You need a `.pts` template that already encodes where each of the 36 lenses sits on the sphere.

### Option A — Bundled template (recommended)

This repo includes a working template at **[docs/ptgui/panono.pts](../ptgui/panono.pts)** with documented lens settings in **[docs/ptgui/PTGUI.md](../ptgui/PTGUI.md)**.

### Option B — Joost's template

PTGui author Joost Nieuwenhuijse shared a working Panono project file in the [“Experience stitching Panono JPGs in PTGui?”](https://groups.google.com/g/ptgui/c/-b2_cGtGLQo) thread (attachment: `branderburgertor.pts`).

1. Open that Google Group thread.
2. Download the attached `.pts` file from Joost's reply.
3. Keep it as your master template for all future panoramas.

### Option C — Build your own template (one-time)

From [Erik Krause on the PTGui Panono thread](https://groups.google.com/g/ptgui/c/qfmU_qS6jRI):

1. Shoot **one** panorama in a **large, detailed** space (outdoors or big hall — avoid blank sky/ceiling).
2. Use a **tripod or pole** to reduce parallax (the ball is ~11 cm wide; close objects show seam errors).
3. Export the 36 JPEGs as above.
4. In PTGui: add all images → set lens to **Rectilinear** (see settings below) → run **Align Images** with enough control points.
5. Enable **individual lens parameters** if needed (36 separate lenses).
6. When the preview looks good, **File → Save project as template**.

Reuse that template for every later panorama via **File → Apply Template**.

## 3. Stitch one panorama in PTGui

1. **File → New project**
2. **Add photos** — select all `img1.jpg` … `img36.jpg` from the ZIP (order by number).
3. **Lens settings** — see **[docs/ptgui/PTGUI.md](../ptgui/PTGUI.md)** for the full table (Rectilinear, 2064×1552, ~1863 px focal length, sensor size / crop factor, and template path).

4. **File → Apply Template…** → choose [`docs/ptgui/panono.pts`](../ptgui/panono.pts) (or Joost's / your own).
5. **Project → Align Images** (fine-tunes; template does most of the work).
6. Fix any obvious gaps in the **Control Points** tab if a single image failed to link.
7. **Create Panorama** tab:
   - Projection: **equirectangular** (360×180)
   - Output size: as large as you need (Panono cloud used ~108 MP)
   - Format: JPEG or TIFF

### PTGui Pro CLI (optional)

```text
PTGui.exe -createproject img1.jpg img2.jpg ... img36.jpg -output shot.pts -template panono.pts -stitchnogui shot.pts
```

See [PTGui version history](https://www.ptgui.com/versionhistory.html) for `-createproject` / `-template` flags.

## 4. Tips when results are still imperfect

| Issue | What to do |
| ----- | ----------- |
| **Holes / missing images** | Use **Apply Template** — auto-align alone rarely links all 36 Panono images. |
| **Seams on nearby objects** | Parallax from the ball's size; shoot outdoors, use a pole, or accept small errors on close geometry. |
| **Colour/exposure shifts** | In PTGui Pro: **HDR / Exposure** tab, or pre-normalize in Lightroom. |
| **108 images instead of 36** | Wrong export — use merged RGB ZIP from this app, not raw channel JPEGs. |
| **Easier path** | Use this app's built-in **View stitched full-res** (server stitcher uses `manifest.json` directly). |

## Related links

- [PTGui Panono — holes remain (template fix)](https://groups.google.com/g/ptgui/c/-b2_cGtGLQo)
- [PTGui Panono — templates & parallax (Erik Krause)](https://groups.google.com/g/ptgui/c/qfmU_qS6jRI)
- [PTGui Panono 360° ball — extract JPEGs first](https://groups.google.com/g/ptgui/c/ckmOqPVusOU)
- [makeRGB reference exporter](https://github.com/sihagm/makeRGB)
