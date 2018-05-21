import './styles.css';
import initMap from './map';
import initApi, { subscribe } from './api';
import { Vehicle, Route } from './types';
import initVehicles from './vehicles';
import initRoutes from './routes';

const activeRoutes = JSON.parse(localStorage.getItem("activeRoutes") || "[]");

const map = initMap();
const apiEvents = initApi();
initRoutes(map, apiEvents);
initVehicles(map, apiEvents);

activeRoutes.forEach((gtfsId: string) => subscribe(gtfsId, false, true));

if (module.hot) {
  module.hot.dispose(() => {
    window.location.reload();
  });
}
