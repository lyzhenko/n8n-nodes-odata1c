#!/usr/bin/env node
/**
 * Mock of the 1C:Enterprise standard OData interface.
 *
 * Used by the automated tests (no 1C server needed in CI) and as a local sandbox:
 *
 *   node mock/odata1c-mock.mjs
 *   curl -u odata:odata 'http://127.0.0.1:18080/erp/odata/standard.odata/Catalog_Номенклатура?$format=json'
 *
 * Implemented on purpose: `$metadata`, `$filter` (eq/ne/gt/ge/lt/le/and/or/not,
 * like/startswith/endswith/substringof), `$select`, `$expand`, `$orderby`, `$top`,
 * `$skip`, `$inlinecount`, `/$count`, POST/PATCH/DELETE, `Post()`/`Unpost()`,
 * `If-Match` with DataVersion and 1C-style `odata.error` responses.
 * Not implemented: `$batch`, Atom, virtual register tables (SliceLast, Balance, …).
 */
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';

const DEFAULT_PREFIX = '/erp/odata/standard.odata';

const SCHEMA = [
	{
		name: 'Catalog_ЕдиницыИзмерения',
		properties: [
			{ name: 'Ref_Key', type: 'Edm.Guid', nullable: false },
			{ name: 'DataVersion', type: 'Edm.String' },
			{ name: 'DeletionMark', type: 'Edm.Boolean' },
			{ name: 'IsFolder', type: 'Edm.Boolean' },
			{ name: 'Code', type: 'Edm.String' },
			{ name: 'Description', type: 'Edm.String' },
		],
		navigation: [],
	},
	{
		name: 'Catalog_Номенклатура',
		properties: [
			{ name: 'Ref_Key', type: 'Edm.Guid', nullable: false },
			{ name: 'DataVersion', type: 'Edm.String' },
			{ name: 'DeletionMark', type: 'Edm.Boolean' },
			{ name: 'IsFolder', type: 'Edm.Boolean' },
			{ name: 'Parent_Key', type: 'Edm.Guid' },
			{ name: 'Code', type: 'Edm.String' },
			{ name: 'Description', type: 'Edm.String' },
			{ name: 'Артикул', type: 'Edm.String' },
			{ name: 'Цена', type: 'Edm.Double' },
			{ name: 'ЕдиницаИзмерения_Key', type: 'Edm.Guid' },
		],
		navigation: [
			{
				name: 'ЕдиницаИзмерения',
				relationship: 'StandardODATA.Catalog_Номенклатура_ЕдиницаИзмерения',
				fromRole: 'Catalog_Номенклатура',
				toRole: 'ЕдиницаИзмерения',
				entitySet: 'Catalog_ЕдиницыИзмерения',
			},
		],
	},
	{
		name: 'Catalog_Контрагенты',
		properties: [
			{ name: 'Ref_Key', type: 'Edm.Guid', nullable: false },
			{ name: 'DataVersion', type: 'Edm.String' },
			{ name: 'DeletionMark', type: 'Edm.Boolean' },
			{ name: 'Code', type: 'Edm.String' },
			{ name: 'Description', type: 'Edm.String' },
			{ name: 'ИНН', type: 'Edm.String' },
		],
		navigation: [],
	},
	{
		name: 'Document_ЗаказКлиента',
		properties: [
			{ name: 'Ref_Key', type: 'Edm.Guid', nullable: false },
			{ name: 'DataVersion', type: 'Edm.String' },
			{ name: 'DeletionMark', type: 'Edm.Boolean' },
			{ name: 'Date', type: 'Edm.DateTime' },
			{ name: 'Number', type: 'Edm.String' },
			{ name: 'Posted', type: 'Edm.Boolean' },
			{ name: 'Контрагент_Key', type: 'Edm.Guid' },
			{ name: 'СуммаДокумента', type: 'Edm.Double' },
			{ name: 'Комментарий', type: 'Edm.String' },
		],
		navigation: [
			{
				name: 'Контрагент',
				relationship: 'StandardODATA.Document_ЗаказКлиента_Контрагент',
				fromRole: 'Document_ЗаказКлиента',
				toRole: 'Контрагент',
				entitySet: 'Catalog_Контрагенты',
			},
		],
		tabular: [
			{
				name: 'Товары',
				properties: [
					{ name: 'LineNumber', type: 'Edm.String' },
					{ name: 'Номенклатура_Key', type: 'Edm.Guid' },
					{ name: 'Количество', type: 'Edm.Double' },
					{ name: 'Цена', type: 'Edm.Double' },
					{ name: 'Сумма', type: 'Edm.Double' },
				],
			},
		],
	},
	{
		name: 'InformationRegister_ЦеныНоменклатуры',
		properties: [
			{ name: 'Номенклатура_Key', type: 'Edm.Guid', nullable: false },
			{ name: 'Period', type: 'Edm.DateTime', nullable: false },
			{ name: 'Цена', type: 'Edm.Double' },
			{ name: 'Валюта_Key', type: 'Edm.Guid' },
		],
		navigation: [],
	},
];

const UNIT_PIECE = '5b1f3a52-6a2c-11ee-9a4d-005056c00008';
const UNIT_KG = '8c8d8a10-6a2c-11ee-9a4d-005056c00008';
const PARTNER_1 = '1f3b9a40-5b0e-11ee-9a4d-005056c00008';
const PARTNER_2 = '2a4c8b51-5b0e-11ee-9a4d-005056c00008';
const GOODS_CABLE = '3f1c9b7e-9d2a-11ee-8f3a-00155d0a1b2c';
const GOODS_SOCKET = '4a2dac8f-9d2a-11ee-8f3a-00155d0a1b2c';
const GOODS_PIPE = '5b3ebd90-9d2a-11ee-8f3a-00155d0a1b2c';

const DATA_VERSION = 'AAAAAQAAAAE=';

function seed() {
	return {
		'Catalog_ЕдиницыИзмерения': [
			{ Ref_Key: UNIT_PIECE, DataVersion: DATA_VERSION, DeletionMark: false, IsFolder: false, Code: '796', Description: 'шт' },
			{ Ref_Key: UNIT_KG, DataVersion: DATA_VERSION, DeletionMark: false, IsFolder: false, Code: '166', Description: 'кг' },
		],
		'Catalog_Номенклатура': [
			{
				Ref_Key: GOODS_CABLE,
				DataVersion: DATA_VERSION,
				DeletionMark: false,
				IsFolder: false,
				Parent_Key: '00000000-0000-0000-0000-000000000000',
				Code: '00-00000001',
				Description: 'Кабель ВВГнг 3x2.5',
				Артикул: 'CBL-325',
				Цена: 128.5,
				ЕдиницаИзмерения_Key: UNIT_KG,
			},
			{
				Ref_Key: GOODS_SOCKET,
				DataVersion: DATA_VERSION,
				DeletionMark: false,
				IsFolder: false,
				Parent_Key: '00000000-0000-0000-0000-000000000000',
				Code: '00-00000002',
				Description: 'Розетка 220V',
				Артикул: 'SCK-220',
				Цена: 340,
				ЕдиницаИзмерения_Key: UNIT_PIECE,
			},
			{
				Ref_Key: GOODS_PIPE,
				DataVersion: DATA_VERSION,
				DeletionMark: true,
				IsFolder: false,
				Parent_Key: '00000000-0000-0000-0000-000000000000',
				Code: '00-00000003',
				Description: 'Труба ПВХ 20мм',
				Артикул: 'PIP-20',
				Цена: 47.2,
				ЕдиницаИзмерения_Key: UNIT_KG,
			},
		],
		'Catalog_Контрагенты': [
			{ Ref_Key: PARTNER_1, DataVersion: DATA_VERSION, DeletionMark: false, Code: '000001', Description: 'ООО Ромашка', ИНН: '7701234567' },
			{ Ref_Key: PARTNER_2, DataVersion: DATA_VERSION, DeletionMark: false, Code: '000002', Description: 'ИП Петров', ИНН: '770987654321' },
		],
		'Document_ЗаказКлиента': [
			{
				Ref_Key: '6c4fce01-9d2a-11ee-8f3a-00155d0a1b2c',
				DataVersion: DATA_VERSION,
				DeletionMark: false,
				Date: '2024-01-15T10:00:00',
				Number: '000000001',
				Posted: true,
				Контрагент_Key: PARTNER_1,
				СуммаДокумента: 385.5,
				Комментарий: 'Первый заказ',
				Товары: [
					{ LineNumber: '1', Номенклатура_Key: GOODS_CABLE, Количество: 3, Цена: 128.5, Сумма: 385.5 },
				],
			},
			{
				Ref_Key: '7d5adf12-9d2a-11ee-8f3a-00155d0a1b2c',
				DataVersion: DATA_VERSION,
				DeletionMark: false,
				Date: '2024-02-20T15:30:00',
				Number: '000000002',
				Posted: false,
				Контрагент_Key: PARTNER_2,
				СуммаДокумента: 340,
				Комментарий: '',
				Товары: [
					{ LineNumber: '1', Номенклатура_Key: GOODS_SOCKET, Количество: 1, Цена: 340, Сумма: 340 },
				],
			},
		],
		'InformationRegister_ЦеныНоменклатуры': [
			{ Номенклатура_Key: GOODS_CABLE, Period: '2024-01-01T00:00:00', Цена: 128.5, Валюта_Key: '00000000-0000-0000-0000-000000000000' },
			{ Номенклатура_Key: GOODS_SOCKET, Period: '2024-01-01T00:00:00', Цена: 340, Валюта_Key: '00000000-0000-0000-0000-000000000000' },
			{ Номенклатура_Key: GOODS_CABLE, Period: '2024-06-01T00:00:00', Цена: 141.9, Валюта_Key: '00000000-0000-0000-0000-000000000000' },
		],
	};
}

// --------------------------------------------------------------------------- errors

class ODataError extends Error {
	constructor(status, message, code = '-1') {
		super(message);
		this.status = status;
		this.code = code;
	}
}

function errorBody(message, code = '-1') {
	return {
		'odata.error': {
			code: String(code),
			message: { lang: 'ru', value: message },
		},
	};
}

// ---------------------------------------------------------------------- filter engine

const TOKEN_RE =
	/\s*(?:('(?:[^']|'')*')|(guid'(?:[^']|'')*')|(datetime'(?:[^']|'')*')|(-?\d+(?:\.\d+)?)|([A-Za-zА-Яа-яЁё_][A-Za-zА-Яа-яЁё_0-9]*)|([(),]))/gu;

function tokenize(expression) {
	const tokens = [];
	TOKEN_RE.lastIndex = 0;
	let match;
	let consumed = 0;
	while ((match = TOKEN_RE.exec(expression)) !== null) {
		if (match.index !== consumed && expression.slice(consumed, match.index).trim() !== '') {
			throw new ODataError(400, `Некорректное выражение фильтра: ${expression}`, '400');
		}
		consumed = match.index + match[0].length;
		if (match[1] !== undefined) {
			tokens.push({ type: 'literal', value: match[1].slice(1, -1).replace(/''/g, "'") });
		} else if (match[2] !== undefined) {
			tokens.push({ type: 'literal', value: match[2].slice(5, -1).replace(/''/g, "'") });
		} else if (match[3] !== undefined) {
			tokens.push({ type: 'datetime', value: match[3].slice(9, -1) });
		} else if (match[4] !== undefined) {
			tokens.push({ type: 'literal', value: Number(match[4]) });
		} else if (match[5] !== undefined) {
			tokens.push({ type: 'identifier', value: match[5] });
		} else {
			tokens.push({ type: 'punctuation', value: match[6] });
		}
	}
	return tokens;
}

const COMPARISON_OPS = new Set(['eq', 'ne', 'gt', 'ge', 'lt', 'le']);
const FUNCTIONS = new Set(['like', 'startswith', 'endswith', 'substringof']);

function parseFilter(expression) {
	const tokens = tokenize(expression);
	let position = 0;

	const peek = () => tokens[position];
	const next = () => tokens[position++];
	const expect = (value) => {
		const token = next();
		if (!token || token.value !== value) {
			throw new ODataError(400, `Ожидалось "${value}" в фильтре: ${expression}`, '400');
		}
		return token;
	};

	function parseOr() {
		let left = parseAnd();
		while (peek()?.type === 'identifier' && peek().value === 'or') {
			next();
			left = { kind: 'or', left, right: parseAnd() };
		}
		return left;
	}

	function parseAnd() {
		let left = parseUnary();
		while (peek()?.type === 'identifier' && peek().value === 'and') {
			next();
			left = { kind: 'and', left, right: parseUnary() };
		}
		return left;
	}

	function parseUnary() {
		if (peek()?.type === 'identifier' && peek().value === 'not') {
			next();
			return { kind: 'not', operand: parseUnary() };
		}
		return parseComparison();
	}

	function parseComparison() {
		const left = parsePrimary();
		const token = peek();
		if (token?.type === 'identifier' && COMPARISON_OPS.has(token.value)) {
			next();
			return { kind: 'compare', operator: token.value, left, right: parsePrimary() };
		}
		return left;
	}

	function parsePrimary() {
		const token = next();
		if (!token) {
			throw new ODataError(400, `Неожиданный конец фильтра: ${expression}`, '400');
		}
		if (token.type === 'punctuation' && token.value === '(') {
			const node = parseOr();
			expect(')');
			return node;
		}
		if (token.type === 'literal') {
			return { kind: 'value', value: token.value };
		}
		if (token.type === 'datetime') {
			return { kind: 'value', value: new Date(token.value) };
		}
		if (token.type === 'identifier') {
			const lower = token.value.toLowerCase();
			if (lower === 'true' || lower === 'false') {
				return { kind: 'value', value: lower === 'true' };
			}
			if (lower === 'null') {
				return { kind: 'value', value: null };
			}
			if (peek()?.type === 'punctuation' && peek().value === '(') {
				if (!FUNCTIONS.has(lower)) {
					throw new ODataError(400, `Неизвестная функция фильтра: ${token.value}`, '400');
				}
				next();
				const args = [];
				if (!(peek()?.type === 'punctuation' && peek().value === ')')) {
					args.push(parseOr());
					while (peek()?.type === 'punctuation' && peek().value === ',') {
						next();
						args.push(parseOr());
					}
				}
				expect(')');
				return { kind: 'call', name: lower, args };
			}
			return { kind: 'field', name: token.value };
		}
		throw new ODataError(400, `Некорректный фильтр: ${expression}`, '400');
	}

	const ast = parseOr();
	if (position !== tokens.length) {
		throw new ODataError(400, `Некорректный фильтр: ${expression}`, '400');
	}
	return ast;
}

function compareValues(left, right, operator) {
	if (left instanceof Date || right instanceof Date) {
		const leftTime = left instanceof Date ? left.getTime() : new Date(String(left)).getTime();
		const rightTime = right instanceof Date ? right.getTime() : new Date(String(right)).getTime();
		return applyOperator(leftTime, rightTime, operator);
	}
	return applyOperator(left, right, operator);
}

function applyOperator(left, right, operator) {
	switch (operator) {
		case 'eq':
			return left === right;
		case 'ne':
			return left !== right;
		case 'gt':
			return left > right;
		case 'ge':
			return left >= right;
		case 'lt':
			return left < right;
		case 'le':
			return left <= right;
		default:
			throw new ODataError(400, `Неизвестный оператор: ${operator}`, '400');
	}
}

function likeToRegExp(pattern, flags = 'u') {
	let source = '';
	for (const char of String(pattern)) {
		if (char === '%') {
			source += '[\\s\\S]*';
		} else if (char === '_') {
			source += '[\\s\\S]';
		} else {
			source += char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		}
	}
	return new RegExp(`^${source}$`, flags);
}

function evaluate(node, item) {
	switch (node.kind) {
		case 'value':
			return node.value;
		case 'field':
			return item[node.name];
		case 'and':
			return Boolean(evaluate(node.left, item)) && Boolean(evaluate(node.right, item));
		case 'or':
			return Boolean(evaluate(node.left, item)) || Boolean(evaluate(node.right, item));
		case 'not':
			return !evaluate(node.operand, item);
		case 'compare':
			return compareValues(evaluate(node.left, item), evaluate(node.right, item), node.operator);
		case 'call': {
			const args = node.args.map((arg) => evaluate(arg, item));
			if (node.name === 'like') {
				const pattern = String(args[1] ?? '');
				if (!String(pattern).includes('%') && !String(pattern).includes('_')) {
					return String(args[0] ?? '') === pattern;
				}
				return likeToRegExp(pattern).test(String(args[0] ?? ''));
			}
			if (node.name === 'startswith') {
				return String(args[0] ?? '').startsWith(String(args[1] ?? ''));
			}
			if (node.name === 'endswith') {
				return String(args[0] ?? '').endsWith(String(args[1] ?? ''));
			}
			if (node.name === 'substringof') {
				return String(args[1] ?? '').includes(String(args[0] ?? ''));
			}
			throw new ODataError(400, `Неизвестная функция: ${node.name}`, '400');
		}
		default:
			throw new ODataError(400, 'Некорректное выражение фильтра', '400');
	}
}

// ------------------------------------------------------------------------- metadata

function edmxString(value) {
	return String(value)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

function buildMetadataXml() {
	const entityTypes = SCHEMA.map((set) => {
		const properties = set.properties
			.map(
				(property) =>
					`<Property Name="${edmxString(property.name)}" Type="${property.type}" Nullable="${property.nullable === false ? 'false' : 'true'}"/>`,
			)
			.join('');
		const navigation = (set.navigation ?? [])
			.map(
				(nav) =>
					`<NavigationProperty Name="${edmxString(nav.name)}" Relationship="${nav.relationship}" FromRole="${nav.fromRole}" ToRole="${nav.toRole}"/>`,
			)
			.join('');
		return `<EntityType Name="${edmxString(set.name)}">${properties}${navigation}</EntityType>`;
	}).join('\n      ');

	const associations = SCHEMA.flatMap((set) =>
		(set.navigation ?? []).map(
			(nav) =>
				`<Association Name="${edmxString(nav.relationship.replace('StandardODATA.', ''))}"><End Type="StandardODATA.${edmxString(set.name)}" Role="${nav.fromRole}" Multiplicity="1"/><End Type="StandardODATA.${edmxString(nav.entitySet)}" Role="${nav.toRole}" Multiplicity="0..1"/></Association>`,
		),
	).join('\n      ');

	const entitySets = SCHEMA.map(
		(set) =>
			`<EntitySet Name="${edmxString(set.name)}" EntityType="StandardODATA.${edmxString(set.name)}"/>`,
	).join('\n        ');

	return `<?xml version="1.0" encoding="utf-8"?>
<edmx:Edmx Version="1.0" xmlns:edmx="http://schemas.microsoft.com/ado/2007/06/edmx">
  <edmx:DataServices m:DataServiceVersion="3.0" xmlns:m="http://schemas.microsoft.com/ado/2007/08/dataservices/metadata">
    <Schema Namespace="StandardODATA" xmlns="http://schemas.microsoft.com/ado/2008/09/edm">
      ${entityTypes}
      ${associations}
      <EntityContainer Name="StandardODATA" m:IsDefaultEntityContainer="true">
        ${entitySets}
      </EntityContainer>
    </Schema>
  </edmx:DataServices>
</edmx:Edmx>`;
}

// ---------------------------------------------------------------------------- helpers

function findSchema(name) {
	return SCHEMA.find((set) => set.name === name);
}

function pickFields(item, select) {
	if (!select || select.length === 0) {
		return { ...item };
	}
	const result = {};
	for (const field of select) {
		if (field in item) {
			result[field] = item[field];
		}
	}
	return result;
}

function applyExpand(rows, schema, expand, data) {
	if (!expand || expand.length === 0) {
		return rows;
	}
	return rows.map((row) => {
		const result = { ...row };
		for (const navName of expand) {
			const nav = (schema.navigation ?? []).find((candidate) => candidate.name === navName);
			if (!nav) {
				continue;
			}
			const keyValue = row[`${navName}_Key`];
			const targetRows = data[nav.entitySet] ?? [];
			const target = targetRows.find((candidate) => candidate.Ref_Key === keyValue);
			if (target) {
				result[`${navName}@navigationLinkUrl`] = `${schema.name}(guid'${row.Ref_Key}')/${navName}`;
				result[navName] = target;
			}
		}
		return result;
	});
}

function sortRows(rows, orderBy) {
	if (!orderBy) {
		return rows;
	}
	const clauses = orderBy
		.split(',')
		.map((clause) => clause.trim())
		.filter(Boolean)
		.map((clause) => {
			const [field, direction] = clause.split(/\s+/);
			return { field, descending: (direction ?? '').toLowerCase() === 'desc' };
		});
	return [...rows].sort((left, right) => {
		for (const { field, descending } of clauses) {
			const leftValue = left[field];
			const rightValue = right[field];
			if (leftValue === rightValue) {
				continue;
			}
			const result = leftValue === undefined || leftValue === null
				? -1
				: rightValue === undefined || rightValue === null
					? 1
					: leftValue < rightValue
						? -1
						: 1;
			return descending ? -result : result;
		}
		return 0;
	});
}

function parseSelect(value) {
	if (!value) {
		return [];
	}
	return value
		.split(',')
		.map((part) => part.trim())
		.filter(Boolean);
}

function parseExpand(value) {
	return parseSelect(value);
}

function readBody(request) {
	return new Promise((resolve, reject) => {
		const chunks = [];
		request.on('data', (chunk) => chunks.push(chunk));
		request.on('end', () => {
			const raw = Buffer.concat(chunks).toString('utf8');
			if (!raw.trim()) {
				resolve(null);
				return;
			}
			try {
				resolve(JSON.parse(raw));
			} catch (error) {
				reject(new ODataError(400, `Некорректный JSON в теле запроса: ${error.message}`, '400'));
			}
		});
		request.on('error', reject);
	});
}

function sendJson(response, status, payload) {
	const body = JSON.stringify(payload);
	response.writeHead(status, {
		'Content-Type': 'application/json;charset=utf-8',
		'Content-Length': Buffer.byteLength(body),
	});
	response.end(body);
}

function sendEmpty(response, status) {
	response.writeHead(status, { 'Content-Length': '0' });
	response.end();
}

function checkAuth(request, response, user, password) {
	const header = request.headers.authorization ?? '';
	if (!header.toLowerCase().startsWith('basic ')) {
		response.writeHead(401, { 'WWW-Authenticate': 'Basic realm="1C OData mock"' });
		response.end();
		return false;
	}
	const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
	const separator = decoded.indexOf(':');
	const providedUser = separator === -1 ? decoded : decoded.slice(0, separator);
	const providedPassword = separator === -1 ? '' : decoded.slice(separator + 1);
	if (providedUser !== user || providedPassword !== password) {
		response.writeHead(401, { 'WWW-Authenticate': 'Basic realm="1C OData mock"' });
		response.end();
		return false;
	}
	return true;
}

// ------------------------------------------------------------------------- the server

export function startMockServer(options = {}) {
	const user = options.user ?? process.env.MOCK_USER ?? 'odata';
	const password = options.password ?? process.env.MOCK_PASSWORD ?? 'odata';
	const prefix = options.prefix ?? process.env.MOCK_PREFIX ?? DEFAULT_PREFIX;
	const host = options.host ?? process.env.MOCK_HOST ?? '127.0.0.1';
	let data = seed();
	let dataVersionCounter = 0;

	function nextDataVersion() {
		dataVersionCounter += 1;
		return Buffer.from(`dv-${dataVersionCounter}`).toString('base64');
	}

	async function handle(request, response) {
		if (!checkAuth(request, response, user, password)) {
			return;
		}

		const url = new URL(request.url ?? '/', `http://${host}`);
		let pathname;
		try {
			pathname = decodeURIComponent(url.pathname);
		} catch {
			throw new ODataError(400, 'Некорректный URL', '400');
		}

		if (!pathname.startsWith(prefix)) {
			throw new ODataError(404, `Ресурс '${pathname}' не найден`, '404');
		}
		const relative = pathname.slice(prefix.length) || '/';
		const query = url.searchParams;

		if (relative === '/' || relative === '') {
			sendJson(response, 200, {
				'odata.metadata': `${url.origin}${prefix}/$metadata`,
				value: SCHEMA.map((set) => ({ name: set.name, kind: 'EntitySet', url: set.name })),
			});
			return;
		}

		if (relative === '/$metadata') {
			const xml = buildMetadataXml();
			response.writeHead(200, {
				'Content-Type': 'application/xml;charset=utf-8',
				'Content-Length': Buffer.byteLength(xml),
			});
			response.end(xml);
			return;
		}

		const countMatch = /^\/([^/()]+)\/\$count$/.exec(relative);
		if (countMatch) {
			const setName = countMatch[1];
			if (!findSchema(setName)) {
				throw new ODataError(404, `Сущность '${setName}' не найдена`, '8');
			}
			const rows = data[setName] ?? [];
			const filterAst = query.get('$filter') ? parseFilter(query.get('$filter')) : null;
			const count = filterAst ? rows.filter((row) => evaluate(filterAst, row)).length : rows.length;
			response.writeHead(200, { 'Content-Type': 'text/plain;charset=utf-8' });
			response.end(String(count));
			return;
		}

		const match = /^\/([^/()]+)(?:\(guid'([^']+)'\))?(?:\/(Post|Unpost)\(\))?$/.exec(relative);
		if (!match) {
			throw new ODataError(404, `Сущность '${relative}' не найдена`, '404');
		}
		const [, setName, refKey, action] = match;
		const schema = findSchema(setName);
		if (!schema) {
			throw new ODataError(404, `Сущность '${setName}' не найдена`, '8');
		}
		const rows = data[setName] ?? (data[setName] = []);
		const format = query.get('$format');
		if (format && format.toLowerCase() !== 'json') {
			throw new ODataError(400, 'Мок поддерживает только $format=json', '400');
		}

		if (!refKey && request.method === 'GET') {
			let filtered = rows;
			const filterAst = query.get('$filter') ? parseFilter(query.get('$filter')) : null;
			if (filterAst) {
				filtered = filtered.filter((row) => evaluate(filterAst, row));
			}
			filtered = sortRows(filtered, query.get('$orderby'));
			const skip = Number(query.get('$skip') ?? 0);
			const top = query.get('$top') === null ? filtered.length : Number(query.get('$top'));
			const page = filtered.slice(skip, skip + top);
			const select = parseSelect(query.get('$select'));
			const expand = parseExpand(query.get('$expand'));
			let result = page.map((row) => pickFields(row, select));
			result = applyExpand(result, schema, expand, data);
			const payload = {
				'odata.metadata': `${url.origin}${prefix}/$metadata#${setName}`,
				value: result,
			};
			if ((query.get('$inlinecount') ?? '').toLowerCase() === 'allpages') {
				payload['odata.count'] = filtered.length;
			}
			sendJson(response, 200, payload);
			return;
		}

		if (refKey && request.method === 'GET') {
			if (query.get('$expand')) {
				throw new ODataError(
					501,
					'Опция $expand не поддерживается при запросе одиночных сущностей',
					'501',
				);
			}
			const row = rows.find((candidate) => candidate.Ref_Key === refKey);
			if (!row) {
				throw new ODataError(404, `Объект с идентификатором '${refKey}' не найден`, '6');
			}
			const select = parseSelect(query.get('$select'));
			const [result] = applyExpand([pickFields(row, select)], schema, [], data);
			sendJson(response, 200, {
				'odata.metadata': `${url.origin}${prefix}/$metadata#${setName}/$entity`,
				...result,
			});
			return;
		}

		if (!refKey && request.method === 'POST') {
			const body = (await readBody(request)) ?? {};
			if (!body || typeof body !== 'object' || Array.isArray(body)) {
				throw new ODataError(400, 'Тело запроса должно быть JSON-объектом', '400');
			}
			if (setName === 'Document_ЗаказКлиента' && !body.Date) {
				throw new ODataError(500, 'Значение поля "Дата" не может быть пустой датой', '-1');
			}
			for (const property of schema.properties) {
				if (property.nullable === false && property.name !== 'Ref_Key' && body[property.name] === undefined) {
					if (setName === 'InformationRegister_ЦеныНоменклатуры') {
						throw new ODataError(500, `Не заполнено поле "${property.name}"`, '-1');
					}
				}
			}
			const created = {
				Ref_Key: body.Ref_Key && body.Ref_Key !== '00000000-0000-0000-0000-000000000000' ? body.Ref_Key : randomUUID(),
				DataVersion: nextDataVersion(),
				DeletionMark: body.DeletionMark ?? false,
				...body,
			};
			created.Ref_Key = body.Ref_Key && body.Ref_Key !== '00000000-0000-0000-0000-000000000000' ? body.Ref_Key : created.Ref_Key;
			rows.push(created);
			sendJson(response, 201, {
				'odata.metadata': `${url.origin}${prefix}/$metadata#${setName}/$entity`,
				...created,
			});
			return;
		}

		if (refKey && (request.method === 'PATCH' || request.method === 'PUT')) {
			const row = rows.find((candidate) => candidate.Ref_Key === refKey);
			if (!row) {
				throw new ODataError(404, `Объект с идентификатором '${refKey}' не найден`, '6');
			}
			const ifMatch = request.headers['if-match'];
			if (ifMatch && ifMatch !== row.DataVersion) {
				throw new ODataError(412, 'Объект был изменен другим пользователем', '412');
			}
			const body = (await readBody(request)) ?? {};
			Object.assign(row, body, { Ref_Key: refKey, DataVersion: nextDataVersion() });
			if (request.method === 'PUT') {
				for (const key of Object.keys(row)) {
					if (!(key in body) && key !== 'Ref_Key' && key !== 'DataVersion') {
						delete row[key];
					}
				}
			}
			sendEmpty(response, 204);
			return;
		}

		if (refKey && request.method === 'DELETE') {
			const index = rows.findIndex((candidate) => candidate.Ref_Key === refKey);
			if (index === -1) {
				throw new ODataError(404, `Объект с идентификатором '${refKey}' не найден`, '6');
			}
			rows.splice(index, 1);
			sendEmpty(response, 204);
			return;
		}

		if (refKey && action && request.method === 'POST') {
			const row = rows.find((candidate) => candidate.Ref_Key === refKey);
			if (!row) {
				throw new ODataError(404, `Объект с идентификатором '${refKey}' не найден`, '6');
			}
			if (setName !== 'Document_ЗаказКлиента') {
				throw new ODataError(400, `Метод '${action}' не поддерживается для '${setName}'`, '400');
			}
			row.Posted = action === 'Post';
			row.DataVersion = nextDataVersion();
			sendJson(response, 200, {
				'odata.metadata': `${url.origin}${prefix}/$metadata#${setName}/$entity`,
				...row,
			});
			return;
		}

		throw new ODataError(405, `Метод ${request.method} не поддерживается`, '405');
	}

	const server = createServer((request, response) => {
		Promise.resolve()
			.then(() => handle(request, response))
			.catch((error) => {
				if (response.headersSent) {
					response.end();
					return;
				}
				if (error instanceof ODataError) {
					sendJson(response, error.status, errorBody(error.message, error.code));
					return;
				}
				sendJson(response, 500, errorBody(error?.message ?? 'Внутренняя ошибка мока'));
			});
	});

	return new Promise((resolve, reject) => {
		server.on('error', reject);
		server.listen(options.port ?? 0, host, () => {
			const address = server.address();
			const port = typeof address === 'object' && address ? address.port : 0;
			resolve({
				server,
				port,
				host,
				prefix,
				baseUrl: `http://${host}:${port}`,
				serviceUrl: `http://${host}:${port}${prefix}`,
				close: () =>
					new Promise((done) => {
						server.close(() => done());
					}),
				reset: () => {
					data = seed();
					dataVersionCounter = 0;
				},
			});
		});
	});
}

const isMain =
	process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
	const port = Number(process.env.MOCK_PORT ?? 18080);
	const host = process.env.MOCK_HOST ?? '127.0.0.1';
	const instance = await startMockServer({ port, host });
	console.log(`1C OData mock is listening on ${instance.serviceUrl}`);
	console.log(`  user: ${process.env.MOCK_USER ?? 'odata'} / password: ${process.env.MOCK_PASSWORD ?? 'odata'}`);
	const shutdown = () => {
		instance.close().then(() => process.exit(0));
	};
	process.on('SIGINT', shutdown);
	process.on('SIGTERM', shutdown);
}
