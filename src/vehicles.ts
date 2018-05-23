import { divIcon, marker, Map, Marker, DivIcon, Point, popup, Popup } from 'leaflet';
import * as L from 'leaflet';
import { Vehicle, Route } from "./types";
import { getSubscriptions } from './api';
import { indexToHue } from './util';
import EventEmitter from 'eventemitter3';

interface SeenVehicle {
  icon: DivIcon,
  marker?: Marker,
  timeout: number,
  vehicle: Vehicle
};
const seenVehicles: { [vehicleId: string]: SeenVehicle } = {};
const getVehicleId = (v: Vehicle) => `${v.gtfsId}/${v.veh}`;

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
<div class="dest">Vehicle ID: ${v.gtfsId}/${v.veh}</div>
<div class="dest">Last update: ${new Date(v.lastUpdate).toLocaleTimeString()}</div>
<div class="dest">Start time: ${v.start}</div>
<div class="dest">Speed: ${Number(v.spd * 3.6).toFixed(2)} km/h</div>
<div class="dest">Acceleration: ${Number(v.acc).toFixed(2)} m/s²</div>
<div class="dest">Heading: ${v.hdg}</div>
<button class="button" onclick=unsubscribe("${v.gtfsId}")>Remove route</button>
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

const removeVehicle = (map: Map) => (v: SeenVehicle) => {
  console.log('removing vehicle', getVehicleId(v.vehicle));
  clearTimeout(v.timeout);
  if (v.marker) {
    map.removeLayer(v.marker);
    delete v.marker;
  }
};

const updateVehicle = (map: Map) => (v: Vehicle) => {
  let seenVehicle = seenVehicles[getVehicleId(v)];

  if (!seenVehicle) {
    // Vehicle not seen before, create new icon & marker
  	const icon = divIcon({ className: 'vehicle', iconSize: [50, 25], html: iconHtml(v) });

    seenVehicle = {
      icon,
      marker: v.latLng && initMarker(map, v, icon),
      vehicle: v,
      timeout: 0,
    };
    seenVehicle.timeout = setTimeout(() => removeVehicle(map)(seenVehicle), 10000);
    seenVehicles[getVehicleId(v)] = seenVehicle;
  } else {
    // Vehicle seen before, update marker
    if (v.latLng) {
      // First reset vehicle timeout
      clearTimeout(seenVehicle.timeout);
      seenVehicle.timeout = setTimeout(() => removeVehicle(map)(seenVehicle), 10000);

      if (!seenVehicle.marker) {
        seenVehicle.marker = initMarker(map, v, seenVehicle.icon);
      } else {
        seenVehicle.marker.setLine(v.latLng)
        seenVehicle.marker._icon.style.backgroundColor = getBackgroundColor(seenVehicle.vehicle.gtfsId);
        seenVehicle.marker._icon.innerHTML = iconHtml(v);
        updatePopup(seenVehicle.marker._popup, v);
      }
    } else {
      removeVehicle(map)(seenVehicle)
    }
  }
};

const removeRoute = (map: Map) => (r: Route) => {
  Object.values(seenVehicles).forEach(seenVehicle => {
    if (seenVehicle.vehicle.gtfsId === r.gtfsId) {
      removeVehicle(map)(seenVehicle);
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
