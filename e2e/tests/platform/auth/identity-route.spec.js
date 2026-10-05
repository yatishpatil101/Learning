import { test, expect } from '../../../fixtures/live.js';
import { API, authHeaders } from '../../../helpers/liveAuth.js';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAARElEQVR4AeyROw0AIAxEL5WADzSw4AcRaGLBDzqKg7uhS4c2eVOTy33snemMtrYzDMErASBBB/0OMNTKCSIoi+pfEYAPAAD//68o26gAAAAGSURBVAMAR8QwUeUtYucAAAAASUVORK5CYII=', 'base64');

async function stubCamera(page, { deny = false, failFirst = 0 } = {}) {
  await page.addInitScript(({ png, denyStream, failCount }) => {
    const bytes = Uint8Array.from(atob(png), (char) => char.charCodeAt(0));
    let calls = 0;
    window.__cameraCalls = () => calls;
    navigator.mediaDevices ??= {};
    navigator.mediaDevices.getUserMedia = async () => {
      calls += 1;
      if (denyStream || calls <= failCount) {
        throw new DOMException('Permission denied', 'NotAllowedError');
      }
      const canvas = document.createElement('canvas');
      canvas.width = 640;
      canvas.height = 480;
      const context = canvas.getContext('2d');
      const image = new Image();
      image.src = URL.createObjectURL(new Blob([bytes], { type: 'image/png' }));
      await image.decode();
      const draw = () => {
        context.fillStyle = '#101214';
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, 160, 120, 320, 240);
        requestAnimationFrame(draw);
      };
      draw();
      return canvas.captureStream(5);
    };
  }, { png: PNG.toString('base64'), denyStream: deny, failCount: failFirst });
}

// Stub frames have no face, so the disabled shutter keeps liveness under test.
async function captureSelfieAfterStall(page) {
  const button = page.getByTestId('capture-button');
  await expect(button).toHaveText('Take selfie');
  await expect(button).toBeDisabled();
  await waitForCameraFrame(page);
  await expect(page.getByText('We could not read the checks.')).toBeVisible({ timeout: 45000 });
  await expect(button).toBeEnabled();
  await button.click();
}

async function waitForCameraFrame(page) {
  await page.waitForFunction(() => {
    const video = document.querySelector('video');
    return video && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth > 0;
  }, null, { timeout: 30000 });
}

async function clickCapture(page) {
  await waitForCameraFrame(page);
  await page.getByTestId('capture-button').click();
}

async function startWithDocument(page, name) {
  await page.getByTestId(`verify-doc-tile-${name}`).click();
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Start capture', exact: true }).click();
}

test('the mobile-first identity route submits a PAN case and later shows the rejected status', async ({ page, login, flags, request }) => {
  await flags.enable('kycBadgeEnabled');
  await stubCamera(page);
  const mobile = await login.asNewOwner();
  await page.setViewportSize({ width: 390, height: 844 });

  await page.goto('/verify-identity');
  await expect(page.getByRole('heading', { name: 'Get Verified', exact: true })).toBeVisible();
  await expect(page.getByTestId(/^verify-doc-tile-/)).toHaveCount(4);
  await expect(page.getByTestId('verify-doc-tile-voter_id')).toHaveCount(0);
  await expect(page.getByText(/unlimited/i)).toHaveCount(0);
  await expect(page.getByText(/realtor/i)).toHaveCount(0);
  await expect(page.locator('input[type="file"]')).toHaveCount(0);

  await expect(page.getByText('Images delete 7 days after decision. Withdraw here anytime.')).toBeVisible();
  await expect(page.getByText(/DigiLocker/i)).toHaveCount(0);

  await startWithDocument(page, 'pan');
  await expect(page.getByTestId('capture-button')).toHaveText('Take front');
  await clickCapture(page);
  await captureSelfieAfterStall(page);

  await expect(page.getByRole('heading', { name: 'Check photos', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Submit', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'In review', exact: true })).toBeVisible({ timeout: 30000 });
  await expect(page.getByText('We will update the badge after review.')).toBeVisible();
  await expect(page.getByTestId('verify-status-progress').locator('[aria-current="step"]')).toHaveText('In review');

  // The button out of a pending case has to actually leave: the intro step renders this same status
  // screen whenever a case exists, so returning to it leaves the only control on screen inert.
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard/);

  const reject = await request.post(`${API}/me/verification/identity/simulate?outcome=reject`, {
    headers: { authorization: (await authHeaders(mobile)).authorization },
  });
  expect(reject.status()).toBe(200);

  await page.goto('/verify-identity');
  await expect(page.getByRole('heading', { name: 'Needs attention', exact: true })).toBeVisible();
  await expect(page.getByText('Simulated rejection')).toBeVisible();
  await expect(page.getByText('Attempts left: 2')).toBeVisible();
  await expect(page.getByTestId('verify-status-progress').locator('[aria-current="step"]')).toHaveText('Needs attention');

  // Retry must pass through consent, not jump to the document picker: `consented` is component
  // state, and a reload skipping the checkbox submits consent=false, which the server refuses.
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Get Verified', exact: true })).toBeVisible();
  await expect(page.getByRole('checkbox')).not.toBeChecked();
});

test('camera permission denial gives recovery instructions instead of a dead end', async ({ page, login, flags }) => {
  await flags.enable('kycBadgeEnabled');
  await stubCamera(page, { deny: true });
  await login.asNewOwner();
  await page.setViewportSize({ width: 390, height: 844 });

  await page.goto('/verify-identity');
  await startWithDocument(page, 'pan');

  await expect(page.getByText('No camera yet')).toBeVisible();
  await expect(page.getByText('The camera is blocked for this site. Allow it in your browser settings, then try again.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Try again', exact: true })).toBeVisible();
});

test('desktop verification route shows the QR phone handoff instead of a camera flow', async ({ page, login, flags }) => {
  await flags.enable('kycBadgeEnabled');
  await login.asNewOwner();

  await page.goto('/verify-identity');
  await expect(page.getByRole('heading', { name: 'Use your phone', exact: true })).toBeVisible();
  await expect(page.getByAltText('QR code to open verification on your phone')).toBeVisible();
  await expect(page.locator('input[type="file"]')).toHaveCount(0);
});

test('passport skips the back shot while driving licence requires it', async ({ page, login, flags }) => {
  await flags.enable('kycBadgeEnabled');
  await stubCamera(page);
  await login.asNewOwner();
  await page.setViewportSize({ width: 390, height: 844 });

  await page.goto('/verify-identity');
  await startWithDocument(page, 'passport');
  await expect(page.getByTestId('capture-button')).toHaveText('Take front');
  await clickCapture(page);
  await expect(page.getByTestId('capture-button')).toHaveText('Take selfie');
  await expect(page.getByTestId('verify-shot-back')).toHaveCount(0);

  await page.reload();
  await startWithDocument(page, 'driving_licence');
  await clickCapture(page);
  await expect(page.getByTestId('capture-button')).toHaveText('Take back');
  await expect(page.getByTestId('verify-shot-back')).toBeVisible();
});

test('the review screen shows photos only, with no document number', async ({ page, login, flags }) => {
  await flags.enable('kycBadgeEnabled');
  await stubCamera(page);
  await login.asNewOwner();
  await page.setViewportSize({ width: 390, height: 844 });

  await page.goto('/verify-identity');
  await startWithDocument(page, 'aadhaar');
  await clickCapture(page);
  await expect(page.getByTestId('capture-button')).toHaveText('Take back');
  await clickCapture(page);
  await captureSelfieAfterStall(page);

  await expect(page.getByRole('heading', { name: 'Check photos', exact: true })).toBeVisible();
  await expect(page.getByTestId('verify-review-number')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Submit', exact: true })).toBeEnabled();
});

test('status handles revoked, not_reviewed and withdraw', async ({ page, login, flags }) => {
  await flags.enable('kycBadgeEnabled');
  await login.asNewOwner();
  await page.setViewportSize({ width: 390, height: 844 });
  let mode = 'revoked';
  let deletes = 0;
  // Routed only now, so everything up to the submit is the real flow.
  await page.route('**/api/me/verification/identity', async (route) => {
    if (route.request().method() === 'DELETE') {
      deletes += 1;
      return route.fulfill({ status: 204 });
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(mode === 'revoked'
        ? { status: 'revoked', docType: 'pan', docLast4: '1234', revokedAt: '2026-09-28T05:00:00Z', revocationReason: 'Badge removed after support review.' }
        : { status: 'rejected', docType: 'pan', docLast4: '1234', rejectionReason: 'not_reviewed', attemptsRemaining: 3 }),
    });
  });

  await page.goto('/verify-identity');
  await expect(page.getByRole('heading', { name: 'Badge removed', exact: true })).toBeVisible();
  await expect(page.getByText('Badge removed after support review.')).toBeVisible();

  mode = 'not_reviewed';
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Needs attention', exact: true })).toBeVisible();
  await expect(page.getByText('Review timed out. This does not use an attempt.')).toBeVisible();

  await page.getByTestId('verify-withdraw-link').click();
  await page.getByTestId('verify-withdraw-confirm').click();
  await expect(page.getByRole('heading', { name: 'Get Verified', exact: true })).toBeVisible();
  expect(deletes).toBe(1);
});

async function openPanCamera(page, login, flags) {
  await flags.enable('kycBadgeEnabled');
  await login.asNewOwner();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/verify-identity');
  await startWithDocument(page, 'pan');
}

test('the camera retry asks the browser again rather than redrawing the same refusal', async ({ page, login, flags }) => {
  // The retry must ask the browser again, not repaint the same screen, so the call count is the
  // subject: asserting only that the error clears would pass on a handler that never re-requests.
  await stubCamera(page, { failFirst: 1 });
  await openPanCamera(page, login, flags);

  await expect(page.getByText('No camera yet')).toBeVisible();
  expect(await page.evaluate(() => window.__cameraCalls())).toBe(1);

  await page.getByRole('button', { name: 'Try again', exact: true }).click();

  await expect(page.getByText('No camera yet')).toHaveCount(0);
  await expect(page.getByTestId('capture-button')).toHaveText('Take front');
  expect(await page.evaluate(() => window.__cameraCalls())).toBe(2);
});

test('the selfie capture button is held by the liveness stages, and released when they stall', async ({ page, login, flags }) => {
  // A failed CDN worker load and an unreadable photo both end at "Nothing readable", so only the
  // number coming back off a frame we control separates them.
  test.slow();
  await page.route('**/api/me/verification/identity/challenge', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ token: 'e2e-left-pose', pose: 'left', expiresAt: new Date(Date.now() + 900000).toISOString() }),
  }));
  await stubCamera(page);
  await openPanCamera(page, login, flags);
  await clickCapture(page);

  const capture = page.getByTestId('capture-button');
  await expect(capture).toHaveText('Take selfie');
  await expect(page.getByTestId('liveness-stage-left')).toHaveAttribute('data-state', /pending|active/);
  await expect(page.getByTestId('liveness-stage-smile')).toHaveCount(0);
  await expect(page.getByTestId('liveness-stage-right')).toHaveCount(0);
  await expect(capture).toBeDisabled();
  await expect(page.getByText('Hold the pose to unlock.')).toBeVisible();

  await expect(capture).toBeEnabled({ timeout: 20000 });
  await expect(page.getByText('We could not read the checks.')).toBeVisible();
  await expect(page.getByText('Checks passed')).toHaveCount(0);
});

test('one failed face-model fetch does not disable selfie guidance for the rest of the session', async ({ page, login, flags }) => {
  // The loader caches its promise, so a cached rejection would make one bad fetch permanent for the
  // session. Failing the fetch exactly once separates "it recovered" from "it never failed".
  const DEGRADED = 'Face guidance is off.';
  // A wasm core that aborts leaves the promise pending rather than rejecting; hanging the request
  // reproduces that shape, and only the deadline in ocr.js gets the user out of it.
  test.slow();
  let modelFetches = 0;
  await page.route('**/models/face_landmarker.task', async (route) => {
    modelFetches += 1;
    if (modelFetches === 1) await route.abort('failed');
    else await route.continue();
  });
  await stubCamera(page);
  await openPanCamera(page, login, flags);

  await clickCapture(page);
  await expect(page.getByText(DEGRADED)).toBeVisible();

  await page.getByTestId('capture-button').click();
  await expect(page.getByRole('heading', { name: 'Check photos', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Retake' }).nth(1).click();

  await expect(page.getByTestId('capture-button')).toHaveText('Take selfie');
  await expect.poll(() => modelFetches, { timeout: 30000 }).toBeGreaterThan(1);
  // The landmarker loaded this time, so whatever it says about the frame, it is not the fallback.
  await expect(page.getByText(DEGRADED)).toHaveCount(0, { timeout: 30000 });
});

// Server 500 bodies must not be printed beside the user's captured photos.
test('a server-side submit failure is named as ours and carries the trace id', async ({ page, login, flags }) => {
  await page.route('**/models/face_landmarker.task', (route) => route.abort('failed'));
  await stubCamera(page);
  await openPanCamera(page, login, flags);
  await clickCapture(page);
  await expect(page.getByText('Face guidance is off.')).toBeVisible();
  await page.getByTestId('capture-button').click();
  await expect(page.getByRole('heading', { name: 'Check photos', exact: true })).toBeVisible();

  await page.route('**/api/me/verification/identity', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    return route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'internal', message: 'Something went wrong', status: 500, traceId: 'trace-abc123' }),
    });
  });
  await page.getByRole('button', { name: 'Submit', exact: true }).click();

  const alert = page.getByRole('alert').filter({ hasText: /Verification is unavailable/ });
  await expect(alert).toContainText('this is on our side, not your photos');
  await expect(alert).toContainText('trace-abc123');
  // The generic server prose is the whole defect; it must not be what the applicant reads.
  await expect(alert).not.toContainText('Something went wrong');
  await expect(page.getByRole('heading', { name: 'In review', exact: true })).toHaveCount(0);
});
