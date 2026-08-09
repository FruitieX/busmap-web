import { chromium } from 'playwright';

const baseUrl = process.env.SMOKE_BASE_URL ?? 'http://127.0.0.1:4173';
let browser;

try {
  browser = await chromium.launch({
    headless: true,
    ...(process.env.SMOKE_CHROMIUM_PATH ? { executablePath: process.env.SMOKE_CHROMIUM_PATH } : {}),
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const pageErrors = [];
  const failedMapRequests = [];

  page.on('pageerror', (error) => {
    pageErrors.push(error.stack ?? error.message);
  });

  page.on('response', (response) => {
    const url = response.url();
    if ((url.includes('maplibre-gl-worker') || url.includes('style.json')) && !response.ok()) {
      failedMapRequests.push(`${response.status()} ${url}`);
    }
  });

  page.on('requestfailed', (request) => {
    const url = request.url();
    if (url.includes('maplibre-gl-worker') || url.includes('style.json')) {
      failedMapRequests.push(`${request.failure()?.errorText ?? 'request failed'} ${url}`);
    }
  });

  const response = await page.goto(`${baseUrl}/`, {
    waitUntil: 'domcontentloaded',
    timeout: 30_000,
  });

  if (!response || !response.ok()) {
    throw new Error(`Preview server returned ${response?.status() ?? 'no response'}`);
  }

  await page.locator('#root > *').first().waitFor({ state: 'attached', timeout: 10_000 });
  await page.locator('.maplibregl-map').waitFor({ state: 'attached', timeout: 10_000 });

  // Allow effects, MapLibre worker startup, and initial React Query work to run.
  await page.waitForTimeout(2_000);

  const canvasSize = await page.locator('.maplibregl-map canvas').first().evaluate((canvas) => ({
    width: canvas.width,
    height: canvas.height,
  }));

  if (canvasSize.width === 0 || canvasSize.height === 0) {
    throw new Error(`Map canvas has invalid dimensions: ${canvasSize.width}x${canvasSize.height}`);
  }

  if (failedMapRequests.length > 0) {
    throw new Error(`Map resources failed to load:\n${failedMapRequests.join('\n')}`);
  }

  if (pageErrors.length > 0) {
    throw new Error(`Browser boot errors:\n${pageErrors.join('\n\n')}`);
  }

  console.log('Browser smoke test passed: the app mounted without boot errors.');
} finally {
  await browser?.close();
}
