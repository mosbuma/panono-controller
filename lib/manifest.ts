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
