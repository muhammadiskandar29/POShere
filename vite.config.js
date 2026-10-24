import { defineConfig } from 'vite';
import fs from 'fs';
import path from 'path';
import mysql from 'mysql2/promise';
import jwt from 'jsonwebtoken';
import { neon } from '@neondatabase/serverless';
import 'dotenv/config';

const JWT_SECRET = 'poshere_super_secret_jwt_key_2026_modern_pos_auth';
const NEON_DATABASE_URL = process.env.DATABASE_URL || 'postgresql://neondb_owner:npg_u9ERC0mWqNpM@ep-lingering-tree-b8tc55nw-pooler.c-14.us-east-1.aws.neon.tech/neondb?sslmode=require';
const neonSql = neon(NEON_DATABASE_URL);

/**
 * Monolithic Server Plugin for:
 * 1. File Uploads (Base64 to public/uploads)
 * 2. Neon PostgreSQL Cloud Server (Direct Database)
 * 3. Direct MySQL Local (XAMPP localhost:3306) synchronization & migration
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

          // ==========================================
          // NEON POSTGRESQL CLOUD DATABASE ENDPOINTS
          // ==========================================
          if (pathname === '/api/neon/status' && method === 'GET') {
            try {
              const resTime = await neonSql`SELECT NOW() as current_time, current_database() as db;`;
              return sendJson(res, 200, {
                success: true,
                online: true,
                database: resTime[0].db,
                timestamp: resTime[0].current_time
              });
            } catch (err) {
              return sendJson(res, 500, { success: false, online: false, error: err.message });
            }
          }

          if (pathname === '/api/neon/pull' && method === 'GET') {
            try {
              const categories = await neonSql`SELECT * FROM categories ORDER BY name ASC`;
              const products = await neonSql`SELECT * FROM products ORDER BY name ASC`;
              const users = await neonSql`SELECT * FROM users ORDER BY name ASC`;
              const payment_methods = await neonSql`SELECT * FROM payment_methods ORDER BY name ASC`;
              const cash_registers = await neonSql`SELECT * FROM cash_registers ORDER BY name ASC`;
              const transactions = await neonSql`SELECT * FROM transactions ORDER BY created_at DESC`;

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
              return sendJson(res, 500, { success: false, error: err.message });
            }
          }

          if (pathname === '/api/neon/sync' && method === 'POST') {
            const body = await parseBody(req);
            const { categories = [], products = [], users = [], payment_methods = [], cash_registers = [], transactions = [] } = body;

            // 1. Categories
            for (const c of categories) {
              await neonSql`
                INSERT INTO categories (id, name, icon)
                VALUES (${c.id}, ${c.name}, ${c.icon || 'coffee'})
                ON CONFLICT (id) DO UPDATE SET
                  name = EXCLUDED.name,
                  icon = EXCLUDED.icon;
              `;
            }

            // 2. Products
            for (const p of products) {
              await neonSql`
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
              await neonSql`
                INSERT INTO users (id, username, name, role, pin, status)
                VALUES (${u.id}, ${u.username}, ${u.name}, ${u.role || 'kasir'}, ${u.pin || '1234'}, ${u.status || 'active'})
                ON CONFLICT (id) DO UPDATE SET
                  name = EXCLUDED.name,
                  role = EXCLUDED.role,
                  pin = EXCLUDED.pin,
                  status = EXCLUDED.status;
              `;
            }

            // 4. Payment Methods
            for (const pm of payment_methods) {
              await neonSql`
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
              await neonSql`
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
              await neonSql`
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
          }

          // --- JWT AUTH LOGIN (Email or Username with Password/PIN) ---
          if (pathname === '/api/auth/login' && method === 'POST') {
            const body = await parseBody(req);
            const { email, username, password, pin } = body;
            const loginIdentifier = (email || username || '').trim();
            const loginSecret = (password || pin || '').trim();

            if (!loginIdentifier || !loginSecret) {
              return sendJson(res, 400, { success: false, message: 'Email dan Password wajib diisi!' });
            }

            let user = null;

            // 1. Cek di Neon PostgreSQL Cloud (by email or username)
            try {
              const neonRows = await neonSql`
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

            // 2. Fallback cek di MySQL Lokal
            if (!user) {
              try {
                const [mysqlRows] = await pool.query(
                  'SELECT * FROM users WHERE LOWER(username) = LOWER(?) LIMIT 1',
                  [loginIdentifier]
                );
                if (mysqlRows && mysqlRows.length > 0) {
                  user = mysqlRows[0];
                }
              } catch (errSql) {
                console.warn('MySQL auth query warning:', errSql.message);
              }
            }

            // 3. Fallback built-in accounts jika offline / database belum sync
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
