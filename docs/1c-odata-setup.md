# Publishing the standard OData interface in 1C:Enterprise

The node talks to the OData service that the 1C platform generates automatically. Nothing has to be programmed in the configuration, but three things must be true on the 1C side:

1. The infobase is published on a web server with the standard OData interface enabled.
2. The required metadata objects are included in the OData composition.
3. A dedicated user with the necessary rights exists.

## 1. Publish the infobase

### Windows / IIS or Apache (Configurator)

1. Open the infobase in the Configurator.
2. **Administration → Publishing on a web server**.
3. Set the publication name (for example `erp`), the web server and the directory.
4. Enable **Publish standard OData interface**.
5. Publish and check that the URL responds:

```bash
curl -i -u odata_user:password https://1c.example.com/erp/odata/standard.odata/$metadata
```

HTTP 200 with an EDMX document means the service is alive. HTTP 401 means authentication; HTTP 404 means the publication or the OData interface is disabled.

### Linux (webinst, default.vrd)

`webinst -publish -apache24 -wsdir erp -dir /var/www/erp -connstr "Srvr=localhost;Ref=erp"` creates the publication. The OData interface is enabled in `default.vrd`:

```xml
<point xmlns="http://v8.1c.ru/8.2/virtual-resource-system"
       xmlns:xs="http://www.w3.org/2001/XMLSchema"
       base="/erp"
       ib="Srvr=localhost;Ref=erp">
  <standardOdata enable="true"
                 reuseSessions="autouse"
                 sessionsTimeout="20"
                 poolSize="10"
                 maxBufferSize="10000000"
                 readWriteMode="readwrite"/>
</point>
```

`readWriteMode` is `readwrite`, `readonly` or `writeonly`. `reuseSessions="autouse"` lets 1C reuse sessions for OData requests.

## 2. Define the OData composition

By default the composition is empty and every request returns «Сущность … не найдена». The composition is set by the platform method `УстановитьСоставСтандартногоИнтерфейсаOData`:

```bsl
Процедура НастроитьСоставOData() Экспорт
	Состав = Новый Массив;
	Состав.Добавить(Метаданные.Справочники.Номенклатура);
	Состав.Добавить(Метаданные.Справочники.Контрагенты);
	Состав.Добавить(Метаданные.Справочники.Валюты);
	Состав.Добавить(Метаданные.Документы.ЗаказКлиента);
	Состав.Добавить(Метаданные.РегистрыСведений.ЦеныНоменклатуры);

	УстановитьСоставСтандартногоИнтерфейсаOData(Состав);
КонецПроцедуры
```

Objects referenced by the included objects must be in the composition as well, otherwise 1C refuses to save it. Configurations based on BSP have a form for this (**Настройка стандартного интерфейса OData**) and the processing **Настройка автоматического REST-сервиса**, which select dependent objects and create a service user.

## 3. Create the integration user

* Separate user, for example `odata_user`, with a long random password.
* Only the rights needed by the integration: read on the objects it queries, write/create on the objects it modifies, plus rights on referenced objects and tabular sections.
* In BSP configurations there is a dedicated role for remote OData access; assign it instead of full rights.
* Never use an administrator account for an integration.

## 4. Verify the endpoints

```bash
BASE=https://1c.example.com/erp/odata/standard.odata
AUTH='-u odata_user:password'

# service document
curl $AUTH "$BASE/?\$format=json"

# metadata (can be tens of megabytes on ERP)
curl $AUTH "$BASE/\$metadata" -o metadata.xml

# first five items of a catalog
curl $AUTH "$BASE/Catalog_Номенклатура?\$format=json&\$top=5&\$select=Ref_Key,Code,Description"

# count with a filter
curl $AUTH "$BASE/Catalog_Номенклатура/\$count?\$filter=DeletionMark%20eq%20false"

# one document with its tabular section
curl $AUTH "$BASE/Document_ЗаказКлиента(guid'6c4fce01-9d2a-11ee-8f3a-00155d0a1b2c')?\$format=json"
```

## Notes

* **`$format=json` is required** for JSON responses; without it 1C returns Atom XML.
* **Authentication is HTTP Basic.** Publish over HTTPS; do not put credentials in URLs.
* **Each request is a 1C session.** `reuseSessions` and `poolSize` in `default.vrd` reduce the overhead, but the platform still opens a session per request.
* **1C does not decode `+` as a space** in query strings. The node sends spaces as `%20`, so filters must be written with spaces and the node encodes them correctly. If you call the service manually, use `%20` rather than `+`.
* **Do not expose OData to the internet** without a reverse proxy, TLS and a strict user. OData gives full CRUD within the user's rights.
