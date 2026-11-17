import type { IDataObject } from 'n8n-workflow';

export const ODATA_CREDENTIAL_NAME = 'odata1cApi';

/** Path appended to the publication URL of the infobase. */
export const ODATA_PATH = '/odata/standard.odata';

export interface OData1cCredentials {
	baseUrl: string;
	username: string;
	password: string;
	allowUnauthorizedCerts?: boolean;
	timeout?: number;
}

/** Removes trailing slashes and a trailing `/odata/standard.odata` suffix. */
export function normalizeBaseUrl(baseUrl: string): string {
	const trimmed = (baseUrl ?? '').trim().replace(/\/+$/, '');
	const lower = trimmed.toLowerCase();
	const suffix = ODATA_PATH.toLowerCase();
	if (lower.endsWith(suffix)) {
		return trimmed.slice(0, trimmed.length - ODATA_PATH.length).replace(/\/+$/, '');
	}
	return trimmed;
}

/** Full OData service root, for example `https://1c.example.com/erp/odata/standard.odata`. */
export function odataBaseUrl(credentials: Pick<OData1cCredentials, 'baseUrl'>): string {
	return `${normalizeBaseUrl(credentials.baseUrl)}${ODATA_PATH}`;
}

export function joinUrl(base: string, path: string): string {
	if (!path) {
		return base;
	}
	if (path.startsWith('/')) {
		return `${base}${path}`;
	}
	return `${base}/${path}`;
}

/**
 * Percent-encodes non-ASCII characters (`Номенклатура` -> `%D0%9D...`) while leaving
 * URL structure and already-encoded sequences intact. Node's HTTP client rejects
 * raw non-ASCII characters in a request path, and 1C entity set names are Cyrillic.
 */
export function encodeNonAscii(value: string): string {
	if (!value) {
		return value;
	}
	let result = '';
	for (const char of value) {
		const code = char.codePointAt(0) ?? 0;
		result += code > 0x7f ? encodeURIComponent(char) : char;
	}
	return result;
}

/**
 * Serializes OData query parameters the way 1C expects them.
 *
 * 1C does not decode `+` as a space (a `$filter` with `+` fails with
 * `Операция не разрешена в предложении "ГДЕ"`), and it does not accept an encoded
 * `$` in option names. So spaces are sent as `%20` and `$` stays literal, while
 * commas, colons and apostrophes are kept readable as axios does.
 */
export function serializeQuery(qs?: Record<string, string | number | boolean>): string {
	if (!qs) {
		return '';
	}
	return Object.entries(qs)
		.filter(([, value]) => value !== undefined && value !== null)
		.map(([key, value]) => `${encodeQueryKey(key)}=${encodeQueryValue(value)}`)
		.join('&');
}

function encodeQueryKey(key: string): string {
	return encodeURIComponent(key).replace(/%24/gi, '$');
}

function encodeQueryValue(value: string | number | boolean): string {
	return encodeURIComponent(String(value))
		.replace(/%2C/gi, ',')
		.replace(/%3A/gi, ':')
		.replace(/%27/gi, "'");
}

const GUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/**
 * Accepts a bare GUID, `guid'...'`, or a full `Catalog_X(guid'...')` reference and
 * returns the bare GUID.
 */
export function normalizeGuid(value: string): string {
	let candidate = (value ?? '').trim();
	const bracket = candidate.lastIndexOf('(guid');
	if (bracket !== -1) {
		candidate = candidate.slice(bracket + 1);
	}
	candidate = candidate.replace(/^guid'/i, '').replace(/'\)?$/, '').trim();
	if (!GUID_RE.test(candidate)) {
		throw new Error(
			`"${value}" is not a valid GUID. Use the Ref_Key value, for example 3f1c9b7e-9d2a-11ee-8f3a-00155d0a1b2c.`,
		);
	}
	return candidate;
}

/** Builds the address of a single entity: `Catalog_Номенклатура(guid'...')`. */
export function entityAddress(entitySet: string, refKey: string): string {
	return `${entitySet}(guid'${normalizeGuid(refKey)}')`;
}

/** Escapes a string value for an OData 3.0 literal (single quotes are doubled). */
export function quoteString(value: string): string {
	return `'${String(value).replace(/'/g, "''")}'`;
}

export function splitList(value: string | undefined): string[] {
	if (!value) {
		return [];
	}
	return value
		.split(',')
		.map((part) => part.trim())
		.filter((part) => part.length > 0);
}

const MS_DATE_RE = /^\\?\/Date\((-?\d+)(?:[+-]\d{4})?\)\\?\/$/;

/**
 * Converts Microsoft-style OData dates (`/Date(1700000000000)/`) into ISO strings.
 * 1C:Enterprise already returns ISO dates in JSON, so this is a defensive measure
 * for proxies and older platform versions.
 */
export function normalizeDatesDeep<T>(value: T): T {
	if (typeof value === 'string') {
		const match = MS_DATE_RE.exec(value);
		if (match) {
			const timestamp = Number(match[1]);
			if (Number.isFinite(timestamp)) {
				return new Date(timestamp).toISOString() as unknown as T;
			}
		}
		return value;
	}
	if (Array.isArray(value)) {
		return value.map((item) => normalizeDatesDeep(item)) as unknown as T;
	}
	if (value !== null && typeof value === 'object') {
		const result: Record<string, unknown> = {};
		for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
			result[key] = normalizeDatesDeep(item);
		}
		return result as unknown as T;
	}
	return value;
}

/** Reads `{"odata.error": {"code": ..., "message": {"value": ...}}}` from any 1C error body. */
export function extractODataErrorText(body: unknown): string | undefined {
	if (body === undefined || body === null) {
		return undefined;
	}
	if (typeof body === 'string') {
		const trimmed = body.trim();
		if (!trimmed) {
			return undefined;
		}
		if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
			try {
				return extractODataErrorText(JSON.parse(trimmed));
			} catch {
				return trimmed.slice(0, 2000);
			}
		}
		const fromXml = extractXmlErrorText(trimmed);
		return fromXml ?? trimmed.slice(0, 2000);
	}
	if (typeof body !== 'object') {
		return String(body);
	}

	const record = body as Record<string, unknown>;
	const odataError = record['odata.error'] ?? record.error;
	if (odataError && typeof odataError === 'object') {
		const errorRecord = odataError as Record<string, unknown>;
		const message = errorRecord.message;
		if (typeof message === 'string') {
			return message;
		}
		if (message && typeof message === 'object') {
			const messageRecord = message as Record<string, unknown>;
			if (typeof messageRecord.value === 'string') {
				return messageRecord.value;
			}
			if (typeof messageRecord.message === 'string') {
				return messageRecord.message;
			}
		}
		if (typeof errorRecord.value === 'string') {
			return errorRecord.value;
		}
		const code = errorRecord.code;
		if (code !== undefined) {
			return `1C OData error ${String(code)}`;
		}
	}
	if (typeof record.message === 'string') {
		return record.message;
	}
	try {
		return JSON.stringify(body).slice(0, 2000);
	} catch {
		return undefined;
	}
}

/** Extracts `<m:message>...</m:message>` from a 1C OData XML error document. */
function extractXmlErrorText(xml: string): string | undefined {
	if (!xml.includes('<')) {
		return undefined;
	}
	const match = /<(?:\w+:)?message[^>]*>([\s\S]*?)<\/(?:\w+:)?message>/i.exec(xml);
	if (!match) {
		return undefined;
	}
	return match[1]
		.replace(/<[^>]+>/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

/** Parses a JSON field value that n8n may hand over as a string or an object. */
export function parseJsonField(value: unknown, label: string): IDataObject {
	if (value === undefined || value === null || value === '') {
		return {};
	}
	if (typeof value === 'object' && !Array.isArray(value)) {
		return value as IDataObject;
	}
	if (typeof value === 'string') {
		const trimmed = value.trim();
		if (!trimmed) {
			return {};
		}
		try {
			const parsed = JSON.parse(trimmed);
			if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
				return parsed as IDataObject;
			}
			throw new Error('the value is not a JSON object');
		} catch (error) {
			throw new Error(`${label} must be a valid JSON object: ${(error as Error).message}`);
		}
	}
	throw new Error(`${label} must be a JSON object`);
}

/** Parses a JSON value that may also be a plain string (for `$filter` and friends). */
export function toBoolean(value: unknown, fallback = false): boolean {
	if (typeof value === 'boolean') {
		return value;
	}
	if (typeof value === 'string') {
		return value === 'true' || value === '1';
	}
	return fallback;
}
