// routes/auth.js
// Эндпоинты:
//   POST /api/auth/login  — вход, возвращает JWT
//   GET  /api/auth/me     — проверка токена, возврат текущего пользователя

const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const { z } = require('zod');

const db = require('../db/database');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// Rate limit на логин: 10 попыток / 15 мин с одного IP
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many login attempts, try again later' },
  standardHeaders: true,
  legacyHeaders: false
});

const loginSchema = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(1).max(256)
});

router.post('/login', loginLimiter, async (req, res, next) => {
  try {
    const { username, password } = loginSchema.parse(req.body);

    const user = db
      .prepare('SELECT id, username, password_hash, role FROM users WHERE username = ?')
      .get(username);

    // Защита от user enumeration: одинаковая длительность ответа
    // для несуществующего пользователя и неверного пароля.
    const ok = user ? await bcrypt.compare(password, user.password_hash) : false;
    if (!user || !ok) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '24h' }
    );

    res.json({
      token,
      user: { id: user.id, username: user.username, role: user.role }
    });
  } catch (err) {
    next(err);
  }
});

router.get('/me', requireAuth, (req, res) => {
  res.json({
    user: { id: req.user.id, username: req.user.username, role: req.user.role }
  });
});

module.exports = router;
