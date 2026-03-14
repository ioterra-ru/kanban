# Configuration file for the Sphinx documentation builder.
# https://www.sphinx-doc.org/en/master/usage/configuration.html

project = "Kanban"
copyright = "2025"
author = "Kanban Team"
release = "1.0"
language = "ru"

extensions = [
    "sphinx.ext.autodoc",
    "sphinx.ext.viewcode",
    "sphinx.ext.intersphinx",
    "sphinx.ext.todo",
]

templates_path = ["_templates"]
exclude_patterns = ["_build", "Thumbs.db", ".DS_Store"]

html_theme = "sphinx_rtd_theme"
html_static_path = ["_static"]
# Опционально: добавьте logo.png и favicon.ico в _static и раскомментируйте:
# html_logo = "_static/logo.png"
# html_favicon = "_static/favicon.ico"

html_theme_options = {
    "display_version": True,
    "prev_next_buttons_location": "bottom",
    "style_external_links": True,
    "navigation_depth": 3,
}

html_context = {
    "display_github": False,
}

# Картинки: хранить в docs/images/ и подключать как /images/name.png
# Пример в RST: .. image:: images/board-view.png
# Для SVG: :align: center и т.д.

intersphinx_mapping = {}

todo_include_todos = True
