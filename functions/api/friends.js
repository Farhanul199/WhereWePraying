// functions/api/friends.js
// GET  /api/friends  -> { code, friends: [...], incoming: [...], outgoing: [...] }
// POST /api/friends   body: { action: 'add'|'accept'|'decline'|'remove', ... }
//   action 'add':    { identifier }         — username, email, or friend code
//   action 'accept':  { requestId }
//   action 'decline': { requestId }
//   action 'remove':  { friendUserId }

const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O/1/I/L — easy to read aloud/type

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

function generateFriendCode() {
  let code = '';
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  for (let i = 0; i < 8; i++) code += CODE_CHARS[bytes[i] % CODE_CHARS.length];
  return code;
}

async function ensureFriendCode(db, userId) {
  const user = await db.prepare('SELECT friend_code FROM users WHERE id = ?').bind(userId).first();
  if (user && user.friend_code) return user.friend_code;

  // Retry a few times in the rare case of a collision.
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateFriendCode();
    const existing = await db.prepare('SELECT id FROM users WHERE friend_code = ?').bind(code).first();
    if (!existing) {
      await db.prepare('UPDATE users SET friend_code = ? WHERE id = ?').bind(code, userId).run();
      return code;
    }
  }
  throw new Error('Could not generate a unique friend code');
}

// Same coral double-border card template used for the newsletter/broadcast
// and magic-link emails, so every email from the app looks consistent.
function buildFriendRequestEmailHtml(fromLabel, siteUrl) {
  return `<html>
<body style="margin:0; padding:24px 16px; background-color:#fbe4d8; font-family:'Manrope',Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px; margin:0 auto;">
    <tr>
      <td style="padding:4px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:2px solid #f4a184; border-radius:28px;">
          <tr>
            <td style="padding:6px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #f4c2ab; border-radius:22px; background-color:#fdf6f0;">
                <tr>
                  <td style="padding:44px 36px 36px;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td align="center">
                          <img src="https://raw.githubusercontent.com/Farhanul199/WhereWePraying/main/assets/email-icon.png" alt="WhereWePraying" width="88" style="display:block; width:88px; height:auto; border-radius:20px;">
                        </td>
                      </tr>
                      <tr>
                        <td align="center" style="padding:28px 0 30px;">
                          <span style="color:#f4a184; font-size:14px; letter-spacing:2px;">&mdash; &#10084; &mdash;</span>
                        </td>
                      </tr>
                      <tr>
                        <td align="center" style="text-align:center;">
                          <p style="margin:0 0 16px; font-size:15px; color:#5c4033; line-height:1.7;">Assalamu alaikum,</p>
                          <p style="margin:0 0 16px; font-size:15px; color:#5c4033; line-height:1.7;"><strong>${fromLabel}</strong> sent you a friend request on WhereWePraying?</p>
                        </td>
                      </tr>
                      <tr>
                        <td align="center" style="padding-top:8px; padding-bottom:8px;">
                          <a href="${siteUrl}" style="display:inline-block; background-color:#f4714e; color:#ffffff; text-decoration:none; font-weight:700; font-size:14px; padding:13px 32px; border-radius:999px; font-family:'Manrope',Arial,sans-serif;">View Request</a>
                        </td>
                      </tr>
                      <tr>
                        <td align="center" style="padding:34px 0 26px;">
                          <span style="color:#f4c2ab; font-size:12px; letter-spacing:2px;">&mdash; &#8226; &mdash;</span>
                        </td>
                      </tr>
                      <tr>
                        <td align="center">
                          <table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:separate;">
                            <tr>
                              <td style="background-color:#fbe4d8; border-radius:999px; padding:10px 22px;">
                                <span style="color:#f4714e; font-weight:700; font-size:14px; text-decoration:none;">wherewepraying.com</span>
                              </td>
                            </tr>
                          </table>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export async function onRequestGet(context) {
  const session = await resolveSession(context);
  if (!session) return json({ error: 'Not signed in' }, 401);

  const db = context.env.DB;
  const code = await ensureFriendCode(db, session.userId);

  const friends = await db
    .prepare(
      `SELECT u.id, u.username, u.email, u.avatar_url, u.is_supporter
       FROM friendships f
       JOIN users u ON u.id = CASE WHEN f.requester_id = ?1 THEN f.addressee_id ELSE f.requester_id END
       WHERE (f.requester_id = ?1 OR f.addressee_id = ?1) AND f.status = 'accepted'`
    )
    .bind(session.userId)
    .all();

  const incoming = await db
    .prepare(
      `SELECT f.id AS request_id, u.id, u.username, u.email, u.avatar_url, u.is_supporter
       FROM friendships f
       JOIN users u ON u.id = f.requester_id
       WHERE f.addressee_id = ?1 AND f.status = 'pending'`
    )
    .bind(session.userId)
    .all();

  const outgoing = await db
    .prepare(
      `SELECT f.id AS request_id, u.id, u.username, u.email, u.avatar_url, u.is_supporter
       FROM friendships f
       JOIN users u ON u.id = f.addressee_id
       WHERE f.requester_id = ?1 AND f.status = 'pending'`
    )
    .bind(session.userId)
    .all();

  function mapUserRow(r) {
    return {
      id: r.id,
      username: r.username,
      email: r.email,
      avatarUrl: r.avatar_url || null,
      isSupporter: !!r.is_supporter,
    };
  }

  return json({
    code,
    friends: (friends.results || []).map(mapUserRow),
    incoming: (incoming.results || []).map((r) => ({ requestId: r.request_id, ...mapUserRow(r) })),
    outgoing: (outgoing.results || []).map((r) => ({ requestId: r.request_id, ...mapUserRow(r) })),
  });
}

export async function onRequestPost(context) {
  const session = await resolveSession(context);
  if (!session) return json({ error: 'Not signed in' }, 401);

  const db = context.env.DB;
  let body;
  try {
    body = await context.request.json();
  } catch (e) {
    return json({ error: 'Invalid request body' }, 400);
  }

  const action = body.action;

  if (action === 'add') {
    let target;

    if (body.targetUserId) {
      // Direct add by id — used when the person is clicked from a list
      // that already has their user id (global leaderboard, followers),
      // skipping the username/email/code lookup below.
      target = await db
        .prepare('SELECT id, username, email FROM users WHERE id = ?')
        .bind(body.targetUserId)
        .first();
      if (!target) return json({ error: 'User not found' }, 404);
    } else {
      const identifier = (body.identifier || '').trim();
      if (!identifier) return json({ error: 'Enter a username, email, or friend code' }, 400);

      target = await db
        .prepare('SELECT id, username, email FROM users WHERE LOWER(username) = LOWER(?1) OR LOWER(email) = LOWER(?1) OR UPPER(friend_code) = UPPER(?1)')
        .bind(identifier)
        .first();
      if (!target) return json({ error: 'No user found with that username, email, or code' }, 404);
    }

    if (target.id === session.userId) return json({ error: "That's your own account" }, 400);

    const existing = await db
      .prepare(
        `SELECT id, status FROM friendships
         WHERE (requester_id = ?1 AND addressee_id = ?2) OR (requester_id = ?2 AND addressee_id = ?1)`
      )
      .bind(session.userId, target.id)
      .first();

    if (existing) {
      if (existing.status === 'accepted') return json({ error: 'Already friends' }, 409);
      if (existing.status === 'pending') return json({ error: 'Friend request already pending' }, 409);
    }

    const id = crypto.randomUUID();
    await db
      .prepare('INSERT INTO friendships (id, requester_id, addressee_id, status) VALUES (?, ?, ?, ?)')
      .bind(id, session.userId, target.id, 'pending')
      .run();

    // Fire-and-forget email if they've opted in — never block the
    // response on this, a failed send shouldn't fail the request.
    try {
      const addressee = await db
        .prepare('SELECT email, notify_friend_requests FROM users WHERE id = ?')
        .bind(target.id)
        .first();

      if (addressee && addressee.notify_friend_requests && context.env.RESEND_API_KEY) {
        const me = await db.prepare('SELECT username, email FROM users WHERE id = ?').bind(session.userId).first();
        const fromLabel = (me && (me.username || me.email)) || 'Someone';
        const siteUrl = new URL(context.request.url).origin;

        context.waitUntil(
          fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${context.env.RESEND_API_KEY}`,
            },
            body: JSON.stringify({
              from: 'noreply@wherewepraying.com',
              to: addressee.email,
              subject: `${fromLabel} sent you a friend request — WhereWePraying?`,
              html: buildFriendRequestEmailHtml(fromLabel, siteUrl),
            }),
          })
        );
      }
    } catch (e) {
      console.error('friend request email failed:', e);
    }

    return json({ success: true, message: `Friend request sent to ${target.username || target.email}` });
  }

  if (action === 'accept' || action === 'decline') {
    const requestId = body.requestId;
    if (!requestId) return json({ error: 'Missing requestId' }, 400);

    const request = await db
      .prepare('SELECT id, addressee_id, status FROM friendships WHERE id = ?')
      .bind(requestId)
      .first();

    if (!request) return json({ error: 'Request not found' }, 404);
    if (request.addressee_id !== session.userId) return json({ error: 'Not your request to respond to' }, 403);
    if (request.status !== 'pending') return json({ error: 'Request already handled' }, 409);

    const newStatus = action === 'accept' ? 'accepted' : 'declined';
    await db
      .prepare("UPDATE friendships SET status = ?, responded_at = datetime('now') WHERE id = ?")
      .bind(newStatus, requestId)
      .run();

    return json({ success: true });
  }

  if (action === 'remove') {
    const friendUserId = body.friendUserId;
    if (!friendUserId) return json({ error: 'Missing friendUserId' }, 400);

    await db
      .prepare(
        `DELETE FROM friendships
         WHERE ((requester_id = ?1 AND addressee_id = ?2) OR (requester_id = ?2 AND addressee_id = ?1))
         AND status = 'accepted'`
      )
      .bind(session.userId, friendUserId)
      .run();

    return json({ success: true });
  }

  return json({ error: 'Unknown action' }, 400);
}
