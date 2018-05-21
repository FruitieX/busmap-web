import { divIcon, marker, Map, Marker, DivIcon, Point, popup, Popup } from 'leaflet';
import * as L from 'leaflet';
import { Vehicle, Route } from "./types";
import { getSubscriptions } from './api';
import { indexToHue } from './util';
import EventEmitter from 'eventemitter3';

interface SeenVehicle {
  icon: DivIcon,
  marker?: Marker,
  vehicle: Vehicle
};
const seenVehicles: { [vehicleId: string]: SeenVehicle } = {};

const getBackgroundColor = (gtfsId: string) => {
  const subscriptions = getSubscriptions();
  const subscriptionIndex = subscriptions.indexOf(gtfsId);

  const hue = indexToHue(subscriptionIndex, subscriptions.length);
  return `hsla(${hue}, 60%, 65%, 0.75)`;
};

const updatePopup = (popup: Popup, v: Vehicle) => {
  popup.setContent(`
<div class="routeId">
  <span class="icon-bus"></span>
  ${v.desi} (${v.dest})
</div>
<div class="dest">Vehicle ID: ${v.veh}</div>
<div class="dest">Last update: ${new Date(v.lastUpdate).toLocaleTimeString()}</div>
<div class="dest">Start time: ${v.start}</div>
<div class="dest">Speed: ${Number(v.spd * 3.6).toFixed(2)} km/h</div>
<div class="dest">Acceleration: ${Number(v.acc).toFixed(2)} m/s²</div>
<div class="dest">Heading: ${v.hdg}</div>
`);
};

const initMarker = (map: Map, v: Vehicle, icon) => {
  const marker = L.animatedMarker(v.latLng, {icon}).addTo(map);
  marker._icon.style.backgroundColor = getBackgroundColor(v.gtfsId);

  marker.bindPopup(
    popup({ autoPanPadding: new Point(50, 50), keepInView: true, className: 'popup', offset: new Point(0, -10) })
  );

  updatePopup(marker._popup, v);
  return marker;
};

const iconHtml = (v: Vehicle) => {
  return `<div class="routeId"><span class="icon-bus"></span>${v.desi}</div><div class="dest">${v.dest}</div>`;
};

const updateVehicle = (map: Map) => (v: Vehicle) => {
  const seenVehicle = seenVehicles[v.veh];

  if (!seenVehicle) {
    // Vehicle not seen before, create new icon & marker
  	const icon = divIcon({ className: 'vehicle', iconSize: [50, 25], html: iconHtml(v) });

    seenVehicles[v.veh] = {
      icon,
      marker: v.latLng && initMarker(map, v, icon),
      vehicle: v
    };
  } else {
    // Vehicle seen before, update marker
    if (v.latLng) {
      if (!seenVehicle.marker) {
        seenVehicle.marker = initMarker(map, v, seenVehicle.icon);
      } else {
        seenVehicle.marker.setLine(v.latLng)
        seenVehicle.marker._icon.style.backgroundColor = getBackgroundColor(seenVehicle.vehicle.gtfsId);
        seenVehicle.marker._icon.innerHTML = iconHtml(v);
        updatePopup(seenVehicle.marker._popup, v);
      }
    } else if (!v.latLng && seenVehicle.marker) {
      // Api supplied null coordinates, remove marker
      map.removeLayer(seenVehicle.marker);
      delete seenVehicle.marker;
    }
  }
};

const removeRoute = (map: Map) => (r: Route) => {
  Object.values(seenVehicles).forEach(seenVehicle => {
    if (seenVehicle.vehicle.gtfsId === r.gtfsId) {
      if (seenVehicle.marker) {
        map.removeLayer(seenVehicle.marker);
        delete seenVehicles[seenVehicle.vehicle.veh];
      }
    }
  });
};

const updateRoutes = (map: Map) => (r: Route[]) => {
  Object.values(seenVehicles).forEach(seenVehicle => {
    if (r.find(route => route.gtfsId === seenVehicle.vehicle.gtfsId)) {
      seenVehicle.marker && seenVehicle.marker._icon.style.backgroundColor = getBackgroundColor(seenVehicle.vehicle.gtfsId);
    }
  });
};

const initVehicles = (map: Map, apiEvents: EventEmitter) => {
  apiEvents.on('updateVehicle', updateVehicle(map));
  apiEvents.on('removeRoute', removeRoute(map));
  apiEvents.on('updateRoutes', updateRoutes(map));
}

export default initVehicles;
