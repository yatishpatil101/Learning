import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, 'dist/third-party/uploads');
const cache = path.join(root, 'node_modules/.cache/upload-sources');
await mkdir(output, { recursive: true });
await mkdir(cache, { recursive: true });

// Ship matching source archives, not only a link whose host could disappear after deployment.
const sources = [
  ['heic-to-1.5.2.tar.gz', 'https://codeload.github.com/hoppergee/heic-to/tar.gz/refs/tags/v1.5.2'],
  ['libheif-1.22.2.tar.gz', 'https://codeload.github.com/strukturag/libheif/tar.gz/refs/tags/v1.22.2'],
  ['libde265-1.0.16.tar.gz', 'https://codeload.github.com/strukturag/libde265/tar.gz/refs/tags/v1.0.16'],
  ['GPL-3.0.txt', 'https://raw.githubusercontent.com/gcc-mirror/gcc/releases/gcc-15.2.0/COPYING3'],
];
const manifest = [];
for (const [name, url] of sources) {
  const cached = path.join(cache, name);
  let bytes;
  try { bytes = await readFile(cached); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    if (!response.ok) throw new Error(`Unable to package ${name}: HTTP ${response.status}`);
    bytes = Buffer.from(await response.arrayBuffer());
    await writeFile(cached, bytes);
  }
  await writeFile(path.join(output, name), bytes);
  manifest.push({ name, url, sha256: createHash('sha256').update(bytes).digest('hex') });
}
for (const name of ['heic-to', 'browser-image-compression', 'pdf-lib']) {
  const license = name === 'pdf-lib' ? 'LICENSE.md' : 'LICENSE';
  await copyFile(path.join(root, 'node_modules', name, license), path.join(output, `${name}-LICENSE.txt`));
}
const integration = path.join(output, 'integration');
await mkdir(integration, { recursive: true });
for (const name of ['image.worker.js', 'imageDimensions.js', 'pdf.worker.js', 'prepareUpload.js', 'policy.js']) {
  await copyFile(path.join(root, 'src/lib/uploads', name), path.join(integration, name));
}
await writeFile(path.join(output, 'sources.json'), JSON.stringify(manifest, null, 2));
await writeFile(path.join(output, 'README.txt'), `Upload processing libraries

heic-to 1.5.2: Copyright Hopper Gee; LGPL-3.0-or-later.
Includes libheif 1.22.2 and libde265 1.0.16. See their bundled source archives
for complete copyright notices, individual component licenses and build scripts.
browser-image-compression 2.0.2 and pdf-lib 1.17.1: MIT; notices are included here.

The HEIC library is an unmodified, separately loaded JavaScript asset in /assets/.
It is loaded only for HEIC/HEIF files, not merged into the application's code.
See heic-to's README and esbuild.mjs in its archive for rebuilding the JS wrapper.
The CSP decoder recipe uses libheif's build-emscripten.sh with
LIBDE265_VERSION=1.0.16 USE_UNSAFE_EVAL=0 USE_WASM=0.

The integration/ directory contains the corresponding upload-worker source.
Rebuild it using Vite 6 and the pinned library versions above. Its ?url import
keeps the decoder separate. To use a compatible modified decoder, replace that
separate heic-to asset while preserving its exported heicTo bitmap API, or update
the import to the rebuilt decoder and rebuild the worker. Clear browser caches.
No integrity check or application code prevents replacement of that library.

The LGPL permits modifying/replacing the library and reverse engineering the
combined work for debugging such modifications; no application terms restrict
those rights. See heic-to-LICENSE.txt and GPL-3.0.txt for the governing terms.
Source archive origins and SHA-256 checksums are recorded in sources.json.
`);
console.info('Packaged upload library notices and corresponding sources.');