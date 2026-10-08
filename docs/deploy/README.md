# Деплой на GitHub Pages

Сайт публикуется на https://bukerteam.github.io/nakarte_ext/ при каждом
пуше в `master`; вручную — Actions → deploy-pages → Run workflow.
Workflow — `.github/workflows/deploy-pages.yml`.

## Как проходит деплой

1. Устанавливаются Node 24 и зависимости (`yarnpkg`).
2. Из `src/secrets.json.template` создаётся `src/secrets.json`
   (подробнее о секретах — в `docs/local-setup/README.md`).
3. Выполняется `npm run build`; если задан секрет
   `OVERPASS_NEXTGIS_KEY`, в `build/config.json` записывается ключ
   NextGIS, и содержимое `build/` публикуется на GitHub Pages.

Пути в сборке относительные, поэтому сайт работает и из подпапки.

## Ключ NextGIS для быстрого Overpass

Без ключа POI грузятся через зеркало VK Maps: медленно (20–50 с) и с
ошибками, когда зеркало перегружено. С ключом NextGIS загрузка занимает
доли секунды. Ключ можно задать одним из способов:

1. **В браузере** (приватно): открой панель POI и вставь ключ в поле
   «Ключ NextGIS» внизу панели. Ключ хранится только в этом браузере
   (localStorage) и никуда не отправляется.
2. **Через config.json** (для всех посетителей): задай секрет
   `OVERPASS_NEXTGIS_KEY` в Settings → Secrets and variables → Actions и
   перезапусти workflow. Workflow положит ключ в `build/config.json` —
   файл **публично доступен** по адресу
   https://bukerteam.github.io/nakarte_ext/config.json, поэтому
   используй ключ, который не жалко отозвать.
3. **В сборке** (для локальной разработки): ключ в `src/secrets.json`
   попадает в JS-бандл и тоже становится публичным.

Приоритет: ключ из браузера → `config.json` → ключ из сборки.

## Релизы

Релиз — тег и GitHub Release на коммит `master`:

```sh
gh release create v1.0.0 --target master --generate-notes
```

Деплой на релиз не завязан: сайт всегда собирается из последнего
`master`, а тег фиксирует версию.
