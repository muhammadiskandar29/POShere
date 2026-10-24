import fs from 'fs';
import path from 'path';

async function parseBody(req) {
  if (req.body) {
    if (typeof req.body === 'string') {
      try { return JSON.parse(req.body); } catch { return {}; }
    }
    return req.body;
  }
  return new Promise((resolve) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        resolve({});
      }
    });
  });
}

function sendJson(res, statusCode, data) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (typeof res.status === 'function') {
    return res.status(statusCode).json(data);
  }
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(data));
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (typeof res.status === 'function') return res.status(200).end();
    res.statusCode = 200;
    return res.end();
  }

  if (req.method !== 'POST') {
    return sendJson(res, 405, { success: false, message: 'Method Not Allowed' });
  }

  try {
    const body = await parseBody(req);
    const { base64Data, filename } = body || {};
    if (!base64Data) {
      return sendJson(res, 400, { success: false, message: 'Base64 image data is required' });
    }

    const uploadsDir = path.resolve(process.cwd(), 'public/uploads');

    try {
      if (!fs.existsSync(uploadsDir)) {
        fs.mkdirSync(uploadsDir, { recursive: true });
      }

      const matches = base64Data.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
      let buffer;
      let ext = '.png';
      if (matches && matches.length === 3) {
        const mime = matches[1];
        ext = mime.includes('jpeg') || mime.includes('jpg') ? '.jpg' : mime.includes('webp') ? '.webp' : '.png';
        buffer = Buffer.from(matches[2], 'base64');
      } else {
        buffer = Buffer.from(base64Data.replace(/^data:image\/\w+;base64,/, ''), 'base64');
      }

      const safeName = `${Date.now()}_${(filename || 'image').replace(/[^a-zA-Z0-9_-]/g, '')}${ext}`;
      const targetPath = path.join(uploadsDir, safeName);
      fs.writeFileSync(targetPath, buffer);

      return sendJson(res, 200, { success: true, path: `/uploads/${safeName}`, filename: safeName });
    } catch {
      // Pada Vercel Serverless yang read-only filesystem, gunakan data URL langsung
      return sendJson(res, 200, { success: true, path: base64Data, filename: filename || 'image.png' });
    }
  } catch (err) {
    return sendJson(res, 500, { success: false, error: err.message });
  }
}
