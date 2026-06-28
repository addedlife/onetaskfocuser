/**
 * Shabbos window + sunset (port of Pro 4 `shabbos.js`). Candle-lighting is Friday sunset; Shabbos ends
 * 72 minutes after Saturday sunset (Rabbeinu Tam). The sunset math is the public-domain SunCalc
 * algorithm (Vladimir Agafonkin) — ~1-minute accuracy, no dependencies.
 */

const RAD = Math.PI / 180;
const DAY_MS = 86_400_000;
const J1970 = 2440588;
const J2000 = 2451545;
const E = RAD * 23.4397; // obliquity of the Earth
const SHABBOS_END_OFFSET_MIN = 72;

export interface GeoLocation {
  lat: number;
  lng: number;
  ts?: number;
}

export interface ShabbosWindow {
  active: boolean;
  start: Date | null;
  end: Date | null;
}

const toJulian = (date: Date): number => date.valueOf() / DAY_MS - 0.5 + J1970;
const fromJulian = (j: number): Date => new Date((j + 0.5 - J1970) * DAY_MS);
const toDays = (date: Date): number => toJulian(date) - J2000;

const solarMeanAnomaly = (d: number): number => RAD * (357.5291 + 0.98560028 * d);

function eclipticLongitude(M: number): number {
  const C = RAD * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
  const P = RAD * 102.9372; // perihelion of the Earth
  return M + C + P + Math.PI;
}

const declination = (l: number): number =>
  Math.asin(Math.sin(0) * Math.cos(E) + Math.cos(0) * Math.sin(E) * Math.sin(l));

const J0 = 0.0009;
const approxTransit = (Ht: number, lw: number, n: number): number =>
  J0 + (Ht + lw) / (2 * Math.PI) + n;
const solarTransitJ = (ds: number, M: number, L: number): number =>
  J2000 + ds + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
const hourAngle = (h: number, phi: number, dec: number): number =>
  Math.acos((Math.sin(h) - Math.sin(phi) * Math.sin(dec)) / (Math.cos(phi) * Math.cos(dec)));

/** Sunset for the civil day of `date` (noon is safest), including atmospheric refraction. */
export function getSunset(date: Date, lat: number, lng: number): Date | null {
  const lw = RAD * -lng;
  const phi = RAD * lat;
  const d = toDays(date);
  const n = Math.round(d - J0 - lw / (2 * Math.PI));
  const ds = approxTransit(0, lw, n);
  const M = solarMeanAnomaly(ds);
  const L = eclipticLongitude(M);
  const dec = declination(L);

  const h0 = RAD * -0.833; // standard sunset altitude
  const w = hourAngle(h0, phi, dec);
  const a = approxTransit(w, lw, n);
  const set = fromJulian(solarTransitJ(a, M, L));
  return Number.isNaN(set.valueOf()) ? null : set;
}

/**
 * The Shabbos window bracketing `now`: `start` = Friday sunset, `end` = Saturday sunset + 72 min.
 * Returns `active:false` on any other day.
 */
export function getShabbosWindow(now: Date, lat: number | null, lng: number | null): ShabbosWindow {
  if (lat == null || lng == null) return { active: false, start: null, end: null };

  const day = now.getDay(); // 0 = Sun … 5 = Fri, 6 = Sat
  let friday: Date;
  let saturday: Date;
  if (day === 5) {
    friday = new Date(now);
    saturday = new Date(now);
    saturday.setDate(saturday.getDate() + 1);
  } else if (day === 6) {
    saturday = new Date(now);
    friday = new Date(now);
    friday.setDate(friday.getDate() - 1);
  } else {
    return { active: false, start: null, end: null };
  }

  const noon = (d: Date): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0, 0);
  const friSunset = getSunset(noon(friday), lat, lng);
  const satSunset = getSunset(noon(saturday), lat, lng);
  if (!friSunset || !satSunset) return { active: false, start: null, end: null };

  const start = friSunset;
  const end = new Date(satSunset.getTime() + SHABBOS_END_OFFSET_MIN * 60_000);
  return { active: now >= start && now <= end, start, end };
}

const GEO_KEY = 'ot_user_geo';

/** Cached {lat,lng} from a prior geolocation request, or null. */
export function getCachedLocation(): GeoLocation | null {
  try {
    const raw = localStorage.getItem(GEO_KEY);
    if (!raw) return null;
    const g = JSON.parse(raw) as Partial<GeoLocation>;
    if (typeof g?.lat === 'number' && typeof g?.lng === 'number') {
      return { lat: g.lat, lng: g.lng, ts: g.ts };
    }
  } catch {
    /* ignore */
  }
  return null;
}

/** Resolve {lat,lng} (cached or via geolocation), caching the result. Never rejects. */
export function requestLocation(): Promise<GeoLocation | null> {
  return new Promise((resolve) => {
    const cached = getCachedLocation();
    if (cached) {
      resolve(cached);
      return;
    }
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      resolve(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const g: GeoLocation = { lat: pos.coords.latitude, lng: pos.coords.longitude, ts: Date.now() };
        try {
          localStorage.setItem(GEO_KEY, JSON.stringify(g));
        } catch {
          /* ignore */
        }
        resolve(g);
      },
      () => resolve(null),
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 7 * DAY_MS },
    );
  });
}
