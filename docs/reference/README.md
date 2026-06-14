# Reference material

## PTGui export

See **[ptgui-export.md](./ptgui-export.md)** — export `img1.jpg` … `img36.jpg` from the gallery (**PTGui ZIP**), then stitch in PTGui with a `.pts` template. Naming follows **[sihagm/makeRGB](https://github.com/sihagm/makeRGB)**.

## Maenpää et al. (2018) — Panono MPC calibration

**Title:** Modelling and automated calibration of a general multi-projective camera  
**Authors:** Ehsan Khoramshahi, Eija Honkavaara  
**Journal:** *The Photogrammetric Record*, vol. 33, no. 161, pp. 86–112  
**DOI:** [10.1111/phor.12230](https://onlinelibrary.wiley.com/doi/full/10.1111/phor.12230)

### Local copy

- **File:** [`maenpaeae-2018-multi-projective-camera-calibration.pdf`](./maenpaeae-2018-multi-projective-camera-calibration.pdf)
- **Source:** Open-access institutional repository copy (University of Helsinki HELDA), not the Wiley paywall.
- **Retrieved:** 2026-06-11

### Why this paper matters for this project

The Panono ball is treated as a **multi-projective camera (MPC)** with 36 fixed projective sensors. The paper validates that:

- Geometry is **rigid** — relative poses between the 36 lenses do not change shot-to-shot. This supports using `manifest.json` `intrinsicMatrix` + `rotationMatrix` directly for reprojection (what our stitcher and viewer do).
- Neighbouring camera pairs have **very small overlap (<10%)**, which makes seamless blending hard and explains visible seams or holes if weights are wrong.
- Per-camera specs (Explorer Edition): **2064×1552** sensors, focal length **~1900±30 px**, FOV **~57°±0.4°**, pixel pitch **~3.07 µm**.
- Cloud stitching produced **108 Mpixel** equirectangular output — non-metric, visualization-oriented.
- Calibration residuals were **~0.5 px** on average after bundle adjustment; object-space accuracy on the order of **mm** in a controlled room.

The paper does **not** document Panono's cloud stitcher, `vignetting_coeffs.txt`, or multiband blending — it focuses on photogrammetric **calibration** via bundle block adjustment. For stitch quality improvements we still rely on UPF sidecar files and image-processing literature.

### Citation

```bibtex
@article{khoramshahi2018modelling,
  title={Modelling and automated calibration of a general multi-projective camera},
  author={Khoramshahi, Ehsan and Honkavaara, Eija},
  journal={The Photogrammetric Record},
  volume={33},
  number={161},
  pages={86--112},
  year={2018},
  publisher={Wiley},
  doi={10.1111/phor.12230}
}
```
