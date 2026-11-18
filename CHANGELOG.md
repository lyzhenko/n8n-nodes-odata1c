# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.0] — 2026-11-18

### Added

* The entity set dropdown ranks its results: an exact name first, then names that start with
  the typed text, then names that contain it, and matches on the object kind last.
* The dropdown is paginated — 100 entity sets per request with `paginationToken`, the next
  page is loaded when the list is scrolled to the end. A page is small enough to render
  instantly, and the editor no longer receives 3,500 items per keystroke.
* A slow-load tip in the dropdown after 3 seconds (`slowLoadNotice`), which now only appears
  on the first read of `$metadata` in a new n8n process.

### Changed

* The entity set dropdown no longer stalls for seconds while typing. n8n calls the list
  search method on every keystroke and blanks the list until the answer arrives, and the
  node used to re-read `$metadata` (tens of megabytes on a real ERP) whenever its 5-minute
  cache had expired. The entity set list now:
  * is parsed from the `<EntitySet>` tags only — 5 ms instead of 160 ms for a 20 MB document;
  * is cached for 12 hours, and an expired list is returned immediately while a fresh copy
    is downloaded in the background, so a search never waits for 1C again;
  * is shared with the *Metadata* resource: a `$metadata` document that was just downloaded
    for the field list is reused by the dropdown.
* Measured on a 20.9 MB ERP `$metadata` (3,535 entity sets): 1C needs 2.5 s per `$metadata`
  request, a cached search now takes 1 ms instead of 2.5 s plus a full parse.
* READMEs: the trusted-publisher setup now states that **Direct npm publish** must be enabled
  under *Allowed actions*. A fresh trusted publisher allows staged publishes only and rejects a
  direct `npm publish` with `403 … OIDC permission denied for this action` — exactly what
  happened while publishing `0.1.1`.

## [0.1.1] — 2026-11-18

### Fixed

* CI was red on every push: the Node 20 and 22 matrix jobs failed in `npm ci`, because
  `n8n-workflow` → `@n8n/expression-runtime` → `isolated-vm` requires Node.js ≥ 24 and
  builds native code from source. CI now runs on Node.js 24, the runtime n8n 2.x itself
  requires.
* `engines.node` raised from `>=20.15.0` to `>=24.0.0` to match n8n 2.x; the READMEs
  promised Node.js 20.15+.

### Changed

* The publish workflow is idempotent: when the `package.json` version is already on npm,
  the publish step is skipped and the run stays green.
* Publishing authenticates through npm Trusted publishing (OIDC) by default, so no
  long-lived `NPM_TOKEN` secret is required; the workflow emits provenance.
* READMEs: installation points at the published `0.1.1`, and the release section
  explains trusted publishing, provenance and the idempotent workflow. This release
  exists mainly to refresh the package page on npm, which always shows the README of
  the published version.

## [0.1.0] — 2026-11-17

First public release. Published to npm as `n8n-nodes-odata1c@0.1.0`.

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
* Test suite: 38 unit and end-to-end tests, no 1C server required.
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


