// routes/orders.js
// Эндпоинты заказов:
//   POST  /api/orders          — публично, создание заказа (rate-limited)
//   GET   /api/orders          — admin, список с фильтрами
//   GET   /api/orders/:id      — admin, один заказ с позициями
//   PATCH /api/orders/:id      — admin, смена статуса
//
// КЛЮЧЕВАЯ ИДЕЯ БЕЗОПАСНОСТИ:
// total_amount и subtotal считаются на сервере. Цены берутся из products в БД,
// а не из тела запроса. Иначе клиент мог бы заказать товар за 1 копейку.

const express = require('express');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const { z } = require('zod');

const db = require('../db/database');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// Защита от спам-заказов: 5 заказов / 10 мин с одного IP
const createOrderLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 5,
  message: { error: 'Too many orders, please wait' },
  standardHeaders: true,
  legacyHeaders: false
});

// ── Валидация ──
const orderItemSchema = z.object({
  product_id: z.number().int().positive(),
  quantity:   z.number().positive().max(9999)
});

const orderCreateSchema = z.object({
  customer_name:  z.string().trim().min(1).max(120),
  customer_phone: z.string().trim().regex(/^\+?\d[\d\s\-()]{8,19}$/, 'Invalid phone format'),
  customer_tg:    z.string().trim().max(64).optional().nullable(),
  delivery_type:  z.enum(['courier', 'np']),
  delivery_addr:  z.string().trim().min(3).max(500),
  payment_method: z.enum(['cash', 'card']),
  comment:        z.string().trim().max(1000).optional().nullable(),
  items:          z.array(orderItemSchema).min(1).max(100)
});

const statusUpdateSchema = z.object({
  status: z.enum(['new', 'confirmed', 'delivering', 'done', 'cancelled'])
});

const listQuerySchema = z.object({
  status: z.enum(['new', 'confirmed', 'delivering', 'done', 'cancelled']).optional(),
  phone:  z.string().trim().min(1).optional(),
  limit:  z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0)
});

// Минимальные суммы заказа — серверная истина
const MIN_ORDER = {
  courier: 1000,
  np:      500
};

function generateOrderNumber() {
  // FG-YYYYMMDD-XXXXXX (последняя часть — криптослучайная)
  const d = new Date();
  const date = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const rand = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `FG-${date}-${rand}`;
}

// ── POST /api/orders ──
router.post('/', createOrderLimiter, (req, res, next) => {
  try {
    const data = orderCreateSchema.parse(req.body);

    // 1. Подтягиваем актуальные цены из БД одним запросом
    const ids = [...new Set(data.items.map(i => i.product_id))];
    const placeholders = ids.map(() => '?').join(',');
    const dbProducts = db
      .prepare(`SELECT id, name, price, unit, is_active FROM products WHERE id IN (${placeholders})`)
      .all(...ids);
    const productMap = new Map(dbProducts.map(p => [p.id, p]));

    // 2. Валидация: все товары существуют и активны
    for (const item of data.items) {
      const p = productMap.get(item.product_id);
      if (!p) {
        return res.status(400).json({ error: `Product ${item.product_id} not found` });
      }
      if (p.is_active !== 1) {
        return res.status(400).json({ error: `Product "${p.name}" is no longer available` });
      }
    }

    // 3. Считаем сумму на сервере
    let total = 0;
    const enrichedItems = data.items.map(item => {
      const p = productMap.get(item.product_id);
      const subtotal = +(p.price * item.quantity).toFixed(2);
      total += subtotal;
      return {
        product_id:   p.id,
        product_name: p.name,
        price:        p.price,
        unit:         p.unit,
        quantity:     item.quantity,
        subtotal
      };
    });
    total = +total.toFixed(2);

    // 4. Проверка минимальной суммы
    const min = MIN_ORDER[data.delivery_type];
    if (total < min) {
      return res.status(400).json({
        error: `Minimum order for ${data.delivery_type === 'courier' ? 'courier' : 'Nova Poshta'} is ${min} грн`,
        current_total: total,
        minimum: min
      });
    }

    // 5. Создаём заказ + позиции в транзакции (атомарно)
    const orderNumber = generateOrderNumber();

    const insertOrder = db.prepare(`
      INSERT INTO orders (
        order_number, customer_name, customer_phone, customer_tg,
        delivery_type, delivery_addr, payment_method, comment, total_amount
      ) VALUES (
        @order_number, @customer_name, @customer_phone, @customer_tg,
        @delivery_type, @delivery_addr, @payment_method, @comment, @total_amount
      )
    `);
    const insertItem = db.prepare(`
      INSERT INTO order_items (order_id, product_id, product_name, price, unit, quantity, subtotal)
      VALUES (@order_id, @product_id, @product_name, @price, @unit, @quantity, @subtotal)
    `);

    const createTx = db.transaction((order, items) => {
      const info = insertOrder.run(order);
      const orderId = info.lastInsertRowid;
      for (const it of items) {
        insertItem.run({ ...it, order_id: orderId });
      }
      return orderId;
    });

    const orderId = createTx(
      {
        order_number:   orderNumber,
        customer_name:  data.customer_name,
        customer_phone: data.customer_phone,
        customer_tg:    data.customer_tg ?? null,
        delivery_type:  data.delivery_type,
        delivery_addr:  data.delivery_addr,
        payment_method: data.payment_method,
        comment:        data.comment ?? null,
        total_amount:   total
      },
      enrichedItems
    );

    res.status(201).json({
      id: orderId,
      order_number: orderNumber,
      total_amount: total,
      status: 'new',
      message: 'Order created. We will contact you shortly.'
    });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/orders (admin) ──
router.get('/', requireAuth, (req, res, next) => {
  try {
    const q = listQuerySchema.parse(req.query);

    const where = [];
    const params = {};

    if (q.status) {
      where.push('status = @status');
      params.status = q.status;
    }
    if (q.phone) {
      where.push('customer_phone LIKE @phone');
      params.phone = `%${q.phone.replace(/[%_]/g, c => '\\' + c)}%`;
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const rows = db
      .prepare(`
        SELECT id, order_number, customer_name, customer_phone, customer_tg,
               delivery_type, delivery_addr, payment_method, comment,
               total_amount, status, created_at, updated_at
        FROM orders
        ${whereSql}
        ORDER BY created_at DESC
        LIMIT @limit OFFSET @offset
      `)
      .all({ ...params, limit: q.limit, offset: q.offset });

    const total = db.prepare(`SELECT COUNT(*) AS c FROM orders ${whereSql}`).get(params).c;

    res.json({ items: rows, total, limit: q.limit, offset: q.offset });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/orders/:id (admin) — с позициями ──
router.get('/:id', requireAuth, (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({ error: 'Invalid id' });
    }
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
    if (!order) return res.status(404).json({ error: 'Order not found' });

    const items = db
      .prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY id')
      .all(id);

    res.json({ ...order, items });
  } catch (err) {
    next(err);
  }
});

// ── PATCH /api/orders/:id (admin) — смена статуса ──
router.patch('/:id', requireAuth, (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({ error: 'Invalid id' });
    }
    const { status } = statusUpdateSchema.parse(req.body);
    const info = db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(status, id);
    if (info.changes === 0) return res.status(404).json({ error: 'Order not found' });
    const row = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
    res.json(row);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
