import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import 'leaflet.locatecontrol';
import 'leaflet.locatecontrol/dist/L.Control.Locate.min.css';
import './AnimatedMarker';
import './fontello/css/fontello.css';
import './fontello/css/animation.css';
import pkg from '../package.json';

import { map as LeafletMap, tileLayer, control, Control, DomUtil } from 'leaflet';

export default () => {
  // Initialize the map
  var map = LeafletMap('map', {});

  // Set the position and zoom level of the map
  map.setView([60.17, 24.95], 13);

  const tileServer = 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png';
  //const tileServer = 'http://{s}.tile.osm.org/{z}/{x}/{y}.png';

  // Initialize the base layer
  tileLayer(tileServer, {
  	maxZoom: 18,
    maxNativeZoom: 18,
    attribution: `v${pkg.version} | &copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors | <a href="https://carto.com/location-data-services/basemaps/">CartoDB</a> | <a href="https://digitransit.fi/en/developers/apis/4-realtime-api/vehicle-positions/">Digitransit</a>`,
  	//attribution: '&copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  }).addTo(map);

  // control contains more stuff than what is in the typedefs
  const lc = L.control.locate({
  	icon: 'icon-location',
  	iconLoading: 'icon-spinner animate-spin',
    setView: 'once',
    clickBehavior: {
      inView: 'setView',
      outOfView: 'setView'
    },
    //keepCurrentZoomLevel: true,
    // onLocationError: (err: Error) => console.log(err.message),
  	locateOptions: {
  		enableHighAccuracy: true,
      maxZoom: 14
  	}
  }).addTo(map);

  // Needed to make setView: 'once' work after programmatic .start() invocation
  // lc._justClicked = true;

  lc.start();

  /*
  map.once('locationfound', () => {
    // Stop following user location if they zoom in/out
    map.on('zoomstart', () => {
      if (lc._active) {
        lc._userPanned = true;
        lc._updateContainerStyle();
        lc._drawMarker();
      }
    });
  });
  */

  const githubControl = Control.extend({
    options: {
      position: 'topright',
    },

    onAdd: function(map: typeof LeafletMap) {
      const container = DomUtil.create('a', 'leaflet-bar leaflet-control');
      container.title = "Fork me on GitHub";
      container.style.backgroundColor = 'white';
      container.style.width = '30px';
      container.style.height = '30px';
      container.style.fontSize = '1.4em';
      container.style.lineHeight = '30px';
      container.style.textAlign = 'center';
      container.innerHTML = '<a target="_blank" href="https://github.com/FruitieX/busmap-web"><span class="icon-github-circled"></span></a>';

      return container;
    }
  });

  map.addControl(new githubControl());

  return map;
};
