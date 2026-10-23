import { neon } from '@neondatabase/serverless';
import 'dotenv/config';

const connectionString = process.env.DATABASE_URL;
console.log('Connecting to Neon PostgreSQL Server...');

const sql = neon(connectionString);

async function runMigration() {
  try {
    console.log('Testing connection...');
    const result = await sql`SELECT NOW() as current_time, current_database() as db;`;
    console.log('Connected successfully:', result[0]);

    console.log('Creating tables in Neon PostgreSQL...');

    // 1. Users Table
    await sql`
      CREATE TABLE IF NOT EXISTS users (
        id VARCHAR(50) PRIMARY KEY,
        username VARCHAR(50) UNIQUE NOT NULL,
        name VARCHAR(100) NOT NULL,
        role VARCHAR(20) NOT NULL DEFAULT 'kasir',
        pin VARCHAR(10) DEFAULT '1234',
        status VARCHAR(20) DEFAULT 'active',
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );
    `;

    // 2. Categories Table
    await sql`
      CREATE TABLE IF NOT EXISTS categories (
        id VARCHAR(50) PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        icon VARCHAR(50) DEFAULT 'coffee',
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );
    `;

    // 3. Products Table
    await sql`
      CREATE TABLE IF NOT EXISTS products (
        id VARCHAR(50) PRIMARY KEY,
        category_id VARCHAR(50) REFERENCES categories(id) ON DELETE SET NULL,
        name VARCHAR(150) NOT NULL,
        price NUMERIC(12, 2) NOT NULL DEFAULT 0,
        cost_price NUMERIC(12, 2) NOT NULL DEFAULT 0,
        stock INT NOT NULL DEFAULT 0,
        sku VARCHAR(50),
        image_path TEXT,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );
    `;

    // 4. Payment Methods Table
    await sql`
      CREATE TABLE IF NOT EXISTS payment_methods (
        id VARCHAR(50) PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        type VARCHAR(20) NOT NULL DEFAULT 'cash',
        account_info TEXT,
        qris_raw_string TEXT,
        image_path TEXT,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );
    `;

    // 5. Cash Registers Table
    await sql`
      CREATE TABLE IF NOT EXISTS cash_registers (
        id VARCHAR(50) PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        device_code VARCHAR(50) NOT NULL,
        location VARCHAR(100),
        printer_type VARCHAR(20) DEFAULT 'bluetooth',
        paper_width INT DEFAULT 58,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );
    `;

    // 6. Transactions Table
    await sql`
      CREATE TABLE IF NOT EXISTS transactions (
        id VARCHAR(50) PRIMARY KEY,
        invoice_number VARCHAR(100) UNIQUE NOT NULL,
        cashier_user_id VARCHAR(50),
        cashier_name VARCHAR(100),
        table_number VARCHAR(50),
        customer_name VARCHAR(100),
        payment_method_id VARCHAR(50),
        payment_method_name VARCHAR(100),
        payment_status VARCHAR(20) DEFAULT 'paid',
        items JSONB NOT NULL DEFAULT '[]'::jsonb,
        subtotal NUMERIC(12, 2) NOT NULL DEFAULT 0,
        tax_amount NUMERIC(12, 2) DEFAULT 0,
        discount_amount NUMERIC(12, 2) DEFAULT 0,
        grand_total NUMERIC(12, 2) NOT NULL DEFAULT 0,
        paid_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
        change_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );
    `;

    console.log('All 6 tables created successfully in Neon!');

    // Insert Default Master Data if empty
    const existingUsers = await sql`SELECT count(*) FROM users;`;
    if (parseInt(existingUsers[0].count, 10) === 0) {
      console.log('Seeding initial master data into Neon...');
      
      await sql`
        INSERT INTO users (id, username, name, role, pin, status) VALUES
        ('usr_1', 'owner', 'Mas Bos (Owner)', 'owner', '1234', 'active'),
        ('usr_2', 'kasir1', 'Rian (Kasir Barista)', 'kasir', '1111', 'active');
      `;

      await sql`
        INSERT INTO categories (id, name, icon) VALUES
        ('cat_coffee', 'Espresso & Coffee', 'coffee'),
        ('cat_noncoffee', 'Non-Coffee & Tea', 'cup'),
        ('cat_snack', 'Pastry & Food', 'cake');
      `;

      await sql`
        INSERT INTO products (id, category_id, name, price, cost_price, stock, sku, image_path, is_active) VALUES
        ('prod_1', 'cat_coffee', 'Kopi Susu Gula Aren', 18000, 9000, 85, 'KPS-001', '/placeholder_coffee1.jpg', true),
        ('prod_2', 'cat_coffee', 'Caramel Macchiato', 24000, 12000, 60, 'CRM-002', '/placeholder_coffee2.jpg', true),
        ('prod_3', 'cat_coffee', 'Americano Double Shot', 16000, 7000, 120, 'AMC-003', '/placeholder_coffee3.jpg', true),
        ('prod_4', 'cat_noncoffee', 'Matcha Latte Oatmilk', 22000, 11000, 45, 'MTC-004', '/placeholder_coffee4.jpg', true),
        ('prod_5', 'cat_snack', 'Butter Croissant Crispy', 20000, 10000, 25, 'CRS-005', '/placeholder_snack1.jpg', true),
        ('prod_6', 'cat_snack', 'French Fries Truffle Mayo', 17000, 8000, 40, 'FF-006', '/placeholder_snack2.jpg', true);
      `;

      await sql`
        INSERT INTO payment_methods (id, name, type, account_info, qris_raw_string, image_path, is_active) VALUES
        ('pay_cash', 'Uang Tunai (Cash)', 'cash', 'Pembayaran kasir langsung di kasir', '', '/poshere_logo.png', true),
        ('pay_qris', 'QRIS Statis / Dinamis', 'qris', 'NMID: ID1020038847291 - POShere Store', '00020101021126650014ID.GO.IDR.WWW011893600998000001234502150001234567890120303UMI51660014ID.LINKAJA.WWW011893600821000001234502150001234567890120303UMI5204581253033605802ID5914POSHERE STORE6007JAKARTA61051234063040ADB', '/poshere_logo.png', true);
      `;

      await sql`
        INSERT INTO cash_registers (id, name, device_code, location, printer_type, paper_width, is_active) VALUES
        ('reg_pos1', 'Mesin Kasir Utama (Bar)', 'POS-01', 'Counter Bar Depan', 'bluetooth', 58, true);
      `;

      console.log('Default master data seeded successfully!');
    } else {
      console.log(`Neon database already contains ${existingUsers[0].count} users.`);
    }

    const tables = await sql`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      ORDER BY table_name;
    `;
    console.log('Tables currently in Neon:', tables.map(t => t.table_name));

  } catch (err) {
    console.error('Migration error:', err);
  }
}

runMigration();
