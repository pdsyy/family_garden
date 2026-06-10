'use strict';
const router = require('express').Router();
const { z }  = require('zod');
const db     = require('../db/database');
const { requireAuth } = require('../middleware/auth');

/* ── Схемы валидации ── */
const createSchema = z.object({
  name:        z.string().trim().min(1).max(200),
  category:    z.string().trim().min(1).max(64),
  price:       z.number().nonnegative(),
  unit:        z.string().trim().min(1).max(32).default('кг'),
  min_order:   z.string().trim().max(64).nullish(),
  image_url:   z.string().trim().max(600).nullish(),
  description: z.string().trim().max(2000).nullish(),
  is_active:   z.boolean().default(true),
});
const updateSchema = createSchema.partial().refine(o => Object.keys(o).length > 0, {
  message: 'At least one field required',
});
const listSchema = z.object({
  category:  z.string().trim().min(1).optional(),
  active:    z.enum(['true','false','all']).default('true'),
  search:    z.string().trim().min(1).optional(),
  min_price: z.coerce.number().nonnegative().optional(),
  max_price: z.coerce.number().nonnegative().optional(),
  limit:     z.coerce.number().int().min(1).max(1000).default(500),
  offset:    z.coerce.number().int().min(0).default(0),
});

function toFront(row) {
  if (!row) return null;
  return { ...row, is_active: row.is_active === 1 };
}

/* GET /api/products */
router.get('/', (req, res, next) => {
  try {
    const q = listSchema.parse(req.query);
    const where = []; const p = {};
    if (q.active === 'true')  where.push('is_active = 1');
    if (q.active === 'false') where.push('is_active = 0');
    if (q.category) { where.push('category = @category'); p.category = q.category; }
    if (q.search) {
      where.push('name LIKE @search');
      p.search = '%' + q.search.replace(/[%_]/g, c => '\\' + c) + '%';
    }
    if (q.min_price !== undefined) { where.push('price >= @min_price'); p.min_price = q.min_price; }
    if (q.max_price !== undefined) { where.push('price <= @max_price'); p.max_price = q.max_price; }

    const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const rows  = db.prepare(`SELECT * FROM products ${w} ORDER BY category, name LIMIT @limit OFFSET @offset`)
                    .all({ ...p, limit: q.limit, offset: q.offset });
    const total = db.prepare(`SELECT COUNT(*) AS c FROM products ${w}`).get(p).c;
    res.json({ items: rows.map(toFront), total, limit: q.limit, offset: q.offset });
  } catch (e) { next(e); }
});

/* GET /api/products/:id */
router.get('/:id', (req, res, next) => {
  try {
    const id = +req.params.id;
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid id' });
    const row = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json(toFront(row));
  } catch (e) { next(e); }
});

/* POST /api/products  — admin */
router.post('/', requireAuth, (req, res, next) => {
  try {
    const d = createSchema.parse(req.body);
    const info = db.prepare(`
      INSERT INTO products (name,category,price,unit,min_order,image_url,description,is_active)
      VALUES (@name,@category,@price,@unit,@min_order,@image_url,@description,@is_active)
    `).run({ ...d, min_order: d.min_order ?? null, image_url: d.image_url ?? null,
              description: d.description ?? null, is_active: d.is_active ? 1 : 0 });
    res.status(201).json(toFront(db.prepare('SELECT * FROM products WHERE id=?').get(info.lastInsertRowid)));
  } catch (e) { next(e); }
});

/* PUT /api/products/:id  — admin */
router.put('/:id', requireAuth, (req, res, next) => {
  try {
    const id = +req.params.id;
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid id' });
    if (!db.prepare('SELECT id FROM products WHERE id=?').get(id))
      return res.status(404).json({ error: 'Not found' });

    const d = updateSchema.parse(req.body);
    const fields = []; const params = { id };
    const map = { name:'name', category:'category', price:'price', unit:'unit',
                  min_order:'min_order', image_url:'image_url', description:'description' };
    for (const [k, col] of Object.entries(map)) {
      if (d[k] !== undefined) { fields.push(`${col} = @${k}`); params[k] = d[k] ?? null; }
    }
    if (d.is_active !== undefined) { fields.push('is_active = @is_active'); params.is_active = d.is_active ? 1 : 0; }

    db.prepare(`UPDATE products SET ${fields.join(', ')} WHERE id = @id`).run(params);
    res.json(toFront(db.prepare('SELECT * FROM products WHERE id=?').get(id)));
  } catch (e) { next(e); }
});

/* DELETE /api/products/:id  — admin */
router.delete('/:id', requireAuth, (req, res, next) => {
  try {
    const id = +req.params.id;
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid id' });
    const info = db.prepare('DELETE FROM products WHERE id=?').run(id);
    if (info.changes === 0) return res.status(404).json({ error: 'Not found' });
    res.status(204).end();
  } catch (e) { next(e); }
});

module.exports = router;
