// Tests for the entity set resource locator: parsing, caching, ranking and paging.
//
// n8n calls the list search method on every keystroke and renders every returned
// item, so the method must hit the cached list, order the best matches first and
// return a bounded page instead of all 3,500 entity sets of an ERP infobase.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { after, before, beforeEach, describe, test } from 'node:test';

import { createCredentials, createExecuteContext, require } from './helpers.mjs';

const { OData1c } = require('../dist/nodes/OData1c/OData1c.node.js');
const { clearMetadataCache } = require('../dist/nodes/OData1c/GenericFunctions.js');

const GENERATED_SETS = 247;

function buildMetadataXml() {
	const names = [
		'Catalog_Номенклатура',
		'Catalog_ХозяйственнаяОперация',
		'Document_ЗаказКлиента',
		...Array.from({ length: GENERATED_SETS }, (_, i) => `Catalog_Объект${String(i).padStart(3, '0')}`),
	];
	const entityTypes = names
		.map(
			(name) =>
				`<EntityType Name="${name}"><Key><PropertyRef Name="Ref_Key"/></Key><Property Name="Ref_Key" Type="Edm.Guid" Nullable="false"/></EntityType>`,
		)
		.join('');
	const entitySets = names
		.map((name) => `<EntitySet Name="${name}" EntityType="StandardODATA.${name}"/>`)
		.join('');
	return `<?xml version="1.0" encoding="utf-8"?>
<edmx:Edmx Version="1.0"><edmx:DataServices>
<Schema Namespace="StandardODATA">${entityTypes}<EntityContainer Name="StandardODATA">${entitySets}</EntityContainer></Schema>
</edmx:DataServices></edmx:Edmx>`;
}

let server;
let baseUrl;
let metadataRequests = 0;

before(async () => {
	const xml = buildMetadataXml();
	server = createServer((request, response) => {
		if ((request.url ?? '').includes('/$metadata')) {
			metadataRequests += 1;
			response.writeHead(200, { 'Content-Type': 'application/xml;charset=utf-8' });
			response.end(xml);
			return;
		}
		response.writeHead(404);
		response.end();
	});
	await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
	baseUrl = `http://127.0.0.1:${server.address().port}/erp`;
});

after(async () => {
	await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => {
	clearMetadataCache();
	metadataRequests = 0;
});

function createSearchContext() {
	const context = createExecuteContext({
		parameters: {},
		credentials: createCredentials({ baseUrl }),
	});
	const node = new OData1c();
	return { context, search: node.methods.listSearch.searchEntitySets };
}

async function search(filter, paginationToken) {
	const { context, search: searchMethod } = createSearchContext();
	return await searchMethod.call(context, filter, paginationToken);
}

describe('entity set list search', () => {
	test('returns the kind next to the name', async () => {
		const result = await search('Номенклатура');
		assert.deepEqual(result.results, [
			{ name: 'Catalog_Номенклатура (Catalog)', value: 'Catalog_Номенклатура' },
		]);
		assert.equal(result.paginationToken, undefined);
	});

	test('ranks prefix matches before substring matches', async () => {
		const result = await search('Хозяйственная');
		assert.equal(result.results.length, 1);
		assert.equal(result.results[0].value, 'Catalog_ХозяйственнаяОперация');

		const byKind = await search('document');
		assert.equal(byKind.results[0].value, 'Document_ЗаказКлиента');
	});

	test('returns a bounded page and continues with the pagination token', async () => {
		const first = await search('');
		assert.equal(first.results.length, 100);
		assert.equal(first.paginationToken, '100');
		assert.equal(first.results[0].value, 'Catalog_Номенклатура');

		const second = await search('', first.paginationToken);
		assert.equal(second.results.length, 100);
		assert.equal(second.paginationToken, '200');
		assert.notEqual(second.results[0].value, first.results[0].value);

		const third = await search('', second.paginationToken);
		assert.equal(third.results.length, 50);
		assert.equal(third.paginationToken, undefined);
	});

	test('downloads $metadata once for a series of keystrokes', async () => {
		await search('Х');
		await search('Хо');
		await search('Хоз');
		assert.equal(metadataRequests, 1);

		clearMetadataCache();
		await search('Хоз');
		assert.equal(metadataRequests, 2);
	});

	test('serves an expired list at once and refreshes it in the background', async () => {
		await search('Хоз');
		assert.equal(metadataRequests, 1);

		const realNow = Date.now;
		try {
			// Move the clock past the entity set list TTL: the next search must answer
			// from the stale list and refresh it after the fact.
			Date.now = () => realNow() + 13 * 60 * 60 * 1000;
			const result = await search('Хоз');
			assert.equal(result.results[0].value, 'Catalog_ХозяйственнаяОперация');

			const deadline = Date.now() + 5000;
			while (metadataRequests < 2 && Date.now() < deadline) {
				await new Promise((resolve) => setTimeout(resolve, 20));
			}
		} finally {
			Date.now = realNow;
		}

		assert.equal(metadataRequests, 2);
	});
});
