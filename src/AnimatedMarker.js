const getTransition = (speed = 0) => {
  return `all ${speed}ms linear, opacity 500ms`;
};

L.AnimatedMarker = L.Marker.extend({
  options: {
    // meters
    distance: 200,
    // ms
    interval: 2000,
    // callback onend
    onEnd: function(){},
  },

  initialize: function (latLng, options) {
    this.setLine(latLng);
    L.Marker.prototype.initialize.call(this, latLng, options);
  },

  zooming: false,

  zoomStart: function() {
    this.zooming = true;
    if (this._icon) { this._icon.style[L.DomUtil.TRANSITION] = ''; }
    if (this._shadow) { this._shadow.style[L.DomUtil.TRANSITION] = ''; }
  },

  zoomEnd: function() {
    this.zooming = false;
    this.animate();
  },

  onAdd: function (map) {
    L.Marker.prototype.onAdd.call(this, map);

    // Start animating when added to the map
    this._zoomStart = this.zoomStart.bind(this);
    this._zoomEnd = this.zoomEnd.bind(this);

    map.on('zoomstart', this._zoomStart);
    map.on('zoomend', this._zoomEnd);

    this.animate(true);
  },

  onRemove: function (map) {
    map.off('zoomstart', this._zoomStart);
    map.off('zoomend', this._zoomEnd);
  },

  animate: function(instant) {
    // Looks terrible while zooming, skip
    if (this.zooming) return;

    const speed = this.options.interval;

        /*
    // Normalize the transition speed from vertex to vertex
    if (this._i < len && this.i > 0) {
      speed = this._latlngs[this._i-1].distanceTo(this._latlngs[this._i]) / this.options.distance * this.options.interval;
    }
    */

    if (!instant) {
      if (this._icon) { this._icon.style[L.DomUtil.TRANSITION] = getTransition(speed); }
      if (this._shadow) { this._shadow.style[L.DomUtil.TRANSITION] = getTransition(speed); }
    }

    // Move to the next vertex
    this.setLatLng(this.latLng);
  },

  setLine: function(latLng){
    this.latLng = latLng
    this.animate();
  }
});

L.animatedMarker = function (latLng, options) {
  return new L.AnimatedMarker(latLng, options);
};
