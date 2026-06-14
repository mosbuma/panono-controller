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
