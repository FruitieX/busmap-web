const getTransition = (speed = 0) => {
  return `all ${speed}ms linear, opacity 500ms linear, background-color 500ms linear`;
};

L.AnimatedMarker = L.Marker.extend({
  options: {
    // ms
    interval: 1500,
    // callback onend
    //onEnd: function(){},
  },

  initialize: function (latLng, options) {
    this.setLine(latLng, true);
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
    map.on('zoomend', () => setTimeout(this._zoomEnd));

    //this.animate(true);
  },

  onRemove: function (map) {
    L.Marker.prototype.onRemove.call(this, map);

    map.off('zoomstart', this._zoomStart);
    map.off('zoomend', this._zoomEnd);
  },

  animate: function(instant) {
    // Looks terrible while zooming, skip
    if (this.zooming) return;

    const speed = instant ? 0 : this.options.interval;

    if (this._icon) {
      this._icon.style.opacity = 1;
      this._icon.style[L.DomUtil.TRANSITION] = getTransition(speed);
    }
    if (this._shadow) { this._shadow.style[L.DomUtil.TRANSITION] = getTransition(speed); }

    // Move to the next vertex
    this.setLatLng(this.latLng);
  },

  setLine: function(latLng, instant){
    this.latLng = latLng
    this.animate(instant);
  }
});

L.animatedMarker = function (latLng, options) {
  return new L.AnimatedMarker(latLng, options);
};
