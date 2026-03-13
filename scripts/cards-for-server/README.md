# Перенос только карточек на сервер

**Восстановление** (на облачном сервере, в корне репозитория):

```bash
cd scripts/cards-for-server
npm install
node restore.mjs backup/kanban-cards-20260313T082148Z.json
```

Доски и колонки создаются по имени/заголовку, если ещё нет. Карточки добавляются без привязки к пользователям.

Конфиг: `docker/compose/.cont_one_app.env` (и при необходимости `.cont_one_app.secrets.env`). Для запуска с хоста в `DATABASE_URL` подставляется `localhost` вместо `db`, если порт БД проброшен.
