// middleware/errorHandler.js
// Централизованная обработка ошибок Express.
// Должен быть подключен ПОСЛЕДНИМ через app.use(errorHandler).

const { ZodError } = require('zod');

function errorHandler(err, req, res, next) {
  // Zod-валидация — 400 с подробностями
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: 'Validation failed',
      details: err.errors.map(e => ({ path: e.path.join('.'), message: e.message }))
    });
  }

  // SQLite constraint violations
  if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
    return res.status(409).json({ error: 'Duplicate value violates a unique constraint' });
  }
  if (err.code && err.code.startsWith('SQLITE_CONSTRAINT')) {
    return res.status(400).json({ error: 'Database constraint violation', code: err.code });
  }

  // Намеренные HTTP-ошибки (бросаем с .status)
  if (err.status && err.status >= 400 && err.status < 600) {
    return res.status(err.status).json({ error: err.message || 'Error' });
  }

  // Всё остальное — 500. Логируем стек на сервере, в ответе только generic.
  console.error('[unhandled error]', err);
  res.status(500).json({ error: 'Internal server error' });
}

module.exports = errorHandler;
