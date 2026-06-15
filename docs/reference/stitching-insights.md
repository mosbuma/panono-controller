# Stitching insights (from calibration paper + UPF practice)

Derived from [Maenpää et al. 2018](./maenpaeae-2018-multi-projective-camera-calibration.pdf) and Panono UPF structure.

## Geometry (trust the manifest)

The Panono rig is a fixed MPC36. Per-shot `rotationMatrix` / `intrinsicMatrix` in `manifest.json` are the right basis for reprojection. Parallax is a real-world issue for nearby objects (throwable ball, ~11 cm diameter) but the rig has **zero translation** per camera in the manifest — pure rotation model is correct for far-field stitching.

## Overlap is tiny

Neighbouring cameras overlap **<10%**. Implications for our stitcher:

- Weighted blending must feather aggressively at patch borders (already done).
- Exposure/vignetting mismatch shows up disproportionately in the thin overlap zones.
- Multiband (Laplacian pyramid) blending helps most in these narrow seams.

## Radiometry (not in the paper — from UPF)

| Source | Use |
| ------ | --- |
| `vignetting_coeffs.txt` | Per-camera radial gain correction before blend |

### `vignetting_coeffs.txt` format (from `/tmp/full.upf`)

```
2048
1.000\t1.000\t1.000
...
2.739\t2.359\t2.365
```

- Line 1: sample count (`2048`)
- Next 2048 lines: tab-separated **R G B** gain factors (1.0 at center → ~2.7 at edge in this sample)
- One file per UPF (not per camera); likely a shared radial profile indexed by distance from principal point
| Per-camera median luminance | Global exposure normalization across 36 sensors |
| Channel merge (R, G0, G1, B) | Recombine half-res BGGR planes → full mosaic → bilinear demosaic → per-camera WB gain → sRGB encode (2064×1552) |

## Official converter colour pipeline (reverse-engineered)

Reverse-engineered from the official `PanonoUPFConverter` v1.1.0 Linux binary
(`reference/converter/`, not stripped; classes `ImageLib::ImageAdjustment`,
`ImageLib::Demosaicing`, `FileIO::PanonoRawReader`). Built from Panono's
`standalone-stitcher/src/lib/ImageLib/`.

**The channel JPEGs are half-resolution *linear* Bayer planes**, recombined into
a full mosaic and demosaiced. Per camera the converter runs:

1. `composeBayerComponents` — interleave `_red/_green0/_green1/_blue` (each
   1032×776) into the full **BGGR** mosaic (2064×1552):
   `(0,0)=B (1,0)=G (0,1)=G (1,1)=R`.
2. 10-bit→8-bit conversion, `devignetting` (radial gains), `debayer`.
3. `imageImprovement`: convert → `balanceColors` → denoise → localContrast →
   unsharp `sharpen` → **`balanceColors` (white balance + gamma)** → convert →
   autoContrast.

The colour-critical step is `balanceColors` → `processImageBayerBG` →
`calcColorBalanceLookupTable`, a per-channel 256-entry LUT:

```
v01 = clamp(whiteBalance[c] * value/255, 0, 1)         # per-camera WB gain
out = v01 <= 0.0031308 ? 12.92*v01                     # standard sRGB OETF
                       : 1.055*v01^(1/2.4) - 0.055
out8 = round(out * 255)
```

The constants `0.0031308 / 12.92 / 1.055 / 0.055 / 2.4` are the exact sRGB
transfer function. So the green cast came from outputting **linear** sensor data
with no white balance and no sRGB encoding.

### Manifest camera fields (per camera)

Parsed from `manifest.json` (`FileIO::PanonoRawReader::loadImageSet`):

| Field | Type | Use |
| ----- | ---- | --- |
| `intrinsicMatrix` | 3×3 | projection |
| `rotationMatrix` | 3×3 | projection |
| `translationVector` | 3×1 | projection (zero translation) |
| `whiteBalance` | 3×1 | **linear RGB white-balance gains** (read via `readVector`) |
| `colorMatrix` | 3×3 | colour-correction matrix (present but unused by v1.1.0) |
| `vignettingCoeffs` | string | ref to `_VignettingCoeffs.txt` |
| `imageWidth` / `imageHeight` / `imageFormat` | — | per-channel plane geometry |

We apply `whiteBalance` + sRGB encode in `lib/merge-bayer-channels.ts`, falling
back to gray-world gains when `whiteBalance` is absent (preview / older UPFs).

## Target quality bar

Panono cloud output: **108 Mpixel** equirect, visually seamless for tourism/architecture. Our server presets (4096×2048 full) are a practical LAN compromise; quality limits are blend/radiometry, not sensor resolution.

## Stitcher upgrades (implemented in `lib/stitcher/`)

1. **`vignetting.ts`** — parses `vignetting_coeffs.txt`, radial R/G/B gain per sample
2. **`exposure.ts`** — per-camera median luminance in central ROI, normalized to panorama average
3. **`multiband.ts`** — Laplacian-pyramid blend per camera (enabled when output width ≥ 512; thumbnails use spatial blend)

## Official equirectangular preview stitch (reverse-engineered)

The shipped `PanonoUPFConverter` v1.1.0 binary contains a full panorama stitcher
(`Stitching::PanoramaStitcher`) that the GUI uses to render the **preview** pane.
The CLI/export only writes the 36 corrected frames; the equirectangular compose is
preview-only. We recovered the algorithm by disassembling these functions:

| Function (VA) | Role |
| ------------- | ---- |
| `PreviewCalculator::run` (0x41fa50) | full pipeline: `open`/`readHeaders`/`loadImageSet`/`loadSensorData` -> `chooseGravity` -> `imagePreprocessing` -> `composeLabelMap_Mt` -> `composeEquirectangularImage_Mt` |
| `composeEquirectangularImage` (0x4289f0) | builds `InfoStruct`: per-camera matrix `M = G * R_cam` (gravity-corrected rotation), then delegates to the row worker |
| `composeEquirectangularImageRows` (0x425220) | per output pixel: sample the camera named by the label map, bicubic |
| `composeLabelMapRows` (0x422700) | per output pixel: choose the source camera (the seam) |
| `getGravityCorrectionMatrix` (0x4260a0) | `Eigen::Quaternion::setFromTwoVectors(g, vertical)` -> 3x3 |

### Equirectangular convention (from constants at `.rodata` 0x7522d0..)

For output pixel `(px, py)` of a `W x H` panorama:

```
theta = px * (2*PI / (W - 1))          # 0x7522d0 = 2*PI
phi   = py * (PI  / (H - 1))           # 0x7522d8 = PI   (0 at top row -> +Y pole)
dir d = ( sin(phi)*cos(theta),  cos(phi),  sin(phi)*sin(theta) )
```

So the panorama up-axis is **+Y**, the seam at `px=0` faces `+X`, and longitude
increases toward `+Z`. Pixel centres use a `0.5` offset (0x752308); epsilons are
`1e-12` (degenerate row) and `1e-5` (sub-pixel) .

### Per-pixel camera selection — the label map (the seam rule)

`composeLabelMapRows` keeps, per output pixel, the camera whose projection lands
**closest to its principal point**:

```
best_dist2 = DBL_MAX            # 0x7522c8
best_cam   = 255               # 0xff = "no camera"
for cam in cameras:
    c  = M_cam^T . d           # camera-space ray (columns of M dotted with d)
    if c.z <= 0: continue      # behind camera
    (u, v) = project(c, intrinsics[+ optional radial distortion])
    if (u, v) outside [margin .. W-1-margin] x [margin .. H-1-margin]: continue
    dist2 = (u - cx)^2 + (v - cy)^2
    if dist2 < best_dist2: best_dist2 = dist2; best_cam = cam
label[px, py] = best_cam
```

This is a **hard, single-source assignment** (a Voronoi-like seam by image-centre
distance) — there is no cross-camera feather/multiband in the preview path. The
margin comes from `InfoStruct+0x90`.

### Compose

`composeEquirectangularImageRows` re-derives `d`, transforms by `M_cam`, projects
with the same intrinsics, and writes the pixel via the chosen `Interpolator`
(default bicubic; NN/bilinear/bicubic all present). cz<=0 and out-of-bounds are
culled (left as background).

### Gravity correction

`chooseGravity` averages `LIS3DSH_ACCELEROMETER.dat` (16-byte records:
`float32 [timestamp, ax, ay, az]`, ~3200 samples) to a gravity vector, and
`getGravityCorrectionMatrix` builds the rotation that maps it onto the vertical
axis (`Quaternion::setFromTwoVectors`). That matrix pre-multiplies each camera
rotation so the horizon is level.

**Empirical note:** for the demo UPF the `manifest.json` `rotationMatrix` values
already encode the levelled capture pose, so applying our accelerometer gravity
correction on top of them *double-corrects* and visibly tilts the panorama.
The port therefore defaults `useGravity = false` and the un-corrected result is
the one with the correct pitch/roll/yaw (level horizon, ceiling on the top row).

**Exposure harmonization off by default.** `computeExposureGains`
(`lib/stitcher/exposure.ts`) forces each camera's central-35% per-channel median
to the global average — a content-driven per-camera auto-exposure/WB. The shipped
planes are already consistently exposed/white-balanced per camera (validated ~6
MAE vs. the official per-camera frames), so this step only adds brightness steps
and coloured seams that the official converter does not have. `applyExposure`
therefore defaults `false`. Any future cross-camera matching should be solved
from overlap regions (luminance gain+bias), not per-camera content medians.
`lib/stitcher/gravity.ts` is retained behind the `useGravity` flag in case a UPF
ships un-levelled calibration. The azimuth mapping (`+sin t` for dz, no output
mirror) already yields readable, non-mirrored text, so `flipOutput` defaults off.

### Our port

`lib/stitcher/equirect-official.ts` implements the above (label map + hard-seam
compose + bicubic) and is the default `calibrated` stitch method. Per-camera
projection uses `c = R_cam . (G^T d)` (with `G` the optional gravity matrix).
The native oracle was skipped per the plan; validation is visual against the
official per-camera frames in `reference/demo-image/`. Stitch knobs exposed on
the API (`/api/stitch`): `useGravity`, `applyVignetting`, `applyExposure`,
`flipOutput`, plus `width`/`height`.
