import { sql } from '../db.js';

function sendJson(res, statusCode, data) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
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
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-tenant-id');
    if (typeof res.status === 'function') return res.status(200).end();
    res.statusCode = 200;
    return res.end();
  }

  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const requestedTenantId = url.searchParams.get('tenant_id') || req.headers['x-tenant-id'] || 'tenant_main';

    // Fetch Tenants & Roles
    let tenants = [];
    let roles = [];
    try {
      tenants = await sql`SELECT * FROM tenants ORDER BY created_at ASC;`;
      roles = await sql`SELECT * FROM roles ORDER BY created_at ASC;`;
    } catch (e) {
      console.warn('Tenants or Roles table warning:', e.message);
    }

    let categories, products, users, payment_methods, cash_registers, transactions;

    if (requestedTenantId && requestedTenantId !== 'all') {
      categories = await sql`SELECT * FROM categories WHERE tenant_id = ${requestedTenantId} ORDER BY name ASC;`;
      products = await sql`SELECT * FROM products WHERE tenant_id = ${requestedTenantId} ORDER BY name ASC;`;
      users = await sql`SELECT id, username, name, role, email, status, tenant_id, created_at FROM users WHERE tenant_id = ${requestedTenantId} OR role = 'super_admin' ORDER BY name ASC;`;
      payment_methods = await sql`SELECT * FROM payment_methods WHERE tenant_id = ${requestedTenantId} ORDER BY name ASC;`;
      cash_registers = await sql`SELECT * FROM cash_registers WHERE tenant_id = ${requestedTenantId} ORDER BY name ASC;`;
      transactions = await sql`SELECT * FROM transactions WHERE tenant_id = ${requestedTenantId} ORDER BY created_at DESC;`;
    } else {
      categories = await sql`SELECT * FROM categories ORDER BY name ASC;`;
      products = await sql`SELECT * FROM products ORDER BY name ASC;`;
      users = await sql`SELECT id, username, name, role, email, status, tenant_id, created_at FROM users ORDER BY name ASC;`;
      payment_methods = await sql`SELECT * FROM payment_methods ORDER BY name ASC;`;
      cash_registers = await sql`SELECT * FROM cash_registers ORDER BY name ASC;`;
      transactions = await sql`SELECT * FROM transactions ORDER BY created_at DESC;`;
    }

    return sendJson(res, 200, {
      success: true,
      data: {
        tenants,
        roles,
        categories,
        products: products.map(p => ({
          ...p,
          price: Number(p.price || 0),
          cost_price: Number(p.cost_price || 0),
          stock: Number(p.stock || 0),
          is_active: Boolean(p.is_active)
        })),
        users,
        payment_methods: payment_methods.map(pm => ({
          ...pm,
          is_active: Boolean(pm.is_active)
        })),
        cash_registers: cash_registers.map(cr => ({
          ...cr,
          paper_width: Number(cr.paper_width || 58),
          is_active: Boolean(cr.is_active)
        })),
        transactions: transactions.map(t => ({
          ...t,
          status: t.status || t.payment_status || 'completed',
          items: typeof t.items === 'string' ? JSON.parse(t.items || '[]') : (t.items || []),
          subtotal: Number(t.subtotal || 0),
          grand_total: Number(t.grand_total || 0),
          paid_amount: Number(t.paid_amount || 0),
          change_amount: Number(t.change_amount || 0)
        }))
      }
    });
  } catch (err) {
    console.error('Neon Pull Error:', err);
    return sendJson(res, 500, { success: false, error: err.message });
  }
}
