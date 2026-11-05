/**
 * Headshot framing, identical to auth.quantt.ca's (public/index.html there), so a photo uploaded on either
 * site is saved the same way: a 600px square JPEG with the face centred across, its centre 47% down (room for
 * hair), and the face 36% of the frame wide. The face is found in the browser with MediaPipe BlazeFace
 * (vendored in public/vendor/mediapipe). Without a face it falls back to a square from the top middle.
 * Browser only. Keep the numbers in step with auth.quantt.ca.
 */
export const SIDE = 600;
const FACE_W = 0.36;
const FACE_Y = 0.47;
const BASE = "/vendor/mediapipe";

type Face = { x: number; y: number; w: number; h: number };
type Detector = { detect(c: HTMLCanvasElement): { detections: { boundingBox?: { originX: number; originY: number; width: number; height: number }; categories?: { score: number }[] }[] } };

let detector: Promise<Detector> | null = null;
function faceDetector(): Promise<Detector> {
  if (!detector) {
    detector = (async () => {
      const url = `${BASE}/vision_bundle.mjs`;
      const { FaceDetector } = await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ url);
      return FaceDetector.createFromOptions(
        { wasmLoaderPath: `${BASE}/wasm/vision_wasm_internal.js`, wasmBinaryPath: `${BASE}/wasm/vision_wasm_internal.wasm` },
        { baseOptions: { modelAssetPath: `${BASE}/blaze_face_short_range.tflite` }, runningMode: "IMAGE", minDetectionConfidence: 0.5 },
      ) as Promise<Detector>;
    })().catch((e) => {
      detector = null;
      throw e;
    });
  }
  return detector;
}

// BlazeFace (short range) looks at a 128px copy, so it misses small faces in big photos. Try the whole image,
// then the top-middle square, then overlapping half-size squares, and keep the biggest confident face.
async function detectIn(img: ImageBitmap, sx: number, sy: number, sw: number, sh: number): Promise<Face[]> {
  const k = Math.min(1, 640 / Math.max(sw, sh));
  const c = Object.assign(document.createElement("canvas"), { width: Math.round(sw * k), height: Math.round(sh * k) });
  c.getContext("2d")!.drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height);
  return (await faceDetector()).detect(c).detections.flatMap((d) => {
    const bb = d.boundingBox;
    return bb ? [{ x: sx + bb.originX / k, y: sy + bb.originY / k, w: bb.width / k, h: bb.height / k }] : [];
  });
}

async function findFace(img: ImageBitmap): Promise<Face | null> {
  try {
    const W = img.width, H = img.height, m = Math.min(W, H);
    const windows: [number, number, number, number][] = [[0, 0, W, H], [(W - m) / 2, H > W ? (H - m) * 0.15 : 0, m, m]];
    const h = m / 2;
    for (const fy of [0, 0.25, 0.5]) for (const fx of [0.25, 0, 0.5]) windows.push([(W - h) * (fx * 2), (H - h) * fy, h, h]);
    for (const w of windows) {
      const best = (await detectIn(img, ...w)).sort((x, y) => y.w * y.h - x.w * x.h)[0];
      if (best) return best;
    }
    return null;
  } catch (e) {
    console.warn("face detection unavailable", e);
    return null;
  }
}

export function cropBox(W: number, H: number, face: Face | null) {
  let side: number, cx: number, cy: number;
  if (face) { side = face.w / FACE_W; cx = face.x + face.w / 2; cy = face.y + face.h / 2; }
  else { side = Math.min(W, H); cx = W / 2; cy = FACE_Y * side + (H > W ? (H - side) * 0.15 : 0); }
  side = Math.min(side, W, H);
  const left = Math.max(0, Math.min(W - side, cx - side / 2));
  const top = Math.max(0, Math.min(H - side, cy - FACE_Y * side));
  return { left, top, side };
}

/** The photo, framed: a 600px square JPEG. Throws if the browser can't open it as an image. */
export async function cropHeadshot(f: Blob): Promise<Blob> {
  let img: ImageBitmap;
  try { img = await createImageBitmap(f); } catch { throw new Error("That isn't a JPEG, PNG or WebP image this browser can open."); }
  const { left, top, side } = cropBox(img.width, img.height, await findFace(img));
  const c = Object.assign(document.createElement("canvas"), { width: SIDE, height: SIDE });
  const g = c.getContext("2d")!;
  g.fillStyle = "#fff"; g.fillRect(0, 0, SIDE, SIDE);
  g.imageSmoothingQuality = "high";
  g.drawImage(img, left, top, side, side, 0, 0, SIDE, SIDE);
  const blob = await new Promise<Blob | null>((ok) => c.toBlob(ok, "image/jpeg", 0.88));
  if (!blob) throw new Error("Couldn't crop that photo.");
  return blob;
}
