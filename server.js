'use strict';
require('dotenv').config();

// Проверка обязательных переменных
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  console.error('FATAL: JWT_SECRET must be at least 32 chars. Generate:');
  console.error("  node -e \"console.log(require('crypto').randomBytes(64).toString('hex'))\"");
  process.exit(1);
}

// Инициализируем БД до подключения роутов
require('./db/database');

const express      = require('express');
const helmet       = require('helmet');
const cors         = require('cors');
const rLimit       = require('express-rate-limit');
const path         = require('path');
const authRoutes   = require('./routes/auth');
const uploadRoutes = require('./routes/upload');
const productRoutes = require('./routes/products');
const orderRoutes  = require('./routes/orders');
const errorHandler = require('./middleware/errorHandler');

const app = express();
app.set('trust proxy', 1);

/* ── Security ── */
app.use(helmet({ contentSecurityPolicy: false })); // CSP off — inline JS в HTML
const origins = (process.env.CORS_ORIGIN || '').split(',').map(s => s.trim()).filter(Boolean);
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || origins.includes(origin)) return cb(null, true);
    cb(new Error('CORS: not allowed'));
  },
  credentials: true,
}));

/* ── Global rate limit ── */
app.use('/api/', rLimit({ windowMs: 15*60*1000, max: 500, standardHeaders: true, legacyHeaders: false }));

app.use(express.json({ limit: '200kb' }));

/* ── Static frontend ── */
const HTML = path.join(__dirname, 'family_garden_shop_fixed.html');
app.get('/', (req, res) => res.sendFile(HTML));
app.use(express.static(__dirname, { index: false }));

// Статична роздача завантажених картинок
const { UPLOAD_DIR } = require('./routes/upload');
const express_static = require('express');
app.use('/uploads', express_static.static(UPLOAD_DIR));

/* ── Health ── */
app.get('/health', (req, res) =>
  res.json({ status: 'ok', uptime: Math.round(process.uptime()), db: 'sqlite' })
);

/* ── API routes ── */
app.use('/api/auth',     authRoutes);
app.use('/api/upload',   uploadRoutes);
app.use('/api/products', productRoutes);
app.use('/api/orders',   orderRoutes);

app.use('/api', (req, res) => res.status(404).json({ error: 'Endpoint not found' }));

/* ── Error handler (must be last) ── */
app.use(errorHandler);

/* ── Start ── */
const PORT = parseInt(process.env.PORT, 10) || 3001;
const srv = app.listen(PORT, () => {
  console.log(`🌱 Family Garden API → http://localhost:${PORT}`);
  console.log(`   NODE_ENV: ${process.env.NODE_ENV || 'development'}`);
  console.log(`   DB: ${process.env.DB_PATH || './data/shop.db'}`);
  console.log(`   CORS: ${origins.join(', ') || '(all origins in dev)'}`);
});

/* ── Graceful shutdown ── */
const shutdown = sig => {
  console.log(`\n${sig} — shutting down`);
  srv.close(() => { console.log('done'); process.exit(0); });
  setTimeout(() => process.exit(1), 10_000).unref();
};
process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

module.exports = app;
