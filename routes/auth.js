'use strict';
const router  = require('express').Router();
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const rLimit  = require('express-rate-limit');
const { z }   = require('zod');
const db      = require('../db/database');
const { requireAuth } = require('../middleware/auth');

const loginLimiter = rLimit({
  windowMs: 15 * 60 * 1000, max: 10,
  message: { error: 'Too many login attempts' },
  standardHeaders: true, legacyHeaders: false,
});

const loginSchema = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(1).max(256),
});

const changePwSchema = z.object({
  current_password: z.string().min(1),
  new_password:     z.string().min(8).max(256),
});

/* POST /api/auth/login */
router.post('/login', loginLimiter, async (req, res, next) => {
  try {
    const { username, password } = loginSchema.parse(req.body);
    const user = db.prepare(
      'SELECT id, username, password_hash, role FROM users WHERE username = ?'
    ).get(username);

    const ok = user ? await bcrypt.compare(password, user.password_hash) : false;
    if (!user || !ok) return res.status(401).json({ error: 'Invalid credentials' });

    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '72h' }
    );
    res.json({ token, user: { id: user.id, username: user.username, role: user.role } });
  } catch (e) { next(e); }
});

/* GET /api/auth/me */
router.get('/me', requireAuth, (req, res) => {
  res.json({ user: { id: req.user.id, username: req.user.username, role: req.user.role } });
});

/* POST /api/auth/change-password */
router.post('/change-password', requireAuth, async (req, res, next) => {
  try {
    const { current_password, new_password } = changePwSchema.parse(req.body);
    const user = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
    if (!await bcrypt.compare(current_password, user.password_hash))
      return res.status(401).json({ error: 'Current password is incorrect' });

    const hash = await bcrypt.hash(new_password, 12);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, req.user.id);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
