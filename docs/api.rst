Справочник API
==============

Общие сведения
--------------

* **Базовый URL:** ``/api`` (основные методы), ``/api/auth`` (аутентификация и профиль).
* **Аутентификация:** сессии (cookie). Для большинства маршрутов требуются вход и прохождение 2FA.
* **Формат:** JSON (запрос/ответ). Загрузка файлов — multipart/form-data.

Проверка доступности
--------------------

* **GET /api/health** — без авторизации; возвращает статус сервиса.

Маршруты аутентификации (/api/auth)
------------------------------------

Все маршруты ниже под префиксом ``/api/auth``.

Профиль и сессия
~~~~~~~~~~~~~~~~

* **GET /api/auth/me** — текущий пользователь, флаг прохождения 2FA, текущая доска (boardId).
* **GET /api/auth/profile** — данные профиля текущего пользователя.
* **PATCH /api/auth/profile** — обновление профиля (имя, доска по умолчанию, уведомления по email и т.д.).

Вход и выход
~~~~~~~~~~~~

* **POST /api/auth/login** — вход (email, password); при успехе создаётся сессия.
* **POST /api/auth/logout** — выход.

Пароль
~~~~~~

* **POST /api/auth/password** — смена пароля (текущий + новый).
* **POST /api/auth/password/forgot** — запрос сброса пароля по email (отправка письма при настроенном SMTP).
* **POST /api/auth/password/reset** — сброс пароля по токену из ссылки (token, newPassword).
* **POST /api/auth/password/reset-by-totp** — сброс пароля по коду TOTP.

Аватар
~~~~~~

* **GET /api/auth/avatar/:id** — получение изображения аватара по ID пользователя.
* **POST /api/auth/profile/avatar** — загрузка/установка аватара (multipart или JSON с preset).
* **DELETE /api/auth/profile/avatar** — удаление аватара.

Двухфакторная аутентификация
~~~~~~~~~~~~~~~~~~~~~~~~~~~~

* **POST /api/auth/2fa/setup** — начало настройки 2FA (возврат секрета/QR).
* **POST /api/auth/2fa/enable** — включение 2FA (код из приложения).
* **POST /api/auth/2fa/verify** — проверка кода 2FA при входе.

Администрирование (только ADMIN)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

* **GET /api/auth/users** — список пользователей.
* **POST /api/auth/users** — создание пользователя.
* **PATCH /api/auth/users/:id** — обновление пользователя (имя, роль и т.д.).
* **DELETE /api/auth/users/:id** — удаление пользователя.
* **POST /api/auth/users/:id/password** — сброс пароля пользователю.
* **GET /api/auth/users/:id/boards** — доски пользователя.
* **PUT /api/auth/users/:id/boards** — установка списка досок для пользователя.
* **GET /api/auth/mail-settings** — настройки SMTP.
* **PUT /api/auth/mail-settings** — сохранение настроек SMTP.
* **POST /api/auth/mail-settings/test** — тест отправки письма.

Основные маршруты (/api)
------------------------

Все маршруты ниже требуют входа и прохождения 2FA. Где указано «контекст доски» — в сессии должен быть выбран ``boardId`` (через POST /api/boards/select).

Доски
~~~~~

* **GET /api/boards** — список досок (для ADMIN — все, для MEMBER — по членству); в ответе также ``currentBoardId``.
* **POST /api/boards/select** — выбор текущей доски (body: ``boardId``).
* **POST /api/boards** — создание доски (ADMIN); body: name, description?, memberIds?.
* **PATCH /api/boards/:id** — обновление доски (ADMIN); body: name?, description?, memberIds?.
* **DELETE /api/boards/:id** — удаление доски (ADMIN).

Контекст доски и поиск
~~~~~~~~~~~~~~~~~~~~~

* **GET /api/board** — данные текущей доски (колонки, карточки и т.п.) в контексте сессии.
* **GET /api/users** — пользователи текущей доски (для выбора исполнителя/участников).
* **GET /api/board/search?q=...** — поиск карточек по текущей доске.

Колонки (ADMIN)
~~~~~~~~~~~~~~~

* **GET /api/boards/:boardId/columns** — список колонок доски.
* **POST /api/boards/:boardId/columns** — создание колонки (title, position).
* **PATCH /api/boards/:boardId/columns/:columnId** — обновление колонки (title?, position?).
* **DELETE /api/boards/:boardId/columns/:columnId** — удаление колонки.
* **POST /api/boards/:boardId/columns/:columnId/archive** — создание архива колонки.

Карточки (в контексте доски)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~

* **GET /api/cards/:id** — полные данные карточки (детали, комментарии, вложения, участники).
* **POST /api/cards** — создание карточки (boardId, columnId, description, details?, assignee?, dueDate?, importance?, paused?).
* **PATCH /api/cards/:id** — обновление полей карточки.
* **POST /api/cards/:id/move** — перемещение (columnId, position).
* **DELETE /api/cards/:id** — удаление карточки.
* **POST /api/cards/:id/archive** — архивирование карточки.
* **POST /api/cards/:id/participants** — добавление участника (userId).
* **DELETE /api/cards/:id/participants/:userId** — удаление участника.

Комментарии
~~~~~~~~~~~

* **POST /api/cards/:id/comments** — добавление комментария (body).
* **PATCH /api/comments/:id** — обновление комментария (body).
* **DELETE /api/comments/:id** — удаление комментария.

Вложения
~~~~~~~~

* **POST /api/cards/:id/attachments** — загрузка файла (multipart).
* **GET /api/attachments/:id/download** — скачивание вложения.
* **DELETE /api/attachments/:id** — удаление вложения.

Архив (ADMIN)
~~~~~~~~~~~~~

* **GET /api/archive** — список имён файлов архивов.
* **GET /api/archive/:filename/download** — скачивание архива.
* **DELETE /api/archive/:filename** — удаление записи/файла архива.
* **POST /api/archive/:filename/restore** — восстановление из архива.

Коды ответов и ошибки
--------------------

* **200** — успех (GET/PATCH и т.д.).
* **201** — создано (POST).
* **400** — неверные данные (валидация).
* **401** — не авторизован.
* **403** — доступ запрещён (нет прав или 2FA не пройдена).
* **404** — ресурс не найден.
* **500** — внутренняя ошибка сервера.

Тело ошибки обычно в формате JSON с полем ``message`` или аналогом.
