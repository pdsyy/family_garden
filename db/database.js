'use strict';
const Database = require('better-sqlite3');
const path = require('path');
const fs   = require('fs');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'shop.db');

// Убедимся что директория существует
const dir = path.dirname(DB_PATH);
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');   // лучше для конкурентных чтений
db.pragma('foreign_keys = ON');    // FK включены явно
db.pragma('synchronous = NORMAL'); // баланс скорость/надёжность

/* ──────────────────────────────────────────
   SCHEMA  (идемпотентно — CREATE IF NOT EXISTS)
   ────────────────────────────────────────── */
db.exec(`
  /* Администраторы / менеджеры */
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT    NOT NULL,
    role          TEXT    NOT NULL DEFAULT 'admin'
                          CHECK(role IN ('admin','manager')),
    created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  /* Товары */
  CREATE TABLE IF NOT EXISTS products (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL,
    category    TEXT    NOT NULL,
    price       REAL    NOT NULL CHECK(price >= 0),
    unit        TEXT    NOT NULL DEFAULT 'кг',
    min_order   TEXT,
    image_url   TEXT,
    description TEXT,
    is_active   INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0,1)),
    created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);
  CREATE INDEX IF NOT EXISTS idx_products_active   ON products(is_active);
  CREATE INDEX IF NOT EXISTS idx_products_name     ON products(name);

  /* Заказы (шапка) */
  CREATE TABLE IF NOT EXISTS orders (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    order_number   TEXT    NOT NULL UNIQUE,
    customer_name  TEXT    NOT NULL,
    customer_phone TEXT    NOT NULL,
    customer_tg    TEXT,
    delivery_type  TEXT    NOT NULL CHECK(delivery_type IN ('courier','np')),
    delivery_addr  TEXT    NOT NULL,
    payment_method TEXT    NOT NULL CHECK(payment_method IN ('cash','card')),
    comment        TEXT,
    total_amount   REAL    NOT NULL CHECK(total_amount >= 0),
    status         TEXT    NOT NULL DEFAULT 'new'
                           CHECK(status IN ('new','confirmed','delivering','done','cancelled')),
    created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at     TEXT    NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_orders_status  ON orders(status);
  CREATE INDEX IF NOT EXISTS idx_orders_phone   ON orders(customer_phone);
  CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at DESC);

  /* Позиции заказа (snapshot цены/названия на момент покупки) */
  CREATE TABLE IF NOT EXISTS order_items (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id     INTEGER NOT NULL,
    product_id   INTEGER,                           -- NULL если товар удалён
    product_name TEXT    NOT NULL,                  -- snapshot
    price        REAL    NOT NULL CHECK(price >= 0),-- snapshot
    unit         TEXT    NOT NULL,
    quantity     REAL    NOT NULL CHECK(quantity > 0),
    subtotal     REAL    NOT NULL CHECK(subtotal >= 0),
    FOREIGN KEY (order_id)   REFERENCES orders(id)   ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL
  );
  CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);

  /* Клієнти (покупці) */
  CREATE TABLE IF NOT EXISTS customers (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT    NOT NULL,
    phone         TEXT    NOT NULL UNIQUE,
    email         TEXT    UNIQUE,
    tg            TEXT,
    addr          TEXT,
    password_hash TEXT    NOT NULL,
    created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone);

  CREATE TRIGGER IF NOT EXISTS trg_customers_upd
    AFTER UPDATE ON customers FOR EACH ROW
    BEGIN UPDATE customers SET updated_at = datetime('now') WHERE id = OLD.id; END;

  /* Триггеры updated_at */
  CREATE TRIGGER IF NOT EXISTS trg_users_upd
    AFTER UPDATE ON users FOR EACH ROW
    BEGIN UPDATE users SET updated_at = datetime('now') WHERE id = OLD.id; END;

  CREATE TRIGGER IF NOT EXISTS trg_products_upd
    AFTER UPDATE ON products FOR EACH ROW
    BEGIN UPDATE products SET updated_at = datetime('now') WHERE id = OLD.id; END;

  CREATE TRIGGER IF NOT EXISTS trg_orders_upd
    AFTER UPDATE ON orders FOR EACH ROW
    BEGIN UPDATE orders SET updated_at = datetime('now') WHERE id = OLD.id; END;
`);

module.exports = db;
