import type { INodeProperties } from 'n8n-workflow';

const CUSTOM_SHOW = { resource: ['custom'] };

export const customDescription: INodeProperties[] = [
	{
		displayName: 'Method',
		name: 'requestMethod',
		type: 'options',
		displayOptions: { show: CUSTOM_SHOW },
		options: [
			{ name: 'GET', value: 'GET' },
			{ name: 'POST', value: 'POST' },
			{ name: 'PATCH', value: 'PATCH' },
			{ name: 'PUT', value: 'PUT' },
			{ name: 'DELETE', value: 'DELETE' },
		],
		default: 'GET',
		description: 'HTTP method of the request',
	},
	{
		displayName: 'Path',
		name: 'requestPath',
		type: 'string',
		displayOptions: { show: CUSTOM_SHOW },
		default: '',
		placeholder: "Catalog_Номенклатура?$filter=DeletionMark eq false&$top=5",
		description:
			'Path relative to /odata/standard.odata. A query string may be included; parameters can also be set in the Query field.',
	},
	{
		displayName: 'Query',
		name: 'requestQuery',
		type: 'json',
		displayOptions: { show: CUSTOM_SHOW },
		default: '',
		placeholder: '{\n  "$select": "Ref_Key,Description",\n  "$top": 10\n}',
		description: 'Query string parameters as a JSON object',
	},
	{
		displayName: 'Body',
		name: 'requestBody',
		type: 'json',
		displayOptions: { show: { ...CUSTOM_SHOW, requestMethod: ['POST', 'PATCH', 'PUT'] } },
		default: '',
		placeholder: '{\n  "Description": "Cable 3x2.5"\n}',
		description: 'Request body as a JSON object',
	},
	{
		displayName: 'Headers',
		name: 'requestHeaders',
		type: 'json',
		displayOptions: { show: CUSTOM_SHOW },
		default: '',
		placeholder: '{\n  "1C_OData-DataLoadMode": "true"\n}',
		description: 'Additional HTTP headers as a JSON object',
	},
	{
		displayName: 'Response Format',
		name: 'responseFormat',
		type: 'options',
		displayOptions: { show: CUSTOM_SHOW },
		options: [
			{ name: 'JSON', value: 'json', description: 'Parse the response as JSON' },
			{ name: 'Text', value: 'text', description: 'Return the response body as plain text' },
		],
		default: 'json',
		description: 'How the response body should be returned',
	},
	{
		displayName:
			'Custom requests are sent as-is. $format=json is added automatically for JSON responses, so 1C returns JSON instead of Atom XML.',
		name: 'customHint',
		type: 'notice',
		default: '',
		displayOptions: { show: CUSTOM_SHOW },
	},
];
