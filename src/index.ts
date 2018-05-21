import './styles.css';
import initMap from './map';
import initApi, { subscribe } from './api';
import { Vehicle, Route } from './types';
import initVehicles from './vehicles';
import initRoutes from './routes';

const map = initMap();
const apiEvents = initApi();
initRoutes(map, apiEvents);
initVehicles(map, apiEvents);

subscribe('HSL:2550');
subscribe('HSL:2551');
subscribe('HSL:2552');

if (module.hot) {
  module.hot.dispose(() => {
    window.location.reload();
  });
}
