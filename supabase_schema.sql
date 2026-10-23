-- ==============================================================================
-- SKEMA DATABASE SUPABASE (POSTGRESQL) UNTUK POSHERE COFFEE SHOP & UMKM
-- Jalankan query SQL ini di Supabase SQL Editor: Dashboard -> SQL Editor -> New Query
-- ==============================================================================

-- 1. Tabel Users (Owner & Kasir)
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY DEFAULT ('usr_' || substr(md5(random()::text), 1, 10)),
    username TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('owner', 'kasir')),
    pin TEXT NOT NULL DEFAULT '1234',
    status TEXT NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Tabel Categories Produk
CREATE TABLE IF NOT EXISTS categories (
    id TEXT PRIMARY KEY DEFAULT ('cat_' || substr(md5(random()::text), 1, 8)),
    name TEXT NOT NULL,
    icon TEXT DEFAULT 'coffee',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Tabel Master Produk
CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY DEFAULT ('prod_' || substr(md5(random()::text), 1, 10)),
    name TEXT NOT NULL,
    category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
    price NUMERIC(15,2) NOT NULL DEFAULT 0,
    cost_price NUMERIC(15,2) NOT NULL DEFAULT 0,
    stock INT NOT NULL DEFAULT 0,
    sku TEXT,
    image_path TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Tabel Master Metode Pembayaran & QRIS
CREATE TABLE IF NOT EXISTS payment_methods (
    id TEXT PRIMARY KEY DEFAULT ('pay_' || substr(md5(random()::text), 1, 8)),
    name TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'qris' CHECK (type IN ('qris', 'cash', 'transfer', 'ewallet', 'edc', 'debit')),
    account_info TEXT,
    qris_raw_string TEXT,
    image_path TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Tabel Master Mesin Kasir / Pos Station
CREATE TABLE IF NOT EXISTS cash_registers (
    id TEXT PRIMARY KEY DEFAULT ('reg_' || substr(md5(random()::text), 1, 8)),
    name TEXT NOT NULL,
    device_code TEXT UNIQUE NOT NULL,
    printer_type TEXT DEFAULT 'bluetooth' CHECK (printer_type IN ('bluetooth', 'usb_serial', 'network', 'system')),
    paper_width INT DEFAULT 58 CHECK (paper_width IN (58, 80)),
    location TEXT DEFAULT 'Main Counter',
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. Tabel Transaksi Penjualan
CREATE TABLE IF NOT EXISTS transactions (
    id TEXT PRIMARY KEY DEFAULT ('trx_' || substr(md5(random()::text), 1, 12)),
    invoice_number TEXT UNIQUE NOT NULL,
    cash_register_id TEXT REFERENCES cash_registers(id) ON DELETE SET NULL,
    cashier_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    cashier_name TEXT,
    payment_method_id TEXT REFERENCES payment_methods(id) ON DELETE SET NULL,
    payment_method_name TEXT,
    customer_name TEXT DEFAULT 'Pelanggan Umum',
    table_number TEXT DEFAULT '-',
    items JSONB NOT NULL DEFAULT '[]'::jsonb,
    subtotal NUMERIC(15,2) NOT NULL DEFAULT 0,
    tax NUMERIC(15,2) NOT NULL DEFAULT 0,
    discount NUMERIC(15,2) NOT NULL DEFAULT 0,
    grand_total NUMERIC(15,2) NOT NULL DEFAULT 0,
    paid_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
    change_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
    qris_dynamic_string TEXT,
    status TEXT NOT NULL DEFAULT 'completed',
    note TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- AKTIFKAN ROW LEVEL SECURITY (RLS) & IZINKAN AKSES ANON/AUTHENTICATED
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_methods ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash_registers ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read/write users" ON users FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow public read/write categories" ON categories FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow public read/write products" ON products FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow public read/write payment_methods" ON payment_methods FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow public read/write cash_registers" ON cash_registers FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow public read/write transactions" ON transactions FOR ALL USING (true) WITH CHECK (true);

-- ==============================================================================
-- SEED DATA AWAL (USER 2 ORANG, MASTER LAIN MASING-MASING 1 LIST)
-- ==============================================================================

-- 1. User: 2 orang (1 Owner & 1 Kasir)
INSERT INTO users (id, username, name, role, pin, status)
VALUES 
  ('usr_1', 'owner', 'Mas Bos (Owner)', 'owner', '1234', 'active'),
  ('usr_2', 'kasir1', 'Rian (Kasir Barista)', 'kasir', '1111', 'active')
ON CONFLICT (id) DO UPDATE SET 
  name = EXCLUDED.name,
  role = EXCLUDED.role;

-- 2. Kategori: Tepat 1 list
INSERT INTO categories (id, name, icon)
VALUES 
  ('cat_coffee', 'Espresso & Coffee', 'coffee')
ON CONFLICT (id) DO UPDATE SET 
  name = EXCLUDED.name;

-- 3. Produk: Tepat 1 list
INSERT INTO products (id, name, category_id, price, cost_price, stock, sku, image_path, is_active)
VALUES 
  ('prod_1', 'Kopi Susu Gula Aren', 'cat_coffee', 18000, 9000, 100, 'KPS-001', '/placeholder_coffee1.jpg', true)
ON CONFLICT (id) DO UPDATE SET 
  name = EXCLUDED.name,
  price = EXCLUDED.price;

-- 4. Metode Pembayaran: Tepat 1 list (QRIS Statis/Dinamis)
INSERT INTO payment_methods (id, name, type, account_info, qris_raw_string, image_path, is_active)
VALUES 
  ('pay_qris', 'QRIS Statis / Dinamis', 'qris', 'NMID: ID1020038847291 - POShere Coffee', '00020101021126650014ID.GO.IDR.WWW011893600998000001234502150001234567890120303UMI51660014ID.LINKAJA.WWW011893600821000001234502150001234567890120303UMI5204581253033605802ID5914POSHERE COFFEE6007JAKARTA61051234063040ADB', '/poshere_logo.png', true)
ON CONFLICT (id) DO UPDATE SET 
  name = EXCLUDED.name;

-- 5. Master Mesin Kasir: Tepat 1 list
INSERT INTO cash_registers (id, name, device_code, printer_type, paper_width, location, is_active)
VALUES 
  ('reg_pos1', 'Mesin Kasir Utama (Bar)', 'POS-01', 'bluetooth', 58, 'Counter Bar Depan', true)
ON CONFLICT (id) DO UPDATE SET 
  name = EXCLUDED.name;

