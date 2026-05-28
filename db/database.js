// db/database.js
// Подключение к SQLite через better-sqlite3.
// Singleton: один экземпляр на всё приложение.

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs'); // Подключаем bcryptjs для правильного хэширования

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'shop.db');

// Убеждаемся, что директория для БД существует
const dbDir = path.dirname(DB_PATH);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new Database(DB_PATH);

// Режим DELETE: стабильная синхронная запись напрямую в файл базы данных
db.pragma('journal_mode = DELETE');
// FK constraints должны быть включены явно
db.pragma('foreign_keys = ON');
// Безопаснее для долгоживущего сервера
db.pragma('synchronous = NORMAL');

/**
 * Инициализация схемы БД. Идемпотентно (CREATE IF NOT EXISTS).
 * Вызывается при старте сервера и из scripts/init-db.js.
 */
function initSchema() {
  db.exec(`
    -- Пользователи (админы CRM)
    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      username      TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role          TEXT NOT NULL DEFAULT 'admin' CHECK(role IN ('admin','manager')),
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Товары
    CREATE TABLE IF NOT EXISTS products (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      name          TEXT    NOT NULL,
      category      TEXT    NOT NULL,
      price         REAL    NOT NULL CHECK(price >= 0),
      unit          TEXT    NOT NULL DEFAULT 'шт',
      min_order     TEXT,
      image_url     TEXT,
      description   TEXT,
      is_active     INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0,1)),
      created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);
    CREATE INDEX IF NOT EXISTS idx_products_active   ON products(is_active);

    -- Заказы (шапка)
    CREATE TABLE IF NOT EXISTS orders (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      order_number    TEXT    NOT NULL UNIQUE,
      customer_name   TEXT    NOT NULL,
      customer_phone  TEXT    NOT NULL,
      customer_tg     TEXT,
      delivery_type   TEXT    NOT NULL CHECK(delivery_type IN ('courier','np')),
      delivery_addr   TEXT    NOT NULL,
      payment_method  TEXT    NOT NULL CHECK(payment_method IN ('cash','card')),
      comment         TEXT,
      total_amount    REAL    NOT NULL CHECK(total_amount >= 0),
      status          TEXT    NOT NULL DEFAULT 'new'
                              CHECK(status IN ('new','confirmed','delivering','done','cancelled')),
      created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_orders_status     ON orders(status);
    CREATE INDEX IF NOT EXISTS idx_orders_created    ON orders(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_orders_phone      ON orders(customer_phone);

    -- Позиции в заказе. Цена/название фиксируется в момент покупки (snapshot),
    -- чтобы изменение товара в каталоге не "переписывало историю".
    CREATE TABLE IF NOT EXISTS order_items (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id      INTEGER NOT NULL,
      product_id    INTEGER,
      product_name  TEXT    NOT NULL,
      price         REAL    NOT NULL CHECK(price >= 0),
      unit          TEXT    NOT NULL,
      quantity      REAL    NOT NULL CHECK(quantity > 0),
      subtotal      REAL    NOT NULL CHECK(subtotal >= 0),
      FOREIGN KEY (order_id)   REFERENCES orders(id)    ON DELETE CASCADE,
      FOREIGN KEY (product_id) REFERENCES products(id)  ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);

    -- Триггер обновления updated_at у products
    CREATE TRIGGER IF NOT EXISTS trg_products_updated
      AFTER UPDATE ON products
      FOR EACH ROW
      BEGIN
        UPDATE products SET updated_at = datetime('now') WHERE id = OLD.id;
      END;

    -- Триггер обновления updated_at у orders
    CREATE TRIGGER IF NOT EXISTS trg_orders_updated
      AFTER UPDATE ON orders
      FOR EACH ROW
      BEGIN
        UPDATE orders SET updated_at = datetime('now') WHERE id = OLD.id;
      END;
  `);

  // ── Авто-создание/обновление администратора с правильным bcrypt хэшем ──
  try {
    const defaultUser = process.env.ADMIN_USERNAME || 'admin';
    const defaultPass = process.env.ADMIN_PASSWORD || 'admin1234';

    // Временная очистка старых записей, у которых хэш был сгенерирован не через bcrypt
    // (поскольку bcrypt хэши всегда начинаются с символа '$')
    db.prepare("DELETE FROM users WHERE password_hash NOT LIKE '$2%'").run();

    const userCount = db.prepare('SELECT COUNT(*) AS count FROM users').get().count;

    if (userCount === 0) {
      console.log('🚨 Таблица пользователей пуста или содержала старые хэши. Создаем корректного администратора...');

      // Генерируем хэш, который роут auth/login сможет успешно проверить
      const hash = bcrypt.hashSync(defaultPass, 10);

      const insertAdmin = db.prepare(`
        INSERT INTO users (username, password_hash, role) 
        VALUES (?, ?, 'admin')
      `);

      insertAdmin.run(defaultUser, hash);
      console.log(`✅ Администратор "${defaultUser}" успешно зарегистрирован.`);
    }
  } catch (err) {
    console.error('Ошибка при инициализации администратора:', err);
  }
}

initSchema();

module.exports = db;
module.exports.initSchema = initSchema;