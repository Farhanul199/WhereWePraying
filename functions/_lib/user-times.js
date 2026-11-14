// functions/_lib/user-times.js
//
// Shared rules for community-submitted Jama'ah times.
//
// Week = Sunday to Saturday in the MOSQUE'S local time. The reset happens
// at midnight Saturday night (start of Sunday). Current-week entries are
// shown normally; last week's are shown greyed out with a "may be out of
// date" note; anything older is ignored.
//
// TIME ZONE: the offset is estimated from longitude (about 1 hour per 15
// degrees). This is not exact (no DST, no country-specific zones), so the
// reset can be off by up to about an hour. Good enough for a weekly reset.

export const PREVIOUS = 'previous';
export const CURRENT = 'current';
export const COOLDOWN_MS = 60 * 60 * 1000; // 1 hour between edits per device
export const PRAYERS = ['fajr', 'zuhr', 'asr', 'maghrib', 'isha'];

// Plausible clock ranges per prayer (24h, minutes). Stops typos and junk.
export const RANGES = {
  fajr: [2 * 60, 8 * 60],
  zuhr: [11 * 60, 15 * 60],
  asr: [13 * 60 + 30, 19 * 60],
  maghrib: [15 * 60 + 30, 21 * 60 + 30],
  isha: [18 * 60 + 30, 23 * 60 + 59],
};

export function parseTime(raw) {
  const m = /^(\d{2}):(\d{2})$/.exec(String(raw || '').trim());
  if (!m) return null;
  const h = +m[1], min = +m[2];
  if (h > 23 || min > 59) return null;
  return { text: `${m[1]}:${m[2]}`, minutes: h * 60 + min };
}

// Mosque-local clock, as a Date whose UTC getters read local time.
export function mosqueLocal(longitude, nowMs = Date.now()) {
  const hours = Math.round((Number(longitude) || 0) / 15);
  return new Date(nowMs + hours * 3600 * 1000);
}

function isoOf(d) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

// Sunday (YYYY-MM-DD, mosque-local) starting the week that contains `local`.
export function weekStartOf(local) {
  const d = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()));
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return isoOf(d);
}

export function previousWeekStart(weekStart) {
  const d = new Date(weekStart + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - 7);
  return isoOf(d);
}

// Describe a mosque's "now": weekday (0-6) and this week's start date.
export function mosqueWeekInfo(longitude, nowMs = Date.now()) {
  const local = mosqueLocal(longitude, nowMs);
  return { weekday: local.getUTCDay(), weekStart: weekStartOf(local) };
}

export function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
  });
}
