-- SKEMA DATABASE MYSQL UNTUK POSHERE POS & RETAIL MANAGEMENT
USE poshere;

CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(50) PRIMARY KEY,
    username VARCHAR(50) NOT NULL UNIQUE,
    name VARCHAR(100) NOT NULL,
    role VARCHAR(20) NOT NULL DEFAULT 'kasir',
    pin VARCHAR(10) DEFAULT '1234',
    status VARCHAR(20) DEFAULT 'active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS categories (
    id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    icon VARCHAR(50) DEFAULT 'tag',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS products (
    id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(150) NOT NULL,
    category_id VARCHAR(50),
    price DECIMAL(15,2) NOT NULL DEFAULT 0,
    cost_price DECIMAL(15,2) NOT NULL DEFAULT 0,
    stock INT NOT NULL DEFAULT 0,
    sku VARCHAR(50),
    image_path TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS payment_methods (
    id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    type VARCHAR(50) NOT NULL DEFAULT 'cash',
    account_info VARCHAR(255),
    qris_raw_string TEXT,
    image_path TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS cash_registers (
    id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    device_code VARCHAR(50) NOT NULL UNIQUE,
    printer_type VARCHAR(50) DEFAULT 'bluetooth',
    paper_width INT DEFAULT 58,
    location VARCHAR(100),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS transactions (
    id VARCHAR(50) PRIMARY KEY,
    invoice_number VARCHAR(100) NOT NULL UNIQUE,
    cashier_name VARCHAR(100) NOT NULL,
    customer_name VARCHAR(100),
    table_number VARCHAR(50),
    subtotal DECIMAL(15,2) NOT NULL DEFAULT 0,
    tax DECIMAL(15,2) DEFAULT 0,
    discount DECIMAL(15,2) DEFAULT 0,
    grand_total DECIMAL(15,2) NOT NULL DEFAULT 0,
    paid_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
    change_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
    payment_method_id VARCHAR(50),
    payment_method_name VARCHAR(100),
    status VARCHAR(20) DEFAULT 'success',
    note TEXT,
    items JSON,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;
