// Gravity / horizon correction, ported from the official PanonoUPFConverter
// preview stitch (PreviewCalculator::chooseGravity + getGravityCorrectionMatrix).
//
// The converter averages the LIS3DSH accelerometer samples to a gravity vector
// and builds the rotation that maps it onto the panorama vertical axis
// (Eigen::Quaternion::setFromTwoVectors). That matrix levels the horizon.

export type Vec3 = [number, number, number];
export type Mat3 = number[][]; // row-major 3x3

/**
 * Parse LIS3DSH_ACCELEROMETER.dat.
 *
 * Layout (from the UPF + binary): tightly packed 16-byte records of four
 * little-endian float32 values: [timestamp, ax, ay, az]. Returns the mean
 * acceleration vector (the gravity direction in device frame), or null if the
 * buffer is empty/malformed.
 */
export function parseAccelerometerGravity(buf: Buffer | Uint8Array): Vec3 | null {
  const bytes = buf instanceof Buffer ? buf : Buffer.from(buf);
  const RECORD = 16;
  const n = Math.floor(bytes.length / RECORD);
  if (n === 0) return null;

  let sx = 0;
  let sy = 0;
  let sz = 0;
  for (let i = 0; i < n; i++) {
    const o = i * RECORD;
    sx += bytes.readFloatLE(o + 4);
    sy += bytes.readFloatLE(o + 8);
    sz += bytes.readFloatLE(o + 12);
  }
  const g: Vec3 = [sx / n, sy / n, sz / n];
  if (!Number.isFinite(g[0]) || !Number.isFinite(g[1]) || !Number.isFinite(g[2])) {
    return null;
  }
  const mag = Math.hypot(g[0], g[1], g[2]);
  if (mag < 1e-6) return null;
  return g;
}

function normalize(v: Vec3): Vec3 {
  const m = Math.hypot(v[0], v[1], v[2]);
  if (m < 1e-12) return [0, 0, 0];
  return [v[0] / m, v[1] / m, v[2] / m];
}

/**
 * Rotation matrix R such that R * a = b (both unit vectors), via the
 * Rodrigues form of Quaternion::setFromTwoVectors. Handles the parallel and
 * anti-parallel degenerate cases.
 */
export function rotationFromTo(aIn: Vec3, bIn: Vec3): Mat3 {
  const a = normalize(aIn);
  const b = normalize(bIn);
  const c = a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; // cos angle
  // v = a x b
  const v: Vec3 = [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
  const s = Math.hypot(v[0], v[1], v[2]); // sin angle

  if (s < 1e-9) {
    if (c > 0) return identity3(); // already aligned
    // anti-parallel: rotate 180 deg about any axis orthogonal to a
    const axis = Math.abs(a[0]) < 0.9 ? ([1, 0, 0] as Vec3) : ([0, 1, 0] as Vec3);
    const o = normalize([
      a[1] * axis[2] - a[2] * axis[1],
      a[2] * axis[0] - a[0] * axis[2],
      a[0] * axis[1] - a[1] * axis[0],
    ]);
    // R = 2*o*o^T - I
    return [
      [2 * o[0] * o[0] - 1, 2 * o[0] * o[1], 2 * o[0] * o[2]],
      [2 * o[1] * o[0], 2 * o[1] * o[1] - 1, 2 * o[1] * o[2]],
      [2 * o[2] * o[0], 2 * o[2] * o[1], 2 * o[2] * o[2] - 1],
    ];
  }

  // R = I + [v]x + [v]x^2 * (1 - c) / s^2  ;  with (1-c)/s^2 = 1/(1+c)
  const k = (1 - c) / (s * s);
  const vx = v[0];
  const vy = v[1];
  const vz = v[2];
  return [
    [1 + k * (-vz * vz - vy * vy), -vz + k * (vx * vy), vy + k * (vx * vz)],
    [vz + k * (vx * vy), 1 + k * (-vz * vz - vx * vx), -vx + k * (vy * vz)],
    [-vy + k * (vx * vz), vx + k * (vy * vz), 1 + k * (-vy * vy - vx * vx)],
  ];
}

export function identity3(): Mat3 {
  return [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
}

/**
 * Gravity-correction matrix that maps the measured gravity vector onto the
 * panorama "down" axis (-Y, since the +Y pole is the top row). Applying this to
 * sampling directions levels the horizon.
 */
export function gravityCorrectionMatrix(gravity: Vec3 | null): Mat3 {
  if (!gravity) return identity3();
  return rotationFromTo(gravity, [0, -1, 0]);
}

/** C = A * B (row-major 3x3). */
export function mat3Mul(a: Mat3, b: Mat3): Mat3 {
  const c: Mat3 = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      c[i]![j] = a[i]![0]! * b[0]![j]! + a[i]![1]! * b[1]![j]! + a[i]![2]! * b[2]![j]!;
    }
  }
  return c;
}
