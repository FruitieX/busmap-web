import { divIcon, marker, Map, Marker, DivIcon } from 'leaflet';
import * as L from 'leaflet';
import { Vehicle } from "./types";
import { getSubscriptions } from './api';
import { indexToHue } from './util';

interface SeenVehicle {
  icon: DivIcon,
  marker?: Marker,
  vehicle: Vehicle
};
const seenVehicles: { [vehicleId: string]: SeenVehicle } = {};

const initMarker = (map: Map, v: Vehicle, icon) => {
  const marker = L.animatedMarker(v.latLng, {icon}).addTo(map);

  const subscriptions = getSubscriptions();
  const subscriptionIndex = subscriptions.indexOf(v.gtfsId);

  const hue = indexToHue(subscriptionIndex, subscriptions.length);
  marker._icon.style.backgroundColor = `hsla(${hue}, 60%, 65%, 0.75)`;
  return marker;
};

const updateVehicle = (map: Map) => (v: Vehicle) => {
  const seenVehicle = seenVehicles[v.veh];

  if (!seenVehicle) {
    // Vehicle not seen before, create new icon & marker
  	const icon = divIcon({ className: 'vehicle', iconSize: [50, 25], html: `<div class="routeId"><span class="icon-bus"></span>${v.desi}</div><div class="dest">${v.dest}</div>` });

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
      }
    } else if (!v.latLng && seenVehicle.marker) {
      // Api supplied null coordinates, remove marker
      seenVehicle.marker.remove();
      delete seenVehicle.marker;
    }
  }
};

export default updateVehicle;
