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
  res.setHeader('Access-Control-Allow-Methods', 'POST,PUT,OPTIONS');
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
    res.setHeader('Access-Control-Allow-Methods', 'POST,PUT,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-tenant-id');
    if (typeof res.status === 'function') return res.status(200).end();
    res.statusCode = 200;
    return res.end();
  }

  if (req.method !== 'POST' && req.method !== 'PUT') {
    return sendJson(res, 405, { success: false, message: 'Method Not Allowed' });
  }

  try {
    const body = await parseBody(req);
    const { entity, data } = body || {};

    if (!entity || !data || !data.id) {
      return sendJson(res, 400, { success: false, message: 'Entity, data, dan ID wajib disertakan.' });
    }

    const tenantId = data.tenant_id || req.headers['x-tenant-id'] || 'tenant_main';

    if (entity === 'products') {
      const catId = data.category_id && data.category_id.trim() ? data.category_id.trim() : null;
      try {
        await sql`
          INSERT INTO products (id, category_id, name, price, cost_price, stock, sku, image_path, is_active, tenant_id)
          VALUES (
            ${data.id}, ${catId}, ${data.name},
            ${Number(data.price) || 0}, ${Number(data.cost_price) || 0}, ${Number(data.stock) || 0},
            ${data.sku || ''}, ${data.image_path || ''}, ${data.is_active !== undefined ? Boolean(data.is_active) : true},
            ${tenantId}
          )
          ON CONFLICT (id) DO UPDATE SET
            category_id = EXCLUDED.category_id,
            name = EXCLUDED.name,
            price = EXCLUDED.price,
            cost_price = EXCLUDED.cost_price,
            stock = EXCLUDED.stock,
            sku = EXCLUDED.sku,
            image_path = EXCLUDED.image_path,
            is_active = EXCLUDED.is_active,
            tenant_id = EXCLUDED.tenant_id;
        `;
      } catch (prodErr) {
        // Fallback jika category_id invalid
        await sql`
          INSERT INTO products (id, category_id, name, price, cost_price, stock, sku, image_path, is_active, tenant_id)
          VALUES (
            ${data.id}, NULL, ${data.name},
            ${Number(data.price) || 0}, ${Number(data.cost_price) || 0}, ${Number(data.stock) || 0},
            ${data.sku || ''}, ${data.image_path || ''}, ${data.is_active !== undefined ? Boolean(data.is_active) : true},
            ${tenantId}
          )
          ON CONFLICT (id) DO UPDATE SET
            category_id = EXCLUDED.category_id,
            name = EXCLUDED.name,
            price = EXCLUDED.price,
            cost_price = EXCLUDED.cost_price,
            stock = EXCLUDED.stock,
            sku = EXCLUDED.sku,
            image_path = EXCLUDED.image_path,
            is_active = EXCLUDED.is_active,
            tenant_id = EXCLUDED.tenant_id;
        `;
      }
    } else if (entity === 'categories') {
      await sql`
        INSERT INTO categories (id, name, icon, tenant_id)
        VALUES (${data.id}, ${data.name}, ${data.icon || 'coffee'}, ${tenantId})
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          icon = EXCLUDED.icon,
          tenant_id = EXCLUDED.tenant_id;
      `;
    } else if (entity === 'users') {
      const userTenant = (data.role === 'super_admin') ? null : (data.tenant_id || tenantId);
      const cleanTele = data.telegram_username ? data.telegram_username.replace(/^@/, '').toLowerCase().trim() : '';
      await sql`
        INSERT INTO users (id, username, name, role, pin, status, email, password, tenant_id, phone, telegram_username)
        VALUES (
          ${data.id}, ${data.username}, ${data.name}, ${data.role || 'kasir'},
          ${data.pin || '1234'}, ${data.status || 'active'}, ${data.email || ''},
          ${data.password || data.pin || '1234'}, ${userTenant},
          ${data.phone || ''}, ${cleanTele}
        )
        ON CONFLICT (id) DO UPDATE SET
          username = EXCLUDED.username,
          name = EXCLUDED.name,
          role = EXCLUDED.role,
          pin = EXCLUDED.pin,
          status = EXCLUDED.status,
          email = EXCLUDED.email,
          password = EXCLUDED.password,
          tenant_id = EXCLUDED.tenant_id,
          phone = EXCLUDED.phone,
          telegram_username = EXCLUDED.telegram_username;
      `;
    } else if (entity === 'payment_methods') {
      await sql`
        INSERT INTO payment_methods (id, name, type, account_info, qris_raw_string, image_path, is_active, tenant_id)
        VALUES (
          ${data.id}, ${data.name}, ${data.type || 'cash'}, ${data.account_info || ''},
          ${data.qris_raw_string || ''}, ${data.image_path || ''}, ${data.is_active !== undefined ? Boolean(data.is_active) : true},
          ${tenantId}
        )
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          type = EXCLUDED.type,
          account_info = EXCLUDED.account_info,
          qris_raw_string = EXCLUDED.qris_raw_string,
          image_path = EXCLUDED.image_path,
          is_active = EXCLUDED.is_active,
          tenant_id = EXCLUDED.tenant_id;
      `;
    } else if (entity === 'cash_registers') {
      await sql`
        INSERT INTO cash_registers (id, name, device_code, location, printer_type, paper_width, is_active, tenant_id)
        VALUES (
          ${data.id}, ${data.name}, ${data.device_code}, ${data.location || ''},
          ${data.printer_type || 'bluetooth'}, ${Number(data.paper_width) || 58}, ${data.is_active !== undefined ? Boolean(data.is_active) : true},
          ${tenantId}
        )
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          device_code = EXCLUDED.device_code,
          location = EXCLUDED.location,
          printer_type = EXCLUDED.printer_type,
          paper_width = EXCLUDED.paper_width,
          is_active = EXCLUDED.is_active,
          tenant_id = EXCLUDED.tenant_id;
      `;
    } else if (entity === 'transactions') {
      const trxStatus = data.status || data.payment_status || 'completed';
      await sql`
        INSERT INTO transactions (
          id, invoice_number, cashier_user_id, cashier_name, table_number, customer_name,
          payment_method_id, payment_method_name, payment_status, status, note, items,
          subtotal, tax_amount, discount_amount, grand_total, paid_amount, change_amount,
          tenant_id
        )
        VALUES (
          ${data.id}, ${data.invoice_number}, ${data.cashier_user_id || ''}, ${data.cashier_name || ''},
          ${data.table_number || ''}, ${data.customer_name || ''}, ${data.payment_method_id || ''},
          ${data.payment_method_name || ''}, ${data.payment_status || trxStatus},
          ${trxStatus}, ${data.note || ''},
          ${JSON.stringify(data.items || [])}::jsonb,
          ${Number(data.subtotal) || 0}, ${Number(data.tax_amount) || 0}, ${Number(data.discount_amount) || 0},
          ${Number(data.grand_total) || 0}, ${Number(data.paid_amount) || 0}, ${Number(data.change_amount) || 0},
          ${tenantId}
        )
        ON CONFLICT (id) DO UPDATE SET
          payment_status = EXCLUDED.payment_status,
          status = EXCLUDED.status,
          note = EXCLUDED.note,
          items = EXCLUDED.items,
          subtotal = EXCLUDED.subtotal,
          tax_amount = EXCLUDED.tax_amount,
          discount_amount = EXCLUDED.discount_amount,
          grand_total = EXCLUDED.grand_total,
          paid_amount = EXCLUDED.paid_amount,
          change_amount = EXCLUDED.change_amount,
          tenant_id = EXCLUDED.tenant_id;
      `;
    } else if (entity === 'tenants') {
      await sql`
        INSERT INTO tenants (id, name, slug, phone, address, status)
        VALUES (${data.id}, ${data.name}, ${data.slug || data.id}, ${data.phone || ''}, ${data.address || ''}, ${data.status || 'active'})
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          slug = EXCLUDED.slug,
          phone = EXCLUDED.phone,
          address = EXCLUDED.address,
          status = EXCLUDED.status;
      `;
    } else {
      return sendJson(res, 400, { success: false, message: `Entity "${entity}" tidak didukung.` });
    }

    return sendJson(res, 200, {
      success: true,
      message: `Data ${entity} (${data.id}) berhasil disimpan ke database Neon.`,
      data
    });
  } catch (err) {
    console.error('Neon Save Error:', err);
    return sendJson(res, 500, { success: false, error: err.message });
  }
}
