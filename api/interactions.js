// api/interactions.js
import nacl from 'tweetnacl';
export const config = { api: { bodyParser: false } };

// ----- utils -----
function readRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.setEncoding('utf8');
    req.on('data', (c) => (data += c));
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}
function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}
async function postToGAS(url, payload) {
  // ยิงครั้งแรกแบบไม่ตาม redirect
  let r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'arc-vercel-bridge/1.1' },
    body: JSON.stringify(payload),
    redirect: 'manual',          // สำคัญ: กัน POST ถูกเปลี่ยนเป็น GET
    signal: AbortSignal.timeout(15000)
  });

  // ถ้าโดน 30x ให้ re-POST ไป Location เอง
  if ([301, 302, 303, 307, 308].includes(r.status)) {
    const loc = r.headers.get('location');
    if (loc) {
      r = await fetch(loc, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'User-Agent': 'arc-vercel-bridge/1.1' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(15000)
      });
    }
  }
  return r;
}

// ----- handler -----
export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });

  const sig = req.headers['x-signature-ed25519'];
  const ts  = req.headers['x-signature-timestamp'];
  const pk  = process.env.DISCORD_PUBLIC_KEY;
  if (!sig || !ts || !pk) return json(res, 400, { error: 'missing signature/public key' });

  const raw = await readRawBody(req);
  const ok = nacl.sign.detached.verify(
    Buffer.from(ts + raw),
    Buffer.from(sig, 'hex'),
    Buffer.from(pk, 'hex')
  );
  if (!ok) return json(res, 401, { error: 'invalid request signature' });

  let body;
  try { body = JSON.parse(raw); } catch { return json(res, 400, { error: 'bad json' }); }

  // PING
  if (body.type === 1) return json(res, 200, { type: 1 });

  // SLASH COMMAND
  if (body.type === 2) {
    // 1) ตอบ defer (ephemeral)
    json(res, 200, { type: 5, data: { flags: 64, content: '⏳ กำลังประมวลผล…' } });

    const forward = {
      kind: 'forward',
      application_id: body.application_id,
      token: body.token,
      guild_id: body.guild_id,
      channel_id: body.channel_id,
      user_id: body.member?.user?.id || body.user?.id || null,
      command: body.data?.name || '',
      options: body.data?.options || []
    };
    const originalUrl = `https://discord.com/api/v10/webhooks/${body.application_id}/${body.token}/messages/@original`;

    try {
      const r = await postToGAS(process.env.GAS_FORWARD_URL, forward);
      if (!r.ok) {
        const txt = await r.text().catch(() => '');
        console.error('Forward status', r.status, txt);
        await fetch(originalUrl, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: `⚠️ GAS error ${r.status}: ${txt || 'no details'}` })
        });
      }
    } catch (e) {
      console.error('Forward error', e);
      await fetch(originalUrl, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: `⚠️ GAS unreachable: ${String(e)}` })
      });
    }
    return;
  }

  return json(res, 200, { type: 4, data: { content: 'Unsupported interaction' } });
}
