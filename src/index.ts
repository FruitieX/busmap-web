import './styles.css';
import initMap from './map';
import initApi from './api';
import { Vehicle, Route } from './types';
import updateVehicle from './vehicles';
import updateRoutes from './routes';

const map = initMap();
const api = initApi(updateVehicle(map), updateRoutes(map));

api.subscribe('HSL:2550');
api.subscribe('HSL:2551');
api.subscribe('HSL:2552');

if (module.hot) {
  module.hot.dispose(() => {
    window.location.reload();
  });
}
