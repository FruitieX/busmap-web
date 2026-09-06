import { test as base, expect, type Page, type WebSocketRoute } from '@playwright/test';

// Keep the browser clock aligned with MQTT's timer worker (which Playwright's
// page clock cannot control). Derive fixture departures relative to this time.
export const NOW = new Date();
const operatingDay = NOW.toLocaleDateString('en-CA', { timeZone: 'Europe/Helsinki' });
const midnightUtc = Date.parse(`${operatingDay}T00:00:00Z`);
const offset = new Intl.DateTimeFormat('en', { timeZone: 'Europe/Helsinki', timeZoneName: 'shortOffset' })
  .formatToParts(midnightUtc).find((part) => part.type === 'timeZoneName')!.value;
export const SERVICE_DAY = midnightUtc / 1000 - Number(offset.replace('GMT', '')) * 3600;
const nowSeconds = Math.floor(NOW.getTime() / 1000) - SERVICE_DAY;
export const route = { gtfsId: 'HSL:2551', shortName: '551', longName: 'Westend - Pasila', mode: 'BUS' };
export const stops = ['Westend', 'Otaniemi', 'Pasila'].map((name, i) => ({
  gtfsId: `HSL:${1220101 + i}`, name, code: `E${1000 + i}`,
  lat: 60.17 + i * 0.005, lon: 24.94 + i * 0.005, vehicleMode: 'BUS', routes: [route],
}));
const departures = [nowSeconds - 120, nowSeconds + 120, nowSeconds + 360];
const stoptimes = stops.map((stop, i) => ({
  stop, serviceDay: SERVICE_DAY, stopPositionInPattern: i,
  scheduledArrival: departures[i], scheduledDeparture: departures[i],
  realtimeArrival: departures[i], realtimeDeparture: departures[i],
  departureDelay: 0, realtime: true, realtimeState: 'UPDATED',
}));
const timetable = [12 * 3600, 13 * 3600].map((start, i) => ({
  scheduledDeparture: departures[1] + i * 3600, realtimeDeparture: departures[1] + i * 3600,
  departureDelay: 0, realtime: true, realtimeState: 'UPDATED', headsign: 'Pasila', serviceDay: SERVICE_DAY,
  trip: { directionId: '0', departureStoptime: { scheduledDeparture: start }, route },
}));

// A minimal MQTT 3.1.1 broker at the WebSocket boundary. The app still runs its
// actual MQTT decoder, buffering, Zustand store and React rendering pipeline.
function packet(header: number, body: Buffer) {
  let remaining = body.length;
  const length: number[] = [];
  do {
    let digit = remaining % 128;
    remaining = Math.floor(remaining / 128);
    if (remaining) digit |= 128;
    length.push(digit);
  } while (remaining);
  return Buffer.concat([Buffer.from([header, ...length]), body]);
}

export async function mockServices(page: Page) {
  const sockets = new Set<WebSocketRoute>();
  let failTimetable = false;
  const unexpectedRequests: string[] = [];
  const publish = (overrides: Record<string, unknown> = {}) => {
    const topic = Buffer.from('/hfp/v2/journey/ongoing/vp/bus/12/42/2551/1/Pasila/12:00/1220102/4/60;24/19/74/00');
    const topicLength = Buffer.alloc(2);
    topicLength.writeUInt16BE(topic.length);
    const payload = Buffer.from(JSON.stringify({ VP: {
      desi: '551', dir: '1', oper: 12, veh: 42, tst: NOW.toISOString(), tsi: NOW.getTime() / 1000,
      spd: 0, hdg: 90, lat: 60.175, long: 24.945, acc: 0, dl: 0, drst: 0,
      oday: operatingDay, start: '12:00', route: '2551', stop: 1220102, occu: 20, ...overrides,
    } }));
    for (const socket of sockets) socket.send(packet(0x30, Buffer.concat([topicLength, topic, payload])));
  };
  await page.routeWebSocket(/.*/, (socket) => {
    const url = new URL(socket.url());
    if (url.protocol !== 'wss:' || url.hostname !== 'mqtt.hsl.fi') {
      unexpectedRequests.push(`WebSocket ${url.origin}${url.pathname}`);
      socket.close();
      return;
    }
    sockets.add(socket);
    let pending = Buffer.alloc(0);
    socket.onClose(() => sockets.delete(socket));
    socket.onMessage((message) => {
      pending = Buffer.concat([pending, Buffer.isBuffer(message) ? message : Buffer.from(message)]);
      while (pending.length > 1) {
        let offset = 1, length = 0, multiplier = 1, digit: number;
        do {
          if (offset >= pending.length) return;
          digit = pending[offset++];
          length += (digit & 127) * multiplier;
          multiplier *= 128;
        } while (digit & 128);
        if (pending.length < offset + length) return;
        const type = pending[0] >> 4;
        const body = pending.subarray(offset, offset + length);
        pending = pending.subarray(offset + length);
        if (type === 1) socket.send(Buffer.from([0x20, 2, 0, 0])); // CONNACK
        if (type === 8) {
          const grants: number[] = [];
          for (let i = 2; i < body.length;) {
            i += 2 + body.readUInt16BE(i);
            grants.push(body[i++]);
          }
          socket.send(packet(0x90, Buffer.from([body[0], body[1], ...grants])));
          publish();
        }
        if (type === 10) socket.send(packet(0xb0, body.subarray(0, 2)));
        if (type === 12) socket.send(Buffer.from([0xd0, 0]));
      }
    });
  });
  await page.route('https://**/*', async (request) => {
    const url = new URL(request.request().url());
    if (url.hostname.endsWith('cartocdn.com')) {
      return request.fulfill({ json: {
        version: 8, sources: {}, glyphs: 'https://fixtures.test/glyphs/{fontstack}/{range}.pbf',
        layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#e8eef0' } }],
      } });
    }
    if (url.hostname === 'fixtures.test') return request.fulfill({ body: Buffer.alloc(0) });
    if (url.hostname === 'api.digitransit.fi') {
      const query = request.request().postData() ?? '';
      if (query.includes('stoptimesWithoutPatterns')) {
        return failTimetable ? request.fulfill({ status: 503, body: 'Unavailable' })
          : request.fulfill({ json: { data: { stop: { stoptimesWithoutPatterns: timetable } } } });
      }
      if (query.includes('fuzzyTrip')) return request.fulfill({ json: { data: { fuzzyTrip: {
        gtfsId: 'HSL:fixture-trip', directionId: '0', tripHeadsign: 'Pasila', stoptimes,
      } } } });
      if (/\bstops\s*\{/.test(query)) return request.fulfill({ json: { data: { stops } } });
      if (/\broutes[\s({]/.test(query)) return request.fulfill({ json: { data: { routes: [{
        ...route, patterns: [{ name: 'Westend - Pasila', geometry: stops.map(({ lat, lon }) => ({ lat, lon })) }],
      }] } } });
    }
    unexpectedRequests.push(`${request.request().method()} ${url.origin}${url.pathname}`);
    return request.abort();
  });
  return { publish, failTimetable: () => { failTimetable = true; }, unexpectedRequests };
}

export const test = base.extend<{ app: Awaited<ReturnType<typeof mockServices>> }>({
  app: [async ({ page, context }, use) => {
    await context.grantPermissions(['geolocation']);
    await context.setGeolocation({ latitude: 60.175, longitude: 24.945 });
    await page.clock.install({ time: NOW });
    await page.addInitScript((savedRoute) => {
      // Seed only on the first load; reload tests must exercise actual persistence.
      if (!localStorage.getItem('busmap-subscriptions')) {
        localStorage.setItem('busmap-subscriptions', JSON.stringify({ version: 1, state: {
          subscribedRoutes: [{ ...savedRoute, mode: 'bus', color: '#007ac9', subscribedAt: 1 }], nearbyBounds: null,
        } }));
        localStorage.setItem('busmap-settings', JSON.stringify({ version: 10, state: { sheetHeight: 500, developerMode: true, showNearby: false } }));
        localStorage.setItem('busmap-active-tab', 'vehicles');
      }
    }, route);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('response', (response) => {
      if (response.url().startsWith('http://127.0.0.1:4173/') && response.status() >= 400) {
        errors.push(`${response.status()} ${response.url()}`);
      }
    });
    const app = await mockServices(page);
    await use(app);
    expect(errors, 'No uncaught browser errors or broken production assets').toEqual([]);
    expect(app.unexpectedRequests, 'All external services must be mocked').toEqual([]);
  }, { auto: true }],
});
export { expect };
