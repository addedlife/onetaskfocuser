// === shabbos.js ===
// Self-contained sunset calculation + Shabbos window logic.
//
// Shabbos candles should be shown only from candle-lighting (sunset Friday)
// until 72 minutes after sunset on Saturday night (Rabbeinu Tam), adjusting
// each week to the current date and the user's location.
//
// The sunset math is a port of the public-domain SunCalc algorithm
// (Vladimir Agafonkin) — accurate to roughly a minute, no dependencies.

const RAD   = Math.PI / 180;
const DAY_MS = 86400000;
const J1970 = 2440588;
const J2000 = 2451545;
const E     = RAD * 23.4397; // obliquity of the Earth

const SHABBOS_END_OFFSET_MIN = 72; // minutes after Saturday sunset (Rabbeinu Tam)

function toJulian(date)  { return date.valueOf() / DAY_MS - 0.5 + J1970; }
function fromJulian(j)   { return new Date((j + 0.5 - J1970) * DAY_MS); }
function toDays(date)    { return toJulian(date) - J2000; }

function solarMeanAnomaly(d) { return RAD * (357.5291 + 0.98560028 * d); }

function eclipticLongitude(M) {
  const C = RAD * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
  const P = RAD * 102.9372; // perihelion of the Earth
  return M + C + P + Math.PI;
}

function declination(l) {
  return Math.asin(Math.sin(0) * Math.cos(E) + Math.cos(0) * Math.sin(E) * Math.sin(l));
}

const J0 = 0.0009;
function approxTransit(Ht, lw, n) { return J0 + (Ht + lw) / (2 * Math.PI) + n; }
function solarTransitJ(ds, M, L)  { return J2000 + ds + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L); }
function hourAngle(h, phi, dec)   { return Math.acos((Math.sin(h) - Math.sin(phi) * Math.sin(dec)) / (Math.cos(phi) * Math.cos(dec))); }

// Sunset (top of the solar disc at the horizon, incl. atmospheric refraction).
// `date` may be any time on the desired civil day; noon is safest.
export function getSunset(date, lat, lng) {
  const lw  = RAD * -lng;
  const phi = RAD * lat;
  const d   = toDays(date);
  const n   = Math.round(d - J0 - lw / (2 * Math.PI));
  const ds  = approxTransit(0, lw, n);
  const M   = solarMeanAnomaly(ds);
  const L   = eclipticLongitude(M);
  const dec = declination(L);

  const h0   = RAD * -0.833; // standard sunset altitude
  const w    = hourAngle(h0, phi, dec);
  const a    = approxTransit(w, lw, n);
  const Jset = solarTransitJ(a, M, L);
  const set  = fromJulian(Jset);
  return Number.isNaN(set.valueOf()) ? null : set;
}

// Returns { active, start, end } for the Shabbos that brackets `now`.
// `start` = Friday sunset (candle lighting), `end` = Saturday sunset + 72 min.
// On any other day, returns active:false (and the upcoming window when known).
export function getShabbosWindow(now, lat, lng) {
  if (lat == null || lng == null) return { active: false, start: null, end: null };

  const day = now.getDay(); // 0 = Sun … 5 = Fri, 6 = Sat

  // Anchor on the Friday and Saturday that surround `now`.
  let friday, saturday;
  if (day === 5) {            // Friday
    friday   = new Date(now);
    saturday = new Date(now); saturday.setDate(saturday.getDate() + 1);
  } else if (day === 6) {     // Saturday
    saturday = new Date(now);
    friday   = new Date(now); friday.setDate(friday.getDate() - 1);
  } else {
    return { active: false, start: null, end: null };
  }

  // Use local noon of each day so the sunset solver lands on the right civil date.
  const noon = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0, 0);
  const friSunset = getSunset(noon(friday),   lat, lng);
  const satSunset = getSunset(noon(saturday), lat, lng);
  if (!friSunset || !satSunset) return { active: false, start: null, end: null };

  const start = friSunset;
  const end   = new Date(satSunset.getTime() + SHABBOS_END_OFFSET_MIN * 60000);
  const active = now >= start && now <= end;
  return { active, start, end };
}

// ── Cached user location (localStorage) + geolocation request ────────────────
const GEO_KEY = "ot_user_geo";

export function getCachedLocation() {
  try {
    const raw = localStorage.getItem(GEO_KEY);
    if (!raw) return null;
    const g = JSON.parse(raw);
    if (typeof g?.lat === "number" && typeof g?.lng === "number") return g;
  } catch {}
  return null;
}

// Resolves to {lat,lng} or null. Caches the result. Never rejects.
export function requestLocation() {
  return new Promise((resolve) => {
    const cached = getCachedLocation();
    if (cached) { resolve(cached); return; }
    if (typeof navigator === "undefined" || !navigator.geolocation) { resolve(null); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const g = { lat: pos.coords.latitude, lng: pos.coords.longitude, ts: Date.now() };
        try { localStorage.setItem(GEO_KEY, JSON.stringify(g)); } catch {}
        resolve(g);
      },
      () => resolve(null),
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 7 * DAY_MS }
    );
  });
}
