[![tests status](https://github.com/wladich/nakarte/workflows/check/badge.svg)](https://github.com/wladich/nakarte/actions?query=workflow%3Atest)

Source code of site http://nakarte.me (former http://nakarte.tk)

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
