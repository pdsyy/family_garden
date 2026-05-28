# Family Garden — Backend API

REST API для интернет-магазина на Node.js + Express + SQLite. JWT-авторизация, валидация Zod, rate-limit, защита от типичных атак.

## Структура проекта

```
fg-backend/
├── server.js                   ← точка входа
├── package.json
├── .env.example                ← скопировать в .env и заполнить
├── .gitignore
├── db/
│   ├── database.js             ← подключение + схема SQLite
│   └── shop.db                 ← создастся автоматически (в .gitignore)
├── middleware/
│   ├── auth.js                 ← JWT verify + role check
│   └── errorHandler.js         ← централизованный обработчик ошибок
├── routes/
│   ├── auth.js                 ← /api/auth/login, /api/auth/me
│   ├── products.js             ← CRUD товаров
│   └── orders.js               ← создание заказов + CRM
└── scripts/
    ├── init-db.js              ← создаёт админа
    └── seed.js                 ← наполняет тестовыми товарами
```

## Установка

```bash
# 1. Установить зависимости
npm install

# 2. Создать .env из примера
cp .env.example .env

# 3. Сгенерировать JWT_SECRET (заменить в .env)
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"

# 4. Изменить ADMIN_PASSWORD в .env

# 5. Создать БД и админа
npm run init-db

# 6. (Опционально) наполнить тестовыми товарами
npm run seed

# 7. Запустить
npm start              # production
npm run dev            # с авто-перезагрузкой (Node 18+)
```

Сервер слушает `http://localhost:3001` по умолчанию.

## Структура БД

Файл схемы — `db/database.js`. Создаются 4 таблицы:

### `users` — администраторы CRM
| Колонка       | Тип    | Примечание                  |
|---------------|--------|----------------------------|
| id            | INT PK |                            |
| username      | TEXT   | UNIQUE                     |
| password_hash | TEXT   | bcrypt, cost 12            |
| role          | TEXT   | `admin` или `manager`      |
| created_at    | TEXT   | ISO datetime               |

### `products` — каталог
| Колонка       | Тип    | Примечание                  |
|---------------|--------|----------------------------|
| id            | INT PK |                            |
| name          | TEXT   |                            |
| category      | TEXT   | `ovochi`/`frukty`/...      |
| price         | REAL   | ≥ 0                        |
| unit          | TEXT   | `кг`/`шт`/`грами`/...      |
| min_order     | TEXT   | `"від 1 кг"`               |
| image_url     | TEXT   |                            |
| description   | TEXT   |                            |
| is_active     | INT    | 0/1                        |
| created_at, updated_at | TEXT |                  |

### `orders` — шапка заказа
| Колонка           | Тип    | Примечание                                          |
|-------------------|--------|----------------------------------------------------|
| id                | INT PK |                                                    |
| order_number      | TEXT   | UNIQUE, формат `FG-YYYYMMDD-XXXXXX`                |
| customer_name     | TEXT   |                                                    |
| customer_phone    | TEXT   |                                                    |
| customer_tg       | TEXT   |                                                    |
| delivery_type     | TEXT   | `courier` или `np`                                 |
| delivery_addr     | TEXT   |                                                    |
| payment_method    | TEXT   | `cash` или `card`                                  |
| comment           | TEXT   |                                                    |
| total_amount      | REAL   | **считается на сервере**, нельзя подделать         |
| status            | TEXT   | `new`/`confirmed`/`delivering`/`done`/`cancelled` |
| created_at, updated_at | TEXT |                                              |

### `order_items` — позиции заказа
| Колонка       | Тип    | Примечание                                              |
|---------------|--------|--------------------------------------------------------|
| id            | INT PK |                                                        |
| order_id      | INT    | FK → orders.id, ON DELETE CASCADE                      |
| product_id    | INT    | FK → products.id, ON DELETE SET NULL (история не ломается) |
| product_name  | TEXT   | snapshot имени на момент заказа                        |
| price         | REAL   | snapshot цены                                          |
| unit          | TEXT   |                                                        |
| quantity      | REAL   |                                                        |
| subtotal      | REAL   | price × quantity                                       |

Индексы созданы на часто фильтруемых колонках (category, status, created_at, phone).

---

## API эндпоинты

Все защищённые эндпоинты требуют заголовок:

```
Authorization: Bearer <JWT>
```

### Авторизация

#### `POST /api/auth/login` — публично, rate-limit 10/15мин
```bash
curl -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"ChangeMe123!"}'
```
Ответ:
```json
{
  "token": "eyJhbGciOi...",
  "user": { "id": 1, "username": "admin", "role": "admin" }
}
```

#### `GET /api/auth/me` — нужен JWT
Проверка токена + текущий пользователь.

### Товары

#### `GET /api/products` — публично
Параметры query (все опциональны):
- `category` — фильтр по категории
- `active` — `true` (по умолчанию) / `false` / `all`
- `search` — поиск по имени
- `min_price`, `max_price`
- `limit` (1–500, по умолчанию 200), `offset`

```bash
curl 'http://localhost:3001/api/products?category=ovochi&search=морква'
```

#### `GET /api/products/:id` — публично

#### `POST /api/products` — требует JWT
```bash
curl -X POST http://localhost:3001/api/products \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Полуниця Україна",
    "category": "frukty",
    "price": 180,
    "unit": "кг",
    "min_order": "від 0.5 кг",
    "is_active": true
  }'
```

#### `PUT /api/products/:id` — требует JWT
Передавать только изменяемые поля:
```bash
curl -X PUT http://localhost:3001/api/products/5 \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"price": 195, "is_active": false}'
```

#### `DELETE /api/products/:id` — требует JWT
Возвращает 204. История заказов не ломается: в `order_items` остаётся snapshot названия и цены.

### Заказы

#### `POST /api/orders` — публично, rate-limit 5/10мин
**Цены считаются на сервере** — клиент передаёт только `product_id` и `quantity`.

```bash
curl -X POST http://localhost:3001/api/orders \
  -H "Content-Type: application/json" \
  -d '{
    "customer_name": "Іван Іваненко",
    "customer_phone": "+380501234567",
    "customer_tg": "@ivan",
    "delivery_type": "courier",
    "delivery_addr": "м. Київ, вул. Хрещатик 1",
    "payment_method": "cash",
    "comment": "Привезти після 18:00",
    "items": [
      { "product_id": 1, "quantity": 2 },
      { "product_id": 5, "quantity": 1 }
    ]
  }'
```
Ответ:
```json
{
  "id": 42,
  "order_number": "FG-20260523-A1B2C3",
  "total_amount": 270,
  "status": "new",
  "message": "Order created. We will contact you shortly."
}
```

Серверная проверка минимальной суммы:
- курьер: 1000 грн
- НП: 500 грн

#### `GET /api/orders` — требует JWT
Параметры: `status`, `phone`, `limit`, `offset`.

#### `GET /api/orders/:id` — требует JWT
Возвращает заказ с позициями.

#### `PATCH /api/orders/:id` — требует JWT
Смена статуса:
```bash
curl -X PATCH http://localhost:3001/api/orders/42 \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"status":"confirmed"}'
```

---

## Что обеспечивает безопасность

1. **JWT** — короткоживущие токены (24h по умолчанию), HS256.
2. **bcryptjs cost 12** для паролей (pure-JS реализация — устанавливается без проблем на любую ОС/Docker).
3. **Rate limiting**:
   - логин: 10 попыток / 15 мин с IP;
   - создание заказа: 5 / 10 мин;
   - общий API: 300 / 15 мин.
4. **Helmet** — стандартные security headers.
5. **CORS** — whitelist через `.env`.
6. **Параметризованные запросы** — никаких SQL-инъекций (better-sqlite3 + named params).
7. **Серверный расчёт total_amount** — клиент не может подделать сумму.
8. **Валидация Zod** на всех входящих данных.
9. **SQLite WAL + foreign_keys** — целостность данных.
10. **Транзакции** при создании заказов — атомарность.
11. **Снапшоты** в `order_items` — удаление товара не ломает историю.
12. **Защита от user enumeration** — одинаковый отклик на «нет такого юзера» и «неверный пароль».

## Что нужно сделать в production

- Заменить `JWT_SECRET` на длинную случайную строку.
- Сменить дефолтный `ADMIN_PASSWORD`.
- Настроить HTTPS через reverse proxy (nginx/caddy).
- Настроить бэкапы файла `db/shop.db` (cron + копирование).
- Логирование запросов — добавить `morgan` или `pino-http`.
- Опционально: refresh-токены, если 24h мало.
