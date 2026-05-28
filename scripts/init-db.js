// scripts/init-db.js
// Создаёт схему БД и первого админа.
// Идемпотентно: повторный запуск не сломает существующие данные.
//
// Использование: npm run init-db

require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('../db/database');

const username = process.env.ADMIN_USERNAME || 'admin';
const password = process.env.ADMIN_PASSWORD;

if (!password || password.length < 8) {
  console.error('ERROR: ADMIN_PASSWORD must be set in .env and at least 8 chars long');
  process.exit(1);
}

(async () => {
  try {
    const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (existing) {
      console.log(`✔ Admin user "${username}" already exists. Skipping.`);
      console.log('  To reset password: DELETE FROM users WHERE username = ? — then re-run.');
      process.exit(0);
    }

    const hash = await bcrypt.hash(password, 12);
    db.prepare(
      "INSERT INTO users (username, password_hash, role) VALUES (?, ?, 'admin')"
    ).run(username, hash);

    console.log(`✔ Schema initialized.`);
    console.log(`✔ Admin user "${username}" created.`);
    console.log(`  Login via POST /api/auth/login with the credentials from .env`);
    process.exit(0);
  } catch (err) {
    console.error('init-db failed:', err);
    process.exit(1);
  }
})();
