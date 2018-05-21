import { Map, Polyline, polyline } from 'leaflet';
import { Route } from './types';
import { indexToHue } from './util';
import { getSubscriptions } from './api';

interface SeenRoute {
  polyline?: Polyline,
  route: Route
};
const seenRoutes: { [gtfsId: string]: SeenRoute } = {};

const initPolyline = (map: Map, r: Route) => {
  if (!r.polyline) return;

  const subscriptions = getSubscriptions();
  const subscriptionIndex = subscriptions.indexOf(r.gtfsId);

  const hue = indexToHue(subscriptionIndex, subscriptions.length);
  const color = `hsla(${hue}, 60%, 65%, 0.75)`;
  const line = polyline(r.polyline, {color}).addTo(map);

  return line;
};

const updateRoutes = (map: Map) => (routes: Route[]) => {
  routes.forEach(route => {
    const seenRoute = seenRoutes[route.gtfsId];

    if (!seenRoute) {
      const line = initPolyline(map, route);

      seenRoutes[route.gtfsId] = {
        polyline: line,
        route,
      }
    } else {
      if (route.polyline) {
        if (seenRoute.polyline) {
          seenRoute.polyline.setLatLngs(route.polyline);
        } else {
          seenRoute.polyline = initPolyline(map, route);
        }
      }
    }
  });
};

export default updateRoutes;
