# Деплой на GitHub Pages

Сайт публикуется на https://bukerteam.github.io/nakarte_ext/ при каждом
пуше в `master`; вручную — Actions → deploy-pages → Run workflow.
Workflow — `.github/workflows/deploy-pages.yml`.

## Как проходит деплой

1. Устанавливаются Node 24 и зависимости (`yarnpkg`).
2. Из `src/secrets.json.template` создаётся `src/secrets.json`
   (подробнее о секретах — в `docs/local-setup/README.md`).
3. Выполняется `npm run build`, содержимое `build/` публикуется на
   GitHub Pages.

Пути в сборке относительные, поэтому сайт работает и из подпапки.

## Включить быстрый Overpass (ключ NextGIS)

По умолчанию сборка использует шаблон: Overpass работает через зеркало
VK Maps. Чтобы публиковать сборку с инстансом NextGIS:

1. Открой Settings → Secrets and variables → Actions.
2. Нажми New repository secret.
3. Имя — `OVERPASS_NEXTGIS_KEY`, значение — ключ из личного кабинета
   my.nextgis.com.
4. Перезапусти workflow (Actions → deploy-pages → Run workflow) или
   сделай любой пуш в `master`.

Ключ будет вшит в JS и доступен всем посетителям сайта: используй
отдельный ключ, который не жалко отозвать.

## Релизы

Релиз — тег и GitHub Release на коммит `master`:

```sh
gh release create v1.0.0 --target master --generate-notes
```

Деплой на релиз не завязан: сайт всегда собирается из последнего
`master`, а тег фиксирует версию.
