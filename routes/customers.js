'use strict';
const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt    = require('jsonwebtoken');
const rLimit = require('express-rate-limit');
const { z }  = require('zod');
const db     = require('../db/database');

const authLimiter = rLimit({
  windowMs: 15 * 60 * 1000, max: 20,
  message: { error: 'Too many requests' },
  standardHeaders: true, legacyHeaders: false,
});

const registerSchema = z.object({
  name:     z.string().trim().min(2).max(120),
  phone:    z.string().trim().regex(/^\+?\d[\d\s\-(]{8,20}$/, 'Invalid phone'),
  password: z.string().min(6).max(256),
  email:    z.string().email().optional().or(z.literal('')),
  tg:       z.string().trim().max(64).optional(),
});

const loginSchema = z.object({
  phone:    z.string().trim().min(1),
  password: z.string().min(1),
});

const updateSchema = z.object({
  name:  z.string().trim().min(2).max(120).optional(),
  email: z.string().email().optional().or(z.literal('')),
  tg:    z.string().trim().max(64).optional(),
  addr:  z.string().trim().max(500).optional(),
});

const changePwSchema = z.object({
  current_password: z.string().min(1),
  new_password:     z.string().min(6).max(256),
});

function toPublic(row) {
  if (!row) return null;
  const { password_hash, ...pub } = row;
  return pub;
}

function makeToken(customer) {
  return jwt.sign(
    { id: customer.id, phone: customer.phone, role: 'customer' },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '72h' }
  );
}

function requireCustomer(req, res, next) {
  const auth = req.headers.authorization || '';
  const [scheme, token] = auth.split(' ');
  if (scheme !== 'Bearer' || !token)
    return res.status(401).json({ error: 'Authorization required' });
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    if (payload.role !== 'customer')
      return res.status(403).json({ error: 'Forbidden' });
    req.customer = payload;
    next();
  } catch (e) {
    res.status(401).json({ error: 'Invalid token' });
  }
}

/* POST /api/customers/register */
router.post('/register', authLimiter, async (req, res, next) => {
  try {
    const d = registerSchema.parse(req.body);
    const exists = db.prepare('SELECT id FROM customers WHERE phone=?').get(d.phone);
    if (exists) return res.status(409).json({ error: 'Цей номер вже зареєстровано' });

    const hash = await bcrypt.hash(d.password, 12);
    const info = db.prepare(
      'INSERT INTO customers (name,phone,email,tg,password_hash) VALUES (?,?,?,?,?)'
    ).run(d.name, d.phone, d.email||null, d.tg||null, hash);

    const customer = db.prepare('SELECT * FROM customers WHERE id=?').get(info.lastInsertRowid);
    const token = makeToken(customer);
    res.status(201).json({ token, customer: toPublic(customer) });
  } catch (e) { next(e); }
});

/* POST /api/customers/login */
router.post('/login', authLimiter, async (req, res, next) => {
  try {
    const { phone, password } = loginSchema.parse(req.body);
    const customer = db.prepare('SELECT * FROM customers WHERE phone=?').get(phone);
    const ok = customer ? await bcrypt.compare(password, customer.password_hash) : false;
    if (!customer || !ok)
      return res.status(401).json({ error: 'Невірний номер або пароль' });
    const token = makeToken(customer);
    res.json({ token, customer: toPublic(customer) });
  } catch (e) { next(e); }
});

/* GET /api/customers/me */
router.get('/me', requireCustomer, (req, res, next) => {
  try {
    const customer = db.prepare('SELECT * FROM customers WHERE id=?').get(req.customer.id);
    if (!customer) return res.status(404).json({ error: 'Not found' });
    res.json(toPublic(customer));
  } catch (e) { next(e); }
});

/* PUT /api/customers/me — оновлення профілю */
router.put('/me', requireCustomer, (req, res, next) => {
  try {
    const d = updateSchema.parse(req.body);
    const fields = []; const params = { id: req.customer.id };
    if (d.name  !== undefined) { fields.push('name=@name');   params.name  = d.name; }
    if (d.email !== undefined) { fields.push('email=@email'); params.email = d.email||null; }
    if (d.tg    !== undefined) { fields.push('tg=@tg');       params.tg    = d.tg||null; }
    if (d.addr  !== undefined) { fields.push('addr=@addr');   params.addr  = d.addr||null; }
    if (!fields.length) return res.status(400).json({ error: 'Nothing to update' });
    db.prepare(`UPDATE customers SET ${fields.join(',')} WHERE id=@id`).run(params);
    res.json(toPublic(db.prepare('SELECT * FROM customers WHERE id=?').get(req.customer.id)));
  } catch (e) { next(e); }
});

/* POST /api/customers/change-password */
router.post('/change-password', requireCustomer, async (req, res, next) => {
  try {
    const { current_password, new_password } = changePwSchema.parse(req.body);
    const customer = db.prepare('SELECT password_hash FROM customers WHERE id=?').get(req.customer.id);
    if (!await bcrypt.compare(current_password, customer.password_hash))
      return res.status(401).json({ error: 'Поточний пароль невірний' });
    const hash = await bcrypt.hash(new_password, 12);
    db.prepare('UPDATE customers SET password_hash=? WHERE id=?').run(hash, req.customer.id);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

/* GET /api/customers/me/orders — замовлення клієнта */
router.get('/me/orders', requireCustomer, (req, res, next) => {
  try {
    const orders = db.prepare(
      'SELECT * FROM orders WHERE customer_phone=? ORDER BY created_at DESC LIMIT 50'
    ).all(req.customer.phone);

    const withItems = orders.map(o => ({
      ...o,
      items: db.prepare('SELECT * FROM order_items WHERE order_id=?').all(o.id)
    }));
    res.json({ items: withItems });
  } catch (e) { next(e); }
});

module.exports = router;
