import { connect } from 'mqtt';
import { Route, ApiVehicle, Vehicle, ApiRoute } from './types';
import { latLng, LatLng } from 'leaflet';

let routes : { [routeId: string]: Route } = {};
let polylines = {};

const gtfsIdRe = /.+:(.+)/;
const initApi = (vehicleUpdated: Function, routesUpdated: Function) => {
  const mqttClient = connect('wss://mqtt.hsl.fi');
  mqttClient.on('message', (topic, message) => {
    let vehicle: Vehicle | undefined = undefined;

    try {
      const apiVehicle: ApiVehicle = JSON.parse(message.toString()).VP;

      let ll: LatLng | undefined;
      if (apiVehicle.lat && apiVehicle.long) {
        ll = latLng(apiVehicle.lat, apiVehicle.long);
      }

      const route = routes[apiVehicle.desi];

      // Route not found for vehicle
      // This probably means we didn't fetch all routes yet
      if (!route) return;

      const routeDestinations = route.longName
        .split('-')
        .map(dest => dest.trim());

      const destIndex = apiVehicle.dir === '2' ? 0 : routeDestinations.length - 1;
      const dest = routeDestinations[destIndex];

      vehicle = {
        ...apiVehicle,
        lastUpdate: new Date().getTime(),
        latLng: ll,
        dest: dest
      };
    } catch(e) {
      console.log('error in handleMessage:', e);
    }

    if (vehicle)
      vehicleUpdated(vehicle);
  });

  fetchRoutes().then((_routes: ApiRoute[]) => {
    _routes.forEach(route => {
      routes[route.shortName] = route;
    });
    routesUpdated(routes);
  });

  const subscribe = (gtfsId: string, unsubscribe = false) => {
    try {
      // gtfsId is in format HSL:1234, mqtt wants only 1234 part
        // eslint-disable-next-line
      const match = gtfsId.match(gtfsIdRe);
      if (!match) throw new Error('invalid gtfsId');

      const [trash, mqttLineId] = match;
      const topic = `/hfp/v1/journey/+/+/+/+/${mqttLineId}/#`

      if (unsubscribe) {
        console.log('unsubscribing from', topic);
        mqttClient.unsubscribe(topic);
      } else {
        console.log('subscribing to', topic);
        mqttClient.subscribe(topic);
      }
    } catch(e) {
      console.log('error while subscribing:', e);
    }
  };

  return {
    subscribe,
    unsubscribe: (gtfsId: string) => subscribe(gtfsId, true),
  };
};

export default initApi;

export const getRoutes = () => {
  return routes;
}

export const getRoute = () => {
};


const allRoutesQuery =
`{
  routes(name: "") {
    gtfsId
    shortName
    longName
  }
}`;

const fetchRoutes = () => {
  const doFetch = async (callback: Function) => {
    try {
      const response = await fetch('https://api.digitransit.fi/routing/v1/routers/hsl/index/graphql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/graphql'
        },
        body: allRoutesQuery
      })
      .then(response => response.json());

      // get rid of duplicates, wtf hsl
      const routes: Route[] = [];
      response.data.routes.forEach((route: Route) => {
        if (!routes.find(existingRoute => existingRoute.shortName === route.shortName)) {
          routes.push(route);
        } else {
          console.log('skipping duplicate route', route);
        }
      });

      callback(routes);
    } catch (e) {
      console.log('failed to fetch routes:', e);
      setTimeout(() => doFetch(callback), 1000);
    }
  };

  return new Promise(resolve => doFetch(resolve));
}

const yyyymmdd = (date: Date): string => {
  let mm = date.getMonth() + 1; // getMonth() is zero-based
  let dd = date.getDate();

  return [date.getFullYear(),
    (mm>9 ? '' : '0') + mm,
    (dd>9 ? '' : '0') + dd
  ].join('');
}

const polylineQuery = (ids: string) =>
`{
  routes(ids: ${ids}) {
    gtfsId
    shortName
    patterns {
      tripsForDate(serviceDate: "${yyyymmdd(new Date())}") {
        id
      }
      geometry {
        lat
        lon
      }
    }
  }
}`;

let polylineTimeout: number | null = null;
const fetchPolylines = (gtfsIdLines: string[]) => {
  polylineTimeout && clearTimeout(polylineTimeout);
  if (!gtfsIdLines.length) return {};

  const doFetch = async (callback: Function) => {
    try {
      console.log('fetching polylines for gtfsIds:', JSON.stringify(gtfsIdLines));
      const query = polylineQuery(`["${gtfsIdLines.join('","')}"]`);
      const response = await fetch('https://api.digitransit.fi/routing/v1/routers/hsl/index/graphql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/graphql'
        },
        body: query
      })
      .then(response => response.json());

      const polylines = {};

      response.data.routes.forEach(route => {
        const polyline = [];

        // sort by number of trips for today
        route.patterns.sort((a, b) => b.tripsForDate.length - a.tripsForDate.length);
        route.patterns[0].geometry.forEach(coord => {
          polyline.push({
            lat: coord.lat,
            lng: coord.lon,
          });
        });

        polylines[route.shortName] = polyline;
      });

      callback(polylines);
    } catch (e) {
      console.log('failed to fetch polyline:', e);
      polylineTimeout = setTimeout(() => doFetch(callback), 5000);
    }
  };

  return new Promise(resolve => doFetch(resolve));
}
