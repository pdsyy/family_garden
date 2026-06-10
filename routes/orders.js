'use strict';
const router = require('express').Router();
const rLimit = require('express-rate-limit');
const crypto = require('crypto');
const { z }  = require('zod');
const db     = require('../db/database');
const { requireAuth } = require('../middleware/auth');

const orderLimiter = rLimit({
  windowMs: 10 * 60 * 1000, max: 5,
  message: { error: 'Too many orders, please wait' },
  standardHeaders: true, legacyHeaders: false,
});

const MIN_SUM = { courier: 1000, np: 500 };

const createSchema = z.object({
  customer_name:  z.string().trim().min(1).max(120),
  customer_phone: z.string().trim().regex(/^\+?\d[\d\s\-(]{8,20}$/, 'Invalid phone'),
  customer_tg:    z.string().trim().max(64).nullish(),
  delivery_type:  z.enum(['courier','np']),
  delivery_addr:  z.string().trim().min(3).max(500),
  payment_method: z.enum(['cash','card']),
  comment:        z.string().trim().max(1000).nullish(),
  items: z.array(z.object({
    product_id: z.number().int().positive(),
    quantity:   z.number().positive().max(9999),
  })).min(1).max(100),
});

const listSchema = z.object({
  status: z.enum(['new','confirmed','delivering','done','cancelled']).optional(),
  phone:  z.string().trim().min(1).optional(),
  limit:  z.coerce.number().int().min(1).max(200).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

function genNumber() {
  const d = new Date();
  const date = `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
  return `FG-${date}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

/* POST /api/orders — public */
router.post('/', orderLimiter, (req, res, next) => {
  try {
    const data = createSchema.parse(req.body);

    // Получаем актуальные цены из БД (клиент не может подделать сумму)
    const ids = [...new Set(data.items.map(i => i.product_id))];
    const products = db.prepare(
      `SELECT id,name,price,unit,is_active FROM products WHERE id IN (${ids.map(()=>'?').join(',')})`
    ).all(...ids);
    const pMap = new Map(products.map(p => [p.id, p]));

    for (const item of data.items) {
      const p = pMap.get(item.product_id);
      if (!p) return res.status(400).json({ error: `Product ${item.product_id} not found` });
      if (!p.is_active) return res.status(400).json({ error: `"${p.name}" is not available` });
    }

    let total = 0;
    const enriched = data.items.map(item => {
      const p = pMap.get(item.product_id);
      const subtotal = +(p.price * item.quantity).toFixed(2);
      total += subtotal;
      return { product_id: p.id, product_name: p.name, price: p.price, unit: p.unit,
               quantity: item.quantity, subtotal };
    });
    total = +total.toFixed(2);

    const min = MIN_SUM[data.delivery_type];
    if (total < min)
      return res.status(400).json({ error: `Minimum order is ${min} грн`, current_total: total, minimum: min });

    const orderNum = genNumber();
    const insertOrder = db.prepare(`
      INSERT INTO orders (order_number,customer_name,customer_phone,customer_tg,
        delivery_type,delivery_addr,payment_method,comment,total_amount)
      VALUES (@order_number,@customer_name,@customer_phone,@customer_tg,
        @delivery_type,@delivery_addr,@payment_method,@comment,@total_amount)
    `);
    const insertItem = db.prepare(`
      INSERT INTO order_items (order_id,product_id,product_name,price,unit,quantity,subtotal)
      VALUES (@order_id,@product_id,@product_name,@price,@unit,@quantity,@subtotal)
    `);

    const create = db.transaction(() => {
      const { lastInsertRowid } = insertOrder.run({
        order_number: orderNum,
        customer_name: data.customer_name,
        customer_phone: data.customer_phone,
        customer_tg: data.customer_tg ?? null,
        delivery_type: data.delivery_type,
        delivery_addr: data.delivery_addr,
        payment_method: data.payment_method,
        comment: data.comment ?? null,
        total_amount: total,
      });
      for (const it of enriched) insertItem.run({ ...it, order_id: lastInsertRowid });
      return lastInsertRowid;
    });

    const orderId = create();
    res.status(201).json({ id: orderId, order_number: orderNum, total_amount: total, status: 'new' });
  } catch (e) { next(e); }
});

/* GET /api/orders — admin */
router.get('/', requireAuth, (req, res, next) => {
  try {
    const q = listSchema.parse(req.query);
    const where = []; const p = {};
    if (q.status) { where.push('status = @status'); p.status = q.status; }
    if (q.phone) {
      where.push('customer_phone LIKE @phone');
      p.phone = '%' + q.phone.replace(/[%_]/g, c => '\\' + c) + '%';
    }
    const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const rows  = db.prepare(`SELECT * FROM orders ${w} ORDER BY created_at DESC LIMIT @limit OFFSET @offset`)
                    .all({ ...p, limit: q.limit, offset: q.offset });
    const total = db.prepare(`SELECT COUNT(*) AS c FROM orders ${w}`).get(p).c;
    res.json({ items: rows, total, limit: q.limit, offset: q.offset });
  } catch (e) { next(e); }
});

/* GET /api/orders/:id — admin (with items) */
router.get('/:id', requireAuth, (req, res, next) => {
  try {
    const id = +req.params.id;
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid id' });
    const order = db.prepare('SELECT * FROM orders WHERE id=?').get(id);
    if (!order) return res.status(404).json({ error: 'Not found' });
    const items = db.prepare('SELECT * FROM order_items WHERE order_id=? ORDER BY id').all(id);
    res.json({ ...order, items });
  } catch (e) { next(e); }
});

/* PATCH /api/orders/:id — admin (change status) */
router.patch('/:id', requireAuth, (req, res, next) => {
  try {
    const id = +req.params.id;
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid id' });
    const { status } = z.object({
      status: z.enum(['new','confirmed','delivering','done','cancelled'])
    }).parse(req.body);
    const info = db.prepare('UPDATE orders SET status=? WHERE id=?').run(status, id);
    if (info.changes === 0) return res.status(404).json({ error: 'Not found' });
    res.json(db.prepare('SELECT * FROM orders WHERE id=?').get(id));
  } catch (e) { next(e); }
});

module.exports = router;
