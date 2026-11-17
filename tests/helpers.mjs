// Shared helpers for the node's unit and end-to-end tests.
//
// The tests call the compiled node directly (dist/) and replace n8n's
// `httpRequestWithAuthentication` helper with fetch, so the whole request/response
// path of the node is exercised against the local 1C OData mock.
import { createRequire } from 'node:module';

export const require = createRequire(import.meta.url);

/** Axios-style query encoding: `$`, `,`, `:` stay readable, spaces become `+`. */
export function axiosLikeEncode(value) {
	return encodeURIComponent(String(value))
		.replace(/%3A/gi, ':')
		.replace(/%24/gi, '$')
		.replace(/%2C/gi, ',')
		.replace(/%5B/gi, '[')
		.replace(/%5D/gi, ']')
		.replace(/%20/g, '+');
}

export function buildUrl(url, qs = {}) {
	const entries = Object.entries(qs).filter(([, value]) => value !== undefined);
	if (entries.length === 0) {
		return url;
	}
	const query = entries
		.map(([key, value]) => `${axiosLikeEncode(key)}=${axiosLikeEncode(value)}`)
		.join('&');
	return `${url}${url.includes('?') ? '&' : '?'}${query}`;
}

export function createCredentials(overrides = {}) {
	return {
		baseUrl: 'http://127.0.0.1:1/erp',
		username: 'odata',
		password: 'odata',
		allowUnauthorizedCerts: true,
		timeout: 5000,
		...overrides,
	};
}

export function createNode(parameters) {
	return {
		id: 'test-node',
		name: 'OData 1C',
		type: 'n8n-nodes-odata1c.odata1c',
		typeVersion: 1,
		position: [0, 0],
		parameters,
	};
}

/**
 * Builds a minimal object that satisfies everything the node's execute() touches.
 */
export function createExecuteContext({
	parameters,
	credentials,
	items = [{ json: {} }],
	continueOnFail = false,
	onRequest,
}) {
	const node = createNode(parameters);

	const getNodeParameter = (name, itemIndex, fallback, options) => {
		if (!(name in parameters)) {
			return fallback;
		}
		const raw = parameters[name];
		if (raw === undefined) {
			return fallback;
		}
		if (options?.extractValue && raw && typeof raw === 'object' && !Array.isArray(raw)) {
			return raw.value ?? fallback;
		}
		return raw;
	};

	const httpRequestWithAuthentication = async (credentialsType, options) => {
		const url = buildUrl(options.url, options.qs ?? {});
		const headers = { ...(options.headers ?? {}) };
		headers.Authorization = `Basic ${Buffer.from(
			`${credentials.username}:${credentials.password}`,
		).toString('base64')}`;

		let body;
		if (options.body !== undefined) {
			body =
				typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
			const hasContentType = Object.keys(headers).some(
				(key) => key.toLowerCase() === 'content-type',
			);
			if (!hasContentType) {
				headers['Content-Type'] = 'application/json;charset=utf-8';
			}
		}

		if (onRequest) {
			onRequest({ url, method: options.method, headers, body });
		}

		const response = await fetch(url, {
			method: options.method ?? 'GET',
			headers,
			body,
		});
		const text = await response.text();
		let parsed = text;
		if (options.json !== false && text) {
			try {
				parsed = JSON.parse(text);
			} catch {
				parsed = text;
			}
		}
		return {
			body: parsed,
			headers: Object.fromEntries(response.headers.entries()),
			statusCode: response.status,
			statusMessage: response.statusText,
		};
	};

	return {
		node,
		items,
		getInputData: () => items,
		getNode: () => node,
		getNodeParameter,
		getCredentials: async () => credentials,
		continueOnFail: () => continueOnFail,
		helpers: {
			httpRequestWithAuthentication,
			returnJsonArray: (data) => data,
		},
	};
}

export async function executeNode(context) {
	const { OData1c } = require('../dist/nodes/OData1c/OData1c.node.js');
	const node = new OData1c();
	const result = await node.execute.call(context);
	return result[0];
}

/** Parameters for an entity request; `entitySet` is passed as a resource locator. */
export function entityParams(entitySet, operation, extra = {}) {
	return {
		resource: 'entity',
		operation,
		entitySet: { __rl: true, mode: 'name', value: entitySet },
		...extra,
	};
}
