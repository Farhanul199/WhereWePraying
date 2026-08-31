// functions/api/push/poke.js
// POST /api/push/poke  body: { friendUserId }
// Records a poke (once per pair per recipient-local day, enforced by a
// UNIQUE index) and, if the friend has a push subscription on file,
// sends them a Web Push notification nudging them about their Qur'an
// reading streak.
//
// Additionally: the FIRST poke a person receives on a given day (from
// whoever sends it first) also triggers a short reminder email, styled
// like the newsletter subscribe-confirmation email (see subscribe.js).
// If a second or third friend pokes the same person later that day,
// no further email goes out — only the push/in-app notification.

import { sendWebPush } from './_webpush.js';

// Same convention used consistently across poke.js and quran-streak.js
// for "what day is it": the recipient's own local date if we know their
// timezone (stored on their push subscription at subscribe-time),
// falling back to UTC for someone who's never enabled push. A flat UTC
// day would put the boundary at a different real-world moment than the
// streak tracking (which uses the browser's local date), causing
// edge-case mismatches for anyone not near UTC.
async function localDateKeyFor(db, userId) {
  try {
    const sub = await db
      .prepare('SELECT tz FROM push_subscriptions WHERE user_id = ? AND tz IS NOT NULL LIMIT 1')
      .bind(userId)
      .first();
    if (sub && sub.tz) {
      return new Intl.DateTimeFormat('en-CA', { timeZone: sub.tz }).format(new Date());
    }
  } catch (e) {
    // fall through to UTC below
  }
  return new Date().toISOString().slice(0, 10);
}

function json(payload, status) {
  return new Response(JSON.stringify(payload), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function resolveSession(context) {
  try {
    const cookies = context.request.headers.get('cookie') || '';
    const sessionId = cookies.split('; ').find((c) => c.startsWith('wwp_session='))?.split('=')[1];
    if (!sessionId) return null;
    const raw = await context.env.SESSIONS.get(sessionId);
    if (!raw) return null;
    const session = JSON.parse(raw);
    if (new Date(session.expiresAt) < new Date()) return null;
    return session;
  } catch (e) {
    return null;
  }
}

// Same layout/palette as the subscribe.js welcome email (cream page
// background, centered 600px card, muted-brown body text, coral CTA) —
// just a coral banner instead of the welcome image, since there's no
// dedicated poke graphic.
function buildPokeReminderEmailHtml(pokerName) {
  return `<html>
<body style="margin:0;padding:20px;background-color:#fbf3ec;">
  <div style="max-width:600px;margin:0 auto;">
    <div style="background:#f4714e;border-radius:24px;padding:32px 24px;text-align:center;">
      <div style="font-size:38px;line-height:1;margin-bottom:8px;">📖</div>
      <p style="margin:0;font-size:18px;font-weight:700;color:#ffffff;">${pokerName} is thinking of you</p>
    </div>
    <p style="margin-top:24px;font-size:14px;color:#5c4033;line-height:1.6;text-align:center;">
      Just a gentle nudge — take a few quiet minutes today for the Qur'an. Even a page or two counts.
    </p>
    <p style="margin-top:16px;text-align:center;">
      <a href="https://wherewepraying.com/#quran" style="color:#f4714e;text-decoration:none;font-weight:600;">Open the Qur'an →</a>
    </p>
  </div>
</body>
</html>`;
}

export async function onRequestPost(context) {
  const session = await resolveSession(context);
  if (!session) return json({ error: 'Not signed in' }, 401);

  let body;
  try {
    body = await context.request.json();
  } catch (e) {
    return json({ error: 'Invalid request body' }, 400);
  }

  const friendUserId = body.friendUserId;
  if (!friendUserId || typeof friendUserId !== 'string') {
    return json({ error: 'Invalid friendUserId' }, 400);
  }
  if (friendUserId === session.userId) {
    return json({ error: 'Cannot poke yourself' }, 400);
  }

  const db = context.env.DB;

  let isFriend;
  try {
    // Only accepted friends can be poked — prevents poking arbitrary users.
    isFriend = await db
      .prepare(
        `SELECT 1 FROM friendships
         WHERE status = 'accepted'
           AND ((requester_id = ?1 AND addressee_id = ?2) OR (requester_id = ?2 AND addressee_id = ?1))`
      )
      .bind(session.userId, friendUserId)
      .first();
  } catch (e) {
    return json({ error: 'db_error', message: String(e) }, 500);
  }
  if (!isFriend) return json({ error: 'Not friends with this user' }, 403);

  const todayKey = await localDateKeyFor(db, friendUserId);

  try {
    await db
      .prepare(
        `INSERT INTO quran_pokes (from_user_id, to_user_id, poke_date, created_at)
         VALUES (?1, ?2, ?3, datetime('now'))`
      )
      .bind(session.userId, friendUserId, todayKey)
      .run();
  } catch (e) {
    const msg = String(e);
    // A UNIQUE constraint violation means they were already poked today —
    // anything else is a real failure, not a "already poked" state.
    if (/unique/i.test(msg)) return json({ error: 'Already poked today' }, 409);
    return json({ error: 'db_error', message: msg }, 500);
  }

  let pokerName = 'A friend';
  let subs = { results: [] };
  let isFirstPokeToday = false;
  try {
    pokerName =
      (await db.prepare('SELECT username FROM users WHERE id = ?').bind(session.userId).first())
        ?.username || 'A friend';
    subs = await db
      .prepare('SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?')
      .bind(friendUserId)
      .all();

    const countRow = await db
      .prepare('SELECT COUNT(*) AS c FROM quran_pokes WHERE to_user_id = ? AND poke_date = ?')
      .bind(friendUserId, todayKey)
      .first();
    isFirstPokeToday = !!countRow && countRow.c === 1;
  } catch (e) {
    // The poke itself is already recorded at this point — a lookup failure
    // here just means we can't push-notify/email, not that the poke failed.
    return json({ success: true, delivered: false, pushLookupError: String(e) });
  }

  // Fire-and-forget — only for the first poke this person received today,
  // regardless of who sent it, so a busy day of multiple pokers doesn't
  // turn into a stack of near-identical emails.
  if (isFirstPokeToday && context.env.RESEND_API_KEY) {
    try {
      const recipient = await db.prepare('SELECT email FROM users WHERE id = ?').bind(friendUserId).first();
      if (recipient && recipient.email) {
        context.waitUntil(
          fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${context.env.RESEND_API_KEY}`,
            },
            body: JSON.stringify({
              from: 'noreply@wherewepraying.com',
              to: recipient.email,
              subject: `${pokerName} sent you a gentle reminder 📖`,
              html: buildPokeReminderEmailHtml(pokerName),
              text: `${pokerName} is thinking of you. Just a gentle nudge — take a few quiet minutes today for the Qur'an. Even a page or two counts.\n\nOpen the Qur'an: https://wherewepraying.com/#quran`,
            }),
          })
        );
      }
    } catch (e) {
      console.error('poke reminder email failed:', e);
    }
  }

  let delivered = false;
  for (const sub of subs.results || []) {
    try {
      const res = await sendWebPush(context.env, sub, {
        title: 'Reading Streak poke 👋',
        body: `${pokerName} nudged you to keep your Qur'an streak alive today.`,
        url: '/#quran',
        tag: 'quran-poke',
      });
      if (res.ok) {
        delivered = true;
      } else if (res.status === 404 || res.status === 410) {
        // Expired subscription — clean it up.
        await db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').bind(sub.endpoint).run();
      }
    } catch (e) {
      // Best-effort — one failed subscription shouldn't fail the whole poke.
    }
  }

  return json({ success: true, delivered });
}
