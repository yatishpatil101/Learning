// The task runner loads its wasm glue with a script tag, so a CDN copy dies on script-src 'self'.
// Bundling it also keeps the runtime on the same version as the package we install.
import wasmBinaryPath from '@mediapipe/tasks-vision/vision_wasm_internal.wasm?url';
import wasmLoaderPath from '@mediapipe/tasks-vision/vision_wasm_internal.js?url';

// Pinned float16/1 and self-hosted: listing storage.googleapis.com in connect-src would make any
// GCS bucket an approved POST destination, and '/latest/' could swap the model under us.
const LANDMARKER_MODEL = '/models/face_landmarker.task';

let taskPromise;

async function createLandmarker() {
  const { FaceLandmarker } = await import('@mediapipe/tasks-vision');
  return FaceLandmarker.createFromOptions({ wasmLoaderPath, wasmBinaryPath }, {
    baseOptions: { modelAssetPath: LANDMARKER_MODEL },
    runningMode: 'VIDEO',
    numFaces: 1,
    outputFaceBlendshapes: true,
    outputFacialTransformationMatrixes: false,
    minFaceDetectionConfidence: 0.5,
    minFacePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });
}

export function loadFaceLandmarker() {
  // Cache the promise for one landmarker per session, but forget a rejected one: caching that
  // would make a single bad fetch permanent, replaying the same failure on every later attempt.
  if (!taskPromise) {
    taskPromise = createLandmarker().catch((error) => {
      taskPromise = null;
      throw error;
    });
  }
  return taskPromise;
}

function blendScore(result, key) {
  const categories = result?.faceBlendshapes?.[0]?.categories || [];
  const match = categories.find((item) => item.categoryName === key);
  return match?.score || 0;
}

function headTurn(result) {
  const landmarks = result?.faceLandmarks?.[0];
  if (!landmarks?.length) return 0;
  const leftEye = landmarks[33];
  const rightEye = landmarks[263];
  const nose = landmarks[1];
  if (!leftEye || !rightEye || !nose) return 0;
  const eyeSpan = Math.max(0.001, Math.abs(rightEye.x - leftEye.x));
  const midEye = (leftEye.x + rightEye.x) / 2;
  return (nose.x - midEye) / eyeSpan;
}

function faceBox(landmarks) {
  const xs = landmarks.map((point) => point.x);
  const ys = landmarks.map((point) => point.y);
  return {
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
    centerX: (Math.max(...xs) + Math.min(...xs)) / 2,
    centerY: (Math.max(...ys) + Math.min(...ys)) / 2,
  };
}

export function readSelfieGuidance(result, stage) {
  const landmarks = result?.faceLandmarks?.[0];
  if (!landmarks?.length) return { ok: false, message: 'No face yet. Bring it into the oval.' };
  const box = faceBox(landmarks);
  // 0.18, not 0.22: a laptop webcam sits an arm's length away, and 0.22 forced an uncomfortable
  // lean-in for a face that was perfectly readable. The stages still have to pass on top of this.
  if (box.width < 0.18 || box.height < 0.18) return { ok: false, message: 'A bit closer — fill more of the oval.' };
  if (box.width > 0.62 || box.height > 0.72) return { ok: false, message: 'Back off slightly.' };
  if (Math.abs(box.centerX - 0.5) > 0.12 || Math.abs(box.centerY - 0.58) > 0.16) {
    return { ok: false, message: 'Centre up — chin inside the oval.' };
  }

  if (stage === 'smile') {
    const smile = Math.max(blendScore(result, 'mouthSmileLeft'), blendScore(result, 'mouthSmileRight'));
    return smile > 0.25 ? { ok: true, message: 'Got the smile.' } : { ok: false, message: 'Give us a smile.' };
  }

  const turn = headTurn(result);
  if (stage === 'left') return turn > 0.08 ? { ok: true, message: 'Got it.' } : { ok: false, message: 'Turn your head left.' };
  if (stage === 'right') return turn < -0.08 ? { ok: true, message: 'Got it.' } : { ok: false, message: 'Now turn your head right.' };
  return { ok: true, message: 'Hold it there.' };
}