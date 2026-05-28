// routes/products.js
// Эндпоинты товаров:
//   GET    /api/products       — публичный список (с фильтрами)
//   GET    /api/products/:id   — публично, один товар
//   POST   /api/products       — admin, создать
//   PUT    /api/products/:id   — admin, обновить
//   DELETE /api/products/:id   — admin, удалить

const express = require('express');
const { z } = require('zod');

const db = require('../db/database');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// ── Валидационные схемы ──
const productCreateSchema = z.object({
  name:        z.string().trim().min(1).max(200),
  category:    z.string().trim().min(1).max(64),
  price:       z.number().nonnegative(),
  unit:        z.string().trim().min(1).max(32).default('шт'),
  min_order:   z.string().trim().max(64).optional().nullable(),
  image_url:   z.string().trim().max(500).optional().nullable(),
  description: z.string().trim().max(2000).optional().nullable(),
  is_active:   z.boolean().default(true)
});

// На update все поля опциональны, но хотя бы одно должно быть
const productUpdateSchema = productCreateSchema.partial().refine(
  obj => Object.keys(obj).length > 0,
  { message: 'At least one field must be provided' }

);

const listQuerySchema = z.object({
  category:  z.string().trim().min(1).optional(),
  active:    z.enum(['true', 'false', 'all']).default('true'),
  search:    z.string().trim().min(1).optional(),
  min_price: z.coerce.number().nonnegative().optional(),
  max_price: z.coerce.number().nonnegative().optional(),
  limit:     z.coerce.number().int().min(1).max(500).default(200),
  offset:    z.coerce.number().int().min(0).default(0)
});

// ── Утилиты ──
function rowToProduct(row) {
  if (!row) return null;
  return {
    id:          row.id,
    name:        row.name,
    category:    row.category,
    price:       row.price,
    unit:        row.unit,
    min_order:   row.min_order,
    image_url:   row.image_url,
    description: row.description,
    is_active:   row.is_active === 1,
    created_at:  row.created_at,
    updated_at:  row.updated_at
  };
}

// ── GET /api/products ──
router.get('/', (req, res, next) => {
  try {
    const q = listQuerySchema.parse(req.query);

    const where = [];
    const params = {};

    if (q.active === 'true')  where.push('is_active = 1');
    if (q.active === 'false') where.push('is_active = 0');
    // 'all' — без фильтра

    if (q.category) {
      where.push('category = @category');
      params.category = q.category;
    }
    if (q.search) {
      // LIKE с экранированием — для пользовательского ввода
      where.push('name LIKE @search');
      params.search = `%${q.search.replace(/[%_]/g, c => '\\' + c)}%`;
    }
    if (q.min_price !== undefined) {
      where.push('price >= @min_price');
      params.min_price = q.min_price;
    }
    if (q.max_price !== undefined) {
      where.push('price <= @max_price');
      params.max_price = q.max_price;
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const sql = `
      SELECT * FROM products
      ${whereSql}
      ORDER BY category, name
      LIMIT @limit OFFSET @offset
    `;
    const rows = db.prepare(sql).all({ ...params, limit: q.limit, offset: q.offset });
    const total = db.prepare(`SELECT COUNT(*) AS c FROM products ${whereSql}`).get(params).c;

    res.json({
      items: rows.map(rowToProduct),
      total,
      limit: q.limit,
      offset: q.offset
    });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/products/:id ──
router.get('/:id', (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({ error: 'Invalid id' });
    }
    const row = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
    if (!row) return res.status(404).json({ error: 'Product not found' });
    res.json(rowToProduct(row));
  } catch (err) {
    next(err);
  }
});

// ── POST /api/products (admin) ──
router.post('/', requireAuth, (req, res, next) => {
  try {
    const data = productCreateSchema.parse(req.body);

    const stmt = db.prepare(`
      INSERT INTO products (name, category, price, unit, min_order, image_url, description, is_active)
      VALUES (@name, @category, @price, @unit, @min_order, @image_url, @description, @is_active)
    `);
    const info = stmt.run({
      name:        data.name,
      category:    data.category,
      price:       data.price,
      unit:        data.unit,
      min_order:   data.min_order ?? null,
      image_url:   data.image_url ?? null,
      description: data.description ?? null,
      is_active:   data.is_active ? 1 : 0
    });

    const row = db.prepare('SELECT * FROM products WHERE id = ?').get(info.lastInsertRowid);
    res.status(201).json(rowToProduct(row));
  } catch (err) {
    next(err);
  }
});

// ── PUT /api/products/:id (admin) ──
router.put('/:id', requireAuth, (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({ error: 'Invalid id' });
    }

    const data = productUpdateSchema.parse(req.body);

    const existing = db.prepare('SELECT id FROM products WHERE id = ?').get(id);
    if (!existing) return res.status(404).json({ error: 'Product not found' });

    // Строим UPDATE только из переданных полей
    const fields = [];
    const params = { id };
    const map = {
      name: 'name', category: 'category', price: 'price', unit: 'unit',
      min_order: 'min_order', image_url: 'image_url', description: 'description'
    };
    for (const [key, col] of Object.entries(map)) {
      if (data[key] !== undefined) {
        fields.push(`${col} = @${key}`);
        params[key] = data[key];
      }
    }
    if (data.is_active !== undefined) {
      fields.push('is_active = @is_active');
      params.is_active = data.is_active ? 1 : 0;
    }

    if (fields.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    db.prepare(`UPDATE products SET ${fields.join(', ')} WHERE id = @id`).run(params);
    const row = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
    res.json(rowToProduct(row));
  } catch (err) {
    next(err);
  }
});

// ── DELETE /api/products/:id (admin) ──
// Замечание: в order_items product_id ON DELETE SET NULL,
// поэтому удаление товара не повредит историю заказов.
router.delete('/:id', requireAuth, (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({ error: 'Invalid id' });
    }
    const info = db.prepare('DELETE FROM products WHERE id = ?').run(id);
    if (info.changes === 0) return res.status(404).json({ error: 'Product not found' });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
