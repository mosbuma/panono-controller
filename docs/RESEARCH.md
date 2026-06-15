# Panono, throwable panoramic cameras, Serveball/Squito, and related patents

**Prepared:** 2026-06-15  
**Scope:** Summary of the Panono camera’s technical/commercial history, notes on stitching/combining images, the related Steven J. Hollinger / Serveball / Squito prior-art cluster, source links, and patent lists.

> **Caveat:** Patent status notes below are based mainly on Google Patents labels, which Google itself describes as assumptions rather than legal conclusions. Treat this as a research note, not legal advice.

---

## 1. Executive summary

Panono grew out of Jonas Pfeil’s TU Berlin diploma-thesis project, the **Throwable Panoramic Ball Camera**. The prototype used **36 fixed-focus 2 MP mobile-phone camera modules** in a padded, ball-shaped enclosure. It used an accelerometer to estimate the top of the throw and trigger all cameras near the apogee, where motion blur and parallax problems were reduced.

The project was published as a **SIGGRAPH Asia 2011 Emerging Technologies** demo and later commercialized as **Panono**, a 36-camera spherical camera producing high-resolution full-spherical still panoramas. The commercial camera eventually became a **108 MP / 16K** panoramic camera whose images were stitched using Panono’s cloud service and an in-house stitching algorithm.

The commercial story is mixed. Panono was founded in 2012, crowdfunded on **Indiegogo** in late 2013 / early 2014, raised about **$1.25 million**, later raised about **€1.6 million** on Companisto, launched the **Explorer Edition** around 2015, shipped some units, but filed for insolvency in 2017. Its assets, trademarks, patents and operations were then restarted under **Professional360 GmbH**, with reporting that Bryanston Group AG was behind the acquisition.

The patent landscape is important because Panono was not alone. **Steven J. Hollinger / Serveball / Squito** has an earlier and broader patent cluster with priority dates back to 2009, covering throwable cameras, in-flight image capture, sensor-aided orientation/perspective normalization, stabilized video, target tracking, multi-camera networks, trajectory control, and throwable light sources. Squito is more about **continuous in-flight imagery and stabilized fly-by video**, while Panono is more about **simultaneous full-spherical still capture at the apex of a throw**.

On stitching specifically: the public Panono patents and papers do **not** disclose an implementation-grade stitching algorithm. They describe capture geometry, triggering, exposure, sensor use, and broad “composite image” creation. Jonas Pfeil’s own Panono page says the commercial product used an **in-house developed stitching algorithm**, but I did not find a paper publishing that algorithm. The most promising unavailable document is Pfeil’s 2010 diploma thesis, **“Throwable Camera Array for Capturing Spherical Panoramas.”**

---

## 2. Panono history and chronology

### 2010 — diploma thesis / prototype

Jonas Pfeil’s thesis project at the Computer Graphics Group, TU Berlin was titled **“Throwable Camera Array for Capturing Spherical Panoramas.”** The prototype was a throwable ball containing 36 fixed-focus 2 MP mobile-phone camera modules, a robust 3D-printed ball-shaped enclosure, foam padding, and an accelerometer. The idea was to solve common panorama problems: slow sequential capture, ghosting from moving objects, and the missing nadir/downward image caused by tripod mounts.

The prototype triggered near the top of a throw by integrating launch acceleration to estimate the rise time to the highest point. After catching the ball, images were downloaded over USB and displayed in a spherical viewer.

### 2011 — SIGGRAPH Asia Emerging Technologies

The prototype was published as:

> Jonas Pfeil, Kristian Hildebrand, Carsten Gremzow, Bernd Bickel, Marc Alexa, **“Throwable Panoramic Ball Camera,”** SIGGRAPH Asia 2011 Emerging Technologies, ACM, DOI: `10.1145/2073370.2073373`.

The demo abstract is only one page and does not describe a detailed stitching implementation. It mainly motivates the capture device: simultaneous multi-camera full-spherical capture at the apogee of a throw.

### 2012 — Panono GmbH founded

Panono GmbH was founded in Berlin by **Jonas Pfeil, Björn Bollensdorff and Qian Qin** to commercialize the thesis project. Jonas Pfeil’s later project page says Panono was created to commercialize the Throwable Panoramic Ball Camera and that he led software, electronics and mechanics development for the camera and cloud infrastructure.

### 2013 — Panono product and crowdfunding campaign

In November 2013, the redesigned commercial device appeared publicly as **Panono**. It was much smaller than the original prototype and shifted toward a consumer/product form factor. The crowdfunding campaign was on **Indiegogo**, not Kickstarter. Many articles casually describe it as “crowdfunding,” and it is easy to misremember it as Kickstarter, but the public campaign was Indiegogo.

Early campaign specifications and articles describe a **36-camera** ball producing **72 MP** spherical panoramas. Later commercial/review descriptions refer to **108 MP**, based on 36 × 3 MP modules.

### 2014 — Indiegogo success and production promises

Panono raised about **$1.25 million** on Indiegogo, widely reported as a record or major campaign from Germany. Around CES 2014, reports described 36 three-megapixel cameras, apex triggering, wireless transfer, and Panono cloud stitching. Planned pricing was often reported around **$500–$600** for pre-order/retail.

### 2015 — Companisto and Explorer Edition

Panono raised roughly **€1.6 million** through Companisto crowdinvesting. Product/fact-sheet sources and later reporting describe the **Panono Explorer Edition** as launched/available around September 2015. This edition was more expensive and more professional/early-access than the original consumer crowdfunding price.

### 2016 — product reviews and higher price positioning

By 2016, reviewers had working units and described the camera as unusually high-resolution but expensive and dependent on cloud stitching. Reports indicate that the Explorer Edition / regular camera was priced far above the original crowdfunding level, with figures around **$1,499 / €1,499** and later around **€2,140+**.

### 2017 — insolvency and asset sale

Panono GmbH filed for insolvency in May 2017. Reporting at the time said only a subset of Indiegogo backers had received cameras, often cited around **400 units**. The company’s dependence on cloud stitching meant that server continuity mattered for existing users.

In July 2017, reports said Panono’s trademarks, patents and assets were acquired, with the business restarted under **Professional360 GmbH** in Berlin. Gizmodo’s update named **Bryanston Group AG** as the Swiss private-equity firm behind the acquisition. 360Rumors interviewed Panono’s new leadership in September 2017, describing Panono as having emerged from bankruptcy reorganization with Professional360 GmbH as new owner.

### After 2017

The post-insolvency operation appears to have been aimed more at professional, high-resolution 360 photography, virtual tours, cloud hosting and related services than at the original mass-consumer “throwable camera ball” vision.

---

## 3. Technical concept: Panono versus Serveball/Squito

### Panono / Throwable Panoramic Ball Camera

Core technical idea:

- Spherical/ball-shaped camera.
- 36 outward-facing camera modules.
- Full solid-angle / full-spherical coverage.
- Simultaneous capture to avoid ghosting in scenes with moving objects.
- Accelerometer-based trigger near apogee.
- Image combination into a spherical panorama.
- Later commercial workflow: upload/transfer images to Panono Cloud for stitching and viewing.

The Panono approach tries to make the panorama problem easier by controlling capture: all views are acquired at essentially the same moment, from a compact multi-camera array, ideally with little motion at the highest point of the throw.

### Serveball / Squito / Hollinger

Core technical idea:

- Throwable camera or ball-shaped camera.
- Operates during airborne trajectory, not only at landing or at a single apex moment.
- Uses position/orientation sensors, IMU and/or other flight data.
- Can select, rotate, scale and normalize images based on the camera’s in-flight pose.
- Can produce stabilized video, panoramic imagery, fly-by/fly-through video, target tracking, multi-camera/image networks, and related sensor/lamp accessories.

Serveball/Squito is broader and earlier as a patent family. It is less narrowly focused on “capture one high-resolution full-spherical still at apogee” and more focused on **sensor-aided image/video processing over a trajectory**.

---

## 4. What the sources say about stitching / image combining

### Panono

The Panono public research paper and patent material does **not** provide a detailed stitching algorithm. It mostly says that the individual images are assembled or composed according to existing panoramic-photography methods.

Useful facts that are public:

- The thesis/demo abstract motivates simultaneous capture as a way to avoid ghosting from moving objects.
- The thesis/demo abstract says images were downloaded and shown in a spherical viewer.
- Jonas Pfeil’s Panono page states that Panono Cloud used an **in-house developed stitching algorithm**.
- The commercial product depended on cloud stitching; this is noted in multiple reviews/articles.
- The patents discuss camera placement, trigger timing, rotation-rate limits, gravity-vector/orientation handling, exposure measurement, and related capture conditions, but not a full feature-matching/blending pipeline.

Likely implementation ingredients, inferred from standard panoramic stitching practice and Pfeil’s software list:

- Fixed rig calibration for 36 cameras.
- Lens distortion correction.
- Projection of each camera image onto a sphere/equirectangular output.
- Overlap alignment, probably using a mix of known rig geometry and image-based refinement.
- Exposure compensation across cameras.
- Seam selection and blending.
- Horizon/gravity correction from sensors.

This is an inference, not a disclosed Panono algorithm.

### Serveball/Squito

Hollinger’s patents contain more algorithmic language than Panono’s, especially around:

- Pairing captured images with flight/orientation data.
- Selecting images based on desired perspective or subject.
- Rotation, offset and scaling transformations.
- Perspective normalization.
- Stitching neighboring edges.
- Producing fly-by video or panoramic video from a spinning/spiraling throwable camera.
- Using networks of thrown cameras to combine multi-source image and sensor data.

However, these are still patent-level process descriptions, not implementation-grade computer-vision recipes. They do not appear to disclose a complete modern stitching pipeline such as SIFT/ORB feature extraction, RANSAC homographies, bundle adjustment, graph-cut seams and multiband blending.

### Publications found for Jonas Pfeil

Found:

- **Throwable Panoramic Ball Camera**, SIGGRAPH Asia 2011 Emerging Technologies.
- **Throwable Camera Array for Capturing Spherical Panoramas**, diploma thesis, 2010 — referenced publicly by Jonas Pfeil, but I did not find a public full-text PDF.

Not found:

- A standalone paper by Jonas Pfeil or Panono publishing the Panono commercial stitching algorithm.
- Source code for the Panono cloud stitcher.

---

## 5. Patent list — Panono / Jonas Pfeil

### Panono utility patent family 1: throwable panoramic capture / apogee triggering


| Publication                                                               | Title / role                                              | Notes                                                                                                                                                                                |
| ------------------------------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [US9531951B2](https://patents.google.com/patent/US9531951B2/en)           | Camera system for recording images, and associated method | Core Panono/Jonas Pfeil patent. Multiple cameras covering a composite image; motion profile/sensor-based triggering; apogee triggering. Google Patents status: expired, fee-related. |
| [US20140111608A1](https://patents.google.com/patent/US20140111608A1/en)   | Application version of US9531951B2                        | Same family.                                                                                                                                                                         |
| [WO2012149926A1](https://patents.google.com/patent/WO2012149926A1/en)     | International publication                                 | Same family.                                                                                                                                                                         |
| [EP2705656A1](https://patents.google.com/patent/EP2705656A1/en)           | European publication                                      | Same family.                                                                                                                                                                         |
| [DE102011109990A1](https://patents.google.com/patent/DE102011109990A1/en) | German publication                                        | Same family.                                                                                                                                                                         |
| [DE202011111046U1](https://patents.google.com/patent/DE202011111046U1/en) | German utility model                                      | Same family / related protection.                                                                                                                                                    |
| [CN103636190A](https://patents.google.com/patent/CN103636190A/en)         | Chinese publication                                       | Same family.                                                                                                                                                                         |
| [JP2014519232A](https://patents.google.com/patent/JP2014519232A/en)       | Japanese publication                                      | Same family.                                                                                                                                                                         |
| [KR20140022056A](https://patents.google.com/patent/KR20140022056A/en)     | Korean publication                                        | Same family.                                                                                                                                                                         |


### Panono utility patent family 2: commercial spherical camera construction


| Publication                                                             | Title / role                                           | Notes                                                                                                                                                                                                     |
| ----------------------------------------------------------------------- | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [US10187555B2](https://patents.google.com/patent/US10187555B2/en)       | Camera system for capturing images and methods thereof | Later Panono/Amaryllis family. Physical camera architecture: encasement, camera modules, protective covers, shock reduction, wiring, support structure, etc. Google Patents status: expired, fee-related. |
| [US20170331986A1](https://patents.google.com/patent/US20170331986A1/en) | Application version of US10187555B2                    | Same family.                                                                                                                                                                                              |
| [WO2016059470A1](https://patents.google.com/patent/WO2016059470A1/en)   | International publication                              | Same family.                                                                                                                                                                                              |
| [EP3207695A1](https://patents.google.com/patent/EP3207695A1/en)         | European publication                                   | Same family.                                                                                                                                                                                              |


### Panono design patents


| Publication                                                     | Title / role     | Notes                                                                                                                 |
| --------------------------------------------------------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------- |
| [USD745076S1](https://patents.google.com/patent/USD745076S1/en) | Camera           | US design patent for ornamental camera appearance. Google Patents status: active; anticipated expiry 2029-12-08.      |
| [USD768750S1](https://patents.google.com/patent/USD768750S1/en) | Throwable camera | US design patent for throwable camera appearance. Previously found in Google Patents; link included for completeness. |


---

## 6. Patent list — Steven J. Hollinger / Serveball / Squito

### Utility patents


| Publication                                                       | Title / role                                                                         | Notes                                                                                                                                                   |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [US8237787B2](https://patents.google.com/patent/US8237787B2/en)   | Ball with camera and trajectory control for reconnaissance or recreation             | Foundational Hollinger ball-camera patent. Priority 2009-05-02; granted 2012-08-07. Google Patents status: expired, fee-related.                        |
| [US8477184B2](https://patents.google.com/patent/US8477184B2/en)   | Ball with camera and trajectory control for reconnaissance or recreation             | Continuation; granted 2013-07-02. Sensor-aided orientation/perspective handling, stitched panoramas/video. Google Patents status: expired, fee-related. |
| [US9144714B2](https://patents.google.com/patent/US9144714B2/en)   | Ball with camera for reconnaissance or recreation and network for operating the same | Networked throwable/ball cameras; image/orientation capture and processing. Google Patents status: expired, fee-related.                                |
| [US9219848B2](https://patents.google.com/patent/US9219848B2/en)   | Ball with camera for reconnaissance or recreation                                    | Orientation-triggered camera capture, image rotation, embedded processing and stitching. Google Patents status: expired, fee-related.                   |
| [US9237317B2](https://patents.google.com/patent/US9237317B2/en)   | Throwable camera and network for operating the same                                  | Broadens from ball to throwable camera/network concepts. Google Patents status: expired, fee-related.                                                   |
| [US9341357B2](https://patents.google.com/patent/US9341357B2/en)   | Throwable light source and network for operating the same                            | Companion throwable visible/IR light-source network. Google Patents status: expired, fee-related.                                                       |
| [US9687698B2](https://patents.google.com/patent/US9687698B2/en)   | Throwable cameras and network for operating the same                                 | Network of throwable cameras; client device receives images/sensor data and processes panoramas/video. Google Patents status: expired, fee-related.     |
| [US9692949B2](https://patents.google.com/patent/US9692949B2/en)   | Ball with trajectory control for reconnaissance or recreation                        | Deformable exterior / shifted center-of-mass concepts for trajectory control. Google Patents status: expired, fee-related.                              |
| [US9983460B2](https://patents.google.com/patent/US9983460B2/en)   | Throwable light source and network for operating the same                            | Later throwable light-source patent. Google Patents status: expired, fee-related.                                                                       |
| [US10218885B2](https://patents.google.com/patent/US10218885B2/en) | Throwable cameras and network for operating the same                                 | Later networked throwable-camera patent. Google Patents status: expired, fee-related.                                                                   |


### Design patents


| Publication                                                     | Title / role                       | Notes                                                                            |
| --------------------------------------------------------------- | ---------------------------------- | -------------------------------------------------------------------------------- |
| [USD690344S1](https://patents.google.com/patent/USD690344S1/en) | Housing for a plurality of cameras | Squito/Serveball multi-camera housing design. Listed in Serveball/SJH portfolio. |
| [USD745910S1](https://patents.google.com/patent/USD745910S1/en) | Camera housing                     | Serveball/Hollinger design patent. Listed in Serveball/SJH portfolio.            |
| [USD833503S1](https://patents.google.com/patent/USD833503S1/en) | Spherical camera                   | Serveball/Hollinger design patent. Listed in Serveball/SJH portfolio.            |


---

## 7. Links discovered / used

### Panono / Jonas Pfeil / original research

- [Panono Wikipedia page](https://en.wikipedia.org/wiki/Panono)
- [Jonas Pfeil — Throwable Panoramic Ball Camera](https://www.jonaspfeil.de/ballcamera/)
- [Jonas Pfeil — Panono Camera](https://www.jonaspfeil.de/panono/)
- [Jonas Pfeil — Contact / short bio](https://www.jonaspfeil.de/contact/)
- [SIGGRAPH Asia 2011 demo abstract PDF](https://www.jonaspfeil.de/static/2011_pfeil_throwable-panoramic-ball-camera_demo-abstract.40de8b8d.pdf)
- [ISTA Research Explorer record: Throwable panoramic ball camera](https://research-explorer.ista.ac.at/record/2100)
- [YouTube: Throwable Panoramic Ball Camera](https://www.youtube.com/watch?v=Th5zlUe6gOE)
- [Core77: Jonas Pfeil & Team’s Amazing Throwable Panoramic Ball Camera](https://www.core77.com/posts/20812/Jonas-Pfeil-n-Teams-Amazing-Throwable-Panoramic-Ball-Camera)
- [Popular Photography: New Gear: The Throwable Panoramic Ball Camera](https://www.popphoto.com/gear/2011/10/new-gear-throwable-panoramic-ball-camera/)
- [Adafruit blog: Throwable Panoramic Ball Camera](https://blog.adafruit.com/2011/10/18/throwable-panoramic-ball-camera/)
- [Designboom: throwable panoramic ball camera](https://www.designboom.com/design/throwable-panoramic-ball-camera/)
- [Laughing Squid: Throwable Ball Camera Captures Spherical Panoramas](https://laughingsquid.com/throwable-ball-camera-captures-spherical-panoramas/)

### Panono commercial / crowdfunding / reviews / insolvency

- [Indiegogo: Panono Panoramic Ball Camera campaign comments page](https://www.indiegogo.com/en/projects/panonogmbh/panono-panoramic-ball-camera/comments)
- [New Atlas: Crowdfunding launch for the Panono throwable panorama camera](https://newatlas.com/panono-throwable-panorama-camera/29761/)
- [Wired: This Throwable Camera Ball Snaps 360-Degree Aerial Photos](https://www.wired.com/2014/01/panono-ball)
- [TIME: Meet Panono, the All-Seeing Camera You Toss in the Air](https://time.com/3808860/meet-panono-the-all-seeing-camera-you-toss-in-the-air/)
- [PetaPixel: Throwable ‘Panono’ Camera Ball Captures Interactive 360-Degree Images Mid-Air](https://petapixel.com/2013/11/12/panono-camera-ball-captures-360-degree-images-mid-air/)
- [Gizmodo: The Throwable, Panoramic Ball Cam Is Finally Here](https://gizmodo.com/the-throwable-panoramic-ball-cam-is-finally-here-and-i-1462751744)
- [DPReview: Makers of the Panono 108MP 360-degree camera filing for bankruptcy](https://www.dpreview.com/news/3264236360/makers-of-the-panono-108mp-360-degree-camera-filing-for-bankruptcy)
- [DPReview: Panono buyer saves the brand](https://www.dpreview.com/news/8791899020/panono-buyer-saves-the-brand-will-continue-making-its-360-ball-camera)
- [Gizmodo: Cursed Throwable Camera Is Finally Dead After Six Years of Toil](https://gizmodo.com/cursed-throwable-camera-is-finally-dead-after-six-years-1796642160)
- [360Rumors: Panono files for bankruptcy; now what?](https://360rumors.com/panono-files-bankruptcy-now/)
- [360Rumors: The Future of PANONO — interview with new leadership](https://360rumors.com/the-future-of-panono-an-exclusive-interview-with-panonos-new-leadership/)
- [Digital Trends: Panono may have a new owner after bankruptcy left backers empty handed](https://www.digitaltrends.com/photography/panono-360-camera-new-owners/)
- [The Verge: Panono is another example of a successful crowdfunding project that failed](https://www.theverge.com/2017/7/8/15941264/panono-camera-bought-three-years-after-raising-1-million-indiegogo)
- [Gust: Panono GmbH company profile](https://gust.com/companies/panono)
- [ePHOTOzine: Panono to begin shipping in Spring](https://www.ephotozine.com/article/panono-to-begin-shipping-in-spring--26406)
- [360Rumors: Price increase and name change for Panono camera](https://360rumors.com/price-increase-and-name-change-for/)
- [Appgefahren: Panono Explorer Edition review](https://www.appgefahren.de/panono-explorer-edition-360-grad-kamera-test-172786.html)
- [Panono Explorer Edition fact sheet PDF via Centralpoint](https://cdn.centralpoint.nl/objects/pdf/6/62c/1349821575_1_document-cameras-panono-explorer-edition-360-panoramakamera-pan000241.pdf)
- [Panono Explorer Edition datasheet PDF via Conrad](https://asset.conrad.com/media10/add/160267/c1/-/de/001486296DS01/datasheet-1486296-panono-explorer-edition-360-vision-camera-108-mp-black-wi-fi.pdf)

### Serveball / Squito / Steven J. Hollinger

- [Serveball home](https://www.serveball.com/)
- [Steve Hollinger / SJH portfolio page](https://www.sjh.com/res/inv/ball.php)
- [Serveball press release, 2012: US8237787](https://www.serveball.com/press/ballcamera_20120821/ballcamera_20120821_pat8237787.php)
- [Serveball press release, 2013: US8477184](https://www.serveball.com/press/ballcamera_20130708/ballcamera_20130708_pat8477184.php)
- [New Atlas: Squito throwable camera prototype](https://newatlas.com/squito-throwable-camera/28223/)
- [PetaPixel: Squito throwable panoramic camera ball](https://petapixel.com/2013/07/09/squito-a-throwable-panoramic-camera-ball-that-captures-360-degree-shots/)
- [Laughing Squid: Squito, A Baseball-Sized Throwable Panoramic Camera](https://laughingsquid.com/squito-a-baseball-sized-throwable-panoramic-camera/)
- [LensVid: Squito — the Throwable Panoramic Camera](https://lensvid.com/gear/squito-the-throwable-panoramic-camera/)
- [SlashGear: Throwable Ball Camera For Fly-By Video Patented](https://www.slashgear.com/throwable-ball-camera-for-fly-by-video-patented-by-inventor-04245951/)

### General panorama / stitching algorithm references

- [Richard Szeliski — Image Alignment and Stitching: A Tutorial](https://pages.cs.wisc.edu/~dyer/cs534/papers/szeliski-alignment-tutorial.pdf)
- [Brown & Lowe — Automatic Panoramic Image Stitching using Invariant Features](https://link.springer.com/article/10.1007/s11263-006-0002-3)
- [Google Photo Sphere XMP metadata documentation](https://developers.google.com/streetview/spherical-metadata)

### Related modern throwable-camera context, not Panono/Serveball

- [MIT News: Bounce Imaging throwable tactical camera gets commercial release](https://news.mit.edu/2015/throwable-tactical-camera-bounce-imaging-0626)
- [Bounce Imaging: thermal 360 throwable camera announcement](https://bounceimaging.com/worlds-first-thermal-360-throwable-camera-revealed-at-ntoa/)

---

