[![tests status](https://github.com/wladich/nakarte/workflows/check/badge.svg)](https://github.com/wladich/nakarte/actions?query=workflow%3Atest)

## Общее

Исходный код сайта http://nakarte.me (ранее http://nakarte.tk) — сервиса
для работы с картами и треками: картографические слои, загрузка и
редактирование треков, поиск, панорамы и другое.

Серверные компоненты:

- https://github.com/wladich/westra_passes_for_nakarte
- https://github.com/wladich/ElevationServer

## Локальная установка и запуск

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

## Базовые возможности

Основная документация — https://docs.nakarte.me/.

## Дополнительные возможности

- [Прокладка маршрутов](docs/additional-features.md#прокладка-маршрутов)
- [Работа с точками треков](docs/additional-features.md#работа-с-точками-треков)
