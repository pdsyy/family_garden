'use strict';
require('dotenv').config();
const db = require('../db/database');

const PRODUCTS = [
  // Овочі
  { name:'Картопля молода',    category:'ovochi',  price:45,  unit:'кг',      min_order:'від 2 кг' },
  { name:'Морква домашня',     category:'ovochi',  price:40,  unit:'кг',      min_order:'від 1 кг' },
  { name:'Помідор рожевий',    category:'ovochi',  price:280, unit:'кг',      min_order:'від 0.5 кг' },
  { name:'Огірок колючий',     category:'ovochi',  price:140, unit:'кг',      min_order:'від 1 кг' },
  { name:'Цибуля ріпчаста',    category:'ovochi',  price:20,  unit:'кг',      min_order:'від 1 кг' },
  { name:'Баклажан',           category:'ovochi',  price:90,  unit:'кг',      min_order:'від 0.5 кг' },
  { name:'Перець болгарський', category:'ovochi',  price:120, unit:'кг',      min_order:'від 0.5 кг' },
  // Фрукти
  { name:'Яблуко Семиренко',   category:'frukty',  price:90,  unit:'кг',      min_order:'від 1 кг' },
  { name:'Банан',              category:'frukty',  price:70,  unit:'кг',      min_order:'від 0.5 кг' },
  { name:'Лимон',              category:'frukty',  price:95,  unit:'кг',      min_order:'від 0.5 кг' },
  { name:'Авокадо',            category:'frukty',  price:60,  unit:'шт',      min_order:'від 1 шт' },
  { name:'Полуниця',           category:'frukty',  price:180, unit:'кг',      min_order:'від 0.5 кг' },
  // Зелень
  { name:'Петрушка',           category:'zelen',   price:60,  unit:'грами',   min_order:'від 100 г' },
  { name:'Кріп',               category:'zelen',   price:60,  unit:'грами',   min_order:'від 100 г' },
  { name:'Айсберг',            category:'zelen',   price:140, unit:'шт',      min_order:'від 1 шт' },
  { name:'Шпинат',             category:'zelen',   price:120, unit:'грами',   min_order:'від 100 г' },
  // Яйця
  { name:'Яйця домашні С1',    category:'yaytsia', price:110, unit:'десяток', min_order:'від 1 десятка' },
  { name:'Яйця перепелині',    category:'yaytsia', price:95,  unit:'десяток', min_order:'від 1 десятка' },
];

const insert = db.prepare(`
  INSERT INTO products (name,category,price,unit,min_order,is_active)
  VALUES (@name,@category,@price,@unit,@min_order,1)
`);
const check = db.prepare('SELECT id FROM products WHERE name=? AND category=?');

const run = db.transaction(() => {
  let added = 0, skipped = 0;
  for (const p of PRODUCTS) {
    if (check.get(p.name, p.category)) { skipped++; continue; }
    insert.run(p);
    added++;
  }
  return { added, skipped };
});

const r = run();
console.log(`✔ Seed: ${r.added} added, ${r.skipped} skipped`);
process.exit(0);
