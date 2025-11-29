
// /api/interactions.js
// Discord Interactions verify (Ed25519) + forward to GAS (fire-and-forget)
import nacl from 'tweetnacl';

export const config = { api: { bodyParser: false } };

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.setEncoding('utf8');
    req.on('data', chunk => (data += chunk));
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
  if (!signature || !timestamp || !publicKey) {
    return json(res, 400, { error: 'Missing signature/public key' });
  }

  const rawBody = await readRawBody(req);

  const isValid = nacl.sign.detached.verify(
    Buffer.from(timestamp + rawBody),
    Buffer.from(signature, 'hex'),
    Buffer.from(publicKey, 'hex')
  );
  if (!isValid) return json(res, 401, { error: 'invalid request signature' });

  let payload;
  try { payload = JSON.parse(rawBody); } catch {
    return json(res, 400, { error: 'invalid json' });
  }

  // PING
  if (payload.type === 1) return json(res, 200, { type: 1 });

  // Application command
  if (payload.type === 2) {
    // Reply immediately (deferred, ephemeral)
    json(res, 200, { type: 5, data: { flags: 64, content: '⏳ Processing…' } });

    // Forward to GAS
    const body = {
      kind: 'forward',
      application_id: payload.application_id,
      token: payload.token,
      channel_id: payload.channel_id,
      guild_id: payload.guild_id,
      user_id: payload.member?.user?.id || payload.user?.id || null,
      command: payload.data?.name || '',
      options: payload.data?.options || []
    };

    try {
      await fetch(process.env.GAS_FORWARD_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
    } catch (e) {
      console.error('Forward error:', e);
    }
    return;
  }

  return json(res, 200, { type: 4, data: { content: 'Unsupported interaction' } });
}
