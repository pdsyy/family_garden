// server.js
// Точка входа для Family Garden REST API.

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

// Проверка обязательных переменных окружения
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  console.error('FATAL: JWT_SECRET must be set in .env and at least 32 chars long');
  console.error('Generate one: node -e "console.log(require(\'crypto\').randomBytes(64).toString(\'hex\'))"');
  process.exit(1);
}

// Инициализируем БД до подключения роутов
require('./db/database');

const authRoutes = require('./routes/auth');
const productsRoutes = require('./routes/products');
const ordersRoutes = require('./routes/orders');
const errorHandler = require('./middleware/errorHandler');

const app = express();

// За реверс-прокси (nginx/cloudflare/heroku) нужен trust proxy,
// иначе rate-limit получит IP прокси, а не клиента.
app.set('trust proxy', 1);

// ── Безопасность ──
app.use(helmet());

// CORS: разрешаем только перечисленные origin'ы
const allowedOrigins = (process.env.CORS_ORIGIN || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    // Запросы без origin (curl, Postman) пропускаем
    if (!origin) return cb(null, true);
    if (allowedOrigins.includes(origin)) return cb(null, true);
    return cb(new Error(`CORS: origin ${origin} not allowed`));
  },
  credentials: true
}));

// Глобальный rate limit на API: 300 запросов / 15 минут с IP
app.use('/api/', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false
}));

app.use(express.json({ limit: '100kb' }));

// ── Routes ──
const path = require('path');

// ── Static frontend ──
// Serves family_garden_shop_fixed.html for any non-API route.
// In production the file sits next to server.js in the project root.
const HTML_FILE = path.join(__dirname, 'family_garden_shop_fixed.html');
app.use(express.static(__dirname, { index: false })); // css/img if you add them later
app.get('/', (req, res) => res.sendFile(HTML_FILE));
app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

app.use('/api/auth', authRoutes);
app.use('/api/products', productsRoutes);
app.use('/api/orders', ordersRoutes);

// 404 для всех неизвестных /api/*
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// Глобальная обработка ошибок (должна быть последней)
app.use(errorHandler);

// ── Старт сервера ──
const PORT = parseInt(process.env.PORT, 10) || 3001;
const server = app.listen(PORT, () => {
  console.log(`🌱 Family Garden API running on http://localhost:${PORT}`);
  console.log(`   Env: ${process.env.NODE_ENV || 'development'}`);
  console.log(`   CORS origins: ${allowedOrigins.length ? allowedOrigins.join(', ') : '(none)'}`);
});

// Graceful shutdown
function shutdown(signal) {
  console.log(`\n[${signal}] shutting down...`);
  server.close(() => {
    console.log('HTTP server closed');
    process.exit(0);
  });
  // Если за 10s не закрылись — форс
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

module.exports = app;
