import { defineConfig } from 'vite';
import fs from 'fs';
import path from 'path';
import mysql from 'mysql2/promise';
import jwt from 'jsonwebtoken';

const JWT_SECRET = 'poshere_super_secret_jwt_key_2026_modern_pos_auth';

/**
 * Monolithic Server Plugin for:
 * 1. File Uploads (Base64 to public/uploads)
 * 2. Direct MySQL Local (XAMPP localhost:3306) synchronization & migration
 */
function monolithicApiPlugin() {
  const uploadsDir = path.resolve(process.cwd(), 'public/uploads');

  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }

  const pool = mysql.createPool({
    host: '127.0.0.1',
    port: 3306,
    user: 'root',
    password: '',
    database: 'poshere',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
  });

  function parseBody(req) {
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
    res.statusCode = statusCode;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(data));
  }

  return {
    name: 'monolithic-api-plugin',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url.startsWith('/api/')) {
          return next();
        }

        const url = new URL(req.url, `http://${req.headers.host}`);
        const pathname = url.pathname;
        const method = req.method;

        try {
          // --- UPLOAD BASE64 IMAGE ---
          if (pathname === '/api/upload' && method === 'POST') {
            const body = await parseBody(req);
            const { base64Data, filename } = body;
            if (!base64Data) {
              return sendJson(res, 400, { success: false, message: 'Base64 image data is required' });
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

            const publicPath = `/uploads/${safeName}`;
            return sendJson(res, 200, { success: true, path: publicPath, filename: safeName });
          }

          // --- MYSQL STATUS CHECK ---
          if (pathname === '/api/mysql/status' && method === 'GET') {
            try {
              const [rows] = await pool.query('SELECT 1 + 1 AS test');
              return sendJson(res, 200, { success: true, connected: true, database: 'poshere' });
            } catch (err) {
              return sendJson(res, 200, { success: false, connected: false, error: err.message });
            }
          }

          // --- SYNC LOCALSTORAGE TO MYSQL ---
          if (pathname === '/api/mysql/sync' && method === 'POST') {
            const body = await parseBody(req);
            const { categories = [], products = [], users = [], payment_methods = [], cash_registers = [], transactions = [] } = body;

            // 1. Categories
            for (const c of categories) {
              await pool.query(
                `INSERT INTO categories (id, name, icon) VALUES (?, ?, ?)
                 ON DUPLICATE KEY UPDATE name=VALUES(name), icon=VALUES(icon)`,
                [c.id, c.name, c.icon || 'tag']
              );
            }

            // 2. Users
            for (const u of users) {
              await pool.query(
                `INSERT INTO users (id, username, name, role, pin, status) VALUES (?, ?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE name=VALUES(name), role=VALUES(role), pin=VALUES(pin), status=VALUES(status)`,
                [u.id, u.username, u.name, u.role || 'kasir', u.pin || '1234', u.status || 'active']
              );
            }

            // 3. Products
            for (const p of products) {
              await pool.query(
                `INSERT INTO products (id, name, category_id, price, cost_price, stock, sku, image_path, is_active)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE name=VALUES(name), category_id=VALUES(category_id), price=VALUES(price),
                 cost_price=VALUES(cost_price), stock=VALUES(stock), sku=VALUES(sku), image_path=VALUES(image_path), is_active=VALUES(is_active)`,
                [p.id, p.name, p.category_id || null, Number(p.price) || 0, Number(p.cost_price) || 0, Number(p.stock) || 0, p.sku || null, p.image_path || '', p.is_active ? 1 : 0]
              );
            }

            // 4. Payment Methods
            for (const pm of payment_methods) {
              await pool.query(
                `INSERT INTO payment_methods (id, name, type, account_info, qris_raw_string, image_path, is_active)
                 VALUES (?, ?, ?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE name=VALUES(name), type=VALUES(type), account_info=VALUES(account_info),
                 qris_raw_string=VALUES(qris_raw_string), image_path=VALUES(image_path), is_active=VALUES(is_active)`,
                [pm.id, pm.name, pm.type || 'cash', pm.account_info || '', pm.qris_raw_string || '', pm.image_path || '', pm.is_active ? 1 : 0]
              );
            }

            // 5. Cash Registers
            for (const r of cash_registers) {
              await pool.query(
                `INSERT INTO cash_registers (id, name, device_code, printer_type, paper_width, location, is_active)
                 VALUES (?, ?, ?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE name=VALUES(name), device_code=VALUES(device_code), printer_type=VALUES(printer_type),
                 paper_width=VALUES(paper_width), location=VALUES(location), is_active=VALUES(is_active)`,
                [r.id, r.name, r.device_code, r.printer_type || 'bluetooth', Number(r.paper_width) || 58, r.location || '', r.is_active ? 1 : 0]
              );
            }

            // 6. Transactions
            for (const t of transactions) {
              await pool.query(
                `INSERT INTO transactions (id, invoice_number, cashier_name, customer_name, table_number, subtotal, tax, discount, grand_total, paid_amount, change_amount, payment_method_id, payment_method_name, status, note, items)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE status=VALUES(status), paid_amount=VALUES(paid_amount), change_amount=VALUES(change_amount)`,
                [
                  t.id, t.invoice_number, t.cashier_name, t.customer_name || null, t.table_number || null,
                  Number(t.subtotal) || 0, Number(t.tax) || 0, Number(t.discount) || 0, Number(t.grand_total) || 0,
                  Number(t.paid_amount) || 0, Number(t.change_amount) || 0, t.payment_method_id || null,
                  t.payment_method_name || null, t.status || 'success', t.note || null, JSON.stringify(t.items || [])
                ]
              );
            }

            return sendJson(res, 200, {
              success: true,
              message: 'Data LocalStorage berhasil dimasukkan ke Database MySQL!',
              synced: {
                categories: categories.length,
                products: products.length,
                users: users.length,
                payment_methods: payment_methods.length,
                cash_registers: cash_registers.length,
                transactions: transactions.length
              }
            });
          }

          // --- FETCH ALL FROM MYSQL ---
          if (pathname === '/api/mysql/pull' && method === 'GET') {
            const [categories] = await pool.query('SELECT * FROM categories');
            const [products] = await pool.query('SELECT * FROM products');
            const [users] = await pool.query('SELECT * FROM users');
            const [payment_methods] = await pool.query('SELECT * FROM payment_methods');
            const [cash_registers] = await pool.query('SELECT * FROM cash_registers');
            const [transactions] = await pool.query('SELECT * FROM transactions ORDER BY created_at DESC');

            return sendJson(res, 200, {
              success: true,
              data: {
                categories,
                products,
                users,
                payment_methods,
                cash_registers,
                transactions: transactions.map(t => ({
                  ...t,
                  items: typeof t.items === 'string' ? JSON.parse(t.items || '[]') : (t.items || [])
                }))
              }
            });
          }

          // --- JWT AUTH LOGIN ---
          if (pathname === '/api/auth/login' && method === 'POST') {
            const body = await parseBody(req);
            const { username, pin } = body;

            if (!username || !pin) {
              return sendJson(res, 400, { success: false, message: 'Username dan PIN / Password wajib diisi' });
            }

            // Cari user di MySQL database poshere
            const [rows] = await pool.query('SELECT * FROM users WHERE username = ? LIMIT 1', [username.trim()]);
            if (!rows || rows.length === 0) {
              return sendJson(res, 401, { success: false, message: 'Akun user tidak ditemukan' });
            }

            const user = rows[0];

            if (user.status !== 'active') {
              return sendJson(res, 403, { success: false, message: 'Akun dinonaktifkan oleh administrator' });
            }

            // Validasi PIN
            if (user.pin !== pin.trim()) {
              return sendJson(res, 401, { success: false, message: 'PIN atau Password salah' });
            }

            // Generate JWT Token (valid 24 jam)
            const payload = {
              id: user.id,
              username: user.username,
              name: user.name,
              role: user.role
            };

            const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '24h' });

            return sendJson(res, 200, {
              success: true,
              token,
              user: payload,
              message: 'Login berhasil! Selamat bertugas.'
            });
          }

          // --- VERIFY JWT TOKEN ---
          if (pathname === '/api/auth/verify' && method === 'GET') {
            const authHeader = req.headers['authorization'];
            if (!authHeader || !authHeader.startsWith('Bearer ')) {
              return sendJson(res, 401, { success: false, message: 'Token otentikasi tidak disediakan' });
            }

            const token = authHeader.split(' ')[1];
            try {
              const decoded = jwt.verify(token, JWT_SECRET);
              return sendJson(res, 200, { success: true, user: decoded });
            } catch (err) {
              return sendJson(res, 401, { success: false, message: 'Token kadaluarsa atau tidak valid' });
            }
          }

          return sendJson(res, 404, { success: false, message: 'Endpoint not found' });
        } catch (err) {
          console.error('API Error:', err);
          return sendJson(res, 500, { success: false, error: err.message });
        }
      });
    }
  };
}

export default defineConfig({
  plugins: [monolithicApiPlugin()],
  server: {
    port: 5173,
    host: true
  }
});
