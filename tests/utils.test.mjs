import assert from 'node:assert/strict';
import { test } from 'node:test';

import { require } from './helpers.mjs';

const {
	normalizeBaseUrl,
	odataBaseUrl,
	joinUrl,
	encodeNonAscii,
	normalizeGuid,
	entityAddress,
	quoteString,
	splitList,
	serializeQuery,
	normalizeDatesDeep,
	extractODataErrorText,
	parseJsonField,
} = require('../dist/nodes/OData1c/utils.js');

test('normalizes the publication URL and appends the OData path once', () => {
	assert.equal(normalizeBaseUrl('https://1c.example.com/erp/'), 'https://1c.example.com/erp');
	assert.equal(
		normalizeBaseUrl('https://1c.example.com/erp/odata/standard.odata'),
		'https://1c.example.com/erp',
	);
	assert.equal(
		normalizeBaseUrl('https://1c.example.com/erp/odata/standard.odata/'),
		'https://1c.example.com/erp',
	);
	assert.equal(
		odataBaseUrl({ baseUrl: 'https://1c.example.com/erp' }),
		'https://1c.example.com/erp/odata/standard.odata',
	);
	assert.equal(
		odataBaseUrl({ baseUrl: 'https://1c.example.com/erp/odata/standard.odata' }),
		'https://1c.example.com/erp/odata/standard.odata',
	);
	assert.equal(joinUrl('http://h/odata', 'Catalog_X'), 'http://h/odata/Catalog_X');
	assert.equal(joinUrl('http://h/odata', '/$metadata'), 'http://h/odata/$metadata');
	assert.equal(joinUrl('http://h/odata', ''), 'http://h/odata');
});

test('encodes only non-ASCII characters of a path', () => {
	assert.equal(encodeNonAscii('Catalog_Номенклатура'), 'Catalog_%D0%9D%D0%BE%D0%BC%D0%B5%D0%BD%D0%BA%D0%BB%D0%B0%D1%82%D1%83%D1%80%D0%B0');
	assert.equal(encodeNonAscii("Catalog_X(guid'abc')/Post()"), "Catalog_X(guid'abc')/Post()");
	assert.equal(encodeNonAscii('$metadata'), '$metadata');
});

test('serializes query parameters the way 1C expects them', () => {
	const query = serializeQuery({
		$format: 'json',
		$filter: "DeletionMark eq false and Description eq 'Кабель'",
		$select: 'Ref_Key,Description',
		$orderby: 'Date desc',
	});
	assert.match(query, /^\$format=json&/);
	// 1C does not treat "+" as a space, so spaces must stay as %20.
	assert.ok(!query.includes('+'));
	assert.ok(query.includes('DeletionMark%20eq%20false'));
	assert.ok(query.includes('%D0%9A%D0%B0%D0%B1%D0%B5%D0%BB%D1%8C'));
	assert.ok(query.includes('$select=Ref_Key,Description'));
	assert.ok(query.includes('$orderby=Date%20desc'));
	assert.equal(serializeQuery({}), '');
	assert.equal(serializeQuery(undefined), '');
});

test('accepts bare, quoted and full GUID references', () => {
	const guid = '3f1c9b7e-9d2a-11ee-8f3a-00155d0a1b2c';
	assert.equal(normalizeGuid(guid), guid);
	assert.equal(normalizeGuid(`guid'${guid}'`), guid);
	assert.equal(normalizeGuid(`Catalog_Номенклатура(guid'${guid}')`), guid);
	assert.equal(normalizeGuid(`  ${guid}  `), guid);
	assert.throws(() => normalizeGuid('not-a-guid'), /not a valid GUID/);
});

test('builds entity addresses and escapes string literals', () => {
	assert.equal(
		entityAddress('Catalog_Номенклатура', '3f1c9b7e-9d2a-11ee-8f3a-00155d0a1b2c'),
		"Catalog_Номенклатура(guid'3f1c9b7e-9d2a-11ee-8f3a-00155d0a1b2c')",
	);
	assert.equal(quoteString("O'Brien"), "'O''Brien'");
});

test('splits comma-separated field lists', () => {
	assert.deepEqual(splitList('Ref_Key, Code ,Description'), ['Ref_Key', 'Code', 'Description']);
	assert.deepEqual(splitList(''), []);
	assert.deepEqual(splitList(undefined), []);
});

test('normalizes Microsoft-style dates recursively', () => {
	const payload = {
		a: '/Date(1700000000000)/',
		list: ['/Date(0)/', 'plain'],
		nested: { b: '\\/Date(86400000)\\/', c: 5 },
	};
	const result = normalizeDatesDeep(payload);
	assert.equal(result.a, '2023-11-14T22:13:20.000Z');
	assert.equal(result.list[0], '1970-01-01T00:00:00.000Z');
	assert.equal(result.list[1], 'plain');
	assert.match(result.nested.b, /^1970-01-02T00:00:00/);
	assert.equal(result.nested.c, 5);
});

test('extracts the 1C error message from odata.error bodies', () => {
	assert.equal(
		extractODataErrorText({
			'odata.error': { code: '8', message: { lang: 'ru', value: 'Сущность не найдена' } },
		}),
		'Сущность не найдена',
	);
	assert.equal(
		extractODataErrorText(
			'{"odata.error":{"code":"-1","message":{"lang":"ru","value":"Ошибка записи"}}}',
		),
		'Ошибка записи',
	);
	assert.equal(
		extractODataErrorText(
			'<?xml version="1.0"?><m:error xmlns:m="x"><m:message>Доступ запрещен</m:message></m:error>',
		),
		'Доступ запрещен',
	);
	assert.equal(extractODataErrorText({ message: 'plain' }), 'plain');
	assert.equal(extractODataErrorText(undefined), undefined);
	assert.equal(extractODataErrorText(''), undefined);
});

test('parses JSON fields given as objects, strings or empty values', () => {
	assert.deepEqual(parseJsonField('{"a":1}', 'Fields'), { a: 1 });
	assert.deepEqual(parseJsonField({ a: 1 }, 'Fields'), { a: 1 });
	assert.deepEqual(parseJsonField('', 'Fields'), {});
	assert.deepEqual(parseJsonField(undefined, 'Fields'), {});
	assert.throws(() => parseJsonField('[1,2]', 'Fields'), /JSON object/);
	assert.throws(() => parseJsonField('{bad', 'Fields'), /valid JSON object/);
});

