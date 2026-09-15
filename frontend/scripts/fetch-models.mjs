/* Downloads the two machine-learning models identity verification runs in the browser, and
 * verifies them against pinned SHA-256 digests.
 *
 * Why a script instead of committing them: together they are 6.5 MB of binary that every clone
 * and every `git fetch` would carry forever, for files no build step reads and no diff can ever
 * show meaningfully. They are frozen upstream artefacts, so fetching them is reproducible in a
 * way that vendoring is not cheaper than.
 *
 * Why self-hosted rather than a CDN <script>/fetch at runtime: a CDN copy would tell a third
 * party the moment someone begins an identity check, and serving them from our own origin is what
 * lets the Content-Security-Policy keep `connect-src 'self'` with no outside host named. See
 * public/_headers, and src/lib/identity-verification/{ocr,face}.js.
 *
 * Why the digests are not optional: a truncated download, a captive-portal login page or an S3
 * error document all produce a file that exists, builds green and deploys green. The failure then
 * surfaces only in a user's browser, where a bad language model leaves emscripten's abort()
 * unable to settle the recognize promise and verification hangs until the 45s deadline. The hash
 * is the only check that runs before that becomes someone else's problem.
 *
 * Runs automatically from `prebuild` and `predev`. Safe and near-instant to re-run: a file whose
 * digest already matches is left alone and never re-fetched.
 *
 * Usage:  node scripts/fetch-models.mjs
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));

/* Provenance, licence and upstream project for both files are recorded in
 * public/third-party/models.txt, which ships to users. Keep the two in step. */
const MODELS = [
  {
    target: 'public/tessdata/eng.traineddata.gz',
    // Pinned to a tessdata_best 4.0.0 build. tesseract.js reads it via its langPath option.
    url: 'https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz',
    sha256: '45b4cb346724ac1774f1c36f42f182b887bcdb28ebe63e6fff90ac41f3fcff91',
  },
  {
    target: 'public/models/face_landmarker.task',
    // Pinned to float16 revision 1, never '/latest/': the model deciding whether a selfie shows a
    // live face must not be able to change without a commit.
    url: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
    sha256: '64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff',
  },
];

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function readIfMatching(file, sha256) {
  try {
    const bytes = await readFile(file);
    return digest(bytes) === sha256 ? bytes : null;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function download(url, sha256) {
  const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${url}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const actual = digest(bytes);
  if (actual !== sha256) {
    // Refuse to write it. A wrong file on disk would be picked up by the next run's hash check,
    // but it would also be served by a `vite dev` started in between.
    throw new Error(`Digest mismatch for ${url}\n  expected ${sha256}\n  received ${actual}`);
  }
  return bytes;
}

for (const { target, url, sha256 } of MODELS) {
  const file = path.join(root, target);
  const name = path.basename(target);

  if (await readIfMatching(file, sha256)) {
    console.log(`= ${name} already present and verified`);
    continue;
  }

  // A shared cache across working copies and between a cleaned public/ and the next build, so a
  // re-run after `git clean` costs nothing.
  const cached = path.join(root, 'node_modules/.cache/models', name);
  let bytes = await readIfMatching(cached, sha256);

  if (bytes) {
    console.log(`+ ${name} restored from cache`);
  } else {
    console.log(`. ${name} downloading...`);
    bytes = await download(url, sha256);
    await mkdir(path.dirname(cached), { recursive: true });
    await writeFile(cached, bytes);
  }

  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, bytes);
  console.log(`+ ${name} written to ${target} (${bytes.length.toLocaleString()} bytes)`);
}
