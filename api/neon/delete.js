import { sql } from '../db.js';

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
  res.setHeader('Access-Control-Allow-Methods', 'POST,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-tenant-id');

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
    res.setHeader('Access-Control-Allow-Methods', 'POST,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-tenant-id');
    if (typeof res.status === 'function') return res.status(200).end();
    res.statusCode = 200;
    return res.end();
  }

  if (req.method !== 'POST' && req.method !== 'DELETE') {
    return sendJson(res, 405, { success: false, message: 'Method Not Allowed' });
  }

  try {
    const body = await parseBody(req);
    const { entity, id } = body || {};

    if (!entity || !id) {
      return sendJson(res, 400, { success: false, message: 'Entity dan ID wajib disertakan.' });
    }

    if (entity === 'products') {
      await sql`DELETE FROM products WHERE id = ${id};`;
    } else if (entity === 'categories') {
      // Set category_id di produk menjadi NULL terlebih dahulu agar foreign key aman
      await sql`UPDATE products SET category_id = NULL WHERE category_id = ${id};`;
      await sql`DELETE FROM categories WHERE id = ${id};`;
    } else if (entity === 'payment_methods') {
      await sql`DELETE FROM payment_methods WHERE id = ${id};`;
    } else if (entity === 'cash_registers') {
      await sql`DELETE FROM cash_registers WHERE id = ${id};`;
    } else if (entity === 'users') {
      if (id === 'usr_superadmin') {
        return sendJson(res, 400, { success: false, message: 'Akun Super Administrator utama tidak boleh dihapus.' });
      }
      await sql`DELETE FROM users WHERE id = ${id};`;
    } else if (entity === 'transactions') {
      await sql`DELETE FROM transactions WHERE id = ${id};`;
    } else if (entity === 'tenants') {
      if (id === 'tenant_main') {
        return sendJson(res, 400, { success: false, message: 'Toko utama (Flagship Store) tidak boleh dihapus.' });
      }
      // Hapus data yang berelasi dengan tenant ini
      await sql`DELETE FROM products WHERE tenant_id = ${id};`;
      await sql`DELETE FROM categories WHERE tenant_id = ${id};`;
      await sql`DELETE FROM payment_methods WHERE tenant_id = ${id};`;
      await sql`DELETE FROM cash_registers WHERE tenant_id = ${id};`;
      await sql`DELETE FROM users WHERE tenant_id = ${id} AND role != 'super_admin';`;
      await sql`DELETE FROM transactions WHERE tenant_id = ${id};`;
      await sql`DELETE FROM tenants WHERE id = ${id};`;
    } else {
      return sendJson(res, 400, { success: false, message: `Entity ${entity} tidak dikenali.` });
    }

    return sendJson(res, 200, {
      success: true,
      message: `Data ${id} berhasil dihapus permanen dari server database Neon (${entity}).`
    });
  } catch (err) {
    console.error('Neon Delete Error:', err);
    return sendJson(res, 500, { success: false, error: err.message });
  }
}
