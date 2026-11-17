import type {
	IDataObject,
	IExecuteFunctions,
	ILoadOptionsFunctions,
	INodeExecutionData,
	INodeListSearchResult,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import { customDescription } from './descriptions/CustomDescription';
import { entityDescription } from './descriptions/EntityDescription';
import { metadataDescription } from './descriptions/MetadataDescription';
import { loadMetadata, odataRequest } from './GenericFunctions';
import { entityFields, entityNavigationProperties, findEntitySet } from './metadata';
import {
	entityAddress,
	parseJsonField,
	splitList,
	toBoolean,
} from './utils';

/** Upper bound for the safety loops that paginate or walk a response. */
const MAX_PAGES = 10_000;

interface NodeOptions extends IDataObject {
	pageSize?: number;
	timeout?: number;
	dataLoadMode?: boolean;
	ifMatch?: boolean;
}

function getEntitySetName(
	context: IExecuteFunctions,
	itemIndex: number,
	parameterName: string,
): string {
	const raw = context.getNodeParameter(parameterName, itemIndex, '', {
		extractValue: true,
	}) as unknown;
	const value =
		typeof raw === 'string' ? raw : ((raw as { value?: string } | undefined)?.value ?? '');
	const trimmed = String(value).trim();
	if (!trimmed) {
		throw new NodeOperationError(
			context.getNode(),
			'Entity Set is empty. Select an entity set from the list, or switch the field to "By Name" and enter one, for example Catalog_Номенклатура.',
			{ itemIndex },
		);
	}
	return trimmed;
}

function getTimeout(options: NodeOptions): number | undefined {
	const value = Number(options.timeout);
	return Number.isFinite(value) && value > 0 ? value : undefined;
}

function buildWriteHeaders(options: NodeOptions): Record<string, string> {
	const headers: Record<string, string> = {
		'Content-Type': 'application/json;charset=utf-8',
	};
	if (toBoolean(options.dataLoadMode)) {
		headers['1C_OData-DataLoadMode'] = 'true';
	}
	return headers;
}

function asArray(value: unknown): IDataObject[] {
	if (Array.isArray(value)) {
		return value as IDataObject[];
	}
	if (value && typeof value === 'object') {
		return [value as IDataObject];
	}
	return [];
}

async function executeEntityOperation(
	this: IExecuteFunctions,
	operation: string,
	itemIndex: number,
): Promise<IDataObject[]> {
	const entitySet = getEntitySetName(this, itemIndex, 'entitySet');
	const options = this.getNodeParameter('options', itemIndex, {}) as NodeOptions;

	if (operation === 'getMany') {
		const filter = String(this.getNodeParameter('filter', itemIndex, '') as string).trim();
		const orderBy = String(this.getNodeParameter('orderBy', itemIndex, '') as string).trim();
		const select = splitList(this.getNodeParameter('select', itemIndex, '') as string);
		const expand = splitList(this.getNodeParameter('expand', itemIndex, '') as string);
		const returnAll = toBoolean(this.getNodeParameter('returnAll', itemIndex, true), true);
		const limit = returnAll
			? Number.POSITIVE_INFINITY
			: Math.max(Number(this.getNodeParameter('limit', itemIndex, 50) as number) || 1, 1);
		const pageSize = Math.min(
			Math.max(Number(options.pageSize) || 100, 1),
			1000,
		);
		const timeout = getTimeout(options);

		const query: Record<string, string | number | boolean> = { $format: 'json' };
		if (filter) {
			query.$filter = filter;
		}
		if (orderBy) {
			query.$orderby = orderBy;
		}
		if (select.length) {
			// 1C returns an expanded navigation property only when it is also listed in
			// $select, so the expand names are added to the field list automatically.
			const selectWithExpanded = [
				...select,
				...expand.filter((name) => !select.includes(name)),
			];
			query.$select = selectWithExpanded.join(',');
		}
		if (expand.length) {
			query.$expand = expand.join(',');
		}

		const rows: IDataObject[] = [];
		let skip = 0;
		let pages = 0;

		while (rows.length < limit && pages < MAX_PAGES) {
			const requested = Number.isFinite(limit)
				? Math.min(pageSize, limit - rows.length)
				: pageSize;
			if (requested <= 0) {
				break;
			}

			const response = await odataRequest<IDataObject | IDataObject[]>(this, {
				method: 'GET',
				path: entitySet,
				qs: { ...query, $top: String(requested), $skip: String(skip) },
				itemIndex,
				timeout,
			});

			const page = Array.isArray(response)
				? (response as IDataObject[])
				: ((response as IDataObject)?.value as IDataObject[] | undefined) ?? [];
			if (!Array.isArray(page) || page.length === 0) {
				break;
			}

			rows.push(...page);
			skip += page.length;
			pages += 1;

			if (page.length < requested) {
				break;
			}
		}

		return Number.isFinite(limit) ? rows.slice(0, limit) : rows;
	}

	if (operation === 'getOne') {
		const refKey = String(this.getNodeParameter('refKey', itemIndex, '') as string);
		const select = splitList(this.getNodeParameter('select', itemIndex, '') as string);
		const query: Record<string, string | number | boolean> = { $format: 'json' };
		if (select.length) {
			query.$select = select.join(',');
		}

		const response = await odataRequest<IDataObject>(this, {
			method: 'GET',
			path: entityAddress(entitySet, refKey),
			qs: query,
			itemIndex,
			timeout: getTimeout(options),
		});
		return asArray(response);
	}

	if (operation === 'count') {
		const filter = String(this.getNodeParameter('filter', itemIndex, '') as string).trim();
		const query: Record<string, string | number | boolean> = {};
		if (filter) {
			query.$filter = filter;
		}
		const response = await odataRequest<string>(this, {
			method: 'GET',
			path: `${entitySet}/$count`,
			qs: query,
			json: false,
			itemIndex,
			timeout: getTimeout(options),
		});
		const count = Number(String(response ?? '').trim().replace(/^\uFEFF/, ''));
		if (!Number.isFinite(count)) {
			throw new NodeOperationError(
				this.getNode(),
				`1C returned an unexpected /$count response: ${String(response).slice(0, 200)}`,
				{ itemIndex },
			);
		}
		return [{ entitySet, count }];
	}

	if (operation === 'create') {
		const fields = parseJsonField(this.getNodeParameter('fields', itemIndex, ''), 'Fields (JSON)');
		if (Object.keys(fields).length === 0) {
			throw new NodeOperationError(
				this.getNode(),
				'Fields (JSON) is empty. Provide at least one field, for example {"Description": "Cable 3x2.5"}.',
				{ itemIndex },
			);
		}

		const response = await odataRequest<IDataObject>(this, {
			method: 'POST',
			path: entitySet,
			qs: { $format: 'json' },
			body: fields,
			headers: buildWriteHeaders(options),
			itemIndex,
			timeout: getTimeout(options),
		});
		return asArray(response);
	}

	if (operation === 'update') {
		const refKey = String(this.getNodeParameter('refKey', itemIndex, '') as string);
		const fields = parseJsonField(this.getNodeParameter('fields', itemIndex, ''), 'Fields (JSON)');
		if (Object.keys(fields).length === 0) {
			throw new NodeOperationError(
				this.getNode(),
				'Fields (JSON) is empty. Provide the fields to change, for example {"Артикул": "CBL-325-NEW"}.',
				{ itemIndex },
			);
		}

		const address = entityAddress(entitySet, refKey);
		const headers = buildWriteHeaders(options);

		if (toBoolean(options.ifMatch)) {
			const current = await odataRequest<IDataObject>(this, {
				method: 'GET',
				path: address,
				qs: { $format: 'json', $select: 'Ref_Key,DataVersion' },
				itemIndex,
				timeout: getTimeout(options),
			});
			const dataVersion = asArray(current)[0]?.DataVersion;
			if (dataVersion === undefined || dataVersion === null) {
				throw new NodeOperationError(
					this.getNode(),
					'Optimistic Lock is enabled, but 1C did not return DataVersion for this entity. Reread the entity or disable the option.',
					{ itemIndex },
				);
			}
			headers['If-Match'] = String(dataVersion);
		}

		const response = await odataRequest<IDataObject>(this, {
			method: 'PATCH',
			path: address,
			qs: { $format: 'json' },
			body: fields,
			headers,
			itemIndex,
			timeout: getTimeout(options),
		});

		const updated = asArray(response);
		if (updated.length > 0) {
			return updated;
		}
		return [{ success: true, entitySet, refKey: entityAddress(entitySet, refKey), fields }];
	}

	if (operation === 'delete') {
		const refKey = String(this.getNodeParameter('refKey', itemIndex, '') as string);
		await odataRequest(this, {
			method: 'DELETE',
			path: entityAddress(entitySet, refKey),
			itemIndex,
			timeout: getTimeout(options),
		});
		return [{ success: true, entitySet, refKey, deleted: true }];
	}

	if (operation === 'posting') {
		const refKey = String(this.getNodeParameter('refKey', itemIndex, '') as string);
		const action = String(this.getNodeParameter('postingAction', itemIndex, 'post') as string);
		const methodName = action === 'unpost' ? 'Unpost' : 'Post';
		const response = await odataRequest<IDataObject>(this, {
			method: 'POST',
			path: `${entityAddress(entitySet, refKey)}/${methodName}()`,
			qs: { $format: 'json' },
			headers: { 'Content-Type': 'application/json;charset=utf-8' },
			itemIndex,
			timeout: getTimeout(options),
		});
		const result = asArray(response);
		return result.length > 0
			? result
			: [{ success: true, entitySet, refKey, action: methodName }];
	}

	throw new NodeOperationError(
		this.getNode(),
		`Unknown operation "${operation}" for the Entity Set resource`,
		{ itemIndex },
	);
}

async function executeMetadataOperation(
	this: IExecuteFunctions,
	operation: string,
	itemIndex: number,
): Promise<IDataObject[]> {
	if (operation === 'list') {
		const metadata = await loadMetadata(this);
		const nameFilter = String(
			this.getNodeParameter('nameFilter', itemIndex, '') as string,
		)
			.trim()
			.toLowerCase();
		const sets = metadata.entitySets.filter(
			(set) =>
				!nameFilter ||
				set.name.toLowerCase().includes(nameFilter) ||
				set.kind.toLowerCase().includes(nameFilter),
		);
		return sets.map((set) => ({
			name: set.name,
			kind: set.kind,
			entityType: set.entityType,
		}));
	}

	if (operation === 'fields') {
		const entitySet = getEntitySetName(this, itemIndex, 'metadataEntitySet');
		const metadata = await loadMetadata(this);
		const known = findEntitySet(metadata, entitySet);
		if (!known) {
			throw new NodeOperationError(
				this.getNode(),
				`Entity set "${entitySet}" is not published in the OData interface. Use the Get Entity Sets operation to list the available sets.`,
				{ itemIndex },
			);
		}

		const properties = entityFields(metadata, entitySet).map((property) => ({
			name: property.name,
			type: property.type,
			nullable: property.nullable,
			key: property.key,
			navigation: false,
			entitySet,
		}));

		const navigation = entityNavigationProperties(metadata, entitySet).map((property) => ({
			name: property.name,
			type: 'NavigationProperty',
			nullable: true,
			key: false,
			navigation: true,
			relationship: property.relationship,
			entitySet,
		}));

		return [...properties, ...navigation];
	}

	if (operation === 'raw') {
		const xml = await odataRequest<string>(this, {
			method: 'GET',
			path: '$metadata',
			json: false,
			headers: { Accept: 'application/xml' },
			itemIndex,
		});
		return [{ entitySet: '$metadata', xml }];
	}

	throw new NodeOperationError(
		this.getNode(),
		`Unknown operation "${operation}" for the Metadata resource`,
		{ itemIndex },
	);
}

async function executeCustomRequest(
	this: IExecuteFunctions,
	itemIndex: number,
): Promise<IDataObject[]> {
	const method = String(this.getNodeParameter('requestMethod', itemIndex, 'GET') as string)
		.toUpperCase() as 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
	const path = String(this.getNodeParameter('requestPath', itemIndex, '') as string).trim();
	const query = parseJsonField(
		this.getNodeParameter('requestQuery', itemIndex, ''),
		'Query',
	) as Record<string, string | number | boolean>;
	const headers = parseJsonField(
		this.getNodeParameter('requestHeaders', itemIndex, ''),
		'Headers',
	) as Record<string, string>;
	const responseFormat = String(
		this.getNodeParameter('responseFormat', itemIndex, 'json') as string,
	);
	const wantsJson = responseFormat !== 'text';

	const qs: Record<string, string | number | boolean> = { ...query };
	if (
		wantsJson &&
		method === 'GET' &&
		!('$format' in qs) &&
		!/[?&]\$format=/i.test(path)
	) {
		qs.$format = 'json';
	}

	let body: IDataObject | undefined;
	if (method === 'POST' || method === 'PATCH' || method === 'PUT') {
		const parsed = parseJsonField(this.getNodeParameter('requestBody', itemIndex, ''), 'Body');
		if (Object.keys(parsed).length > 0) {
			body = parsed;
		}
	}

	const response = await odataRequest<unknown>(this, {
		method,
		path,
		qs,
		body,
		headers,
		json: wantsJson,
		itemIndex,
	});

	if (!wantsJson) {
		return [{ data: String(response ?? '') }];
	}
	if (Array.isArray(response)) {
		return response as IDataObject[];
	}
	if (response && typeof response === 'object') {
		return [response as IDataObject];
	}
	if (typeof response === 'string' || typeof response === 'number' || typeof response === 'boolean') {
		return [{ data: response }];
	}
	return [{ data: null }];
}

export class OData1c implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'OData 1C',
		name: 'odata1c',
		icon: 'file:odata1c.svg',
		group: ['transform'],
		version: [1],
		subtitle: '={{$parameter["resource"] + ": " + $parameter["operation"]}}',
		description:
			'Read and modify 1C:Enterprise data through the standard OData REST interface',
		defaults: {
			name: 'OData 1C',
		},
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [
			{
				name: 'odata1cApi',
				required: true,
			},
		],
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Entity Set',
						value: 'entity',
						description: 'Catalogs, documents, registers and other published entity sets',
					},
					{
						name: 'Metadata',
						value: 'metadata',
						description: 'Read $metadata: entity sets and their fields',
					},
					{
						name: 'Custom Request',
						value: 'custom',
						description: 'Send an arbitrary request to the OData service',
					},
				],
				default: 'entity',
			},
			...entityDescription,
			...metadataDescription,
			...customDescription,
		],
	};

	methods = {
		listSearch: {
			searchEntitySets,
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let i = 0; i < items.length; i++) {
			try {
				// n8n stores only parameters that differ from their defaults, so the
				// defaults have to be passed as fallbacks here.
				const resource = String(this.getNodeParameter('resource', i, 'entity') as string);
				const operation = String(this.getNodeParameter('operation', i, 'getMany') as string);

				let results: IDataObject[];
				if (resource === 'entity') {
					results = await executeEntityOperation.call(this, operation, i);
				} else if (resource === 'metadata') {
					results = await executeMetadataOperation.call(this, operation, i);
				} else if (resource === 'custom') {
					results = await executeCustomRequest.call(this, i);
				} else {
					throw new NodeOperationError(this.getNode(), `Unknown resource "${resource}"`, {
						itemIndex: i,
					});
				}

				for (const json of results) {
					returnData.push({ json, pairedItem: { item: i } });
				}
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: { error: (error as Error).message },
						pairedItem: { item: i },
					});
					continue;
				}
				if (error instanceof NodeOperationError) {
					throw error;
				}
				throw new NodeOperationError(this.getNode(), error as Error, { itemIndex: i });
			}
		}

		return [returnData];
	}
}

/** Search method for the entity set resource locator: reads the list from $metadata. */
async function searchEntitySets(
	this: ILoadOptionsFunctions,
	filter?: string,
): Promise<INodeListSearchResult> {
	const metadata = await loadMetadata(this);
	const needle = (filter ?? '').trim().toLowerCase();
	const results = metadata.entitySets
		.filter(
			(set) =>
				!needle ||
				set.name.toLowerCase().includes(needle) ||
				set.kind.toLowerCase().includes(needle),
		)
		.map((set) => ({
			name: `${set.name} (${set.kind})`,
			value: set.name,
		}));

	return { results };
}
