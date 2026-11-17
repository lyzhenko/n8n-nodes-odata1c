# n8n-nodes-odata1c

[![npm version](https://img.shields.io/npm/v/n8n-nodes-odata1c.svg)](https://www.npmjs.com/package/n8n-nodes-odata1c)
[![npm downloads](https://img.shields.io/npm/dm/n8n-nodes-odata1c.svg)](https://www.npmjs.com/package/n8n-nodes-odata1c)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/lyzhenko/n8n-nodes-odata1c/blob/main/LICENSE)
[![n8n community node](https://img.shields.io/badge/n8n-community%20node-ff6d5a.svg)](https://docs.n8n.io/integrations/community-nodes/)

n8n community node for the **standard OData interface of 1C:Enterprise** ([«Стандартный интерфейс OData»](https://infostart.ru/1c/articles/1570140/)). It reads and writes catalogs, documents, registers and constants of a 1C infobase over the automatic REST interface — without writing a single line of 1C code.

* 1C:Enterprise 8.3.10+ with the standard OData interface published (see [docs/1c-odata-setup.md](https://github.com/lyzhenko/n8n-nodes-odata1c/blob/main/docs/1c-odata-setup.md))
* n8n 1.x and 2.x, Node.js 20.15+
* Tested against a production ERP 2.5 infobase: 3,535 entity sets, 20 MB `$metadata`, 29k catalog items

Russian documentation: [README.ru.md](https://github.com/lyzhenko/n8n-nodes-odata1c/blob/main/README.ru.md).

---

## Contents

- [Features](#features)
- [Installation](#installation)
- [Credentials](#credentials)
- [Node reference](#node-reference)
- [Filters and expressions](#filters-and-expressions)
- [Examples](#examples)
- [1C-specific behaviour and limitations](#1c-specific-behaviour-and-limitations)
- [Troubleshooting](#troubleshooting)
- [Development](#development)
- [Deployment to a self-hosted n8n](#deployment-to-a-self-hosted-n8n)
- [Releasing](#releasing)
- [License](#license)

## Features

| Feature | Details |
| --- | --- |
| Entity set CRUD | Read one entity, read a page or the whole set, create, patch, delete |
| Documents | Post and unpost (`/Post()`, `/Unpost()`), tabular sections as arrays |
| Count | `/<EntitySet>/$count` with an optional filter |
| Metadata | Entity set list, fields and navigation properties, raw EDMX |
| Custom request | Any method and path against `/odata/standard.odata` |
| Filters | OData 3.0: `eq`, `ne`, `gt`, `ge`, `lt`, `le`, `and`, `or`, `not`, `like`, `startswith`, `endswith`, `substringof` |
| Paging | Automatic `$top`/`$skip` loop when *Return All* is on, stable page size |
| Dynamic lists | Entity sets are loaded from `$metadata` and cached for 5 minutes |
| Optimistic locking | Optional `If-Match` with the current `DataVersion` (HTTP 412 on conflict) |
| Data load mode | Optional `1C_OData-DataLoadMode: true` header for exchange-style writes |
| SSL | Self-signed certificates supported per credential |
| AI Agent | The node has `usableAsTool`, so an n8n AI Agent can call it as a tool |

## Installation

### From the n8n UI (recommended after publishing)

1. Open **Settings → Community nodes → Install**.
2. Enter `n8n-nodes-odata1c` and confirm.
3. Restart n8n if the node does not appear immediately.

Community nodes must be enabled on the instance (`N8N_COMMUNITY_PACKAGES_ENABLED=true`, and `N8N_UNVERIFIED_PACKAGES_ENABLED=true` for unverified packages).

### From a tarball (offline or self-hosted)

```bash
npm pack                       # produces n8n-nodes-odata1c-0.1.0.tgz
# on the n8n host, as the user that runs n8n:
mkdir -p ~/.n8n/nodes/node_modules/n8n-nodes-odata1c
tar -xzf n8n-nodes-odata1c-0.1.0.tgz -C ~/.n8n/nodes/node_modules/n8n-nodes-odata1c --strip-components=1
systemctl restart n8n          # or restart the container
```

The repository also ships an automated installer for a native (non-Docker) n8n:
see [Deployment to a self-hosted n8n](#deployment-to-a-self-hosted-n8n).

## Credentials

Create a credential of type **OData 1C API**.

| Field | Description |
| --- | --- |
| **Base URL** | Publication URL of the infobase **without** `/odata/standard.odata`, for example `https://1c.example.com/erp` or `http://192.168.0.20/trade`. A URL with `/odata/standard.odata` is also accepted and normalised. |
| **Username** / **Password** | A 1C user with access to the OData interface. Use a dedicated integration user with the minimum required rights — never an administrator. |
| **Ignore SSL Issues** | On by default: internal 1C servers usually have self-signed certificates. Turn it off if the certificate is valid. |
| **Timeout (ms)** | Request timeout, 60 000 ms by default. A cold 1C session or a big `$metadata` request may need more. |

The credential test performs `GET /odata/standard.odata/$metadata` and succeeds only if 1C accepts the user and the OData interface is published.

## Node reference

### Resource: Entity Set

| Operation | What it does | HTTP |
| --- | --- | --- |
| **Get Many** | Reads a page or the whole entity set | `GET /<Set>?$filter=…&$select=…&$top=…&$skip=…` |
| **Get One** | Reads one entity by `Ref_Key` | `GET /<Set>(guid'…')` |
| **Create** | Creates a catalog item, document or register record | `POST /<Set>` |
| **Update** | Patches the listed fields | `PATCH /<Set>(guid'…')` |
| **Delete** | Deletes the entity permanently | `DELETE /<Set>(guid'…')` |
| **Count** | Number of entities matching a filter | `GET /<Set>/$count?$filter=…` |
| **Post / Unpost** | Changes the posting status of a document | `POST /<Set>(guid'…')/Post()` or `/Unpost()` |

Parameters:

| Parameter | Applies to | Notes |
| --- | --- | --- |
| **Entity Set** | all | Picked from `$metadata` or typed by name (`Catalog_Номенклатура`, `Document_ЗаказКлиента`, …) |
| **Filter** | Get Many, Count | OData 3.0 expression, see [Filters](#filters-and-expressions) |
| **Sort** | Get Many | `$orderby`, for example `Date desc`; add `Ref_Key` for stable paging |
| **Select Fields** | Get Many, Get One | Comma-separated, for example `Ref_Key,Code,Description`. Highly recommended: a document without `$select` returns every field **and** every tabular section |
| **Expand** | Get Many | Navigation properties to expand. 1C supports `$expand` only for collection requests; the expanded names are added to `$select` automatically |
| **Return All** | Get Many | On: pages through the whole set with `$top`/`$skip`. Off: returns `Limit` rows |
| **Ref Key** | Get One, Update, Delete, Post/Unpost | `Ref_Key` GUID; `guid'…'` and `Catalog_X(guid'…')` forms are accepted |
| **Fields (JSON)** | Create, Update | JSON object. Reference fields use `<Name>_Key` with a GUID, tabular sections are arrays |

Options: **Page Size** (rows per HTTP call while paging, default 100), **Timeout**, **Data Load Mode** (`1C_OData-DataLoadMode: true` for writes), **Optimistic Lock (If-Match)** for Update (the node reads the current `DataVersion` and sends it; a concurrent change returns HTTP 412).

Output:

* Get Many / Get One — one n8n item per entity, fields exactly as 1C returned them (`Ref_Key`, `DataVersion`, `DeletionMark`, …; tabular sections as arrays; references as `<Name>_Key` plus an expanded object when `$expand` was used).
* Create — the created entity (HTTP 201).
* Update / Delete — `{ "success": true, … }` when 1C answers `204 No Content`.
* Count — `{ "entitySet": "Catalog_Контрагенты", "count": 23241 }`.
* Post / Unpost — the document returned by 1C, or `{ "success": true, "action": "Post" }`.

### Resource: Metadata

| Operation | Result |
| --- | --- |
| **Get Entity Sets** | One item per published set: `{ name, kind, entityType }`. Optional name/kind filter. |
| **Get Fields** | One item per property: `{ name, type, nullable, key, navigation, entitySet }`. Navigation properties (references and tabular sections) have `navigation: true`. |
| **Get Raw $metadata** | `{ entitySet: "$metadata", xml }` — the whole EDMX document. A big infobase can return tens of megabytes. |

### Resource: Custom Request

Any method (`GET`, `POST`, `PATCH`, `PUT`, `DELETE`), a path relative to `/odata/standard.odata` (a query string may be embedded), query/body/header JSON, and a response format (`JSON` or `Text`). `$format=json` is added automatically for JSON GET requests, because 1C returns Atom XML otherwise.

## Filters and expressions

`$filter` is passed to 1C almost verbatim; the only transformation is correct URL encoding. 1C uses OData 3.0 syntax:

| Entity | Syntax |
| --- | --- |
| String | `'Cable'`, an inner quote is doubled: `'O''Brien'` |
| GUID | `guid'3f1c9b7e-9d2a-11ee-8f3a-00155d0a1b2c'` |
| DateTime | `datetime'2024-01-31T00:00:00'` |
| Boolean | `true` / `false` |
| Null | `null` |
| Operators | `eq ne gt ge lt le`, combined with `and`, `or`, `not` and parentheses |
| Functions | `like(Description,'%cable%')`, `startswith(Code,'00-')`, `endswith(Description,'mm')`, `substringof('cable',Description)` |

Examples:

```
DeletionMark eq false
Date ge datetime'2024-01-01T00:00:00' and Posted eq true
Контрагент_Key eq guid'566e2814-612a-11e3-b722-001e673d6c4b'
like(Description,'%кабель%')
Ref_Key eq guid'3f1c9b7e-9d2a-11ee-8f3a-00155d0a1b2c'
```

`like` supports `%` (any sequence) and `_` (one character). Values with Cyrillic are URL-encoded by the node, so they can be typed as-is.

## Examples

### Read five catalog items

Resource `Entity Set`, operation `Get Many`:

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

### Create a customer order with a tabular section

Operation `Create`, entity set `Document_ЗаказКлиента`, **Fields (JSON)**:

```json
{
  "Date": "2024-03-20T10:00:00",
  "Контрагент_Key": "1f3b9a40-5b0e-11ee-9a4d-005056c00008",
  "Комментарий": "Created from n8n",
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

1C runs the object module, checks rights and validates the data, exactly as in interactive mode. A rejected write returns HTTP 500 and the 1C message, which the node shows as the error text.

### Post a document

Two nodes: `Update` (optional, set `Posted` fields if the configuration requires it) and `Post / Unpost` with action `Post`. Posting is a separate action, not a field write.

### Read all changed items since a date

```
$filter: Date ge datetime'2024-03-01T00:00:00'
$orderby: Date,Ref_Key
Return All: on
Page Size: 500
```

The node loops with `$top`/`$skip`. For large sets add a narrow filter and `$select` — every HTTP request starts a 1C session.

### Custom request to a virtual register table

Resource `Custom Request`, method `GET`, path:

```
InformationRegister_ЦеныНоменклатуры/SliceLast(Period=datetime'2024-03-01T00:00:00')?$format=json&$select=Номенклатура_Key,Цена
```

### Use the node from an expression

The node can be used as a tool by an n8n AI Agent (`usableAsTool`), and its output is ordinary n8n JSON, so fields are available downstream:

```
{{ $json.Description }}
{{ $json.Товары.length }}
{{ $json.Ref_Key }}
```

## 1C-specific behaviour and limitations

These are platform limitations, not node limitations:

* **`$expand` works only for collection requests.** `GET /Set(guid'…')?$expand=…` returns HTTP 501 in 1C. Use *Get Many* with `$filter=Ref_Key eq guid'…'` and *Expand* instead.
* **Tabular sections are returned inline** for documents and catalogs when `$select` is empty. Always set `$select` for documents: an ERP order can carry hundreds of fields and dozens of rows.
* **Dates are ISO strings without a timezone** (`2024-01-15T10:00:00`). `Date` and `Period` are compared with `datetime'…'` literals.
* **References are GUIDs** in `<Name>_Key` fields. Use `$expand` to get the referenced object or `$select=Контрагент/Description` to get just a presentation.
* **No joins, groupings or arbitrary queries.** OData exposes one entity set at a time; use virtual tables (`SliceLast`, `Balance`, `Turnovers`, …) where the configuration provides them.
* **Every request is a 1C session** and consumes a licence for its duration. Prefer paging, filters and `$select`; avoid thousands of tiny requests per minute.
* **`DELETE` is physical** and has no reference control. To hide an item, patch `DeletionMark: true` instead.
* **Rights decide everything.** The OData user needs rights on the object, on the referenced objects, and on tabular sections. HTTP 403/500 with «Доступ запрещен» means the 1C role is missing, not the node.
* **`$metadata` is big.** An ERP `$metadata` is about 20 MB; the node downloads it once per credential per 5 minutes and parses it in ~100 ms. The first node open in the editor may take a couple of seconds.
* **No `$batch` and no Atom.** The node speaks JSON only (`$format=json`).
* **Composition of the OData interface is explicit.** An infobase publishes only the objects listed by `УстановитьСоставСтандартногоИнтерфейсаOData`; if an entity set is missing, change the composition in 1C.

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| `401 Unauthorized` | Wrong user/password, or the 1C user is not allowed to use OData. Check with `curl -u user:pass https://host/base/odata/standard.odata/$metadata`. |
| `404` «Сущность 'Catalog_X' не найдена» | The object is not included in the OData composition or the name is misspelled (`Catalog_`, `Document_`, `InformationRegister_`, …). |
| `500` «Доступ запрещен» | The 1C role does not allow reading/writing this object or its references. Grant rights to the integration user. |
| `500` «Значение поля "Дата" не может быть пустой датой» | A required field is missing in **Fields (JSON)**. Required fields depend on the configuration. |
| `501` «Опция $expand не поддерживается при запросе одиночных сущностей» | Use *Get Many* with `$filter=Ref_Key eq guid'…'` + *Expand*. |
| Empty result with a filter | Cyrillic strings must be in single quotes: `Description eq 'Кабель'`; GUIDs need `guid'…'`; dates need `datetime'…'`. |
| Node does not appear in n8n | Community packages are disabled (`N8N_COMMUNITY_PACKAGES_ENABLED`), the package is not in `~/.n8n/nodes/node_modules`, or n8n was not restarted. |
| TLS error | Enable **Ignore SSL Issues** in the credential or install a valid certificate. |
| Timeout on a large set | Increase **Timeout** and lower **Page Size**; add a filter and `$select`. |

## Development

```bash
npm install
npm run build          # tsc + assets -> dist/
npm run typecheck
npm test               # build + unit and end-to-end tests against the bundled 1C mock
```

The test suite starts [mock/odata1c-mock.mjs](https://github.com/lyzhenko/n8n-nodes-odata1c/blob/main/mock/odata1c-mock.mjs), a dependency-free 1C OData emulator (metadata, filters, select/expand, CRUD, posting, If-Match, 1C-style `odata.error`), and runs the compiled node against it through a fetch-based replacement for n8n's HTTP helper. No 1C server is required for CI.

Manual run of the mock:

```bash
npm run mock
curl -u odata:odata 'http://127.0.0.1:18080/erp/odata/standard.odata/Catalog_Номенклатура?$format=json&$top=2'
```

Live check against a real infobase (read-only by default, `--write` also creates, patches and deletes a test item):

```bash
ODATA_BASE_URL=http://1c.example.com/erp ODATA_USER=user ODATA_PASSWORD=pass \
  node --env-file=.env scripts/live-check.mjs
node --env-file=.env scripts/live-check.mjs --write
```

## Deployment to a self-hosted n8n

The repository contains an idempotent installer used for a native n8n installation on ALT Linux (`/var/lib/n8n/.n8n/nodes`, systemd unit `n8n.service`):

```bash
python deploy/deploy.py            # build, pack, upload, install, restart
python deploy/deploy.py --no-build # reuse the existing build
```

`deploy/deploy.py` reads SSH settings from `.env` (or `../n8n_deploy/.env`):

```
SSH_PATH=http://192.168.0.11
SSH_USER=eladm
SSH_PASS=…
```

The remote part is [deploy/install-node.sh](https://github.com/lyzhenko/n8n-nodes-odata1c/blob/main/deploy/install-node.sh): it unpacks the tarball into `~n8n/.n8n/nodes/node_modules/n8n-nodes-odata1c`, fixes ownership and permissions (the service uses `UMask=0027`), restarts n8n and waits for `/healthz`.

## Releasing

1. Bump `version` in `package.json`, update [CHANGELOG.md](https://github.com/lyzhenko/n8n-nodes-odata1c/blob/main/CHANGELOG.md).
2. Push, then create a GitHub release. The workflow [.github/workflows/publish.yml](https://github.com/lyzhenko/n8n-nodes-odata1c/blob/main/.github/workflows/publish.yml) publishes to npm with provenance.
3. The repository secret `NPM_TOKEN` must be an npm **Automation** token (npm → Access Tokens) with publish rights for the package.

Manual publish (with an npm login that owns the package):

```bash
npm whoami
npm publish --access public
```

## License

[MIT](https://github.com/lyzhenko/n8n-nodes-odata1c/blob/main/LICENSE) © Alexander Lyzhenko

1C:Enterprise is a trademark of 1C Company. This project is an independent integration
and is not affiliated with, endorsed by or supported by 1C.

