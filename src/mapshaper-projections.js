/* @requires mapshaper-common */
var DEG2RAD = Math.PI / 180.0;

function initProj(proj, opts) {
  var base = {
    spherical: false, // Toggle for spherical / ellipsoidal formulas
    x0: 0,   // false easting (used by UTM and some other projections)
    y0: 0,   // false northing
    k0: 1,   // scale factor
    R: 6378137, // Earth radius / semi-major axis (spherical / ellipsoidal formulas)
    // E: flattening parameter for GRS80 ellipsoid (others not supported)
    E: 0.0818191908426214943348,

    forward: function(lng, lat, xy) {
      xy = xy || {};
      this.projectLatLng(lat * DEG2RAD, lng * DEG2RAD, xy);
      xy.x = this.R * xy.x + this.x0;
      xy.y = this.R * xy.y + this.y0;
      return xy;
    },
    inverse: function(x, y, ll) {
      x = (x - this.x0) / this.R;
      y = (y - this.y0) / this.R;
      ll = ll || {};
      this.unprojectXY(x, y, ll);
      ll.lat /= DEG2RAD;
      ll.lng /= DEG2RAD;
      return ll;
    },
    // Approximate the inverse ellipsoidal projection function when
    // the forward ellipsoidal formula and both spheroidal formulas are known.
    // (Many ellipsoidal inverse projections lack closed formulas and/or are a hassle to implement).
    // Accuracy depends on # of iterations, projection, etc.
    // n of 4 gives ~1e-10 degree accuracy with Lambert CC.
    inverseEllApprox: function(x, y, ll) {
      var xy = {};
      var dx = 0, dy = 0;
      var n = 4;
      while (true) {
        this.spherical = true;
        this.unprojectXY(x + dx, y + dy, ll);
        this.spherical = false;
        if (!--n) break;
        this.projectLatLng(ll.lat, ll.lng, xy);
        dx += x - xy.x;
        dy += y - xy.y;
      }
    }
  };
  utils.extend(proj, base, opts);
}

function WebMercator() {
  return new Mercator({spherical: true});
}

// Optional params: lat0, lng0 (in decimal degrees)
function Mercator(opts) {
  initProj(this, opts);
  var lat0 = (this.lat0 || 0) * DEG2RAD;
  var lng0 = (this.lng0 || 0) * DEG2RAD;
  this.projectLatLng = function(lat, lng, xy) {
    xy.x = lng - lng0;
    if (!this.spherical) {
      xy.y = Math.log(Math.tan(Math.PI * 0.25 + lat * 0.5) *
        Math.pow((1 - this.E * Math.sin(lat)) / (1 + this.E * Math.sin(lat)), this.E * 0.5));
    } else {
      xy.y = Math.log(Math.tan(Math.PI * 0.25 + lat * 0.5));
    }
  };
  this.unprojectXY = function(x, y, ll) {
    if (!this.spherical) {
      this.inverseEllApprox(x, y, ll);
    } else {
      ll.lng = x + lng0;
      ll.lat = Math.PI * 0.5 - 2 * Math.atan(Math.exp(-y));
    }
  };
}

function UTM(opts) {
  var m = /^([\d]+)([NS])$/i.exec(opts.zone || "");
  if (!m) {
    throw new Error("[UTM] Expected a UTM zone parameter of the form: 17N");
  }
  var z = parseFloat(m[1]);
  var proj = new TransverseMercator({
    k0: 0.9996,
    lng0: z * 6 - 183,
    lat0: 0,
    x0: 500000,
    y0: m[2].toUpperCase() == 'S' ? 1e7 : 0
  });
  return proj;
}

function TransverseMercator(opts) {
  initProj(this, opts);
  var lat0 = this.lat0 * DEG2RAD;
  var lng0 = this.lng0 * DEG2RAD;
  var _m0 = calcTransMercM(lat0, this.E);
  this.projectLatLng = function(lat, lng, xy) {
    if (this.spherical) {
      var B = Math.cos(lat) * Math.sin(lng - lng0);
      xy.x = 0.5 * this.k0 * Math.log((1 + B) / (1 - B));
      xy.y = this.k0 * (Math.atan(Math.tan(lat) / Math.cos(lng - lng0)) - lat0);
    } else {
      var e2 = this.E * this.E,
          ep2 = e2 / (1 - e2),
          sinLat = Math.sin(lat),
          cosLat = Math.cos(lat),
          tanLat = Math.tan(lat),
          n = 1 / Math.sqrt(1 - e2 * sinLat * sinLat),
          t = tanLat * tanLat,
          c = ep2 * cosLat * cosLat,
          a = cosLat * (lng - lng0),
          a2 = a * a,
          m = calcTransMercM(lat, this.E);
      xy.x = this.k0 * n * (a + a * a2 / 6 * (1 - t + c) +
        a2 * a2 * a / 120 * (5 - 18 * t + t * t + 72 * c - 58 * ep2));
      xy.y = this.k0 * (m - _m0 + n * tanLat *
        (a2 / 2 + a2 * a2 / 24 * (5 - t + 9 * c + 4 * c * c)));
    }
  };
  this.unprojectXY = function(x, y, ll) {
    if (this.spherical) {
      var D = y / this.k0 + lat0;
      ll.lat = Math.asin(Math.sin(D) / cosh(x / this.k0));
      ll.lng = lng0 +
        Math.atan(sinh(x / this.k0) / Math.cos(D));
    } else {
      this.inverseEllApprox(x, y, ll);
    }
  };
}

// Authalic sin
function sinh(x) {
  return (Math.exp(x) - Math.exp(-x)) * 0.5;
}

// Authalic cosine
function cosh(x) {
  return (Math.exp(x) + Math.exp(-x)) * 0.5;
}

function calcTransMercM(lat, e) {
  var e2 = e * e,
      e4 = e2 * e2,
      e6 = e4 * e2;
  return (lat * (1 - e2 / 4.0 - 3 * e4 / 64 - 5 * e6 / 256) -
    Math.sin(2 * lat) * (3 * e2 / 8 + 3 * e4 / 32 + 45 * e6 / 1024) +
    Math.sin(4 * lat) * (15 * e4 / 256 + 45 * e6 / 1024) -
    Math.sin(6 * lat) * (35 * e6 / 3072));
}

function AlbersNYT() {
  var lambert = new LambertConformalConic({lng0:-96, lat1:33, lat2:45, lat0:39, spherical: true});
  return new MixedProjection(new AlbersUSA())
    .addFrame(lambert, {lat:63, lng:-152}, {lat:27, lng:-115}, 6000000, 3000000, 0.31, 29.2)  // AK
    .addFrame(lambert, {lat:20.9, lng:-157}, {lat:28.2, lng:-106.6}, 2000000, 4000000, 0.9, 40); // HI
}

function AlbersUSA() {
  return new AlbersEqualAreaConic({lng0:-96, lat1:29.5, lat2:45.5, lat0:37.5});
}

/*
function LambertUSA() {
  return new LambertConformalConic({lng0:-96, lat1:33, lat2:45, lat0:39});
}
*/

// Parameters (in decimal degrees):
//   lng0  Reference longitude
//   lat0  Reference latitude
//   lat1  First standard parallel
//   lat2  Second standard parallel
function AlbersEqualAreaConic(opts) {
  initProj(this, opts);
  var E = this.E;
  var lat0 = this.lat0 * DEG2RAD,
      lat1 = this.lat1 * DEG2RAD,
      lat2 = this.lat2 * DEG2RAD,
      lng0 = this.lng0 * DEG2RAD;

  var cosLat1 = Math.cos(lat1),
      sinLat1 = Math.sin(lat1),
      _sphN = 0.5 * (sinLat1 + Math.sin(lat2)),
      _sphC = cosLat1 * cosLat1 + 2.0 * _sphN * sinLat1,
      _sphRho0 = Math.sqrt(_sphC - 2.0 * _sphN * Math.sin(lat0)) / _sphN;

  var m1 = calcAlbersMell(E, lat1),
      m2 = calcAlbersMell(E, lat2),
      q0 = calcAlbersQell(E, lat0),
      q1 = calcAlbersQell(E, lat1),
      q2 = calcAlbersQell(E, lat2),
      _ellN = (m1 * m1 - m2 * m2) / (q2 - q1),
      _ellC = m1 * m1 + _ellN * q1,
      _ellRho0 = Math.sqrt(_ellC - _ellN * q0) / _ellN,
      _ellAuthConst = 1 - (1 - E * E) / (2 * E) * Math.log((1 - E) / (1 + E));

  this.projectLatLng = function(lat, lng, xy) {
    var rho, theta;
    if (!this.spherical) {
      var q = calcAlbersQell(E, lat);
      rho = Math.sqrt(_ellC - _ellN * q) / _ellN;
      theta = _ellN * (lng - lng0);
      xy.x = rho * Math.sin(theta);
      xy.y = _ellRho0 - rho * Math.cos(theta);
    } else {
      rho = Math.sqrt(_sphC - 2 * _sphN * Math.sin(lat)) /
        _sphN;
      theta = _sphN * (lng - lng0);
      xy.x = rho * Math.sin(theta);
      xy.y = _sphRho0 - rho * Math.cos(theta);
    }
  };

  this.unprojectXY = function(x, y, ll) {
    var rho, theta, e2, e4, q, beta;
    if (!this.spherical) {
      theta = Math.atan(x / (_ellRho0 - y));
      ll.lng = lng0 + theta / _ellN;
      e2 = E * E;
      e4 = e2 * e2;
      rho = Math.sqrt(x * x + (_ellRho0 - y) * (_ellRho0 - y));
      q = (_ellC - rho * rho * _ellN * _ellN) / _ellN;
      beta = Math.asin(q / _ellAuthConst);
      ll.lat = beta + Math.sin(2 * beta) *
        (e2 / 3 + 31 * e4 / 180 + 517 * e4 * e2 / 5040) +
        Math.sin(4 * beta) * (23 * e4 / 360 + 251 * e4 * e2 / 3780) +
        Math.sin(6 * beta) * 761 * e4 * e2 / 45360;
    } else {
      rho = Math.sqrt(x * x + (_sphRho0 - y) * (_sphRho0 - y));
      theta = Math.atan(x / (_sphRho0 - y));
      ll.lat = Math.asin((_sphC - rho * rho * _sphN * _sphN) *
        0.5 / _sphN);
      ll.lng = theta / _sphN + lng0;
    }
  };
}

function calcAlbersQell(e, lat) {
  var sinLat = Math.sin(lat);
  return (1 - e * e) * (sinLat / (1 - e * e * sinLat * sinLat) -
    0.5 / e * Math.log((1 - e * sinLat) / (1 + e * sinLat)));
}

function calcAlbersMell(e, lat) {
  var sinLat = Math.sin(lat);
  return Math.cos(lat) / Math.sqrt(1 - e * e * sinLat * sinLat);
}

// Parameters (in decimal degrees):
//   lng0  Reference longitude
//   lat0  Reference latitude
//   lat1  First standard parallel
//   lat2  Second standard parallel
function LambertConformalConic(opts) {
  initProj(this, opts);
  var E = this.E;
  var lat0 = this.lat0 * DEG2RAD,
      lat1 = this.lat1 * DEG2RAD,
      lat2 = this.lat2 * DEG2RAD,
      lng0 = this.lng0 * DEG2RAD;
  var _sphN = Math.log(Math.cos(lat1) / Math.cos(lat2)) /
    Math.log(Math.tan(Math.PI / 4.0 + lat2 / 2.0) /
    Math.tan(Math.PI / 4.0 + lat1 / 2.0));
  var _sphF = Math.cos(lat1) *
    Math.pow(Math.tan(Math.PI / 4.0 + lat1 / 2.0), _sphN) / _sphN;
  var _sphRho0 = _sphF /
    Math.pow(Math.tan(Math.PI / 4.0 + lat0 / 2.0), _sphN);
  var _ellN = (Math.log(calcLambertM(lat1, E)) -
    Math.log(calcLambertM(lat2, E))) /
    (Math.log(calcLambertT(lat1, E)) -
    Math.log(calcLambertT(lat2, E)));
  var _ellF = calcLambertM(lat1, E) / (_ellN *
    Math.pow(calcLambertT(lat1, E), _ellN));
  var _ellRho0 = _ellF *
    Math.pow(calcLambertT(lat0, E), _ellN);

  this.projectLatLng = function(lat, lng, xy) {
    var rho, theta;
    if (!this.spherical) {
      var t = calcLambertT(lat, E);
      rho = _ellF * Math.pow(t, _ellN);
      theta = _ellN * (lng - lng0);
      xy.x = rho * Math.sin(theta);
      xy.y = _ellRho0 - rho * Math.cos(theta);
    } else {
      rho = _sphF /
        Math.pow(Math.tan(Math.PI / 4 + lat / 2.0), _sphN);
      theta = _sphN * (lng - lng0);
      xy.x = rho * Math.sin(theta);
      xy.y = _sphRho0 - rho * Math.cos(theta);
    }
  };

  this.unprojectXY = function(x, y, ll) {
    if (!this.spherical) {
      this.inverseEllApprox(x, y, ll);
    } else {
      var rho0 = _sphRho0;
      var rho = Math.sqrt(x * x + (rho0 - y) * (rho0 - y));
      if (_sphN < 0) {
        rho = -rho;
      }
      var theta = Math.atan(x / (rho0 - y));
      ll.lat = 2 * Math.atan(Math.pow(_sphF /
        rho, 1 / _sphN)) - 0.5 * Math.PI;
      ll.lng = theta / _sphN + lng0;
    }
  };
}

function calcLambertT(lat, e) {
  var sinLat = Math.sin(lat);
  return Math.tan(Math.PI / 4 - lat / 2) /
    Math.pow((1 - e * sinLat) / (1 + e * sinLat), e / 2);
}

function calcLambertM(lat, e) {
  var sinLat = Math.sin(lat);
  return Math.cos(lat) / Math.sqrt(1 - e * e * sinLat * sinLat);
}

function WinkelTripel() {
  initProj(this);
  this.projectLatLng = function(lat, lng, xy) {
    var lat0 = 50.4670 * DEG2RAD;
    var a = Math.acos( Math.cos(lat) * Math.cos(lng * 0.5));
    var sincAlpha = a === 0 ? 1 : Math.sin( a ) / a;
    xy.x = 0.5 * (lng * Math.cos(lat0) + 2 * Math.cos(lat) * Math.sin(0.5 * lng) / sincAlpha);
    xy.y = 0.5 * (lat + Math.sin(lat) / sincAlpha);
  };
}

// A compound projection, consisting of a default projection and one or more rectangular frames
// that are reprojected and/or affine transformed.
// @proj Default projection.
function MixedProjection(proj) {
  var frames = [];

  // @proj2 projection to use.
  // @ctr1 {lat, lng} center of the frame contents.
  // @ctr2 {lat, lng} geo location to move the frame center
  // @frameWidth Width of the frame in base projection units
  // @frameHeight Height of the frame in base projection units
  // @scale Scale factor; 1 = no scaling.
  // @rotation Rotation in degrees; 0 = no rotation.
  this.addFrame = function(proj2, ctr1, ctr2, frameWidth, frameHeight, scale, rotation) {
    var xy1 = proj.forward(ctr1.lng, ctr1.lat);
    var xy2 = proj.forward(ctr2.lng, ctr2.lat);
    var bbox = [xy1.x - frameWidth * 0.5, xy1.y - frameHeight * 0.5, xy1.x + frameWidth * 0.5, xy1.y + frameHeight * 0.5];
    var m = new Matrix2D();
    m.rotate(rotation * DEG2RAD, xy1.x, xy1.y );
    m.scale(scale, scale);
    m.transformXY(xy1.x, xy1.y, xy1);
    m.translate(xy2.x - xy1.x, xy2.y - xy1.y);
    frames.push({
      bbox: bbox,
      matrix: m,
      projection: proj2
    });
    return this;
  };

  this.forward = function(lng, lat, xy) {
    var frame, bbox;
    xy = proj.forward(lng, lat, xy);
    for (var i=0, n=frames.length; i<n; i++) {
      frame = frames[i];
      bbox = frame.bbox;
      if (xy.x >= bbox[0] && xy.x <= bbox[2] && xy.y >= bbox[1] && xy.y <= bbox[3]) {
        frame.projection.forward(lng, lat, xy);
        frame.matrix.transformXY(xy.x, xy.y, xy);
        break;
      }
    }
    return xy;
  };

  // TODO: implement inverse projection for frames
  this.inverse = function(x, y, ll) {
    return proj.inverse.call(proj, x, y, ll);
  };
}

// A matrix class that supports affine transformations (scaling, translation, rotation).
// Elements:
//   a  c  tx
//   b  d  ty
//   0  0  1  (u v w are not used)
//
function Matrix2D() {
  this.a = 1;
  this.c = 0;
  this.tx = 0;
  this.b = 0;
  this.d = 1;
  this.ty = 0;
}

Matrix2D.prototype.transformXY = function(x, y, p) {
  p = p || {};
  p.x = x * this.a + y * this.c + this.tx;
  p.y = x * this.b + y * this.d + this.ty;
  return p;
};

Matrix2D.prototype.translate = function(dx, dy) {
  this.tx += dx;
  this.ty += dy;
};

Matrix2D.prototype.rotate = function(q, x, y) {
  var cos = Math.cos(q);
  var sin = Math.sin(q);
  x = x || 0;
  y = y || 0;
  this.a = cos;
  this.c = -sin;
  this.b = sin;
  this.d = cos;
  this.tx += x - x * cos + y * sin;
  this.ty += y - x * sin - y * cos;
};

Matrix2D.prototype.scale = function(sx, sy) {
  this.a *= sx;
  this.c *= sx;
  this.b *= sy;
  this.d *= sy;
};
