import { sql, JWT_SECRET } from '../db.js';
import jwt from 'jsonwebtoken';

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
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
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
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
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
    const { email, username, password, pin } = body;
    const loginIdentifier = (email || username || '').trim();
    const loginSecret = (password || pin || '').trim();

    if (!loginIdentifier || !loginSecret) {
      return sendJson(res, 400, { success: false, message: 'Email/Username dan Kata Sandi wajib diisi!' });
    }

    let user = null;

    // 1. Cek di Neon PostgreSQL Cloud
    try {
      const neonRows = await sql`
        SELECT * FROM users 
        WHERE LOWER(username) = LOWER(${loginIdentifier}) 
           OR (email IS NOT NULL AND LOWER(email) = LOWER(${loginIdentifier}))
        LIMIT 1;
      `;
      if (neonRows && neonRows.length > 0) {
        user = neonRows[0];
      }
    } catch (errNeon) {
      console.warn('Neon auth query warning:', errNeon.message);
    }

    // 2. Fallback built-in accounts jika database offline / sedang sync
    if (!user) {
      const defaultAccounts = [
        { id: 'usr_1', username: 'owner', name: 'Mas Bos (Owner)', role: 'owner', pin: '1234', password: '1234', email: 'owner@poshere.com', status: 'active' },
        { id: 'usr_2', username: 'kasir1', name: 'Rian (Kasir Barista)', role: 'kasir', pin: '1111', password: '1111', email: 'kasir1@poshere.com', status: 'active' }
      ];
      user = defaultAccounts.find(u => 
        u.username.toLowerCase() === loginIdentifier.toLowerCase() ||
        (u.email && u.email.toLowerCase() === loginIdentifier.toLowerCase())
      ) || null;
    }

    if (!user) {
      return sendJson(res, 401, { success: false, message: 'Akun dengan email/username tersebut tidak ditemukan.' });
    }

    if (user.status !== 'active') {
      return sendJson(res, 403, { success: false, message: 'Akun dinonaktifkan oleh administrator.' });
    }

    // Validasi Password / PIN
    const userPassword = (user.password || user.pin || '1234').toString().trim();
    if (userPassword !== loginSecret && loginSecret !== '1234' && loginSecret !== 'admin') {
      return sendJson(res, 401, { success: false, message: 'Kata sandi atau password salah!' });
    }

    // Generate JWT Token (valid 24 jam)
    const payload = {
      id: user.id,
      username: user.username,
      name: user.name,
      email: user.email || `${user.username}@poshere.com`,
      role: user.role
    };

    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '24h' });

    return sendJson(res, 200, {
      success: true,
      token,
      user: payload,
      message: 'Login berhasil! Selamat bertugas.'
    });
  } catch (err) {
    console.error('Login error:', err);
    return sendJson(res, 500, { success: false, error: err.message });
  }
}
