# n8n-nodes-odata1c

[![npm version](https://img.shields.io/npm/v/n8n-nodes-odata1c.svg)](https://www.npmjs.com/package/n8n-nodes-odata1c)
[![npm downloads](https://img.shields.io/npm/dm/n8n-nodes-odata1c.svg)](https://www.npmjs.com/package/n8n-nodes-odata1c)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/lyzhenko/n8n-nodes-odata1c/blob/main/LICENSE)
[![n8n community node](https://img.shields.io/badge/n8n-community%20node-ff6d5a.svg)](https://docs.n8n.io/integrations/community-nodes/)

Community-нода n8n для **стандартного интерфейса OData 1С:Предприятия** ([«Работа с 1С через протокол OData»](https://infostart.ru/1c/articles/1570140/)). Читает и записывает справочники, документы, регистры и константы информационной базы через автоматический REST-интерфейс — без единой строки кода в 1С.

* 1С:Предприятие 8.3.10+ с опубликованным стандартным интерфейсом OData (см. [docs/1c-odata-setup.ru.md](https://github.com/lyzhenko/n8n-nodes-odata1c/blob/main/docs/1c-odata-setup.ru.md))
* n8n 1.x и 2.x, Node.js 20.15+
* Проверено на рабочей базе ERP 2.5: 3 535 сущностей, 20 МБ `$metadata`, 29 тыс. элементов номенклатуры

Документация на английском: [README.md](https://github.com/lyzhenko/n8n-nodes-odata1c/blob/main/README.md).

---

## Содержание

- [Возможности](#возможности)
- [Установка](#установка)
- [Учётные данные](#учётные-данные)
- [Описание ноды](#описание-ноды)
- [Фильтры и выражения](#фильтры-и-выражения)
- [Примеры](#примеры)
- [Особенности и ограничения 1С](#особенности-и-ограничения-1с)
- [Решение проблем](#решение-проблем)
- [Разработка](#разработка)
- [Развёртывание на свой n8n](#развёртывание-на-свой-n8n)
- [Публикация](#публикация)
- [Лицензия](#лицензия)

## Возможности

| Возможность | Описание |
| --- | --- |
| CRUD по наборам сущностей | Чтение одной записи, страницы или всего набора, создание, изменение, удаление |
| Документы | Проведение и отмена (`/Post()`, `/Unpost()`), табличные части как массивы |
| Количество | `/<Набор>/$count` с необязательным отбором |
| Метаданные | Список наборов, реквизиты и навигационные свойства, «сырой» EDMX |
| Произвольный запрос | Любой метод и путь относительно `/odata/standard.odata` |
| Отборы | OData 3.0: `eq`, `ne`, `gt`, `ge`, `lt`, `le`, `and`, `or`, `not`, `like`, `startswith`, `endswith`, `substringof` |
| Постраничное чтение | Автоматический цикл `$top`/`$skip` при включённом *Return All* |
| Динамические списки | Наборы сущностей подгружаются из `$metadata` и кешируются на 5 минут |
| Оптимистичная блокировка | Необязательный `If-Match` с текущим `DataVersion` (HTTP 412 при конфликте) |
| Режим загрузки данных | Необязательный заголовок `1C_OData-DataLoadMode: true` для записи «как при обмене» |
| SSL | Самоподписанные сертификаты поддерживаются на уровне учётных данных |
| AI Agent | У ноды есть `usableAsTool` — AI-агент n8n может вызывать её как инструмент |

## Установка

### Из интерфейса n8n (после публикации в npm)

1. Откройте **Settings → Community nodes → Install**.
2. Введите `n8n-nodes-odata1c` и подтвердите установку.
3. Если нода не появилась — перезапустите n8n.

Community-ноды должны быть разрешены на инстансе (`N8N_COMMUNITY_PACKAGES_ENABLED=true`, для непроверенных пакетов — `N8N_UNVERIFIED_PACKAGES_ENABLED=true`).

### Из tarball (офлайн или свой сервер)

```bash
npm pack                       # создаст n8n-nodes-odata1c-0.1.0.tgz
# на сервере n8n, от пользователя, под которым работает n8n:
mkdir -p ~/.n8n/nodes/node_modules/n8n-nodes-odata1c
tar -xzf n8n-nodes-odata1c-0.1.0.tgz -C ~/.n8n/nodes/node_modules/n8n-nodes-odata1c --strip-components=1
systemctl restart n8n          # или перезапуск контейнера
```

В репозитории есть автоматический установщик для нативного (не Docker) n8n: см. [Развёртывание на свой n8n](#развёртывание-на-свой-n8n).

## Учётные данные

Создайте учётные данные типа **OData 1C API**.

| Поле | Описание |
| --- | --- |
| **Base URL** | Адрес публикации базы **без** `/odata/standard.odata`, например `https://1c.example.com/erp` или `http://192.168.0.20/trade`. Адрес вместе с `/odata/standard.odata` тоже принимается и нормализуется. |
| **Username** / **Password** | Пользователь 1С с доступом к интерфейсу OData. Заведите отдельного пользователя интеграции с минимальными правами — не администратора. |
| **Ignore SSL Issues** | Включено по умолчанию: у внутренних серверов 1С обычно самоподписанный сертификат. Выключите, если сертификат валидный. |
| **Timeout (ms)** | Таймаут запроса, по умолчанию 60 000 мс. «Холодный» сеанс 1С или большой `$metadata` могут требовать больше. |

Проверка учётных данных выполняет `GET /odata/standard.odata/$metadata` и успешна только если 1С приняла пользователя и интерфейс OData опубликован.

## Описание ноды

### Ресурс «Entity Set» (набор сущностей)

| Операция | Что делает | HTTP |
| --- | --- | --- |
| **Get Many** | Читает страницу или весь набор | `GET /<Set>?$filter=…&$select=…&$top=…&$skip=…` |
| **Get One** | Читает одну запись по `Ref_Key` | `GET /<Set>(guid'…')` |
| **Create** | Создаёт элемент справочника, документ или запись регистра | `POST /<Set>` |
| **Update** | Изменяет перечисленные поля | `PATCH /<Set>(guid'…')` |
| **Delete** | Удаляет запись физически | `DELETE /<Set>(guid'…')` |
| **Count** | Количество записей по отбору | `GET /<Set>/$count?$filter=…` |
| **Post / Unpost** | Проводит или отменяет проведение документа | `POST /<Set>(guid'…')/Post()` или `/Unpost()` |

Параметры:

| Параметр | Для каких операций | Примечание |
| --- | --- | --- |
| **Entity Set** | все | Выбирается из `$metadata` или вводится вручную (`Catalog_Номенклатура`, `Document_ЗаказКлиента`, …) |
| **Filter** | Get Many, Count | Выражение OData 3.0, см. [Фильтры](#фильтры-и-выражения) |
| **Sort** | Get Many | `$orderby`, например `Date desc`; для стабильной постраничной выборки добавьте `Ref_Key` |
| **Select Fields** | Get Many, Get One | Через запятую, например `Ref_Key,Code,Description`. Настоятельно рекомендуется: документ без `$select` вернёт все реквизиты **и** все табличные части |
| **Expand** | Get Many | Навигационные свойства. 1С поддерживает `$expand` только для запросов коллекций; имена автоматически добавляются в `$select` |
| **Return All** | Get Many | Вкл.: читает весь набор циклом `$top`/`$skip`. Выкл.: возвращает `Limit` записей |
| **Ref Key** | Get One, Update, Delete, Post/Unpost | GUID из `Ref_Key`; принимаются формы `guid'…'` и `Catalog_X(guid'…')` |
| **Fields (JSON)** | Create, Update | JSON-объект. Ссылочные реквизиты — `<Имя>_Key` с GUID, табличные части — массивы |

Опции: **Page Size** (записей на один HTTP-запрос при постраничном чтении, по умолчанию 100), **Timeout**, **Data Load Mode** (заголовок `1C_OData-DataLoadMode: true` при записи), **Optimistic Lock (If-Match)** для Update (нода читает текущий `DataVersion` и отправляет его; параллельное изменение вернёт HTTP 412).

Результат:

* Get Many / Get One — по одному элементу n8n на запись, поля в том виде, в котором их вернула 1С (`Ref_Key`, `DataVersion`, `DeletionMark`, …; табличные части — массивами; ссылки — `<Имя>_Key`, а при `$expand` ещё и вложенный объект).
* Create — созданная запись (HTTP 201).
* Update / Delete — `{ "success": true, … }`, если 1С ответила `204 No Content`.
* Count — `{ "entitySet": "Catalog_Контрагенты", "count": 23241 }`.
* Post / Unpost — документ, который вернула 1С, либо `{ "success": true, "action": "Post" }`.

### Ресурс «Metadata»

| Операция | Результат |
| --- | --- |
| **Get Entity Sets** | По элементу на набор: `{ name, kind, entityType }`. Можно отфильтровать по имени или виду. |
| **Get Fields** | По элементу на реквизит: `{ name, type, nullable, key, navigation, entitySet }`. У навигационных свойств (ссылок и табличных частей) `navigation: true`. |
| **Get Raw $metadata** | `{ entitySet: "$metadata", xml }` — весь EDMX-документ. У большой базы это десятки мегабайт. |

### Ресурс «Custom Request»

Любой метод (`GET`, `POST`, `PATCH`, `PUT`, `DELETE`), путь относительно `/odata/standard.odata` (строка запроса может быть внутри пути), JSON для query/body/headers и формат ответа (`JSON` или `Text`). Для GET c JSON-ответом `$format=json` добавляется автоматически, иначе 1С вернёт Atom XML.

## Фильтры и выражения

`$filter` передаётся в 1С практически без изменений — нода только корректно кодирует его в URL. Синтаксис — OData 3.0:

| Сущность | Синтаксис |
| --- | --- |
| Строка | `'Кабель'`, внутренняя кавычка удваивается: `'O''Brien'` |
| GUID | `guid'3f1c9b7e-9d2a-11ee-8f3a-00155d0a1b2c'` |
| Дата | `datetime'2024-01-31T00:00:00'` |
| Логическое | `true` / `false` |
| Пусто | `null` |
| Операторы | `eq ne gt ge lt le` в сочетании с `and`, `or`, `not` и скобками |
| Функции | `like(Description,'%кабель%')`, `startswith(Code,'00-')`, `endswith(Description,'мм')`, `substringof('кабель',Description)` |

Примеры:

```
DeletionMark eq false
Date ge datetime'2024-01-01T00:00:00' and Posted eq true
Контрагент_Key eq guid'566e2814-612a-11e3-b722-001e673d6c4b'
like(Description,'%кабель%')
Ref_Key eq guid'3f1c9b7e-9d2a-11ee-8f3a-00155d0a1b2c'
```

В `like` поддерживаются `%` (любая последовательность) и `_` (один символ). Кириллица кодируется нодой автоматически — значения можно писать как есть.

## Примеры

### Прочитать пять элементов справочника

Ресурс `Entity Set`, операция `Get Many`:

```json
{
  "entitySet": { "__rl": true, "mode": "name", "value": "Catalog_Номенклатура" },
  "filter": "DeletionMark eq false",
  "select": "Ref_Key,Code,Description,Артикул",
  "orderBy": "Code",
  "returnAll": false,
  "limit": 5,
  "options": { "pageSize": 100 }
}
```

### Создать заказ клиента с табличной частью

Операция `Create`, набор `Document_ЗаказКлиента`, **Fields (JSON)**:

```json
{
  "Date": "2024-03-20T10:00:00",
  "Контрагент_Key": "1f3b9a40-5b0e-11ee-9a4d-005056c00008",
  "Комментарий": "Создано из n8n",
  "Товары": [
    {
      "LineNumber": "1",
      "Номенклатура_Key": "3f1c9b7e-9d2a-11ee-8f3a-00155d0a1b2c",
      "Количество": 4,
      "Цена": 128.5,
      "Сумма": 514
    }
  ]
}
```

1С выполнит модуль объекта, проверит права и данные — так же, как при интерактивной записи. Отказ записи вернёт HTTP 500 и сообщение 1С, которое нода покажет текстом ошибки.

### Провести документ

Две ноды: `Update` (при необходимости заполнить реквизиты, если этого требует конфигурация) и `Post / Unpost` с действием `Post`. Проведение — отдельное действие, а не запись поля.

### Прочитать всё, что изменилось с даты

```
$filter: Date ge datetime'2024-03-01T00:00:00'
$orderby: Date,Ref_Key
Return All: вкл.
Page Size: 500
```

Нода идёт циклом `$top`/`$skip`. Для больших наборов добавляйте узкий отбор и `$select` — каждый HTTP-запрос запускает сеанс 1С.

### Произвольный запрос к виртуальной таблице регистра

Ресурс `Custom Request`, метод `GET`, путь:

```
InformationRegister_ЦеныНоменклатуры/SliceLast(Period=datetime'2024-03-01T00:00:00')?$format=json&$select=Номенклатура_Key,Цена
```

### Использование в выражениях

Ноду можно подключать как инструмент AI-агента n8n (`usableAsTool`), а её результат — обычный JSON n8n, поэтому поля доступны дальше по цепочке:

```
{{ $json.Description }}
{{ $json.Товары.length }}
{{ $json.Ref_Key }}
```

## Особенности и ограничения 1С

Это ограничения платформы, а не ноды:

* **`$expand` работает только для запросов коллекций.** `GET /Set(guid'…')?$expand=…` возвращает HTTP 501. Используйте *Get Many* с `$filter=Ref_Key eq guid'…'` и *Expand*.
* **Табличные части возвращаются inline** для документов и справочников при пустом `$select`. Всегда указывайте `$select` для документов: у заказа ERP сотни реквизитов и десятки строк.
* **Даты — строки ISO без часового пояса** (`2024-01-15T10:00:00`). `Date` и `Period` сравниваются с литералами `datetime'…'`.
* **Ссылки — это GUID** в полях `<Имя>_Key`. Чтобы получить объект, используйте `$expand`, чтобы только представление — `$select=Контрагент/Description`.
* **Нет соединений, группировок и произвольных запросов.** OData отдаёт один набор сущностей за раз; используйте виртуальные таблицы (`SliceLast`, `Balance`, `Turnovers`, …), если конфигурация их предоставляет.
* **Каждый запрос — сеанс 1С** и на время работы занимает лицензию. Предпочитайте постраничное чтение, отборы и `$select`; не делайте тысячи мелких запросов в минуту.
* **`DELETE` удаляет физически** и не контролирует ссылки. Чтобы «скрыть» элемент, меняйте `DeletionMark: true`.
* **Права решают всё.** Пользователю OData нужны права на объект, на связанные объекты и на табличные части. HTTP 403/500 с «Доступ запрещен» — это отсутствующая роль в 1С, а не ошибка ноды.
* **`$metadata` большой.** У ERP это около 20 МБ; нода скачивает его один раз на учётные данные за 5 минут и разбирает примерно за 100 мс. Первое открытие ноды в редакторе может занять пару секунд.
* **Нет `$batch` и Atom.** Нода работает только с JSON (`$format=json`).
* **Состав интерфейса OData задаётся явно.** База публикует только объекты из `УстановитьСоставСтандартногоИнтерфейсаOData`; если набора сущностей нет — измените состав в 1С.

## Решение проблем

| Симптом | Причина и решение |
| --- | --- |
| `401 Unauthorized` | Неверный пользователь/пароль или пользователю 1С запрещён OData. Проверьте: `curl -u user:pass https://host/base/odata/standard.odata/$metadata`. |
| `404` «Сущность 'Catalog_X' не найдена» | Объект не включён в состав OData или имя с опечаткой (`Catalog_`, `Document_`, `InformationRegister_`, …). |
| `500` «Доступ запрещен» | Роль 1С не позволяет читать/писать объект или его ссылки. Выдайте права пользователю интеграции. |
| `500` «Значение поля "Дата" не может быть пустой датой» | В **Fields (JSON)** не хватает обязательного реквизита. Набор обязательных полей зависит от конфигурации. |
| `501` «Опция $expand не поддерживается при запросе одиночных сущностей» | Используйте *Get Many* с `$filter=Ref_Key eq guid'…'` + *Expand*. |
| Пустой результат с отбором | Кириллица — в одинарных кавычках: `Description eq 'Кабель'`; GUID — `guid'…'`; даты — `datetime'…'`. |
| Нода не появилась в n8n | Community-пакеты выключены (`N8N_COMMUNITY_PACKAGES_ENABLED`), пакета нет в `~/.n8n/nodes/node_modules` или n8n не перезапущен. |
| Ошибка TLS | Включите **Ignore SSL Issues** в учётных данных или поставьте валидный сертификат. |
| Таймаут на большом наборе | Увеличьте **Timeout** и уменьшите **Page Size**; добавьте отбор и `$select`. |

## Разработка

```bash
npm install
npm run build          # tsc + ассеты -> dist/
npm run typecheck
npm test               # сборка + юнит- и e2e-тесты на встроенном моке 1С
```

Тесты поднимают [mock/odata1c-mock.mjs](https://github.com/lyzhenko/n8n-nodes-odata1c/blob/main/mock/odata1c-mock.mjs) — эмулятор OData 1С без зависимостей (метаданные, фильтры, select/expand, CRUD, проведение, If-Match, ошибки в формате `odata.error`) — и прогоняют скомпилированную ноду через fetch-замену HTTP-хелпера n8n. Для CI сервер 1С не нужен.

Ручной запуск мока:

```bash
npm run mock
curl -u odata:odata 'http://127.0.0.1:18080/erp/odata/standard.odata/Catalog_Номенклатура?$format=json&$top=2'
```

Проверка на реальной базе (по умолчанию только чтение, `--write` дополнительно создаёт, меняет и удаляет тестовый элемент):

```bash
ODATA_BASE_URL=http://1c.example.com/erp ODATA_USER=user ODATA_PASSWORD=pass \
  node --env-file=.env scripts/live-check.mjs
node --env-file=.env scripts/live-check.mjs --write
```

## Развёртывание на свой n8n

В репозитории есть идемпотентный установщик для нативного n8n на ALT Linux (`/var/lib/n8n/.n8n/nodes`, systemd-юнит `n8n.service`):

```bash
python deploy/deploy.py            # сборка, упаковка, загрузка, установка, перезапуск
python deploy/deploy.py --no-build # использовать готовую сборку
```

`deploy/deploy.py` читает настройки SSH из `.env` (или `../n8n_deploy/.env`):

```
SSH_PATH=http://192.168.0.11
SSH_USER=eladm
SSH_PASS=…
```

Удалённая часть — [deploy/install-node.sh](https://github.com/lyzhenko/n8n-nodes-odata1c/blob/main/deploy/install-node.sh): распаковывает tarball в `~n8n/.n8n/nodes/node_modules/n8n-nodes-odata1c`, выставляет владельца и права (сервис работает с `UMask=0027`), перезапускает n8n и ждёт `/healthz`.

## Публикация

1. Поднимите `version` в `package.json`, обновите [CHANGELOG.md](https://github.com/lyzhenko/n8n-nodes-odata1c/blob/main/CHANGELOG.md).
2. Запушьте изменения и создайте релиз на GitHub. Workflow [.github/workflows/publish.yml](https://github.com/lyzhenko/n8n-nodes-odata1c/blob/main/.github/workflows/publish.yml) опубликует пакет в npm с provenance.
3. Секрет репозитория `NPM_TOKEN` — это npm **Automation** token (npm → Access Tokens) с правом публикации пакета.

Ручная публикация (из-под npm-пользователя, которому принадлежит пакет):

```bash
npm whoami
npm publish --access public
```

## Лицензия

[MIT](https://github.com/lyzhenko/n8n-nodes-odata1c/blob/main/LICENSE) © Alexander Lyzhenko

