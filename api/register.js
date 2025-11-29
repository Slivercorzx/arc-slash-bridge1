// api/register.js  — ชั่วคราวไว้สมัคร Slash Commands แล้วลบทีหลัง
export default async function handler(req, res) {
  const secret = req.headers['x-secret'] || req.query.secret;
  if (secret !== process.env.REGISTER_SECRET) return res.status(403).send('forbidden');

  if (req.method !== 'POST' && req.method !== 'GET') return res.status(405).send('method not allowed');

  const defs = [
    { name:'item', description:'ค้นหาไอเท็ม', type:1,
      options:[{ name:'name', description:'ชื่อไอเท็ม', type:3, required:true }] },
    { name:'craft', description:'ดูวัสดุที่ต้องใช้คราฟต์', type:1,
      options:[{ name:'name', description:'ชื่อไอเท็ม', type:3, required:true }] },
    { name:'drop', description:'ดูแหล่งดรอป', type:1,
      options:[{ name:'name', description:'ชื่อไอเท็ม', type:3, required:true }] }
  ];

  const url = `https://discord.com/api/v10/applications/${process.env.DISCORD_APPLICATION_ID}/guilds/${process.env.DISCORD_GUILD_ID}/commands`;

  const r = await fetch(url, {
    method: 'PUT',
    headers: {
      'Authorization': `Bot ${process.env.DISCORD_BOT_TOKEN}`,
      'Content-Type': 'application/json',
      'User-Agent': 'arc-commands-register/1.0'
    },
    body: JSON.stringify(defs)
  });

  const txt = await r.text();
  res.status(r.status).send(txt);
}
