import { test, expect } from '../../../fixtures/live.js';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAARElEQVR4AeyROw0AIAxEL5WADzSw4AcRaGLBDzqKg7uhS4c2eVOTy33snemMtrYzDMErASBBB/0OMNTKCSIoi+pfEYAPAAD//68o26gAAAAGSURBVAMAR8QwUeUtYucAAAAASUVORK5CYII=', 'base64');

async function stubCamera(page) {
  await page.addInitScript(({ png }) => {
    const bytes = Uint8Array.from(atob(png), (char) => char.charCodeAt(0));
    navigator.mediaDevices ??= {};
    navigator.mediaDevices.getUserMedia = async () => {
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
  }, { png: PNG.toString('base64') });
}

async function openPanReview(page, login, flags) {
  await flags.enable('kycBadgeEnabled');
  await page.route('**/models/face_landmarker.task', (route) => route.abort('failed'));
  await login.asNewOwner();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/verify-identity');
  await page.getByTestId('verify-doc-tile-pan').click();
  await page.getByRole('checkbox').check();
  await page.getByTestId('verify-start-cta').click();
  await page.getByTestId('capture-button').click();
  await expect(page.getByTestId('capture-button')).toHaveText('Take selfie');
  await expect(page.getByTestId('capture-button')).toBeEnabled({ timeout: 30000 });
  await page.getByTestId('capture-button').click();
  await expect(page.getByRole('heading', { name: 'Check photos' })).toBeVisible();
}

function multipartText(request) {
  return request.postDataBuffer().toString('latin1');
}

test('consent is English-only and submitted as consentLanguage=en', async ({ page, login, flags }) => {
  await stubCamera(page);
  let submitted = '';
  await page.route('**/api/me/verification/identity', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    submitted = multipartText(route.request());
    return route.fulfill({
      status: 202,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'pending', docType: 'pan', docLast4: '234F' }),
    });
  });

  await openPanReview(page, login, flags);
  await page.getByRole('button', { name: 'Submit', exact: true }).click();

  await expect(page.getByRole('heading', { name: 'In review', exact: true })).toBeVisible();
  expect(submitted).toContain('name="consentLanguage"');
  expect(submitted).toContain('\r\n\r\nen\r\n');
  expect(submitted).not.toContain('name="claims"');
});

test('duplicate ID submit opens a misuse report and posts the dispute', async ({ page, login, flags }) => {
  await stubCamera(page);
  let disputeBody = null;
  await page.route('**/api/me/verification/identity', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    return route.fulfill({
      status: 409,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'identity_already_registered', message: 'Already registered' }),
    });
  });
  await page.route('**/api/me/verification/identity/dispute', async (route) => {
    disputeBody = JSON.parse(route.request().postData() || '{}');
    return route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ ticketId: 'T-IDV-1' }),
    });
  });

  await openPanReview(page, login, flags);
  await page.getByRole('button', { name: 'Submit', exact: true }).click();

  await expect(page.getByText('This ID is already verified on another Draazy account.')).toBeVisible();
  await page.getByRole('button', { name: 'Report misuse', exact: true }).click();
  await page.getByLabel('Note (optional)').fill('This is my PAN.');
  await page.getByRole('button', { name: 'Send report', exact: true }).click();

  await expect(page.getByText('Report sent. Our team will reply within 2 working days.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'View support tickets' })).toHaveAttribute('href', '/support');
  expect(disputeBody).toEqual({ note: 'This is my PAN.' });
});
