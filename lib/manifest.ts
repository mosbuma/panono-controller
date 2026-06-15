// Subset of the Panono UPF manifest.json we rely on for projection.

export interface ManifestCamera {
  id: number;
  imageFilenames: string[];
  imageWidth: number;
  imageHeight: number;
  /** 3x3 [[fx,0,cx],[0,fy,cy],[0,0,1]] */
  intrinsicMatrix: number[][];
  /** 3x3 world->camera rotation. */
  rotationMatrix: number[][];
  translationVector: number[];
  /**
   * Per-camera black level (sensor pedestal). Already applied on-camera to the
   * shipped channel planes, so NOT used by our pipeline (see
   * lib/merge-bayer-channels.ts). Reference/metadata only.
   */
  blackLevel?: number;
  /**
   * Per-camera 3x3 colour-correction matrix (rows sum to 1, neutral-
   * preserving). NOT applied — the shipped planes are already display-referred,
   * and applying it post-demosaic worsens R/B. Reference/metadata only.
   */
  colorMatrix?: number[][];
  /**
   * Per-camera linear RGB white-balance gains [r, g, b]. NOTE: the channel
   * planes are already white-balanced by the camera, so these must NOT be
   * re-applied during demosaicing. Kept for reference/metadata only.
   */
  whiteBalance?: number[];
}

export interface ManifestImageSet {
  cameras: ManifestCamera[];
}

export interface UpfManifest {
  defaultSetId: number;
  fileType: string;
  imageSets: ManifestImageSet[];
  geoTag?: { latitude: number; longitude: number };
  version?: string;
}
