'use strict';
const { ZodError } = require('zod');

module.exports = function errorHandler(err, req, res, next) {
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: 'Validation failed',
      details: err.errors.map(e => ({ path: e.path.join('.'), message: e.message }))
    });
  }
  if (err.code === 'SQLITE_CONSTRAINT_UNIQUE')
    return res.status(409).json({ error: 'Duplicate value' });
  if (err.code?.startsWith('SQLITE_CONSTRAINT'))
    return res.status(400).json({ error: 'Constraint violation', code: err.code });
  if (err.status >= 400 && err.status < 600)
    return res.status(err.status).json({ error: err.message });

  console.error('[error]', err);
  res.status(500).json({ error: 'Internal server error' });
};
