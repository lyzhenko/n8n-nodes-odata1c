# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] — 2026-11-17

First public release.

### Added

* **OData 1C** action node (`n8n-nodes-odata1c.odata1c`) with three resources:
  * **Entity Set** — Get Many (with automatic `$top`/`$skip` paging), Get One, Create,
    Update (HTTP PATCH, optional `If-Match` with the current `DataVersion`), Delete,
    Count, and Post / Unpost for documents.
  * **Metadata** — entity set list, fields and navigation properties of one set, raw
    `$metadata` EDMX.
  * **Custom Request** — any HTTP method and path relative to `/odata/standard.odata`.
* **OData 1C API** credential: infobase publication URL, 1C user and password,
  self-signed certificate support, request timeout, metadata request as the credential test.
* Entity sets and their fields are loaded from `$metadata` with a 5-minute cache;
  the parser handles a 20 MB ERP metadata document in about 100 ms.
* Query support: `$filter`, `$select`, `$expand` (collections), `$orderby`, `$top`,
  `$skip`, `/$count`, and 1C-style `guid'…'` / `datetime'…'` literals.
* Correct URL encoding for 1C: spaces are sent as `%20` (1C does not decode `+`),
  `$` in option names stays literal, Cyrillic entity set names are percent-encoded.
* 1C error messages (`odata.error.message.value`, XML errors) are surfaced as n8n
  node errors, with `Continue On Fail` support.
* `1C_OData-DataLoadMode: true` request option for exchange-style writes.
* `usableAsTool` for n8n AI Agents.
* Bundled dependency-free 1C OData mock (`mock/odata1c-mock.mjs`) used by the test
  suite and usable as a local sandbox.
* Test suite: 37 unit and end-to-end tests, no 1C server required.
* `scripts/live-check.mjs` to verify a real infobase (read-only by default,
  `--write` also creates, patches and deletes a test item).
* `deploy/deploy.py` + `deploy/install-node.sh` for a native, non-Docker n8n.
* Documentation in English and Russian, plus a 1C publication guide
  (`docs/1c-odata-setup.md`, `docs/1c-odata-setup.ru.md`).

### Verified

* End-to-end against a production ERP 2.5 infobase (3,535 entity sets, 20 MB
  `$metadata`, 29k catalog items): reading catalogs and documents, filtering by date,
  expanding references, counting, creating and patching a catalog item with
  `If-Match`, deleting it, and running the node inside n8n 2.47.7.
