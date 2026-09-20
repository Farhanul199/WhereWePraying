// functions/_lib/calculated-times.js
//
// Last-resort fallback for mosques with NO live jama'ah data at all
// (see area-times.js SOURCE_RANK - this is rank 7, the lowest). It
// fills MAGHRIB ONLY, computed from the mosque's own coordinates and
// the date, using the standard sunset (sun's centre 0.833deg below
// the horizon) solar-position formulas every Islamic prayer-time
// calculator is built on - not sourced from any one app, just public
// astronomy.
//
// Why Maghrib only: Begins (sunset) is genuinely computable, but
// Jama'ah is a mosque committee's own decision - the whole reason this
// product exists (see overview.md). For Fajr/Zuhr/Asr/Isha that
// decision routinely moves Jama'ah well past Adhan, so a calculated
// time would misrepresent it. Maghrib is the one prayer most mosques
// pray at/near Adhan, so a calculated sunset is a reasonable stand-in
// ONLY when nothing else exists - never shown as a real committee time
// (the UI marks it "Estimated for this area").
//
// Toggle: this only ever runs when the calc_maghrib_enabled setting
// (app_settings table, created on first use) is on. Off by default.

function toRad(d) { return (d * Math.PI) / 180; }
function toDeg(r) { return (r * 180) / Math.PI; }
function fixAngle(a) { a = a % 360; return a < 0 ? a + 360 : a; }
function fixHour(h) { h = h % 24; return h < 0 ? h + 24 : h; }

// Sun's declination and the equation of time for a Gregorian date,
// via Julian day -> mean anomaly/longitude -> ecliptic longitude.
function sunPosition(y, m, d) {
  let yy = y, mm = m;
  if (mm <= 2) { yy -= 1; mm += 12; }
  const A = Math.floor(yy / 100);
  const B = 2 - A + Math.floor(A / 4);
  const jd = Math.floor(365.25 * (yy + 4716)) + Math.floor(30.6001 * (mm + 1)) + d + B - 1524.5;

  const D = jd - 2451545.0; // days since J2000.0
  const g = toRad(fixAngle(357.529 + 0.98560028 * D));
  const q = fixAngle(280.459 + 0.98564736 * D);
  const L = toRad(fixAngle(q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)));
  const e = toRad(23.439 - 0.00000036 * D);

  const RA = toDeg(Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L))) / 15;
  const decl = Math.asin(Math.sin(e) * Math.sin(L));
  const eqt = q / 15 - fixHour(RA);
  return { decl, eqt };
}

// Sunset in UTC minutes-since-midnight. null if the sun doesn't set/rise
// that day (polar cases) - callers just leave Maghrib blank there.
function sunsetUtcMinutes(lat, lon, y, m, d) {
  const { decl, eqt } = sunPosition(y, m, d);
  const latR = toRad(lat);
  const angle = toRad(-0.833); // refraction + solar radius, standard "sunset"
  const cosH = (Math.sin(angle) - Math.sin(latR) * Math.sin(decl)) / (Math.cos(latR) * Math.cos(decl));
  if (cosH <= -1 || cosH >= 1) return null;
  const H = toDeg(Math.acos(cosH)) / 15;
  const noonUtc = 12 - lon / 15 - eqt;
  return Math.round(fixHour(noonUtc + H) * 60);
}

// A handful of representative IANA zones for countries currently showing
// zero live times (see admin "By country"), so DST (where it applies,
// e.g. Lithuania) is handled correctly via Intl rather than guessed.
// Anything not listed here falls back to a fixed longitude-based offset.
const COUNTRY_TZ = {
  BD: 'Asia/Dhaka', IR: 'Asia/Tehran', PK: 'Asia/Karachi', SA: 'Asia/Riyadh',
  DZ: 'Africa/Algiers', IN: 'Asia/Kolkata', ID: 'Asia/Jakarta', TR: 'Europe/Istanbul',
  UZ: 'Asia/Tashkent', EG: 'Africa/Cairo', TN: 'Africa/Tunis', CM: 'Africa/Douala',
  AZ: 'Asia/Baku', ZA: 'Africa/Johannesburg', MU: 'Indian/Mauritius', LR: 'Africa/Monrovia',
  KR: 'Asia/Seoul', LT: 'Europe/Vilnius',
};
// Russia alone spans 11 zones - pick the nearest by longitude rather
// than one flat zone, or the estimate can be off by hours.
const RU_ZONES = [
  [-Infinity, 48, 'Europe/Kaliningrad'], [48, 63, 'Europe/Moscow'],
  [63, 71, 'Asia/Yekaterinburg'], [71, 82, 'Asia/Omsk'], [82, 96, 'Asia/Krasnoyarsk'],
  [96, 110, 'Asia/Irkutsk'], [110, 122, 'Asia/Yakutsk'], [122, 143, 'Asia/Vladivostok'],
  [143, 172, 'Asia/Magadan'], [172, Infinity, 'Asia/Kamchatka'],
];
function fallbackTz(lon) {
  const off = Math.max(-12, Math.min(14, Math.round(lon / 15)));
  return off === 0 ? 'Etc/GMT' : (off > 0 ? `Etc/GMT-${off}` : `Etc/GMT+${-off}`);
}
function tzFor(countryCode, lon) {
  const cc = (countryCode || '').toUpperCase();
  if (cc === 'RU') { const z = RU_ZONES.find(([a, b]) => lon >= a && lon < b); return z ? z[2] : 'Europe/Moscow'; }
  return COUNTRY_TZ[cc] || fallbackTz(lon);
}

function utcMinutesToLocalHM(y, m, d, utcMinutes, tz) {
  if (utcMinutes == null) return null;
  const dt = new Date(Date.UTC(y, m - 1, d, 0, Math.round(utcMinutes)));
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(dt);
    return `${parts.find((p) => p.type === 'hour').value}:${parts.find((p) => p.type === 'minute').value}`;
  } catch (e) { return null; }
}

const daysInMonth = (key) => new Date(Date.UTC(+key.slice(0, 4), +key.slice(5, 7), 0)).getUTCDate();
function pack(t) { return t ? t.slice(0, 2) + t.slice(3, 5) : '----'; }

// Build one packed month page (same 20-char-per-day shape as
// area-times.js) with only Maghrib filled in. Returns null if the
// mosque has no usable coordinates or the sun never sets there.
export function buildCalculatedMonthPage(lat, lon, countryCode, key) {
  if (lat == null || lon == null) return null;
  const days = daysInMonth(key);
  const y = +key.slice(0, 4), m = +key.slice(5, 7);
  const tz = tzFor(countryCode, lon);
  let out = '', any = false;
  for (let d = 1; d <= days; d++) {
    const utc = sunsetUtcMinutes(lat, lon, y, m, d);
    const local = utc != null ? utcMinutesToLocalHM(y, m, d, utc, tz) : null;
    if (local) any = true;
    out += pack(null) + pack(null) + pack(null) + pack(local) + pack(null); // fajr,zuhr,asr,maghrib,isha
  }
  return any ? { times: out, jummah: null } : null;
}

/* ----------------------------------------------------- global toggle */

export async function ensureCalcSchema(db) {
  await db.prepare(
    `CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT)`
  ).run();
}

export async function isCalcMaghribEnabled(db) {
  try {
    const row = await db.prepare(`SELECT value FROM app_settings WHERE key = 'calc_maghrib_enabled'`).first();
    return !!row && row.value === '1';
  } catch (e) { return false; } // table not created yet -> off by default
}

export async function setCalcMaghribEnabled(db, on) {
  await ensureCalcSchema(db);
  const now = new Date().toISOString();
  await db.prepare(
    `INSERT INTO app_settings (key, value, updated_at) VALUES ('calc_maghrib_enabled', ?1, ?2)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).bind(on ? '1' : '0', now).run();
}
