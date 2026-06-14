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

3. **Linearise.** Subtract the per-camera `blackLevel` (sensor pedestal) and
   normalise: `lin = max(0, value - blackLevel) / (255 - blackLevel)`.

4. **Colour-correct.** Multiply the linear RGB by the per-camera 3×3
   `colorMatrix` (rows sum to 1, so neutrals are preserved).

5. **Encode.** Clamp to `[0,1]` and apply the standard **sRGB OETF**:

   ```
   out = v <= 0.0031308 ? 12.92*v : 1.055*v^(1/2.4) - 0.055   (×255, round)
   ```

> **Do NOT re-apply `whiteBalance`.** Validated against the official per-camera
> output in `reference/demo-image/official-converted/`, the channel planes are
> *already white-balanced by the camera*. Dividing a raw plane by its manifest
> `whiteBalance` gain yields a green-dominant signal — i.e. the un-balanced
> sensor data — confirming the planes are post-WB. Re-applying the
> `[1.354, 1, 1.277]`-style gains over-boosts red+blue and produces a
> magenta/pink, over-bright cast. The earlier *green* output came from emitting
> the linear planes with neither black-level nor sRGB encoding; the brief *pink*
> output came from double-applying white balance. The pipeline above matches the
> official converter (per-camera mean RGB within a few levels).

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

> **Binary vs. real data — the white-balance reconciliation.** The binary's
> `balanceColors` feeds the per-camera `whiteBalance` gains into the LUT, which
> implies WB is applied at convert time. But that path operates on the truly-raw
> sensor mosaic read via `PanonoRawReader::composeBayerComponents`. The channel
> JPEGs *shipped inside the `.upf`* are already white-balanced (verified against
> the official output — see [§1](#1-tldr--the-algorithm)), so for our input we
> must **not** re-apply the gains. What we *do* need from the manifest and the
> LUT path is the **black-level** subtraction, the **`colorMatrix`**, and the
> **sRGB** encode — the combination that reproduces the official per-camera
> images.

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
| `blackLevel` | int | sensor pedestal, subtracted on linearise (e.g. `64`) |
| `colorMatrix` | 3×3 | **colour-correction matrix, applied** to linear RGB (rows sum to 1) |
| `whiteBalance` | 3×1 | linear RGB gains — **already baked into the planes; do not re-apply** |
| `gamma` | double | per-camera encode gamma (≈`0.41667` = 1/2.4 ⇒ sRGB) |
| `vignettingCoeffs` | string | filename of the vignetting profile |
| `imageWidth` / `imageHeight` | int | full-image geometry (2064×1552) |
| `imageFormat` | string | e.g. `RAW_GR_8bit_JPEGcompressed` (GRBG) |

---

## 5. What we reproduce vs. omit

Our implementation targets **colour fidelity**, not byte-exact equality.

| Stage | Official | Us |
| ----- | -------- | -- |
| Bayer recombine (GRBG) | yes | yes |
| Demosaic | edge-directed (`debayerCustom`) + simple fallback | bilinear |
| Black-level subtract | yes | **yes** (`blackLevel`) |
| Colour matrix | yes | **yes** (`colorMatrix`) |
| sRGB encode | yes | **yes** |
| White balance | applied to true raw; **already baked into shipped planes** | **not re-applied** (would over-correct) |
| Devignetting | yes (per-camera radial gains) | server stitcher only (`lib/stitcher/vignetting.ts`) |
| Denoise / local-contrast / unsharp / auto-contrast | yes | no (cosmetic, not colour) |

Validated against `reference/demo-image/official-converted/` — per-camera mean
RGB matches within a few levels. Residual differences are the omitted finishing
passes (devignetting in the merge path, denoise, contrast/sharpen), not
hue/white-balance.

---

## 6. Open items / caveats

- **Channel identity is by filename**, so R↔B can't swap; the GRBG vs BGGR
  choice only affects demosaic sub-pixel alignment.
- **Gamma source.** The manifest exposes a per-camera `gamma` (≈0.41667 = 1/2.4);
  empirically the full sRGB piecewise curve matches the official output slightly
  better than a pure power, so we use the sRGB OETF.
- **Devignetting in the merge path.** `demosaicBayerPlanes` does not apply the
  radial vignetting profile (the server stitcher does, via
  `lib/stitcher/vignetting.ts`). This is the main remaining cause of corner
  brightness differences vs. the official per-camera JPEGs.
- **Black-level / white-point.** We normalise by `255 - blackLevel`. A true
  white level below 255 would change tone slightly; `255` matched best on the
  sample set.

---

## 7. Source map

| Concept | Our code |
| ------- | -------- |
| Bayer recombine + demosaic + black level + colour matrix + sRGB | `lib/merge-bayer-channels.ts` |
| Browser channel merge (viewer / PTGui export) | `lib/upf-client.ts` |
| Server stitcher camera load | `lib/stitcher/load-camera.ts` |
| Server PTGui ZIP export | `lib/stitcher/export-stitcher-zip.ts` |
| Browser PTGui ZIP export | `lib/export-stitcher-zip-client.ts` |
| Manifest types (`blackLevel`, `colorMatrix`, …) | `lib/manifest.ts` |
| Vignetting profile parse | `lib/stitcher/vignetting.ts` |
