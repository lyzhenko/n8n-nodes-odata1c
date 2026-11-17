import type {
	IDataObject,
	IExecuteFunctions,
	IHttpRequestOptions,
	ILoadOptionsFunctions,
	INode,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeOperationError } from 'n8n-workflow';

import type { ODataMetadata } from './metadata';
import { parseMetadata } from './metadata';
import {
	ODATA_CREDENTIAL_NAME,
	encodeNonAscii,
	extractODataErrorText,
	joinUrl,
	normalizeDatesDeep,
	odataBaseUrl,
	serializeQuery,
	type OData1cCredentials,
} from './utils';

/** Context that is enough to perform a request from the node or from a load-options method. */
export type ODataContext = IExecuteFunctions | ILoadOptionsFunctions;

export type ODataMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

/** The subset of n8n's HTTP response that this node uses (`returnFullResponse`). */
export interface HttpResponseLike {
	body: unknown;
	headers?: Record<string, unknown>;
	statusCode?: number;
	statusMessage?: string;
}

export interface ODataRequestOptions {
	method: ODataMethod;
	/** Path relative to `/odata/standard.odata`, for example `Catalog_Номенклатура`. */
	path?: string;
	qs?: Record<string, string | number | boolean>;
	body?: IDataObject | IDataObject[] | string;
	headers?: Record<string, string>;
	json?: boolean;
	itemIndex?: number;
	/** Overrides the credential timeout for this call. */
	timeout?: number;
}

export const DEFAULT_TIMEOUT_MS = 60_000;

function getNode(context: ODataContext): INode {
	return context.getNode();
}

export async function getODataCredentials(
	context: ODataContext,
): Promise<OData1cCredentials> {
	const credentials = (await context.getCredentials(
		ODATA_CREDENTIAL_NAME,
	)) as unknown as OData1cCredentials;
	if (!credentials?.baseUrl) {
		throw new NodeOperationError(
			getNode(context),
			'The OData 1C credential has no base URL. Open the credential and set the infobase publication URL, for example https://1c.example.com/erp.',
		);
	}
	return credentials;
}

function timeoutFrom(credentials: OData1cCredentials): number {
	const configured = Number(credentials.timeout);
	return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_TIMEOUT_MS;
}

/**
 * Performs an authenticated request against the 1C OData service and returns the
 * parsed response body. HTTP errors are converted into readable n8n errors that
 * carry the 1C message (`odata.error.message.value`).
 */
export async function odataRequest<T = IDataObject | IDataObject[] | string>(
	context: ODataContext,
	options: ODataRequestOptions,
): Promise<T> {
	const credentials = await getODataCredentials(context);
	const requestPath = encodeNonAscii(options.path ?? '');
	const queryString = serializeQuery(options.qs);
	const url = `${joinUrl(odataBaseUrl(credentials), requestPath)}${
		queryString ? `${requestPath.includes('?') ? '&' : '?'}${queryString}` : ''
	}`;
	const node = getNode(context);
	const timeout =
		options.timeout !== undefined && Number(options.timeout) > 0
			? Number(options.timeout)
			: timeoutFrom(credentials);

	const requestOptions: IHttpRequestOptions = {
		method: options.method,
		url,
		headers: {
			Accept: 'application/json',
			...(options.headers ?? {}),
		},
		json: options.json !== false,
		returnFullResponse: true,
		ignoreHttpStatusErrors: true,
		skipSslCertificateValidation: Boolean(credentials.allowUnauthorizedCerts),
		timeout,
	};

	if (options.body !== undefined) {
		requestOptions.body = options.body as unknown as IDataObject;
	}

	let response: HttpResponseLike;
	try {
		response = (await context.helpers.httpRequestWithAuthentication.call(
			context,
			ODATA_CREDENTIAL_NAME,
			requestOptions,
		)) as HttpResponseLike;
	} catch (error) {
		const detail = extractODataErrorText(
			(error as { response?: { body?: unknown } })?.response?.body ?? (error as Error)?.message,
		);
		throw new NodeApiError(node, error as unknown as JsonObject, {
			message: detail
				? `1C OData request failed: ${detail}`
				: `1C OData request failed: ${(error as Error)?.message ?? 'unknown error'}`,
			itemIndex: options.itemIndex,
		});
	}

	const statusCode = Number(response.statusCode ?? 0);
	if (statusCode >= 400) {
		const detail = extractODataErrorText(response.body);
		const methodAndPath = `${options.method} ${options.path ?? ''}`.trim();
		throw new NodeApiError(node, (response.body ?? {}) as JsonObject, {
			message: detail
				? `1C OData error (HTTP ${statusCode}) on ${methodAndPath}: ${detail}`
				: `1C OData request failed with HTTP ${statusCode} on ${methodAndPath}${
						response.statusMessage ? ` (${response.statusMessage})` : ''
					}`,
			httpCode: String(statusCode),
			itemIndex: options.itemIndex,
		});
	}

	return normalizeDatesDeep(response.body as T);
}

const METADATA_TTL_MS = 5 * 60 * 1000;

interface CacheEntry {
	timestamp: number;
	value: Promise<ODataMetadata>;
}

const metadataCache = new Map<string, CacheEntry>();

/** Drops cached `$metadata` documents (used by tests and for a forced refresh). */
export function clearMetadataCache(): void {
	metadataCache.clear();
}

/**
 * Loads and parses `$metadata`, caching the result per service root and user for a
 * few minutes: n8n calls load-options methods on every parameter change, and an
 * ERP `$metadata` document is megabytes of XML.
 */
export async function loadMetadata(
	context: ODataContext,
	options: { forceRefresh?: boolean } = {},
): Promise<ODataMetadata> {
	const credentials = await getODataCredentials(context);
	const key = `${odataBaseUrl(credentials)}|${credentials.username ?? ''}`;
	const cached = metadataCache.get(key);
	const now = Date.now();

	if (!options.forceRefresh && cached && now - cached.timestamp < METADATA_TTL_MS) {
		return cached.value;
	}

	const value = (async (): Promise<ODataMetadata> => {
		const xml = await odataRequest<string>(context, {
			method: 'GET',
			path: '$metadata',
			json: false,
			headers: { Accept: 'application/xml' },
		});
		if (typeof xml !== 'string' || !xml.includes('<')) {
			throw new NodeOperationError(
				getNode(context),
				'1C returned an unexpected response for $metadata. Check that the standard OData interface is published for this infobase and that the user has access to it.',
			);
		}
		return parseMetadata(xml);
	})();

	metadataCache.set(key, { timestamp: now, value });
	try {
		return await value;
	} catch (error) {
		metadataCache.delete(key);
		throw error;
	}
}
