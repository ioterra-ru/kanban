# Документация Kanban (Sphinx)

Документация приложения на русском языке: обзор, аутентификация, доски, карточки, админ-кабинет, API и развёртывание.

## Сборка HTML

1. Установите зависимости (рекомендуется виртуальное окружение):
   ```bash
   python3 -m venv .venv-docs
   source .venv-docs/bin/activate   # Linux/macOS
   pip install -r docs/requirements.txt
   ```
   Или глобально: `pip install -r docs/requirements.txt` (при необходимости флаг `--user`).

2. Соберите документацию:
   ```bash
   cd docs && make html
   ```

3. Откройте в браузере: `docs/_build/html/index.html`.

Альтернатива без Makefile:
```bash
cd docs
sphinx-build -b html . _build/html
```

## Скриншоты

В разделах предусмотрены места для скриншотов. Список нужных файлов и их описание — в **`docs/images/README.md`**. Добавьте PNG (или JPEG) в `docs/images/` с указанными именами — они автоматически подхватятся при следующей сборке.

Сейчас в качестве заглушки используется `images/placeholder.png`; после добавления реальных скриншотов замените в `.rst`-файлах путь `images/placeholder.png` на соответствующий файл (например, `images/auth-login.png`).

## Структура

| Файл | Содержание |
|------|------------|
| `index.rst` | Оглавление и главная страница |
| `overview.rst` | Обзор приложения, стек, роли |
| `auth.rst` | Вход, 2FA, сброс пароля, профиль |
| `boards.rst` | Доски, колонки, поиск |
| `cards.rst` | Карточки, DnD, комментарии, вложения |
| `admin.rst` | Админ-кабинет: почта, доски, пользователи, архив |
| `api.rst` | Справочник API (маршруты и методы) |
| `deployment.rst` | Развёртывание, Docker, резервное копирование |

Тема: **Read the Docs** (`sphinx_rtd_theme`).
