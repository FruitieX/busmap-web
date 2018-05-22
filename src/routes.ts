import { Map, Polyline, polyline, Control, DomUtil, control, popup, Point } from 'leaflet';
import { Route } from './types';
import { indexToHue } from './util';
import { getSubscriptions, getSubscribedRoutes, unsubscribe, getRoutes, subscribe } from './api';
import EventEmitter from 'eventemitter3';

const openRoutes = () => {
  const routeContainer = document.createElement('div');
  routeContainer.style.display = 'flex';
  routeContainer.style.fontSize = '20px';
  routeContainer.style.textAlign = 'center';
  routeContainer.style.overflowX = 'auto';

  const allRoutes = Object.values(getRoutes());

  const subscriptions = getSubscriptions();
  const subscribedRoutes = getSubscribedRoutes();
  subscribedRoutes.forEach(route => {
    const routeElement = document.createElement('span');
    routeElement.innerHTML = `<div><span class="icon-bus"></span></div><div>${route.shortName}</div>`;

    const subscriptionIndex = subscriptions.indexOf(route.gtfsId);

    const hue = indexToHue(subscriptionIndex, subscriptions.length);
    const color = `hsla(${hue}, 60%, 65%, 0.75)`;

    routeElement.style.backgroundColor = color;
    routeElement.style.margin = '8px';
    routeElement.style.padding = '8px';
    routeElement.style.height = '40px';
    routeElement.style.width = '50px';
    routeElement.style.borderRadius = '4px';
    routeElement.style.cursor = 'pointer';
    routeElement.className = 'highlight';

    routeElement.onclick = (e) => {
      e.stopPropagation();
      unsubscribe(route.gtfsId);
      hideSearch();
    }

    routeContainer.appendChild(routeElement);
  });

  const searchResults = document.createElement('div');
  searchResults.style.overflowX = 'hidden';
  searchResults.style.margin = '8px';
  searchResults.style.marginTop = '0px';

  const searchBox = document.createElement('input');
  searchBox.id = 'searchBox';
  searchBox.placeholder = 'Enter service number';
  searchBox.style.padding = '8px';
  searchBox.style.margin = '8px';
  searchBox.style.marginBottom = '0px';
  searchBox.autofocus = true;
  searchBox.onclick = (e) => {
    e.stopPropagation();
  }
  searchBox.onkeypress = (e) => {
    if (e.keyCode === 13) {
      const searchValue = e.target.value.trim().toLowerCase();
      const route = allRoutes.find(route => route.shortName === searchValue);
      route && subscribe(route.gtfsId);
      hideSearch();

      return false;
    };
  };
  searchBox.oninput = (e) => {
    e.preventDefault()

    const searchValue = e.target.value.trim().toLowerCase();
    let matchingRoutes: Route[] = [];

    if (searchValue !== '') {
      matchingRoutes = allRoutes
        .filter(line => !line.shortName.toLowerCase().indexOf(searchValue))
          .sort((a, b) => {
            // First sort by length (shorter first)
            if (a.shortName.length !== b.shortName.length) {
              return a.shortName.length - b.shortName.length;
            }

            // Then sort by alphanumeric
            return a.shortName.localeCompare(b.shortName);
          });
        }

    searchResults.innerHTML = '';
    matchingRoutes.forEach(route => {
      const result = document.createElement('div');
      result.onclick = (e) => {
        e.stopPropagation();
        subscribe(route.gtfsId);
        hideSearch();
      };
      result.style.display = 'flex';
      result.style.cursor = 'pointer';
      result.className = 'result';

      const routeName = document.createElement('span');
      routeName.innerText = route.shortName;
      routeName.style.width = '100px';
      routeName.style.textAlign = 'center';
      routeName.style.fontSize = '30px';
      routeName.style.overflow = 'hidden';
      routeName.style.flexShrink = '0';

      const routeDetails = document.createElement('span');
      routeDetails.innerText = route.longName;
      routeDetails.style.overflow = 'hidden';
      routeDetails.style.display = '-webkit-box';
      routeDetails.style['-webkit-box-orient'] = 'vertical';
      routeDetails.style['-webkit-line-clamp'] = '2';

      result.appendChild(routeName);
      result.appendChild(routeDetails);
      searchResults.appendChild(result);
    });
  }

  const container = document.createElement('div');
  let hiding = false;
  const hideSearch = () => {
    if (hiding) return;
    hiding = true;
    container.style.opacity = '0';
    setTimeout(() => body.removeChild(container), 300);
  }
  document.onkeydown = function(e) {
    // handle escape key
    if (e.keyCode === 27) {
      hideSearch();
    }
  };
  container.style.backgroundColor = '#00000080';
  container.style.opacity = '0';
  container.style.transition = 'all 300ms';
  container.style.position = 'absolute';
  container.style.top = '0';
  container.style.width = '100%';
  container.style.left = '0';
  container.style.height = '100%';
  container.onclick = hideSearch;
  container.style.overflowY = 'auto';

  const root = document.createElement('div');
  root.style.position = 'relative';
  root.style.padding = '10px';
  root.style.paddingLeft = '54px';
  root.appendChild(routeContainer);
  root.appendChild(searchBox);
  root.appendChild(searchResults);

  const body = document.getElementsByTagName('body')[0];
  body.appendChild(container);
  container.appendChild(root);
  setTimeout(() => container.style.opacity = '1');

  document.getElementById('searchBox').focus();
};

const routeControl = Control.extend({
  options: {
    position: 'topleft',
  },

  onAdd: function(map: Map) {
    const container = DomUtil.create('div', 'leaflet-bar leaflet-control');
    container.style.backgroundColor = 'white';
    container.style.width = '30px';
    container.style.height = '30px';
    container.style.fontSize = '1.4em';
    container.style.lineHeight = '30px';
    container.style.textAlign = 'center';
    container.innerHTML = '<a><span class="icon-bus"></span></a>';

    container.onclick = () => {
      openRoutes();
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
  const color = `hsla(${hue}, 70%, 42%, 0.75)`;
  const line = polyline(r.polyline, {color, weight: 6, dashArray: '8, 20'}).addTo(map);

  const p =
  popup({ autoPanPadding: new Point(50, 50), className: 'popup', offset: new Point(0, -10) })
    .setContent(`
      <div class="routeId">
      <span class="icon-bus"></span>
      ${r.shortName} (${r.longName})
      </div>
      <div class="dest">Route ID: ${r.gtfsId}</div>
      <button class="button" onclick=unsubscribe("${r.gtfsId}")>Remove route</button>
      `)
  line.on('popupopen', () => {
    map.fitBounds(line.getBounds());
  });

  line.bindPopup(p);

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
  map.addControl(new routeControl());
}

export default initRoutes;
