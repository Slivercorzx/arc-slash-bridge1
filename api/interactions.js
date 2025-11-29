// /api/interactions.js  (เวอร์ชันดีบั๊ก + Fallback)
// - ยืนยันลายเซ็น Discord
// - ตอบ defer (กำลังคิด…)
// - พยายามส่งต่อไป GAS
// - ถ้า GAS พัง/ตอบไม่ 2xx จะ PATCH ข้อความเดิมให้ขึ้น error ทันที

import nacl from 'tweetnacl';
export const config = { api: { bodyParser: false } };

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.setEncoding('utf8');
    req.on('data', (ch) => (data += ch));
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}
function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });

  const signature = req.headers['x-signature-ed25519'];
  const timestamp = req.headers['x-signature-timestamp'];
  const publicKey = process.env.DISCORD_PUBLIC_KEY;
  if (!signature || !timestamp || !publicKey) return json(res, 400, { error: 'missing header/key' });

  const raw = await readRawBody(req);
  const ok = nacl.sign.detached.verify(
    Buffer.from(timestamp + raw),
    Buffer.from(signature, 'hex'),
    Buffer.from(publicKey, 'hex')
  );
  if (!ok) return json(res, 401, { error: 'invalid request signature' });

  let payload;
  try { payload = JSON.parse(raw); } catch { return json(res, 400, { error: 'bad json' }); }

  // PING
  if (payload.type === 1) return json(res, 200, { type: 1 });

  // Slash command
  if (payload.type === 2) {
    // ตอบ defer (ephemeral)
    json(res, 200, { type: 5, data: { flags: 64, content: '⏳ กำลังประมวลผล…' } });

    const forwardBody = {
      kind: 'forward',
      application_id: payload.application_id,
      token: payload.token,
      guild_id: payload.guild_id,
      channel_id: payload.channel_id,
      user_id: payload.member?.user?.id || payload.user?.id || null,
      command: payload.data?.name || '',
      options: payload.data?.options || []
    };

    // เตรียม URL ที่จะ PATCH ถ้า GAS ล้มเหลว
    const originalUrl = `https://discord.com/api/v10/webhooks/${payload.application_id}/${payload.token}/messages/@original`;

    try {
      const r = await fetch(process.env.GAS_FORWARD_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(forwardBody)
      });

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
