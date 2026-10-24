import { sql } from '../db.js';

function sendJson(res, statusCode, data) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
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
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (typeof res.status === 'function') return res.status(200).end();
    res.statusCode = 200;
    return res.end();
  }

  try {
    const categories = await sql`SELECT * FROM categories ORDER BY name ASC`;
    const products = await sql`SELECT * FROM products ORDER BY name ASC`;
    const users = await sql`SELECT * FROM users ORDER BY name ASC`;
    const payment_methods = await sql`SELECT * FROM payment_methods ORDER BY name ASC`;
    const cash_registers = await sql`SELECT * FROM cash_registers ORDER BY name ASC`;
    const transactions = await sql`SELECT * FROM transactions ORDER BY created_at DESC`;

    return sendJson(res, 200, {
      success: true,
      data: {
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
