# Локальная установка и запуск

Склонировать репозиторий и установить зависимости:

```bash
git clone https://github.com/wladich/nakarte.git
cd nakarte
yarn
```

Создать файл `src/secrets.js` из шаблона:

```bash
cp src/secrets.js.template src/secrets.js
```

Запустить dev-сервер:

```bash
yarn start
```

Проверить код:

```bash
yarn run lint
```

Часть возможностей требует ключей в `src/secrets.js`; в репозитории
вместо них лежат заглушки.
