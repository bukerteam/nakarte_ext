[![tests status](https://github.com/wladich/nakarte/workflows/check/badge.svg)](https://github.com/wladich/nakarte/actions?query=workflow%3Atest)

Source code of site http://nakarte.me (former http://nakarte.tk)

## Прокладка маршрутов

В форк добавлена панель маршрутов. Открывается кнопкой с иконкой маршрута на панели
инструментов слева — или сама, когда вы начинаете строить маршрут с карты.

Как построить маршрут:

- правый клик по карте → **Route from**, **Route to** или **Route via**: так задаются старт,
  финиш и промежуточные точки;
- точки можно взять из треков: клик по точке трека → **Route from / Route to / Route via**;
- точки двигаются прямо на карте; в панели их можно удалить крестиком, а порядок поменять
  перетаскиванием строки за ручку «⋮». Первая точка списка — старт, последняя — финиш,
  остальные — промежуточные. После любого изменения маршрут пересчитывается сам.

В панели ещё есть:

- выбор профиля: Car, Bike, Motorcycle, Foot;
- для машины и мотоцикла — «Avoid toll roads» и «Avoid unpaved roads», для всех —
  «Prefer shortest route»;
- кнопка **Show elevation profile** — профиль высот построенного маршрута;
- **Save route** — маршрут сохраняется в список **Trips** внизу панели (хранится в localStorage
  браузера). Сохранённый маршрут можно показать или скрыть, перекрасить, переименовать,
  отредактировать (точки пересчитаются) и удалить. По правому клику на маршруте в списке
  есть **Convert to track** — он превратится в обычный трек и появится в списке треков.

Маршруты строит Valhalla. Адрес и ключ задаются в `src/config.js`:

```js
routing: {
    provider: 'valhalla',
    url: 'https://valhalla1.openstreetmap.de/route',
    apiKey: secrets.routingApiKey,
},
```

Ключ (если он нужен вашему инстансу) кладётся в `src/secrets.js` — поле `routingApiKey`,
шаблон есть в `src/secrets.js.template`.

Публичный `valhalla1.openstreetmap.de` годится только для разработки: у него есть лимиты
(например, велосипед — 150 км, пешеход — 100 км). Для продакшена нужен свой или платный
инстанс Valhalla — варианты расписаны в
[issue #10](https://github.com/bukerteam/nakarte_ext/issues/10).

Install locally for development

```bash
git clone https://github.com/wladich/nakarte.git
cd nakarte
yarn
```

Create a dummy `secrets.js` file:
```bash
cp src/secrets.js.template src/secrets.js
```

Run dev server:
```bash
yarn start
```

Check code for errors:
```bash
yarn run lint
```

Some features require keys stored in src/secrets.js. 
In repository those keys are replaced with dummy ones.
    
Some of server side components:
https://github.com/wladich/westra_passes_for_nakarte
https://github.com/wladich/ElevationServer

## Работа с точками треков

Точки треков можно переносить и копировать между треками, а также
выделять и обрабатывать пачкой.

**Перенести или скопировать одну точку**

- Нажми на точку правой кнопкой (подойдёт и обычный клик) — откроется
  контекстное меню.
- Выбери **Copy to track** или **Move to track**.
- Кликни трек, в который переносим точку: строку в списке треков или
  линию трека на карте.
- Передумал — **Cancel** или Esc.

**Выделить и обработать сразу несколько точек**

- В списке треков нажми **…** в строке нужного трека и выбери
  **Select points**.
- Вокруг точек трека появится прямоугольник, а сверху — панель со
  счётчиком и кнопками Delete, Copy, Move и Cancel.
- Тяни прямоугольник за стороны или углы — точки внутри подсвечиваются,
  счётчик обновляется.
- **Delete** удаляет выделенные точки, **Copy** и **Move** переносят их
  в другой трек так же, как одну точку: кликом по строке или по линии
  на карте.
- Отменить выделение — **Cancel** или Esc.

Если у трека нет точек, пункт **Select points** неактивен. Если в
списке только один трек, неактивны **Copy** и **Move**.
