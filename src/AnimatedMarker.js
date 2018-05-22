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

  disableAnim: function() {
    if (this._icon) { this._icon.style[L.DomUtil.TRANSITION] = ''; }
    if (this._shadow) { this._shadow.style[L.DomUtil.TRANSITION] = ''; }
  },

  panning: false,
  panEndTimeout: null,

  panStart: function() {
    /*
    console.log('panStart()');
    clearTimeout(this.panEndTimeout);
    this.panning = true;
    this.disableAnim();
    */
  },

  panEnd: function() {
    /*
    console.log('panEnd()');
    // FIXME: use requestAnimationFrame() or similar instead of this hack?
    this.panEndTimeout = setTimeout(() => {
      this.panning = false;

      // Zoom is active, zoom timeout will handle the rest
      if (this.zooming) return;
      this.animate();
    }, 20);
    */
  },

  zooming: false,
  zoomEndTimeout: null,

  zoomStart: function() {
    clearTimeout(this.zoomEndTimeout);
    this.zooming = true;
    this.disableAnim();
  },

  zoomEnd: function() {
    // FIXME: use requestAnimationFrame() or similar instead of this hack?
    this.zoomEndTimeout = setTimeout(() => {
      this.zooming = false;

      // Pan is active, pan timeout will handle the rest
      if (this.panning) return;
      this.animate();
    }, 20);
  },

  onAdd: function (map) {
    L.Marker.prototype.onAdd.call(this, map);

    this._map = map;
    this._zoomStart = this.zoomStart.bind(this);
    this._zoomEnd = this.zoomEnd.bind(this);

    this._panStart = this.panStart.bind(this);
    this._panEnd = this.panEnd.bind(this);

    map.on('zoomstart', this._zoomStart);
    map.on('zoomend', this._zoomEnd);

    map.on('movestart', this._panStart);
    map.on('moveend', this._panEnd);
  },

  onRemove: function (map) {
    L.Marker.prototype.onRemove.call(this, map);

    map.off('zoomstart', this._zoomStart);
    map.off('zoomend', this._zoomEnd);

    map.off('movestart', this._panStart);
    map.off('moveend', this._panEnd);
  },

  animate: function(instant) {
    // Any movement looks terrible while zooming, skip
    if (this.zooming) return;

    // Don't start animating again while panning
    //if (this.panning) return;

    // Move to the next location
    this.setLatLng(this.latLng);

    if (!this.prevLatLng) return;

    const dist = this._map.distance(this.prevLatLng, this.latLng);

    // A bus shouldn't travel 100 meters in a second...
    if (dist > 100) return;

    // Add animations
    const speed = instant ? 0 : this.options.interval;

    if (this._icon) {
      this._icon.style.opacity = 1;
      this._icon.style[L.DomUtil.TRANSITION] = getTransition(speed);
    }
    if (this._shadow) { this._shadow.style[L.DomUtil.TRANSITION] = getTransition(speed); }
  },

  setLine: function(latLng, instant){
    this.prevLatLng = this.latLng
    this.latLng = latLng
    this.animate(instant);
  }
});

L.animatedMarker = function (latLng, options) {
  return new L.AnimatedMarker(latLng, options);
};
