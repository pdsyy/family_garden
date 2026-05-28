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

    // 1. Пытаемся найти пользователя в базе данных
    const user = db
        .prepare('SELECT id, username, password_hash, role FROM users WHERE username = ?')
        .get(username);

    let ok = user ? await bcrypt.compare(password, user.password_hash) : false;

    // 2. 🚀 ЖЕЛЕЗНАЯ ПОДСТРАХОВКА 🚀
    // Если по базе не совпало, сверяем напрямую с переменными Railway (минуя хэширование)
    const envUser = process.env.ADMIN_USERNAME || 'admin';
    const envPass = process.env.ADMIN_PASSWORD || 'admin1234';

    // ВАЖНО: .trim() убирает случайные пробелы, если вы случайно скопировали их в панели Railway
    if (!ok && username.trim() === envUser.trim() && password === envPass) {
      console.log('--- Авторизация успешна через подстраховку Environment Variables! ---');

      // Если пользователя вообще нет в базе, подставляем фейковый объект для генерации JWT
      return res.json({
        token: jwt.sign(
            { id: user?.id || 999, username: envUser, role: user?.role || 'admin' },
            process.env.JWT_SECRET,
            { expiresIn: process.env.JWT_EXPIRES_IN || '24h' }
        ),
        user: { id: user?.id || 999, username: envUser, role: user?.role || 'admin' }
      });
    }

    // Если не подошел ни хэш из базы, ни прямые переменные окружения
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
