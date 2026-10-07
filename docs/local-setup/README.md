# Локальная установка и запуск

Склонировать репозиторий и установить зависимости:

```bash
git clone https://github.com/wladich/nakarte.git
cd nakarte
yarn
```

Создать файл `src/secrets.json` из шаблона:

```bash
cp src/secrets.json.template src/secrets.json
```

Запустить dev-сервер:

```bash
yarn start
```

Проверить код:

```bash
yarn run lint
```

Часть возможностей требует ключей в `src/secrets.json`; в репозитории
вместо них лежат заглушки.
