import { test, expect } from '../../../fixtures/live.js';
import { API, authHeaders } from '../../../helpers/liveAuth.js';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAARElEQVR4AeyROw0AIAxEL5WADzSw4AcRaGLBDzqKg7uhS4c2eVOTy33snemMtrYzDMErASBBB/0OMNTKCSIoi+pfEYAPAAD//68o26gAAAAGSURBVAMAR8QwUeUtYucAAAAASUVORK5CYII=', 'base64');

/** `deny` refuses every call as a blocked browser does; `failFirst` refuses only the first n so a
 * retry can be seen to succeed; `card` draws legible text for the OCR path. */
async function stubCamera(page, { deny = false, failFirst = 0, card = null } = {}) {
  await page.addInitScript(({ png, denyStream, failCount, cardText }) => {
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
      canvas.width = cardText ? 1280 : 640;
      canvas.height = cardText ? 800 : 480;
      const context = canvas.getContext('2d');
      if (cardText) {
        const draw = () => {
          context.fillStyle = '#ffffff';
          context.fillRect(0, 0, canvas.width, canvas.height);
          context.fillStyle = '#000000';
          context.textAlign = 'center';
          cardText.forEach((line, index) => {
            context.font = `${index === 0 ? 'bold ' : ''}${index === 0 ? 96 : 72}px Arial`;
            context.fillText(line, canvas.width / 2, 220 + index * 150);
          });
          requestAnimationFrame(draw);
        };
        draw();
        return canvas.captureStream(5);
      }
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
  }, { png: PNG.toString('base64'), denyStream: deny, failCount: failFirst, cardText: card });
}

/**
 * A stub frame has no face, so the liveness stages never advance; asserting the shutter starts
 * DISABLED keeps that gate under test. Anchored on the testid, since two labels share a name regex.
 */
async function captureSelfieAfterStall(page) {
  const button = page.getByTestId('capture-button');
  await expect(button).toHaveText('Take the selfie');
  await expect(button).toBeDisabled();
  await expect(button).toBeEnabled({ timeout: 20000 });
  await button.click();
}

test('the mobile-first identity route submits a PAN case and later shows the rejected status', async ({ page, login, flags, request }) => {
  await flags.enable('kycBadgeEnabled');
  await stubCamera(page);
  const mobile = await login.asNewOwner();
  await page.setViewportSize({ width: 390, height: 844 });

  await page.goto('/verify-identity');
  await expect(page.getByRole('heading', { name: 'Get the Verified badge', exact: true })).toBeVisible();
  // The benefit list may only claim what this product does: "unlimited" contacts belong to the paid
  // Seeker Plus plan and there is no realtor directory, so ranking is the one real promise.
  await expect(page.getByText('Your listings rank higher', { exact: true })).toBeVisible();
  await expect(page.getByText(/unlimited/i)).toHaveCount(0);
  await expect(page.getByText(/realtor/i)).toHaveCount(0);
  await expect(page.locator('input[type="file"]')).toHaveCount(0);

  await page.getByRole('button', { name: /Start Verification/i }).click();
  await expect(page.getByRole('heading', { name: 'Before you send anything', exact: true })).toBeVisible();
  // The consent checkbox carries the same retention promise in its own words, so the bare phrase
  // now matches twice. Pin the disclosure paragraph, which is the one a reader sees before ticking.
  await expect(page.getByText('Images are deleted seven days after a decision')).toBeVisible();
  await expect(page.getByText(/DigiLocker/i)).toHaveCount(0);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Agree and continue', exact: true }).click();

  await page.getByRole('button', { name: /PAN card/i }).click();
  await expect(page.getByTestId('capture-button')).toHaveText('Take the front');
  await page.getByTestId('capture-button').click();
  await captureSelfieAfterStall(page);

  await expect(page.getByRole('heading', { name: 'Check before you send', exact: true })).toBeVisible();
  await expect(page.getByText('Reviewers work from the image itself', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Send for review', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Sent for review', exact: true })).toBeVisible({ timeout: 30000 });
  await expect(page.getByText('You are not verified yet.')).toBeVisible();

  // The button out of a pending case has to actually leave: the intro step renders this same status
  // screen whenever a case exists, so returning to it leaves the only control on screen inert.
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard/);

  const reject = await request.post(`${API}/me/verification/identity/simulate?outcome=reject`, {
    headers: { authorization: (await authHeaders(mobile)).authorization },
  });
  expect(reject.status()).toBe(200);

  await page.goto('/verify-identity');
  await expect(page.getByRole('heading', { name: 'Not approved', exact: true })).toBeVisible();
  await expect(page.getByText('Review outcome')).toBeVisible();
  await expect(page.getByText('Simulated rejection')).toBeVisible();
  await expect(page.getByText('Attempts left: 2')).toBeVisible();

  // Retry must pass through consent, not jump to the document picker: `consented` is component
  // state, and a reload skipping the checkbox submits consent=false, which the server refuses.
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Before you send anything', exact: true })).toBeVisible();
  await expect(page.getByRole('checkbox')).not.toBeChecked();
});

test('camera permission denial gives recovery instructions instead of a dead end', async ({ page, login, flags }) => {
  await flags.enable('kycBadgeEnabled');
  await stubCamera(page, { deny: true });
  await login.asNewOwner();
  await page.setViewportSize({ width: 390, height: 844 });

  await page.goto('/verify-identity');
  await page.getByRole('button', { name: /Start Verification/i }).click();
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Agree and continue', exact: true }).click();
  await page.getByRole('button', { name: /PAN card/i }).click();

  await expect(page.getByText('No camera yet')).toBeVisible();
  await expect(page.getByText('The camera is blocked for this site. Allow it in your browser settings, then try again.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Try the camera again', exact: true })).toBeVisible();
});

test('desktop verification route shows the QR phone handoff instead of a camera flow', async ({ page, login, flags }) => {
  await flags.enable('kycBadgeEnabled');
  await login.asNewOwner();

  await page.goto('/verify-identity');
  await expect(page.getByRole('heading', { name: 'Finish this on your phone', exact: true })).toBeVisible();
  await expect(page.getByAltText('QR code to open verification on your phone')).toBeVisible();
  await expect(page.locator('input[type="file"]')).toHaveCount(0);
});

/** Consent through to the PAN viewfinder, which is where both tests below begin. */
async function openPanCamera(page, login, flags) {
  await flags.enable('kycBadgeEnabled');
  await login.asNewOwner();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/verify-identity');
  await page.getByRole('button', { name: /Start Verification/i }).click();
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Agree and continue', exact: true }).click();
  await page.getByRole('button', { name: /PAN card/i }).click();
}

test('the camera retry asks the browser again rather than redrawing the same refusal', async ({ page, login, flags }) => {
  // The retry must ask the browser again, not repaint the same screen, so the call count is the
  // subject: asserting only that the error clears would pass on a handler that never re-requests.
  await stubCamera(page, { failFirst: 1 });
  await openPanCamera(page, login, flags);

  await expect(page.getByText('No camera yet')).toBeVisible();
  expect(await page.evaluate(() => window.__cameraCalls())).toBe(1);

  await page.getByRole('button', { name: 'Try the camera again', exact: true }).click();

  await expect(page.getByText('No camera yet')).toHaveCount(0);
  await expect(page.getByTestId('capture-button')).toHaveText('Take the front');
  expect(await page.evaluate(() => window.__cameraCalls())).toBe(2);
});

test('OCR reads the card in the browser, so the reviewer sees a claim and not a worker failure', async ({ page, login, flags }) => {
  // A failed CDN worker load and an unreadable photo both end at "Nothing readable", so only the
  // number coming back off a frame we control separates them.
  test.slow();
  await stubCamera(page, { card: ['ABCDE1234F', 'RAVI SHARMA'] });
  await openPanCamera(page, login, flags);

  await page.getByTestId('capture-button').click();
  await captureSelfieAfterStall(page);

  await expect(page.getByRole('heading', { name: 'Check before you send', exact: true })).toBeVisible();
  await expect(page.getByText('Reading the card…')).toHaveCount(0, { timeout: 120000 });
  await expect(page.getByText('ABCDE1234F', { exact: true })).toBeVisible();
});

test('an OCR read that never finishes still hands the user the manual path', async ({ page, login, flags }) => {
  // A wasm core that aborts leaves the promise pending rather than rejecting; hanging the request
  // reproduces that shape, and only the deadline in ocr.js gets the user out of it.
  test.slow();
  await page.route('**/tessdata/**', () => { /* never settles, exactly as the aborted worker did */ });
  await stubCamera(page, { card: ['ABCDE1234F', 'RAVI SHARMA'] });
  await openPanCamera(page, login, flags);

  await page.getByTestId('capture-button').click();
  await captureSelfieAfterStall(page);

  await expect(page.getByRole('heading', { name: 'Check before you send', exact: true })).toBeVisible();
  await expect(page.getByText('Reading the card…')).toHaveCount(0, { timeout: 90000 });
  // An unreadable document is the reviewer's problem, not a dead end — submission stays open.
  await expect(page.getByText('Nothing readable').first()).toBeVisible();
});

test('the selfie capture button is held by the liveness stages, and released when they stall', async ({ page, login, flags }) => {
  // The gate exists only to coax a usable photo out of an honest user, so it must both hold the
  // button until the stages clear and let go when they stall rather than stranding a dim room.
  test.slow();
  await stubCamera(page);
  await openPanCamera(page, login, flags);
  await page.getByTestId('capture-button').click();

  const capture = page.getByTestId('capture-button');
  await expect(capture).toHaveText('Take the selfie');
  for (const stage of ['smile', 'left', 'right']) {
    await expect(page.getByTestId(`liveness-stage-${stage}`)).toHaveAttribute('data-state', /pending|active/);
  }
  await expect(page.getByTestId('liveness-stage-right')).toHaveAttribute('data-state', 'pending');
  await expect(capture).toBeDisabled();
  await expect(page.getByText('Finish all three to unlock the shutter.')).toBeVisible();

  await expect(capture).toBeEnabled({ timeout: 20000 });
  await expect(page.getByText('We could not read the checks from your camera.')).toBeVisible();
  // Released, not silently passed: nothing claims the checks were met.
  await expect(page.getByText('All three done')).toHaveCount(0);
});

test('one failed face-model fetch does not disable selfie guidance for the rest of the session', async ({ page, login, flags }) => {
  // The loader caches its promise, so a cached rejection would make one bad fetch permanent for the
  // session. Failing the fetch exactly once separates "it recovered" from "it never failed".
  const DEGRADED = 'Face guidance is off.';
  test.slow();
  let modelFetches = 0;
  await page.route('**/models/face_landmarker.task', async (route) => {
    modelFetches += 1;
    if (modelFetches === 1) await route.abort('failed');
    else await route.continue();
  });
  await stubCamera(page);
  await openPanCamera(page, login, flags);

  await page.getByTestId('capture-button').click();
  await expect(page.getByText(DEGRADED)).toBeVisible();

  // Back out to review and return, which re-runs the camera effect and asks the loader again.
  await page.getByTestId('capture-button').click();
  await expect(page.getByRole('heading', { name: 'Check before you send', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Retake' }).nth(1).click();

  await expect(page.getByTestId('capture-button')).toHaveText('Take the selfie');
  // The landmarker loaded this time, so whatever it says about the frame, it is not the fallback.
  await expect(page.getByText(DEGRADED)).toHaveCount(0, { timeout: 30000 });
  expect(modelFetches).toBeGreaterThan(1);
});

/* A 500 here is ours, and the screen used to print the server's last-resort body verbatim:
   "Something went wrong", beside three photos the user had just taken. That reads as "one of these
   is bad" and sends them to retake all three, which cannot help. This is not hypothetical — sandbox
   runs without object storage wired, so `ObjectStoreFileStorage.store` throws on every real
   submission and this was the only thing the applicant was told. The trace id is asserted because it
   is the sole handle support has on the log line that says why. */
test('a server-side submit failure is named as ours and carries the trace id', async ({ page, login, flags }) => {
  await stubCamera(page);
  await openPanCamera(page, login, flags);
  await page.getByTestId('capture-button').click();
  await captureSelfieAfterStall(page);
  await expect(page.getByRole('heading', { name: 'Check before you send', exact: true })).toBeVisible();

  // Routed only now, so everything up to the submit is the real flow.
  await page.route('**/api/me/verification/identity', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    return route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'internal', message: 'Something went wrong', status: 500, traceId: 'trace-abc123' }),
    });
  });
  await page.getByRole('button', { name: 'Send for review', exact: true }).click();

  const alert = page.getByRole('alert').filter({ hasText: /Verification is unavailable/ });
  await expect(alert).toContainText('this is on our side, not your photos');
  await expect(alert).toContainText('trace-abc123');
  // The generic server prose is the whole defect; it must not be what the applicant reads.
  await expect(alert).not.toContainText('Something went wrong');
  // A failed submit leaves the user on review with their captures, not on a success screen.
  await expect(page.getByRole('heading', { name: 'Sent for review', exact: true })).toHaveCount(0);
});
