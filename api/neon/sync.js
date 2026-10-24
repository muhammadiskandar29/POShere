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
    const { categories = [], products = [], users = [], payment_methods = [], cash_registers = [], transactions = [] } = body || {};

    // 1. Categories
    for (const c of categories) {
      await sql`
        INSERT INTO categories (id, name, icon)
        VALUES (${c.id}, ${c.name}, ${c.icon || 'coffee'})
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          icon = EXCLUDED.icon;
      `;
    }

    // 2. Products
    for (const p of products) {
      await sql`
        INSERT INTO products (id, category_id, name, price, cost_price, stock, sku, image_path, is_active)
        VALUES (
          ${p.id}, ${p.category_id || null}, ${p.name}, 
          ${p.price || 0}, ${p.cost_price || 0}, ${p.stock || 0}, 
          ${p.sku || ''}, ${p.image_path || ''}, ${Boolean(p.is_active)}
        )
        ON CONFLICT (id) DO UPDATE SET
          category_id = EXCLUDED.category_id,
          name = EXCLUDED.name,
          price = EXCLUDED.price,
          cost_price = EXCLUDED.cost_price,
          stock = EXCLUDED.stock,
          sku = EXCLUDED.sku,
          image_path = EXCLUDED.image_path,
          is_active = EXCLUDED.is_active;
      `;
    }

    // 3. Users
    for (const u of users) {
      await sql`
        INSERT INTO users (id, username, name, role, pin, status, email, password)
        VALUES (${u.id}, ${u.username}, ${u.name}, ${u.role || 'kasir'}, ${u.pin || '1234'}, ${u.status || 'active'}, ${u.email || ''}, ${u.password || u.pin || '1234'})
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          role = EXCLUDED.role,
          pin = EXCLUDED.pin,
          status = EXCLUDED.status,
          email = EXCLUDED.email,
          password = EXCLUDED.password;
      `;
    }

    // 4. Payment Methods
    for (const pm of payment_methods) {
      await sql`
        INSERT INTO payment_methods (id, name, type, account_info, qris_raw_string, image_path, is_active)
        VALUES (${pm.id}, ${pm.name}, ${pm.type || 'cash'}, ${pm.account_info || ''}, ${pm.qris_raw_string || ''}, ${pm.image_path || ''}, ${Boolean(pm.is_active)})
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          type = EXCLUDED.type,
          account_info = EXCLUDED.account_info,
          qris_raw_string = EXCLUDED.qris_raw_string,
          image_path = EXCLUDED.image_path,
          is_active = EXCLUDED.is_active;
      `;
    }

    // 5. Cash Registers
    for (const cr of cash_registers) {
      await sql`
        INSERT INTO cash_registers (id, name, device_code, location, printer_type, paper_width, is_active)
        VALUES (${cr.id}, ${cr.name}, ${cr.device_code}, ${cr.location || ''}, ${cr.printer_type || 'bluetooth'}, ${cr.paper_width || 58}, ${Boolean(cr.is_active)})
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          device_code = EXCLUDED.device_code,
          location = EXCLUDED.location,
          printer_type = EXCLUDED.printer_type,
          paper_width = EXCLUDED.paper_width,
          is_active = EXCLUDED.is_active;
      `;
    }

    // 6. Transactions
    for (const t of transactions) {
      await sql`
        INSERT INTO transactions (
          id, invoice_number, cashier_user_id, cashier_name, table_number, customer_name,
          payment_method_id, payment_method_name, payment_status, items,
          subtotal, tax_amount, discount_amount, grand_total, paid_amount, change_amount
        )
        VALUES (
          ${t.id}, ${t.invoice_number}, ${t.cashier_user_id || ''}, ${t.cashier_name || ''}, 
          ${t.table_number || ''}, ${t.customer_name || ''}, ${t.payment_method_id || ''}, 
          ${t.payment_method_name || ''}, ${t.payment_status || 'paid'}, 
          ${JSON.stringify(t.items || [])}::jsonb,
          ${t.subtotal || 0}, ${t.tax_amount || 0}, ${t.discount_amount || 0}, 
          ${t.grand_total || 0}, ${t.paid_amount || 0}, ${t.change_amount || 0}
        )
        ON CONFLICT (id) DO NOTHING;
      `;
    }

    return sendJson(res, 200, {
      success: true,
      message: 'Data berhasil disinkronisasi ke Neon PostgreSQL Cloud Server!',
      synced: {
        categories: categories.length,
        products: products.length,
        users: users.length,
        payment_methods: payment_methods.length,
        cash_registers: cash_registers.length,
        transactions: transactions.length
      }
    });
  } catch (err) {
    console.error('Neon Sync Error:', err);
    return sendJson(res, 500, { success: false, error: err.message });
  }
}
