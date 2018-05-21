import { Map, Polyline, polyline, Control, DomUtil } from 'leaflet';
import { Route } from './types';
import { indexToHue } from './util';
import { getSubscriptions, unsubscribe } from './api';
import EventEmitter from 'eventemitter3';

const routeControl = Control.extend({
  options: {
    position: 'bottomleft'
  },

  initialize: function(route: Route) {
    this.route = route;
  },

  onAdd: function(map: Map) {
    const container = DomUtil.create('div', 'leaflet-bar leaflet-control leaflet-control-custom');
    container.style.backgroundColor = 'white';
    container.style.width = '50px';
    container.style.height = '30px';
    container.innerText = this.route.shortName;

    container.onclick = () => {
      unsubscribe(this.route.gtfsId)
    }
    return container;
  }
});

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
  Object.values(seenRoutes).forEach(seenRoute => {
    //map.removeControl(seenRoute.control);
    seenRoute.polyline && seenRoute.polyline.remove();
  })

  console.log(routes);

  routes.forEach(route => {
    const line = initPolyline(map, route);
    //const control = new routeControl(route);
    //map.addControl(control);

    seenRoutes[route.gtfsId] = {
      polyline: line,
      route,
    }
  });
};

const initRoutes = (map: Map, apiEvents: EventEmitter) => {
  apiEvents.on('updateRoutes', updateRoutes(map));
}

export default initRoutes;
