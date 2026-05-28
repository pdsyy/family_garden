// scripts/seed.js
// Наполняет БД примерными товарами. Идемпотентно: пропускает уже существующие имена.
//
// Использование: npm run seed

require('dotenv').config();
const db = require('../db/database');

const SAMPLE = [
  // Овочі
  { name: 'Картопля молода',    category: 'ovochi',  price: 45,  unit: 'кг', min_order: 'від 2 кг' },
  { name: 'Морква домашня',     category: 'ovochi',  price: 40,  unit: 'кг', min_order: 'від 1 кг' },
  { name: 'Помідор рожевий',    category: 'ovochi',  price: 280, unit: 'кг', min_order: 'від 0.5 кг' },
  { name: 'Огірок колючий',     category: 'ovochi',  price: 140, unit: 'кг', min_order: 'від 1 кг' },
  { name: 'Цибуля ріпчаста',    category: 'ovochi',  price: 20,  unit: 'кг', min_order: 'від 1 кг' },

  // Фрукти
  { name: 'Яблуко Семиренко',   category: 'frukty',  price: 90,  unit: 'кг', min_order: 'від 1 кг' },
  { name: 'Банан',              category: 'frukty',  price: 70,  unit: 'кг', min_order: 'від 0.5 кг' },
  { name: 'Лимон',              category: 'frukty',  price: 95,  unit: 'кг', min_order: 'від 0.5 кг' },
  { name: 'Авокадо',            category: 'frukty',  price: 60,  unit: 'шт', min_order: 'від 1 шт' },

  // Зелень
  { name: 'Петрушка',           category: 'zelen',   price: 60,  unit: 'грами', min_order: 'від 100 г' },
  { name: 'Кріп',               category: 'zelen',   price: 60,  unit: 'грами', min_order: 'від 100 г' },
  { name: 'Айсберг',            category: 'zelen',   price: 140, unit: 'шт',    min_order: 'від 1 шт' },

  // Яйця
  { name: 'Яйця домашні С1',    category: 'yaytsia', price: 110, unit: 'десяток', min_order: 'від 1 десятка' },
];

const insert = db.prepare(`
  INSERT INTO products (name, category, price, unit, min_order, is_active)
  VALUES (@name, @category, @price, @unit, @min_order, 1)
`);

const checkName = db.prepare('SELECT id FROM products WHERE name = ?');

const seedTx = db.transaction(items => {
  let added = 0, skipped = 0;
  for (const p of items) {
    if (checkName.get(p.name)) { skipped++; continue; }
    insert.run(p);
    added++;
  }
  return { added, skipped };
});

const result = seedTx(SAMPLE);
console.log(`✔ Seed complete: ${result.added} added, ${result.skipped} skipped (already existed)`);
process.exit(0);
