#!/usr/bin/env node
/**
 * Live check of the node against a real 1C:Enterprise infobase.
 *
 *   ODATA_BASE_URL=http://host/erp ODATA_USER=user ODATA_PASSWORD=pass \
 *     node --env-file=.env scripts/live-check.mjs [--write]
 *
 * `--write` also creates, patches and deletes a test item in Catalog_Номенклатура.
 * Without `--write` the script is read-only. The compiled node in dist/ is used, so
 * run `npm run build` first (or `npm test`).
 */
import assert from 'node:assert/strict';

import { createCredentials, createExecuteContext, entityParams, executeNode } from '../tests/helpers.mjs';

const writeMode = process.argv.includes('--write');

function resolveBaseUrl() {
	const explicit = process.env.ODATA_BASE_URL;
	if (explicit) {
		return explicit.replace(/\/+$/, '');
	}
	const full = process.env.ODATA_PATH;
	if (full) {
		return full.replace(/\/odata\/standard\.odata\/?$/i, '');
	}
	throw new Error('Set ODATA_BASE_URL (or ODATA_PATH) with the infobase publication URL');
}

const credentials = createCredentials({
	baseUrl: resolveBaseUrl(),
	username: process.env.ODATA_USER ?? process.env.ODATA_USERNAME ?? '',
	password: process.env.ODATA_PASSWORD ?? process.env.ODATA_PASS ?? '',
	timeout: 120000,
});

async function run(parameters, options = {}) {
	const context = createExecuteContext({ parameters, credentials, ...options });
	return executeNode(context);
}

function log(label, value) {
	console.log(`✔ ${label}: ${typeof value === 'string' ? value : JSON.stringify(value)}`);
}

const started = Date.now();

// 1. Metadata
const metadataStarted = Date.now();
const sets = await run({ resource: 'metadata', operation: 'list' });
const metadataMs = Date.now() - metadataStarted;
log('entity sets', `${sets.length} (parsed in ${metadataMs} ms)`);

const fields = await run({
	resource: 'metadata',
	operation: 'fields',
	metadataEntitySet: { __rl: true, mode: 'name', value: 'Catalog_Номенклатура' },
});
log(
	'Catalog_Номенклатура fields',
	`${fields.length} (first: ${fields
		.slice(0, 5)
		.map((item) => item.json.name)
		.join(', ')})`,
);

// 2. Read with filter, select, limit
const nomenclature = await run(
	entityParams('Catalog_Номенклатура', 'getMany', {
		filter: 'DeletionMark eq false',
		select: 'Ref_Key,Code,Description,Артикул',
		orderBy: 'Code',
		returnAll: false,
		limit: 3,
	}),
);
assert.ok(nomenclature.length > 0, 'Catalog_Номенклатура returned no rows');
log(
	'nomenclature page',
	`${nomenclature.length} rows, first=${nomenclature[0].json.Description}`,
);

// 3. Collection with $expand (1C rejects $expand for single entities with HTTP 501)
const withUnit = await run(
	entityParams('Catalog_Номенклатура', 'getMany', {
		filter: "ЕдиницаИзмерения_Key ne guid'00000000-0000-0000-0000-000000000000'",
		select: 'Ref_Key,Description',
		expand: 'ЕдиницаИзмерения',
		returnAll: false,
		limit: 1,
	}),
);
log(
	'getMany + expand',
	withUnit[0]?.json.ЕдиницаИзмерения
		? `expanded reference: ${withUnit[0].json.ЕдиницаИзмерения.Description}`
		: 'no reference',
);

// 4. Count
const counted = await run(
	entityParams('Catalog_Номенклатура', 'count', { filter: 'DeletionMark eq false' }),
);
log('count', counted[0].json.count);

// 5. Documents with a date filter and a tabular section
const orders = await run(
	entityParams('Document_ЗаказКлиента', 'getMany', {
		filter: "Date ge datetime'2024-01-01T00:00:00'",
		orderBy: 'Date desc',
		returnAll: false,
		limit: 2,
	}),
);
log(
	'orders',
	`${orders.length} rows${
		orders[0]?.json.Товары ? `, tabular rows in first: ${orders[0].json.Товары.length}` : ''
	}`,
);

// 6. Custom request
const custom = await run({
	resource: 'custom',
	requestMethod: 'GET',
	requestPath: 'Catalog_Контрагенты',
	requestQuery: { $top: 1, $select: 'Ref_Key,Description' },
});
log('custom request', `${custom[0].json.value?.length ?? 0} row(s)`);

if (writeMode) {
	const created = await run(
		entityParams('Catalog_Номенклатура', 'create', {
			fields: { Description: `n8n live check ${new Date().toISOString()}`, Артикул: 'N8N-LIVE-CHECK' },
		}),
	);
	const refKey = created[0].json.Ref_Key;
	log('created', refKey);

	const updated = await run(
		entityParams('Catalog_Номенклатура', 'update', {
			refKey,
			fields: { Артикул: 'N8N-LIVE-CHECK-2' },
			options: { ifMatch: true },
		}),
	);
	log('updated', updated[0].json.success ?? 'ok');

	const reread = await run(
		entityParams('Catalog_Номенклатура', 'getOne', { refKey, select: 'Ref_Key,Артикул' }),
	);
	assert.equal(reread[0].json.Артикул, 'N8N-LIVE-CHECK-2');
	log('reread', reread[0].json.Артикул);

	const removed = await run(entityParams('Catalog_Номенклатура', 'delete', { refKey }));
	log('deleted', removed[0].json.deleted);
}

console.log(
	`\nAll live checks passed in ${Date.now() - started} ms (RSS ${
		Math.round(process.memoryUsage().rss / 1024 / 1024)
	} MB)`,
);
