# Panono UPF Converter — colour pipeline (reverse-engineered)

How the official **Panono UPF Converter v1.1.0** turns the raw channel JPEGs
inside a `.upf` into full-resolution colour images, and exactly how we recovered
that algorithm from the shipped binary.

Our re-implementation lives in [`lib/merge-bayer-channels.ts`](../../lib/merge-bayer-channels.ts);
this document is the spec it follows.

---

## 1. TL;DR — the algorithm

For each of the 36 cameras in a full-resolution UPF:

1. **Recombine** the four half-resolution channel JPEGs
   (`imageset0_cameraNN_red.jpg`, `_green0`, `_green1`, `_blue`, each
   **1032×776**) into one full **2064×1552 Bayer mosaic**. `imageFormat` is
   `RAW_GR_8bit_JPEGcompressed` ⇒ the pattern is **GRBG**:

   ```
   (0,0)=G(green0)  (1,0)=R(red)     plane coords x=X>>1, y=Y>>1
   (0,1)=B(blue)    (1,1)=G(green1)
   ```

   Because we assign each output channel from the plane named for it, the exact
   pattern only affects demosaic sub-pixel alignment, not channel identity.

2. **Demosaic** the mosaic to interleaved RGB (bilinear interpolation).

3. **Emit the demosaiced bytes directly.** That's it — no black-level subtract,
   no colour matrix, no sRGB encode.

> **The shipped channel planes are already display-referred.** They are
> white-balanced AND gamma-encoded by the camera. Validated against
> `reference/demo-image/official-converted/` (36 cameras): passing the
> demosaiced bytes through gives **MAE ≈6** with per-channel contrast matching
> the official (std ≈38–40 vs official ≈39–41). Re-encoding them through an sRGB
> OETF — the previous approach — **double-gammas** the data: it roughly doubles
> contrast (std ≈57) and lifts brightness, giving MAE ≈26. (Earlier *green*
> output came from emitting the raw planes at half-res / with the wrong Bayer
> phase; the *pink* output came from also multiplying by the manifest
> `whiteBalance`. The manifest `blackLevel`, `colorMatrix` and `whiteBalance`
> are all already baked into the planes — see §3.)

> **Optional residual white balance.** A tiny, very stable per-channel gain
> `[1.028, 1.001, 0.922]` (the official is ~3 levels redder / ~9 bluer than the
> bare passthrough) takes MAE **6.0 → 4.66**. It is fit to one reference capture
> (std ≈0.02 across all 36 cameras), so it is exposed as the opt-in
> `whiteGain` / `REFERENCE_WHITE_GAIN` and is **off by default**.

---

## 2. The binary we analysed

```
reference/converter/panono-upf-converter-1.1.0-linux/PanonoUPFConverter
```

```
$ file PanonoUPFConverter
ELF 64-bit LSB executable, x86-64, dynamically linked,
  BuildID[sha1]=59b3528affcf36f8c3576d428dbb8d55892fc4c0, not stripped
```

Two facts made this tractable:

- **Not stripped** — all C++ class/method symbols are present.
- **Statically linked OpenCV + Eigen + boost**, but Panono's own code lives in
  recognisable namespaces (`ImageLib`, `FileIO`, `Stitching`, `PanonoUtilsLib`).

It is a Qt5 GUI app (`libQt5Widgets/Gui/Core`), built from sources rooted at
`standalone-stitcher/src/lib/ImageLib/` (seen in an assert path string).

---

## 3. How we derived it (step by step)

Everything below uses standard binutils (`nm`, `objdump`, `strings`, `readelf`)
plus a little `python3` to decode constants. No execution of the binary.

### 3.1 Enumerate the relevant code

```bash
# Demangled defined symbols, filtered to image/colour code.
nm -C --defined-only PanonoUPFConverter | grep -iE \
  'demosaic|bayer|balance|vignett|whitebalance|debayer|colorMatrix'
```

This surfaced the whole pipeline surface, notably:

- `ImageLib::ImageAdjustment::imageImprovement(PanonoImage, PanonoCamera&, bool, Eigen::Vector3d)`
- `ImageLib::ImageAdjustment::balanceColors(... Eigen::Vector3d const&, bool)`
- `ImageLib::ImageAdjustment::devignetting(...)`
- `ImageLib::Demosaicing::{debayer,debayerSimple,debayerCustom}`
- `ImageLib::ImageAdjustment::processImageBayerBG / processImageBayerGR`
- `ImageLib::ImageAdjustment::calcColorBalanceLookupTable<uchar>(...)`
- `FileIO::PanonoRawReader::composeBayerComponents(...)`
- `FileIO::PanonoRawWriter::decomposeBayerComponents(...)`
- `ImageLib::PanonoCamera::WhiteBalanceParams`, `VignettingParams`

The presence of `processImageBayerBG` (**BG** = BGGR) and `processImageBayerGR`
(**GR** = GRBG) told us the sensor pattern is one of those two, chosen per image.

### 3.2 Recover the manifest schema

The JSON keys are plain `.rodata` strings. We found their file offsets, mapped
them to virtual addresses, and located the code that reads them.

```bash
# .rodata: VA 0x6f9880, file offset 0x2f9880  →  delta = 0x400000
readelf -SW PanonoUPFConverter | grep -E '\.rodata'

# Find code referencing the "whiteBalance" string (VA 0x752d7e).
objdump -d -M intel PanonoUPFConverter | grep 752d7e
```

The reference sits inside
`FileIO::PanonoRawReader::loadImageSet`, immediately followed by a call to
`readVector(... Eigen::Matrix<double,3,1>)` — i.e. **`whiteBalance` is parsed as
a 3-element vector**. Dumping the neighbouring strings revealed the full
per-camera schema:

```
vignettingCoeffs  whiteBalance  colorMatrix  imageWidth  imageHeight  imageFormat
```

(`intrinsicMatrix`, `rotationMatrix`, `translationVector` are read via
`readMatrix`/`readVector` in the same function.)

### 3.3 Decode the Bayer recombination (`composeBayerComponents`)

We disassembled the inner pixel loop:

```bash
objdump -d --start-address=0x42f4b0 --stop-address=0x42f5c0 -M intel PanonoUPFConverter
```

The hot loop (annotated):

```asm
movzx esi, BYTE PTR [r13+rax]   ; esi = planeB[k]   (r13 = arg b)
lea   edi, [rax+rax]            ; edi = 2k
mov   BYTE PTR [r11+rdi], sil   ; bayer[oddRow ][2k  ] = planeB[k]
movzx edx, BYTE PTR [rbx+rax]   ; edx = planeA[k]   (rbx = arg a)
mov   esi, ecx                  ; esi = 2k+1
mov   BYTE PTR [r11+rsi], dl    ; bayer[oddRow ][2k+1] = planeA[k]
movzx edx, BYTE PTR [r12+rax]   ; edx = planeD[k]   (r12 = arg d)
mov   BYTE PTR [r10+rdi], dl    ; bayer[evenRow][2k  ] = planeD[k]
movzx edi, BYTE PTR [r14+rax]   ; edi = planeC[k]   (r14 = arg c)
mov   BYTE PTR [r10+rsi], dil   ; bayer[evenRow][2k+1] = planeC[k]
```

with `r10` = output row `2y` and `r11` = output row `2y+1` (the row counter at
`[rsp+0x20]` starts odd and steps by 2). So, in argument order
`compose(a, b, c, d, out)`:

```
even row (2y):   col 2k = d,  col 2k+1 = c
odd  row (2y+1): col 2k = b,  col 2k+1 = a
```

`loadImageSet` passes the planes in `imageFilenames` order
`[red, green0, green1, blue]` → `a=red, b=green0, c=green1, d=blue`, giving:

```
(0,0)=blue   (1,0)=green1
(0,1)=green0 (1,1)=red
```

This is the converter's *internal* compose order. The real-world sample's
`imageFormat` is `RAW_GR_8bit_JPEGcompressed` (**GRBG**, the
`processImageBayerGR` path), and our re-implementation uses GRBG offsets. In
practice this distinction only changes demosaic sub-pixel alignment: we map each
output channel from the plane named for it (`_red`→R, `_green0/_green1`→G,
`_blue`→B), so channel identity is correct regardless of the chosen offsets.

### 3.4 Recover the processing order (`imageImprovement`)

```bash
objdump -d --start-address=0x454560 --stop-address=0x4547a0 -M intel PanonoUPFConverter
```

The call sequence, in order:

```
Conversion::convert
balanceColors(img, d,d,d,d,d, bool)          # uniform levels/gamma pass
Denoising::denoise
UnsharpMask::localContrast
UnsharpMask::sharpen
balanceColors(img, d,d,d,d, Vector3d&, bool) # white balance + gamma  ← colour-critical
Conversion::convert
Contrast::autoContrast
```

`devignetting` and `debayer` run earlier in `imagePreprocessing` /
`debayering`. The gamma value comes from the camera struct (`[r12+0x140]`).

The second `balanceColors` takes the `Eigen::Vector3d` of white-balance gains;
the 5-double overload simply broadcasts one scalar into all three components
(a neutral pass).

### 3.5 Extract the colour math (`calcColorBalanceLookupTable`)

`processImageBayerBG` builds **one 256-entry LUT per channel** by calling
`calcColorBalanceLookupTable(table, 256, x0, gamma, whiteBalance[c], bool)`
three times (with `whiteBalance[0..2]` at `[r14]`, `[r14+8]`, `[r14+0x10]`),
then maps every pixel through its channel LUT.

Disassembling the LUT builder showed a `pow` call and a clamp. The decisive
clue was its hard-coded constants. We read them as little-endian doubles:

```python
import struct
def rd(off):
    with open('PanonoUPFConverter','rb') as f:
        f.seek(off); return struct.unpack('<d', f.read(8))[0]
# VA - 0x400000 = file offset
for va in [0x754fc0,0x754fc8,0x754fd0,0x754fd8,0x754fe0,0x754fe8]:
    print(hex(va), rd(va-0x400000))
```

```
0x754fc0 0.0031308      # sRGB linear-segment threshold
0x754fc8 12.92          # sRGB linear-segment slope
0x754fd0 1.055          # sRGB alpha
0x754fd8 0.055          # sRGB offset
0x754fe0 2.4            # sRGB gamma
0x754fe8 0.04045        # sRGB *decode* threshold (inverse direction)
```

These are precisely the **sRGB transfer-function constants**, confirming the
encode step.

> **`whiteBalance` is an *offset*, not a gain.** Disassembling the per-channel
> LUT builder and its RGB caller (`processImageRGB<uchar,3>`) shows the LUT is:
>
> ```
> calcColorBalanceLookupTable(table, 256, d1, d2=gamma, d3, gammaFlag):
>   v   = d1 / (255 - |d3|) · max(0, i - d3)        // per index i
>   out = gammaFlag && |gamma-0.41667|<0.001
>           ? sRGB_OETF(v)·255                       // exact sRGB piecewise
>           : (1.055·v^gamma - 0.055)·255            // generic
> ```
>
> and the caller passes **`d1 = m_c` (=1.0), `d3 = whiteBalance[c]`**. So even
> here the "white balance" enters only as `max(0, i - wb_c)` with `wb_c ≈
> 1.0–1.35` — a sub-1.5-level black offset, *not* a multiply.
>
> **Crucially, this whole LUT path runs on the truly-raw sensor mosaic** read
> via `PanonoRawReader::composeBayerComponents` — i.e. when the converter starts
> from raw sensor data. The `_red/_green/_blue` channel JPEGs *shipped inside
> the `.upf`* have already been through it on the camera: they are
> white-balanced **and** sRGB-encoded. So for our input we apply **none** of
> this — `blackLevel`, `colorMatrix`, `whiteBalance` and the sRGB encode are all
> already baked in. Emitting the demosaiced bytes directly reproduces the
> official output (MAE ≈6; §1). The sRGB constants above are real, but they
> describe the camera-side encode, not a step we should repeat.

---

## 4. UPF layout (for reference)

A `.upf` is a ZIP. Relevant entries:

| Entry | Contents |
| ----- | -------- |
| `manifest.json` | 36-camera calibration + colour params (see below) |
| `imageset0_cameraNN_red.jpg` etc. | half-res Bayer **channel** planes (full UPF) |
| `imageset0_cameraNN.jpg` | single combined JPEG (preview UPF) |
| `*_VignettingCoeffs.txt` | radial R/G/B gain profile |
| `LIS3DSH_ACCELEROMETER.dat` | IMU samples (gravity / horizon) |

`manifest.json` per-camera fields used by the converter:

| Field | Shape | Meaning |
| ----- | ----- | ------- |
| `intrinsicMatrix` | 3×3 | `[[fx,0,cx],[0,fy,cy],[0,0,1]]` |
| `rotationMatrix` | 3×3 | world→camera rotation |
| `translationVector` | 3×1 | per-camera translation (≈0) |
| `blackLevel` | int | sensor pedestal (e.g. `64`) — **already applied on camera; not used** |
| `colorMatrix` | 3×3 | colour-correction matrix (rows sum to 1) — **not applied** (worsens R/B post-demosaic) |
| `whiteBalance` | 3×1 | linear RGB gains — **already baked into the planes; do not re-apply** |
| `gamma` | double | camera-side encode gamma (≈`0.41667` = 1/2.4 ⇒ sRGB) — planes are already encoded |
| `vignettingCoeffs` | string | filename of the vignetting profile |
| `imageWidth` / `imageHeight` | int | full-image geometry (2064×1552) |
| `imageFormat` | string | e.g. `RAW_GR_8bit_JPEGcompressed` (GRBG) |

---

## 4b. The finishing chain (`ImageAdjustment::imageImprovement`)

After debayer/colour, the converter runs a fixed finishing chain. Disassembled
from `imageImprovement` (0x454560); all numeric constants resolved from
`.rodata`. Radii scale with image width `w` (reference 2064). Steps marked
*improve* run only when the improve flag is set (the converter sets it):

| Order | Call | Recovered parameters (at w=2064) | improve-gated |
| ----- | ---- | -------------------------------- | ------------- |
| 1 | `balanceColors(1,1,1, 1/γ=2.4, 0)` | neutral, **decode** (linearise) | no |
| 2 | `Denoising::denoise(N=3, 332.8, 2.0)` | NL-means-style | no |
| 3 | `UnsharpMask::localContrast(r, 0.0, 0.1)` | `r=max(10, w/2064·150)`, amount **0.1** | **yes** |
| 4 | `UnsharpMask::sharpen(r, 0.0, 0.9, 1024)` | `r=max(1, w/2064·3)`, amount **0.9**, thresh 1024 (16-bit) | no |
| 5 | `balanceColors(1,1,1, γ=0.4167, whiteBalance)` | **encode** (sRGB) + WB-offset | no |
| 6 | `Contrast::autoContrast(0.01, 0.01, 16)` | histogram + `expf`, clip 1% lo / 1% hi, 256 bins | **yes** |

Notes:
- Steps 1 and 5 are a **decode(γ2.4) → … → encode(sRGB)** sandwich, so denoise /
  local-contrast / sharpen operate in (approximately) linear light, and the net
  colour transform of the two `balanceColors` passes is ~identity.
- **`autoContrast` decoded exactly** (`Contrast::autoContrast_internal<uchar,3>`,
  0x47c110; constants from `.rodata`: `1.0`, sign-bit, `255.0`, `0.5`). It is a
  *black-point* operator, not a stretch:

  ```
  histMin[256], histMax[256]  // per-pixel min- and max-channel histograms
  lo = first idx where cumsum(histMin, asc)  ≥ clipLo·N   // 1% dark point
  hi = first idx where cumsum(histMax, desc) ≥ clipHi·N   // 1% bright point
  span   = max(hi - lo, 1)
  weight = exp(-k · (lo/span)²)            // k = 16; damps lift when the black
  offset = lo · weight                     //   point is high vs. the range
  scale  = (255 - offset) ≥ 1 ? 255/(255 - offset) : 255
  out    = round((v - offset)·scale)       // all channels equally; clamp [0,255]
  ```

  Because the white point stays at 255 and `scale ≥ 1`, it only ever lifts the
  black point (never reduces contrast). On our already-deep-black passthrough
  output it barely fires (`offset≈0`, `scale≈1`).

**What we implement** (`lib/finish-image.ts`): a faithful **`autoContrast`**
plus the two unsharp steps — **local contrast** (`r≈150`, amount 0.1) and
**unsharp sharpen** (`r≈3`, amount 0.9), `out = in + amount·(in − blur(in))` via
a 3-pass separable box-blur Gaussian (pure typed-array JS, identical in Node and
browser). We omit `denoise` (NL-means-ish). The whole chain is **off by
default** (`DemosaicOptions.finish`): on the passthrough output it adds
perceptual crispness but *lowers* numeric fidelity (MAE 6.0 → 9.3), since the
unsharp passes re-introduce contrast.

---

## 5. What we reproduce vs. omit

Our implementation targets **colour fidelity** to the official per-camera
output (MAE ≈6 of 255), not byte-exact equality.

| Stage | Official (raw-sensor path) | Us (UPF channel JPEGs) |
| ----- | -------- | -- |
| Bayer recombine (GRBG) | yes | yes |
| Demosaic | edge-directed (`debayerCustom`) + simple fallback | bilinear |
| Black level / colour matrix / WB / sRGB encode | yes (on raw sensor) | **none** — already baked into the shipped planes |
| Emit bytes | — | **passthrough** (planes are already display-referred) |
| Residual white-balance gain `[1.028,1.001,0.922]` | (implicit) | **opt-in** (`whiteGain`, off by default; MAE 6.0→4.66) |
| Devignetting | yes (per-camera radial gains) | server stitcher only (`lib/stitcher/vignetting.ts`) |
| Local contrast / unsharp sharpen | yes | implemented, **off by default** (lowers MAE; `finish`) |
| autoContrast | yes (black-point) | faithfully ported, **off by default** (`finish`) |
| Denoise | yes (NL-means-ish) | no |

Validated against `reference/demo-image/official-converted/` (36 cameras):
mean RGB ≈111/109/100 vs official ≈115/109/91, per-channel std ≈38/40/38 vs
≈39/41/39, **MAE 6.0** (→4.66 with the opt-in gain). The per-image affine floor
is ≈3.9, so the small residual is structural (demosaic / JPEG), not tone.

---

## 6. Open items / caveats

- **The planes are display-referred — this was the key insight.** Treating them
  as linear and applying our own sRGB OETF double-gammas the data: contrast
  roughly doubles (std ≈57 vs official ≈39) and the image brightens, giving
  MAE ≈26. The bare passthrough (no encode) gives std ≈38–40 and MAE ≈6. This
  also resolves the long-running "too dark / too contrasty" gap: it was the
  redundant sRGB encode, not a missing tone curve.
- **Channel identity is by filename**, so R↔B can't swap; the GRBG vs BGGR
  choice only affects demosaic sub-pixel alignment.
- **Residual warm white balance.** The bare passthrough is ~3 levels too blue /
  ~3 too low in red. A fixed gain `[1.028,1.001,0.922]` (std ≈0.02 across all 36
  cameras → it is a real systematic offset, not scene-dependent) closes most of
  it (MAE 6.0→4.66). It is fit to **one** reference capture, so it ships as the
  opt-in `whiteGain`/`REFERENCE_WHITE_GAIN`, off by default. Its origin is
  unconfirmed (it does not match the manifest `whiteBalance`).
- **Devignetting in the merge path.** `demosaicBayerPlanes` does not apply the
  radial vignetting profile (the server stitcher does, via
  `lib/stitcher/vignetting.ts`). This is the main remaining cause of corner
  brightness differences vs. the official per-camera JPEGs.

---

## 7. Source map

| Concept | Our code |
| ------- | -------- |
| Bayer recombine + demosaic + passthrough (+ optional `whiteGain` / `finish`) | `lib/merge-bayer-channels.ts` |
| Browser channel merge (viewer / PTGui export) | `lib/upf-client.ts` |
| Server stitcher camera load | `lib/stitcher/load-camera.ts` |
| Server PTGui ZIP export | `lib/stitcher/export-stitcher-zip.ts` |
| Browser PTGui ZIP export | `lib/export-stitcher-zip-client.ts` |
| Manifest types | `lib/manifest.ts` |
| Finishing chain (autoContrast + local contrast + unsharp) | `lib/finish-image.ts` |
| Backend UPF→JPEG batch (`WHITE_GAIN=1`, `FINISH=1`) | `scripts/upf-to-jpegs.ts` |
| Vignetting profile parse | `lib/stitcher/vignetting.ts` |
