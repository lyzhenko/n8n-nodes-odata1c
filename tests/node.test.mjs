import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';

import {
	createCredentials,
	createExecuteContext,
	entityParams,
	executeNode,
} from './helpers.mjs';
import { startMockServer } from '../mock/odata1c-mock.mjs';

const CABLE = '3f1c9b7e-9d2a-11ee-8f3a-00155d0a1b2c';
const ORDER = '6c4fce01-9d2a-11ee-8f3a-00155d0a1b2c';

let mock;
let credentials;

before(async () => {
	mock = await startMockServer({ user: 'odata', password: 'odata' });
	credentials = createCredentials({ baseUrl: `${mock.baseUrl}/erp` });
});

after(async () => {
	await mock?.close();
});

beforeEach(() => {
	mock.reset();
});

async function run(parameters, options = {}) {
	const context = createExecuteContext({ parameters, credentials, ...options });
	return executeNode(context);
}

describe('metadata', () => {
	test('lists entity sets from $metadata', async () => {
		const items = await run({ resource: 'metadata', operation: 'list' });
		const names = items.map((item) => item.json.name);
		assert.ok(names.includes('Catalog_Номенклатура'));
		assert.ok(names.includes('Document_ЗаказКлиента'));
		assert.equal(items.length, 5);
		const catalog = items.find((item) => item.json.name === 'Catalog_Номенклатура');
		assert.equal(catalog.json.kind, 'Catalog');
		assert.equal(catalog.json.entityType, 'Catalog_Номенклатура');
	});

	test('filters entity sets by name', async () => {
		const items = await run({
			resource: 'metadata',
			operation: 'list',
			nameFilter: 'register',
		});
		assert.ok(items.length >= 1);
		assert.ok(items.every((item) => item.json.kind.includes('Register')));
	});

	test('returns fields and navigation properties of an entity set', async () => {
		const items = await run({
			resource: 'metadata',
			operation: 'fields',
			metadataEntitySet: { __rl: true, mode: 'name', value: 'Catalog_Номенклатура' },
		});
		const byName = Object.fromEntries(items.map((item) => [item.json.name, item.json]));
		assert.equal(byName.Ref_Key.key, true);
		assert.equal(byName.Артикул.type, 'Edm.String');
		assert.equal(byName.ЕдиницаИзмерения.navigation, true);
	});

	test('reports an unknown entity set of metadata fields', async () => {
		await assert.rejects(
			run({
				resource: 'metadata',
				operation: 'fields',
				metadataEntitySet: { __rl: true, mode: 'name', value: 'Catalog_Nope' },
			}),
			/not published in the OData interface/,
		);
	});

	test('returns the raw EDMX document', async () => {
		const items = await run({ resource: 'metadata', operation: 'raw' });
		assert.equal(items.length, 1);
		assert.match(items[0].json.xml, /<edmx:Edmx/);
		assert.match(items[0].json.xml, /Catalog_Номенклатура/);
	});
});

describe('read operations', () => {
	test('reads a page of entities with select and sort', async () => {
		const requests = [];
		const items = await run(
			entityParams('Catalog_Номенклатура', 'getMany', {
				returnAll: false,
				limit: 2,
				select: 'Ref_Key,Description,Цена',
				orderBy: 'Цена desc',
			}),
			{ onRequest: (request) => requests.push(request) },
		);
		assert.equal(items.length, 2);
		assert.deepEqual(Object.keys(items[0].json).sort(), ['Description', 'Ref_Key', 'Цена']);
		assert.ok(items[0].json.Цена >= items[1].json.Цена);
		assert.equal(requests.length, 1);
		assert.match(requests[0].url, /\$top=2/);
		assert.match(requests[0].url, /\$skip=0/);
	});

	test('paginates through the whole set when Return All is on', async () => {
		const requests = [];
		const items = await run(
			entityParams('Catalog_Номенклатура', 'getMany', {
				options: { pageSize: 2 },
			}),
			{ onRequest: (request) => requests.push(request) },
		);
		assert.equal(items.length, 3);
		assert.equal(requests.length, 2);
		assert.match(requests[1].url, /\$skip=2/);
	});

	test('filters with OData expressions', async () => {
		const items = await run(
			entityParams('Catalog_Номенклатура', 'getMany', {
				filter: 'DeletionMark eq false',
				select: 'Ref_Key,Description',
			}),
		);
		assert.equal(items.length, 2);
		assert.ok(items.every((item) => item.json.Description !== 'Труба ПВХ 20мм'));
	});

	test('supports like() and Cyrillic values in filters', async () => {
		const items = await run(
			entityParams('Catalog_Номенклатура', 'getMany', {
				filter: "like(Description,'%Кабель%')",
				select: 'Description',
			}),
		);
		assert.equal(items.length, 1);
		assert.equal(items[0].json.Description, 'Кабель ВВГнг 3x2.5');
	});

	test('reads one entity by Ref_Key', async () => {
		const items = await run(
			entityParams('Catalog_Номенклатура', 'getOne', {
				refKey: `guid'${CABLE}'`,
			}),
		);
		assert.equal(items.length, 1);
		assert.equal(items[0].json.Ref_Key, CABLE);

		const expanded = await run(
			entityParams('Catalog_Номенклатура', 'getMany', {
				filter: `Ref_Key eq guid'${CABLE}'`,
				expand: 'ЕдиницаИзмерения',
			}),
		);
		assert.equal(expanded.length, 1);
		assert.equal(expanded[0].json.ЕдиницаИзмерения.Ref_Key, '8c8d8a10-6a2c-11ee-9a4d-005056c00008');
		assert.match(expanded[0].json['ЕдиницаИзмерения@navigationLinkUrl'], /\/ЕдиницаИзмерения$/);
	});

	test('counts entities with a filter', async () => {
		const items = await run(
			entityParams('Catalog_Номенклатура', 'count', { filter: 'DeletionMark eq false' }),
		);
		assert.deepEqual(items.map((item) => item.json.count), [2]);
	});

	test('reads documents together with their tabular section', async () => {
		const items = await run(
			entityParams('Document_ЗаказКлиента', 'getOne', { refKey: ORDER }),
		);
		assert.equal(items[0].json.Posted, true);
		assert.equal(items[0].json.Date, '2024-01-15T10:00:00');
		assert.equal(items[0].json.Товары.length, 1);
		assert.equal(items[0].json.Товары[0].Количество, 3);
	});
});

describe('write operations', () => {
	test('creates, updates and deletes a catalog item', async () => {
		const created = await run(
			entityParams('Catalog_Номенклатура', 'create', {
				fields: { Description: 'Тестовая позиция', Артикул: 'TST-1', Цена: 10 },
			}),
		);
		assert.equal(created.length, 1);
		const refKey = created[0].json.Ref_Key;
		assert.match(refKey, /^[0-9a-f-]{36}$/);
		assert.equal(created[0].json.Description, 'Тестовая позиция');

		const updated = await run(
			entityParams('Catalog_Номенклатура', 'update', {
				refKey,
				fields: { Артикул: 'TST-2' },
			}),
		);
		assert.equal(updated[0].json.success, true);

		const reread = await run(entityParams('Catalog_Номенклатура', 'getOne', { refKey }));
		assert.equal(reread[0].json.Артикул, 'TST-2');

		const removed = await run(entityParams('Catalog_Номенклатура', 'delete', { refKey }));
		assert.equal(removed[0].json.success, true);
		assert.equal(removed[0].json.deleted, true);

		await assert.rejects(
			run(entityParams('Catalog_Номенклатура', 'getOne', { refKey })),
			/не найден/,
		);
	});

	test('sends If-Match with the current DataVersion when optimistic lock is on', async () => {
		const requests = [];
		const created = await run(
			entityParams('Catalog_Номенклатура', 'create', {
				fields: { Description: 'Позиция с блокировкой' },
			}),
		);
		const refKey = created[0].json.Ref_Key;

		await run(
			entityParams('Catalog_Номенклатура', 'update', {
				refKey,
				fields: { Цена: 55 },
				options: { ifMatch: true },
			}),
			{
				onRequest: (request) => {
					if (request.method === 'PATCH') {
						requests.push(request);
					}
				},
			},
		);

		assert.equal(requests.length, 1);
		assert.ok(requests[0].headers['If-Match']);
		assert.equal(requests[0].headers['If-Match'], created[0].json.DataVersion);
	});

	test('posts and unposts a document', async () => {
		const unposted = await run(
			entityParams('Document_ЗаказКлиента', 'posting', {
				refKey: ORDER,
				postingAction: 'unpost',
			}),
		);
		assert.equal(unposted[0].json.Posted, false);

		const posted = await run(
			entityParams('Document_ЗаказКлиента', 'posting', {
				refKey: ORDER,
				postingAction: 'post',
			}),
		);
		assert.equal(posted[0].json.Posted, true);
	});

	test('adds the 1C_OData-DataLoadMode header in data load mode', async () => {
		const requests = [];
		await run(
			entityParams('Catalog_Номенклатура', 'create', {
				fields: { Description: 'Через режим обмена' },
				options: { dataLoadMode: true },
			}),
			{ onRequest: (request) => requests.push(request) },
		);
		assert.equal(requests[0].headers['1C_OData-DataLoadMode'], 'true');
	});

	test('surfaces the 1C error message when a document is invalid', async () => {
		await assert.rejects(
			run(
				entityParams('Document_ЗаказКлиента', 'create', {
					fields: { Number: '000000099' },
				}),
			),
			(error) => {
				assert.match(error.message, /Дата/);
				return true;
			},
		);
	});
});

describe('custom requests', () => {
	test('sends a GET with a path and query parameters', async () => {
		const items = await run({
			resource: 'custom',
			requestMethod: 'GET',
			requestPath: 'Catalog_Номенклатура',
			requestQuery: { $filter: 'DeletionMark eq false', $top: 1 },
		});
		assert.equal(items.length, 1);
		assert.equal(items[0].json.value.length, 1);
	});

	test('sends a POST with a JSON body', async () => {
		const items = await run({
			resource: 'custom',
			requestMethod: 'POST',
			requestPath: 'Catalog_Контрагенты',
			requestBody: { Description: 'ООО Тест', ИНН: '7700000000' },
		});
		assert.equal(items[0].json.Description, 'ООО Тест');
		assert.ok(items[0].json.Ref_Key);
	});

	test('returns text responses as data', async () => {
		const items = await run({
			resource: 'custom',
			requestMethod: 'GET',
			requestPath: 'Catalog_Номенклатура/$count',
			responseFormat: 'text',
		});
		assert.equal(items[0].json.data, '3');
	});
});

describe('defaults', () => {
	test('falls back to the default resource and operation when n8n omits them', async () => {
		const items = await run({
			entitySet: { __rl: true, mode: 'name', value: 'Catalog_Номенклатура' },
			filter: 'DeletionMark eq false',
			returnAll: false,
			limit: 1,
		});
		assert.equal(items.length, 1);
		assert.ok(items[0].json.Ref_Key);
	});
});

describe('error handling', () => {
	test('honours Continue On Fail', async () => {
		const items = await run(
			entityParams('Catalog_Номенклатура', 'getOne', {
				refKey: '00000000-0000-0000-0000-000000000000',
			}),
			{ continueOnFail: true },
		);
		assert.equal(items.length, 1);
		assert.match(items[0].json.error, /не найден/);
	});

	test('reports an empty entity set name', async () => {
		await assert.rejects(
			run({
				resource: 'entity',
				operation: 'getOne',
				entitySet: { __rl: true, mode: 'name', value: '' },
				refKey: CABLE,
			}),
			/Entity Set is empty/,
		);
	});

	test('rejects invalid JSON in Fields', async () => {
		await assert.rejects(
			run(
				entityParams('Catalog_Номенклатура', 'create', {
					fields: '{oops',
				}),
			),
			/valid JSON object/,
		);
	});
});
