import { test, expect } from './fixtures';

test('launch shows nearest departures and opens the selected stop', async ({ page }) => {
  await page.goto('/');
  const nearby = page.getByRole('region', { name: 'Nearby departures' });
  await expect(nearby.getByRole('heading', { name: 'Departures near you' })).toBeVisible();
  await expect(nearby.getByRole('button')).toHaveCount(3);
  await expect(nearby.getByRole('button').first()).toHaveAccessibleName('Departures from Otaniemi');
  await expect(nearby.getByRole('button').first()).toContainText('2 min');
  await expect(nearby.getByRole('button').first().getByLabel('Tracked route').first()).toBeVisible();
  await nearby.getByRole('button').first().click();
  await expect(page.getByRole('heading', { name: 'Otaniemi', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Next departures' })).toBeVisible();
  await expect(page.getByText('0 m from you')).toBeVisible();
  await page.getByRole('button', { name: 'Back to nearby departures' }).click();
  await expect(nearby).toBeVisible();
});

test('details stay compact and navigable at 320px', async ({ page, app }, testInfo) => {
  app.extendTrip();
  await page.setViewportSize({ width: 320, height: 740 });
  if (testInfo.project.name === 'mobile') await page.addInitScript(() => {
    const saved = JSON.parse(localStorage.getItem('busmap-settings')!);
    saved.state.theme = 'dark';
    localStorage.setItem('busmap-settings', JSON.stringify(saved));
  });
  await page.goto('/');
  await page.getByRole('region', { name: 'Live vehicles', exact: true }).getByText('Pasila', { exact: true }).click();
  await expect(page.getByRole('button', { name: /^Show .* on map$/ })).toHaveCount(4);
  await expect(page.getByText(/Nearest to you/)).toBeVisible();
  for (const name of ['Vehicles', 'Routes', 'Stops']) {
    const tab = page.getByRole('button', { name, exact: true });
    await expect(tab).toBeVisible();
    const box = await tab.boundingBox();
    expect(box!.x + box!.width).toBeLessThanOrEqual(320);
  }
  await expect(page.locator('details').filter({ hasText: 'Vehicle activity' })).not.toHaveAttribute('open');
  await page.screenshot({ path: testInfo.outputPath('vehicle-320.png') });
  await page.getByRole('button', { name: 'Show 3 more stops' }).click();
  await expect(page.getByRole('button', { name: /^Show .* on map$/ })).toHaveCount(7);
  await page.getByRole('button', { name: 'Show fewer stops' }).click();
  await page.getByRole('button', { name: 'Show Otaniemi on map' }).click();
  await expect(page.locator('details').filter({ hasText: 'Routes at this stop' })).not.toHaveAttribute('open');
  await page.screenshot({ path: testInfo.outputPath('stop-320.png') });
  await page.getByText('Routes at this stop · 1', { exact: true }).click();
  await page.getByRole('button', { name: 'Open route 551', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Live vehicles', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Towards Pasila' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('route-320.png') });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('location denial keeps the vehicle list usable without misleading nearby results', async ({ page }) => {
  await page.addInitScript(() => {
    const deny = (_success: PositionCallback, failure?: PositionErrorCallback | null) => {
      queueMicrotask(() => failure?.({ code: 1, message: 'Denied', PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 }));
      return 1;
    };
    Object.defineProperty(navigator, 'geolocation', { value: { getCurrentPosition: deny, watchPosition: deny, clearWatch: () => {} } });
  });
  await page.goto('/');
  await expect(page.getByRole('region', { name: 'Live vehicles', exact: true }).getByText('Pasila', { exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Nearby departures' })).toHaveCount(0);
});

test('production app loads its map worker and supports sheet controls', async ({ page }) => {
  const worker = page.waitForResponse((response) => /maplibre-gl-worker-.*\.js/.test(response.url()) && response.ok());
  await page.goto('/');
  await worker;
  await expect(page.locator('.maplibregl-map canvas')).toBeVisible();
  const handle = page.getByRole('button', { name: /Change sheet size/ });
  await handle.click(); // expanded -> compact
  await expect(handle).toHaveAttribute('aria-label', /compact/);
  await handle.click();
  await expect(handle).toHaveAttribute('aria-label', /reading/);
  await handle.press('ArrowUp');
  await expect(handle).toHaveAttribute('aria-label', /expanded/);
  const box = await handle.boundingBox();
  if (!box) throw new Error('Sheet handle has no bounds');
  await page.mouse.move(box.x + box.width / 2, box.y + 10);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + 160, { steps: 15 });
  await page.mouse.up();
  await expect(handle).toHaveAttribute('aria-label', /reading/);
});

test('MQTT vehicle -> trip stop -> vehicle preserves navigation and departure meaning', async ({ page, app }) => {
  await page.goto('/');
  await page.getByRole('region', { name: 'Live vehicles', exact: true }).getByText('Pasila', { exact: true }).click();
  await expect(page.getByText('Trip stops', { exact: true })).toBeVisible();
  await expect(page.getByText('In 2 min', { exact: true })).toBeVisible();
  await expect(page.getByText(/^Departed ·/)).toHaveCount(1);
  await expect(page.locator('details').filter({ hasText: 'Technical details' })).not.toHaveAttribute('open');
  await page.getByRole('button', { name: 'Show Otaniemi on map' }).click();
  await expect(page.getByRole('button', { name: 'Back to vehicle 551' })).toBeVisible();
  const unavailable = page.getByRole('button').filter({ hasText: 'Vehicle not tracking yet' });
  await expect(unavailable).toBeDisabled();
  await page.getByRole('button', { name: 'Back to vehicle 551' }).click();
  await expect(page.getByText('Trip stops', { exact: true })).toBeVisible();
  app.publish({ stop: null });
  await expect(page.getByText(/^Expected to have departed ·/)).toHaveCount(1);
  await page.clock.fastForward(15_000);
  await expect(page.getByRole('status').filter({ hasText: 'Last seen' })).toBeVisible();
});

test('search, route selection, saved-route persistence and theme survive reload', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button').filter({ hasText: /Search/ }).first().click();
  await page.getByPlaceholder('Search routes & stops...').fill('551');
  await page.getByRole('button').filter({ hasText: 'Westend - Pasila' }).first().click();
  await expect(page.getByRole('button', { name: 'Stop tracking route', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Stop tracking route', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Track this route', exact: true })).toBeVisible();
  await page.reload();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('busmap-subscriptions')!).state.subscribedRoutes);
  expect(saved).toEqual([]);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.locator('select').filter({ has: page.locator('option[value="dark"]') }).selectOption('dark');
  await expect(page.locator('html')).toHaveClass(/dark/);
  await page.reload();
  await expect(page.locator('html')).toHaveClass(/dark/);
});

test('failed timetable refresh retains cached departures and shows a warning', async ({ page, app }) => {
  await page.goto('/');
  await page.getByRole('region', { name: 'Live vehicles', exact: true }).getByText('Pasila', { exact: true }).click();
  await page.getByRole('button', { name: 'Show Otaniemi on map' }).click();
  await expect(page.getByText('In 2 min', { exact: true })).toBeVisible();
  app.failTimetable();
  await page.clock.fastForward(95_000);
  await expect(page.getByRole('status').filter({ hasText: 'Updates unavailable' })).toBeVisible();
  await expect(page.getByRole('button').filter({ hasText: 'Vehicle not tracking yet' }).first()).toBeVisible();
});

test('installed PWA reloads its app shell offline', async ({ page, context }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  // Prompt-mode service workers take control on the following navigation.
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('button', { name: /Change sheet size/ })).toBeVisible();
  await expect(page.locator('.maplibregl-map canvas')).toBeVisible();
});
