// functions/api/admin/calc-maghrib.js
//
// Global on/off switch for the calculated-Maghrib fallback (see
// functions/_lib/calculated-times.js). Off by default. When on, any
// mosque anywhere with NO live jama'ah data from a real source gets
// Maghrib computed from its own coordinates (sunset), marked
// "Estimated for this area" on the live site - never a substitute for
// a real committee time, and never touches a mosque any real source
// already covers.
//
// GET  /api/admin/calc-maghrib            -> { enabled }
// POST /api/admin/calc-maghrib  { enabled } -> { ok, enabled }
// Both need X-Broadcast-Key.

import { isAdminRequest } from '../../_lib/auth.js';
import { isCalcMaghribEnabled, setCalcMaghribEnabled } from '../../_lib/calculated-times.js';

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

export async function onRequestGet(context) {
  if (!isAdminRequest(context)) return json({ error: 'unauthorized' }, 401);
  try {
    return json({ enabled: await isCalcMaghribEnabled(context.env.DB) });
  } catch (e) { return json({ error: String(e).slice(0, 300) }, 500); }
}

export async function onRequestPost(context) {
  if (!isAdminRequest(context)) return json({ error: 'unauthorized' }, 401);
  let body;
  try { body = await context.request.json(); } catch (e) { body = {}; }
  try {
    await setCalcMaghribEnabled(context.env.DB, !!body.enabled);
    return json({ ok: true, enabled: !!body.enabled });
  } catch (e) { return json({ error: String(e).slice(0, 300) }, 500); }
}
