import 'leaflet/dist/leaflet.css';
import 'leaflet.locatecontrol';
import 'leaflet.locatecontrol/dist/L.Control.Locate.min.css';
import './AnimatedMarker';
import '../fontello-b738a398/css/fontello.css';
import '../fontello-b738a398/css/animation.css';

import { map as LeafletMap, tileLayer, control } from 'leaflet';

export default () => {
  // Initialize the map
  var map = LeafletMap('map', {});

  // Set the position and zoom level of the map
  map.setView([60.17, 24.95], 13);

  const tileServer = 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png';
  //const tileServer = 'http://{s}.tile.osm.org/{z}/{x}/{y}.png';

  // Initialize the base layer
  tileLayer(tileServer, {
  	maxZoom: 19,
    attribution: '&copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors | CartoDB'
  	//attribution: '&copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  }).addTo(map);

  // control contains more stuff than what is in the typedefs
  const lc = (<any>control).locate({
  	icon: 'icon-location',
  	iconLoading: 'icon-spinner animate-spin',
    keepCurrentZoomLevel: true,
    onLocationError: (err: Error) => console.log(err.message),
  	locateOptions: {
  		enableHighAccuracy: true,
  	}
  }).addTo(map);

  lc.start();

  // Stop following user location if they zoom in/out
  map.on('zoomstart', () => {
    if (lc._active) {
      lc._userPanned = true;
      lc._updateContainerStyle();
      lc._drawMarker();
    }
  });

  return map;
};
