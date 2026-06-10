'use strict';
require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('../db/database');

(async () => {
  const username = process.env.ADMIN_USERNAME || 'admin';
  const password = process.env.ADMIN_PASSWORD;

  if (!password || password.length < 8) {
    console.error('ERROR: ADMIN_PASSWORD must be set in env and at least 8 chars');
    process.exit(1);
  }

  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existing) {
    console.log(`✔ Admin "${username}" already exists — skip`);
    process.exit(0);
  }

  const hash = await bcrypt.hash(password, 12);
  db.prepare("INSERT INTO users (username,password_hash,role) VALUES (?,?,'admin')").run(username, hash);
  console.log(`✔ Admin "${username}" created`);
  process.exit(0);
})();
