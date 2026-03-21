# ИоТерра Канбан

[![CI](https://github.com/ioterra-ru/kanban/actions/workflows/ci.yml/badge.svg)](https://github.com/ioterra-ru/kanban/actions/workflows/ci.yml)
![License](https://img.shields.io/github/license/ioterra-ru/kanban)
![Last commit](https://img.shields.io/github/last-commit/ioterra-ru/kanban)

Канбан доски.

## ИоТерра Канбан (PostgreSQL + Node/Express + React/Vite)

Веб‑приложение Kanban‑доски с карточками, участниками, вложениями, ролями, 2FA и несколькими досками.

### Как запустить приложение

**Вариант 1 — скриптом (рекомендуется):**

- локальная разработка (compose `base` + `dev`, в т.ч. Adminer):

  ```bash
  ./run_one_app_dev.sh
  ```

- продакшен-сервер (compose `base` + `prod`, без Adminer в типовой конфигурации):

  ```bash
  ./run_one_app_prod.sh
  ```

Нужны файлы `docker/compose/.cont_one_app.env` (скопировать из `.cont_one_app.env.example`) и `docker/compose/.cont_one_app.secrets.env` (скопировать из `.cont_one_app.secrets.env.example`; если файла нет, скрипт создаст его из примера). Если в секретах нет переменной **SESSION_SECRET** или она короче 16 символов, скрипт сгенерирует её (нужен установленный **openssl**) и сохранит в `.cont_one_app.secrets.env`. Без openssl скрипт выдаст ошибку с подсказкой.

**Вариант 2 — вручную через docker compose:**

Сначала создайте `docker/compose/.cont_one_app.secrets.env` и задайте в нём **SESSION_SECRET** длиной не менее 16 символов. Сгенерировать можно так:

```bash
echo "SESSION_SECRET=$(openssl rand -hex 32)" >> docker/compose/.cont_one_app.secrets.env
```

(остальные переменные для SMTP при необходимости добавьте по образцу из `.cont_one_app.secrets.env.example`). Затем:

```bash
docker compose --env-file docker/compose/.cont_one_app.env --env-file docker/compose/.cont_one_app.secrets.env up -d --build
```

Переменные берутся только из этих env-файлов; любую команду `docker compose` (в том числе `logs`, `down`) нужно вызывать с теми же `--env-file`.

### Быстрый старт: всё в контейнерах

После первого запуска (скриптом или вручную) при необходимости отредактируйте `docker/compose/.cont_one_app.env` (порты, хосты, БД) и перезапустите.

- **Логи backend** (при ошибке «backend is unhealthy» или для отладки): с теми же env-файлами, например  
  `docker compose --env-file docker/compose/.cont_one_app.env --env-file docker/compose/.cont_one_app.secrets.env logs -f backend`

После запуска UI и Adminer доступны по адресу из переменной `PUBLIC_BASE_URL` (по умолчанию `https://localhost:8443`). При `ENABLE_HTTPS=false` используется HTTP по порту из `FRONTEND_HTTP_PORT` (по умолчанию 8080). Самоподписанный сертификат при HTTPS создаётся автоматически в каталоге из `CERTS_PATH` (`./certs/` по умолчанию).

### Вход в систему

- **По умолчанию** при первом запуске есть пользователь:
  - **логин**: `admin`
  - **пароль**: `admin`
- При первом входе требуется **сменить пароль**.
- В системе включена **2FA (TOTP)**: после входа настройте 2FA в **Кабинете**.

### Основные возможности

- **Колонки**: по умолчанию — Backlog, High priority, ToDo, In Progress, Ready For Acceptance, Done; для каждой доски администратор может настраивать свой набор колонок (добавлять, удалять, переименовывать)
- **Карточка**:
  - описание/детали
  - ответственный
  - срок (дата+время)
  - метки (важность + пауза)
  - комментарии (история)
  - вложения (загрузка/скачивание/удаление)
  - участники карточки
- **Drag‑and‑drop** перемещение карточек между колонками
- **Несколько досок** + выбор доски по умолчанию
- **Роли**:
  - **Администратор**: управление пользователями и досками
  - **Участник**: работа с карточками в доступных досках
- **Права на комментарии**:
  - участник может редактировать/удалять **только свои** комментарии
  - администратор может управлять любыми
- **Аватары**:
  - пресеты + загрузка фото (в Кабинете)

### Кабинет

Кнопка **«Кабинет»** в верхней панели:

- изменение имени/почты (если допустимо) и доски по умолчанию
- настройка 2FA
- управление аватаром (пресет/фото)

Для администратора внутри кабинета есть блок **«Администрирование»**:

- **Доски**: создание/редактирование/удаление (кроме основной), описание, участники доски
- **Пользователи**: создание, удаление (кроме системного администратора), смена роли, сброс пароля
- **Почта**: включение/выключение уведомлений и параметры SMTP + кнопка **«Проверить соединение»**

### Уведомления по почте и восстановление пароля по почте

Функциональность email‑уведомлений и восстановления пароля **оставлена**, но работает только если администратор включил и настроил почту:

**Кабинет → Администрирование → Почта**

- включите **«Использовать уведомления по почте»**
- заполните SMTP параметры
- нажмите **«Проверить соединение»**

Если почта выключена или не настроена:

- уведомления по карточкам не отправляются
- восстановление пароля по почте не выполняется

### Восстановление пароля без почты

Если почта недоступна, есть альтернативы:

- **по коду 2FA**: на экране входа **«Забыли пароль?»** → логин/email + код 2FA + новый пароль (только если в БД у пользователя включена 2FA и есть секрет)
- **через администратора в приложении**: Админ → **Пользователи** → кнопка с ключом (сброс пароля, при входе потребуется смена) — нужен другой уже вошедший администратор

**Почта не работает, 2FA выключена, пароль забыт, войти некому** — сброс пароля с сервера по SSH: скрипт **`admin-reset-user-password.sh`** (описан в разделе **«Скрипты»** ниже).

### Скрипты: каталог `scripts/`

В каталоге лежат **три** служебных скрипта для PostgreSQL и аварийного сброса пароля. Нужны **Docker** и **docker compose**, файлы `docker/compose/.cont_one_app.env` и `docker/compose/.cont_one_app.secrets.env`.

**Общие замечания**

| Тема | Поведение |
|------|-----------|
| Откуда запускать | Из **корня репозитория** (рядом с `docker/compose/`). Скрипты **`restore-db.sh`** и **`admin-reset-user-password.sh`** дополнительно находят корень по `docker/compose/.cont_one_app.env` или по переменной **`KANBAN_REPO_ROOT`**. **`backup-db.sh`** считает корень каталогом на уровень выше `scripts/`. |
| Compose-файлы | Автоматически подбирается набор (`docker-compose-base.yml` + prod или dev, иначе `docker-compose.yml`) по **запущенному** сервису `db`; если контейнеры ещё не подняты — по умолчанию prod-набор, если файлы есть. Вручную: `export COMPOSE_FILE=...` или `export KANBAN_COMPOSE_FILE=...`. |

---

#### `backup-db.sh` — дамп базы

```bash
./scripts/backup-db.sh
```

- Контейнер **`db`** должен быть запущен (например `./run_one_app_dev.sh`, `./run_one_app_prod.sh` или `docker compose up -d db`).
- В `backup/` создаётся файл **`kanban-YYYY-MM-DDTHHMMSSZ.sql`** (текстовый дамп `pg_dump` с `--no-owner --clean --if-exists`).
- Имя пользователя и БД берутся из env (`POSTGRES_USER`, `POSTGRES_DB`).

---

#### `restore-db.sh` — восстановление из SQL-файла

```bash
# явный путь к дампу (относительный — от корня репозитория)
./scripts/restore-db.sh backup/kanban-2026-03-12T123456Z.sql

# без аргумента — самый новый по времени файла backup/kanban-*.sql
./scripts/restore-db.sh
```

- **Вход** — один необязательный аргумент: путь к **текстовому SQL**, который выполняет **`psql`** (обычно дамп из `backup-db.sh`; другой совместимый SQL возможен на свой риск).
- Останавливает **`backend`** и **`frontend`**, передаёт файл в `psql` в контейнере **`db`** с **`ON_ERROR_STOP`** (ошибка в дампе прерывает восстановление), затем снова поднимает backend и frontend. При необходимости поднимает только **`db`**.
- Абсолютный путь к файлу можно передать как есть; относительный интерпретируется **от корня репозитория**.

---

#### `admin-reset-user-password.sh` — новый пароль пользователя по email

```bash
./scripts/admin-reset-user-password.sh user@example.com
```

- Запуск от **администратора ОС** на сервере (SSH). Один аргумент — **email** учётной записи из таблицы `User`.
- Дважды запрашивает новый пароль (**ввод скрыт**), минимум **8** символов; пароли должны совпасть.
- Считает **bcrypt**-хеш в одноразовом контейнере **`backend`** (`docker compose run`, 12 раундов, как в приложении), обновляет **`passwordHash`**, выставляет **`mustChangePassword = true`**, удаляет строки **`session`** для этого пользователя.
- Нужны запущенный **`db`** и возможность **`docker compose run`** для сервиса **`backend`** (образ уже собран).

---

### Бэкап и восстановление БД

Краткий типичный цикл (подробности — в разделе **Скрипты** выше):

```bash
./scripts/backup-db.sh
./scripts/restore-db.sh backup/kanban-2026-03-12T123456Z.sql
# или ./scripts/restore-db.sh — последний kanban-*.sql из backup/
```

Файл дампа можно копировать на другой хост (`scp`, `rsync` и т.д.) и восстанавливать там тем же `restore-db.sh`.

### Перенос БД на удалённый сервер

Один и тот же порядок: дамп локально → копирование файла на сервер → восстановление через `./scripts/restore-db.sh`. Разница только в том, какой дамп создавать.

**На удалённом сервере** должен быть развёрнут полный репозиторий (docker compose, `docker/compose/.cont_one_app.env` и `.cont_one_app.secrets.env`). Файл дампа копируйте в каталог `backup/` внутри репозитория, восстановление запускайте из **корня репозитория**: `cd /path/to/kanban && ./scripts/restore-db.sh ...`

**Вариант 1 — полная БД (структура + данные)**

1. **Локально** создайте полный бэкап:

   ```bash
   ./scripts/backup-db.sh
   ```

   Файл: `backup/kanban-YYYY-MM-DDTHHMMSSZ.sql`.

2. **Скопируйте на удалённый сервер:**

   ```bash
   scp backup/kanban-*.sql user@remote-host:/path/to/kanban/backup/
   ```

3. **На удалённом сервере** по SSH:

   ```bash
   cd /path/to/kanban
   ./scripts/restore-db.sh backup/kanban-YYYY-MM-DDTHHMMSSZ.sql
   ```

   Удалённая БД будет полностью заменена содержимым локальной (пользователи, доски, карточки и т.д.).

   **Если после переноса нельзя войти из‑за 2FA:** на целевом сервере в PostgreSQL отключите 2FA у всех пользователей (подставьте пользователя/БД из env):

   ```bash
   docker compose exec -T db psql -U kanban -d kanban -c \
     'UPDATE "User" SET "totpEnabled" = false, "totpSecret" = null, "totpTempSecret" = null;'
   ```

   После этого вход по паролю; 2FA при необходимости снова включается в профиле. Подробнее в `docs/auth.rst` (раздел «Перенос базы данных и 2FA»).

**Только схема БД (без данных)** — при необходимости вручную, с запущенным контейнером `db`:

```bash
docker compose --env-file docker/compose/.cont_one_app.env --env-file docker/compose/.cont_one_app.secrets.env \
  exec -T db pg_dump -U kanban -d kanban --schema-only --no-owner > backup/kanban-schema-manual.sql
```

Дальше файл можно перенести и применить через `./scripts/restore-db.sh` (данные на целевой БД будут уничтожены дампом).

### Переменные окружения и секреты

Скрипты `./run_one_app_dev.sh` и `./run_one_app_prod.sh` используют два файла в `docker/compose/`:

- **`.cont_one_app.env`** — конфигурация (порты, хосты, URL, БД). По умолчанию в примере заданы значения для локального запуска; пользователь редактирует этот файл под себя.
- **`.cont_one_app.secrets.env`** — секреты (не коммитить). Создаётся скриптом при первом запуске; нужно задать `SESSION_SECRET` (не короче 16 символов) и при необходимости SMTP.

Файлы нужно создать вручную (скопировать из `.example` и заполнить). **PUBLIC_BASE_URL** и **CORS_ORIGIN** в env не задают — backend формирует их из `APP_HOST`, `ENABLE_HTTPS` и портов. Файлы должны быть в кодировке UTF-8 или ASCII, с окончаниями строк LF (Unix); каждая переменная — одна строка вида `NAME=value`, без переносов внутри значения. Если в значении есть пробелы или символы `<` `>` (например, в SMTP_FROM), возьмите значение в двойные кавычки: `SMTP_FROM="Имя <email@example.com>"`.

#### Переменные в `docker/compose/.cont_one_app.env`

| Переменная | Описание | Пример |
|------------|----------|--------|
| `APP_HOST` | Хост приложения (CN сертификата, ссылки в письмах, CORS) | `localhost` |
| `ENABLE_HTTPS` | `true` — nginx на 443 + редирект 80→443; `false` — только HTTP на 80 | `true` |
| `FRONTEND_HTTP_PORT` | Порт на хосте для HTTP (маппинг на 80 в контейнере) | `8080` |
| `FRONTEND_HTTPS_PORT` | Порт на хосте для HTTPS (маппинг на 443 в контейнере) | `8443` |
| `CERTS_PATH` | Путь к каталогу с TLS-сертификатами (относительно каталога запуска compose) | `./certs` |
| `POSTGRES_USER` | Пользователь PostgreSQL | `kanban` |
| `POSTGRES_PASSWORD` | Пароль PostgreSQL | `kanban` |
| `POSTGRES_DB` | Имя БД PostgreSQL | `kanban` |
| `DATABASE_URL` | URL подключения к БД для backend | `postgresql://kanban:kanban@db:5432/kanban?schema=public` |
| `BACKEND_PORT` | Порт backend внутри Docker-сети | `4000` |

#### Переменные в `docker/compose/.cont_one_app.secrets.env`

| Переменная | Описание | Пример |
|------------|----------|--------|
| `SESSION_SECRET` | Секрет для сессий (обязательно, не короче 16 символов) | например `openssl rand -hex 32` |
| `SMTP_HOST` | Хост SMTP-сервера (пусто — почта отключена) | `smtp.example.com` |
| `SMTP_PORT` | Порт SMTP | `465` |
| `SMTP_SECURE` | Использовать TLS для SMTP | `true` |
| `SMTP_USER` | Логин SMTP | |
| `SMTP_PASS` | Пароль SMTP | |
| `SMTP_FROM` | Адрес отправителя в письмах | |

### Локальная разработка (без контейнеров)

1) Поднять PostgreSQL:

```bash
docker compose up -d db
```

2) Backend:

```bash
cd backend
npm install
npx prisma generate
npx prisma migrate dev
npm run dev
```

3) Frontend:

```bash
cd frontend
npm install
npm run dev
```

### Документация

В каталоге **`docs/`** — документация на Sphinx (обзор, вход и 2FA, доски, карточки, админ-кабинет, API, развёртывание), с возможностью добавить скриншоты. Сборка: см. `docs/README.md` (нужны Python, `pip install -r docs/requirements.txt`, затем `cd docs && make html`).

### Тесты

```bash
npm run test
```

Отдельно:

```bash
npm run test -w backend
npm run test -w frontend
```
