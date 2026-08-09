import { chromium } from 'playwright';

const baseUrl = process.env.SMOKE_BASE_URL ?? 'http://127.0.0.1:4173';
let browser;

try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const pageErrors = [];

  page.on('pageerror', (error) => {
    pageErrors.push(error.stack ?? error.message);
  });

  const response = await page.goto(`${baseUrl}/`, {
    waitUntil: 'domcontentloaded',
    timeout: 30_000,
  });

  if (!response || !response.ok()) {
    throw new Error(`Preview server returned ${response?.status() ?? 'no response'}`);
  }

  await page.locator('#root > *').first().waitFor({ state: 'attached', timeout: 10_000 });

  // Allow effects, MapLibre worker startup, and initial React Query work to run.
  await page.waitForTimeout(2_000);

  if (pageErrors.length > 0) {
    throw new Error(`Browser boot errors:\n${pageErrors.join('\n\n')}`);
  }

  console.log('Browser smoke test passed: the app mounted without boot errors.');
} finally {
  await browser?.close();
}
