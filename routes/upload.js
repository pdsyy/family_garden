'use strict';
const router  = require('express').Router();
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const { requireAuth } = require('../middleware/auth');

// Папка для зберігання — на Railway це /data/uploads (постійний диск)
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '..', 'data', 'uploads');

// Створюємо папку якщо немає
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext  = path.extname(file.originalname).toLowerCase();
    const name = `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
    cb(null, name);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 3 * 1024 * 1024 }, // 3 MB
  fileFilter: (req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error('Only images allowed: jpg, png, webp, gif'));
  },
});

// POST /api/upload — завантаження картинки (тільки адмін)
router.post('/', requireAuth, upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  // Повертаємо публічний URL
  const url = `/uploads/${req.file.filename}`;
  res.json({ url, filename: req.file.filename });
});

// DELETE /api/upload/:filename — видалення (тільки адмін)
router.delete('/:filename', requireAuth, (req, res) => {
  const filename = path.basename(req.params.filename); // безпека — тільки ім'я файлу
  const filepath = path.join(UPLOAD_DIR, filename);
  if (fs.existsSync(filepath)) {
    fs.unlinkSync(filepath);
    res.json({ ok: true });
  } else {
    res.status(404).json({ error: 'File not found' });
  }
});

module.exports = router;
module.exports.UPLOAD_DIR = UPLOAD_DIR;
