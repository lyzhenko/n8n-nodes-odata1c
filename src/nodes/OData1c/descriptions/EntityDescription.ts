import type { INodeProperties } from 'n8n-workflow';

const ENTITY_SET_SHOW = { resource: ['entity'] };

const GET_ONE_SHOW = { ...ENTITY_SET_SHOW, operation: ['getOne'] };
const GET_MANY_SHOW = { ...ENTITY_SET_SHOW, operation: ['getMany'] };
const CREATE_SHOW = { ...ENTITY_SET_SHOW, operation: ['create'] };
const UPDATE_SHOW = { ...ENTITY_SET_SHOW, operation: ['update'] };
const DELETE_SHOW = { ...ENTITY_SET_SHOW, operation: ['delete'] };
const COUNT_SHOW = { ...ENTITY_SET_SHOW, operation: ['count'] };
const POSTING_SHOW = { ...ENTITY_SET_SHOW, operation: ['posting'] };

const WRITE_SHOW = { ...ENTITY_SET_SHOW, operation: ['create', 'update', 'delete', 'posting'] };

const FILTER_DESCRIPTION =
	'<a href="https://github.com/lyzhenko/n8n-nodes-odata1c#filters" target="_blank">OData 3.0 filter</a> expression, for example <code>DeletionMark eq false and Description eq \'Cable\'</code>. Use <code>like(Description,\'%cab%\')</code> for substring search, <code>guid\'…\'</code> for references and <code>datetime\'2024-01-31T00:00:00\'</code> for dates.';

export const entityDescription: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: ENTITY_SET_SHOW },
		options: [
			{
				name: 'Create',
				value: 'create',
				description: 'Create a catalog item, document or register record',
				action: 'Create an entity',
			},
			{
				name: 'Count',
				value: 'count',
				description: 'Count entities that match a filter',
				action: 'Count entities',
			},
			{
				name: 'Delete',
				value: 'delete',
				description: 'Delete an entity by its Ref_Key',
				action: 'Delete an entity',
			},
			{
				name: 'Get Many',
				value: 'getMany',
				description: 'Read a page or all entities of a set',
				action: 'Get many entities',
			},
			{
				name: 'Get One',
				value: 'getOne',
				description: 'Read a single entity by its Ref_Key',
				action: 'Get an entity',
			},
			{
				name: 'Post / Unpost',
				value: 'posting',
				description: 'Post or unpost a document',
				action: 'Change document posting',
			},
			{
				name: 'Update',
				value: 'update',
				description: 'Patch fields of an existing entity',
				action: 'Update an entity',
			},
		],
		default: 'getMany',
	},
	{
		displayName: 'Entity Set',
		name: 'entitySet',
		type: 'resourceLocator',
		default: { mode: 'list', value: '' },
		required: true,
		displayOptions: { show: ENTITY_SET_SHOW },
		description:
			'Entity set published in the standard OData interface, for example Catalog_Номенклатура or Document_ЗаказПокупателя. The list is read from $metadata.',
		modes: [
			{
				displayName: 'From List',
				name: 'list',
				type: 'list',
				placeholder: 'Select an entity set…',
				typeOptions: {
					searchListMethod: 'searchEntitySets',
					searchable: true,
				},
			},
			{
				displayName: 'By Name',
				name: 'name',
				type: 'string',
				placeholder: 'Catalog_Номенклатура',
			},
		],
	},

	// ------------------------------------------------------------------ getMany
	{
		displayName: 'Filter',
		name: 'filter',
		type: 'string',
		default: '',
		displayOptions: { show: GET_MANY_SHOW },
		description: FILTER_DESCRIPTION,
		placeholder: "DeletionMark eq false and Description eq 'Cable'",
	},
	{
		displayName: 'Sort',
		name: 'orderBy',
		type: 'string',
		default: '',
		displayOptions: { show: GET_MANY_SHOW },
		placeholder: 'Date desc',
		description:
			'OData $orderby expression. When reading more than one page, add a unique field such as Ref_Key to keep paging stable.',
	},
	{
		displayName: 'Select Fields',
		name: 'select',
		type: 'string',
		default: '',
		displayOptions: { show: { ...ENTITY_SET_SHOW, operation: ['getMany', 'getOne'] } },
		placeholder: 'Ref_Key,Code,Description',
		description:
			'Comma-separated field names for $select. Leave empty to return all fields; use the Metadata resource to list them.',
	},
	{
		displayName: 'Expand',
		name: 'expand',
		type: 'string',
		default: '',
		displayOptions: { show: GET_MANY_SHOW },
		placeholder: 'Контрагент,Товары',
		description:
			'Comma-separated navigation properties for $expand, for example a reference field or a tabular section. 1C supports $expand only for collection requests.',
	},
	{
		displayName: 'Return All',
		name: 'returnAll',
		type: 'boolean',
		default: true,
		displayOptions: { show: GET_MANY_SHOW },
		description: 'Whether to return all results or only up to a given limit',
	},
	{
		displayName: 'Limit',
		name: 'limit',
		type: 'number',
		default: 50,
		typeOptions: { minValue: 1 },
		displayOptions: { show: { ...GET_MANY_SHOW, returnAll: [false] } },
		description: 'Max number of results to return',
	},
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: { show: { ...ENTITY_SET_SHOW, operation: ['getMany'] } },
		options: [
			{
				displayName: 'Page Size',
				name: 'pageSize',
				type: 'number',
				default: 100,
				typeOptions: { minValue: 1, maxValue: 1000 },
				description: 'Number of entities requested per HTTP call while paging',
			},
			{
				displayName: 'Timeout (ms)',
				name: 'timeout',
				type: 'number',
				default: 0,
				description: 'Overrides the timeout from the credential for this node',
			},
		],
	},

	// ------------------------------------------------------------------- getOne
	{
		displayName: 'Ref Key',
		name: 'refKey',
		type: 'string',
		default: '',
		required: true,
		displayOptions: { show: GET_ONE_SHOW },
		placeholder: '3f1c9b7e-9d2a-11ee-8f3a-00155d0a1b2c',
		description:
			'GUID of the entity (the Ref_Key field). The value guid\'…\' and a full Catalog_X(guid\'…\') reference are accepted as well.',
	},

	// -------------------------------------------------------------------- count
	{
		displayName: 'Filter',
		name: 'filter',
		type: 'string',
		default: '',
		displayOptions: { show: COUNT_SHOW },
		description: FILTER_DESCRIPTION,
		placeholder: "DeletionMark eq false",
	},

	// ------------------------------------------------------------------- create
	{
		displayName: 'Fields (JSON)',
		name: 'fields',
		type: 'json',
		default: '',
		displayOptions: { show: CREATE_SHOW },
		description:
			'Entity fields as a JSON object. Reference fields are passed as FieldName_Key with a GUID, tabular sections as an array of row objects.',
		placeholder:
			'{\n  "Description": "Cable 3x2.5",\n  "Артикул": "CBL-325",\n  "ЕдиницаИзмерения_Key": "…"\n}',
	},
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: { show: WRITE_SHOW },
		options: [
			{
				displayName: 'Data Load Mode',
				name: 'dataLoadMode',
				type: 'boolean',
				default: false,
				description:
					'Whether to send the 1C_OData-DataLoadMode header so 1C handles the write as a data exchange (fewer user checks)',
			},
			{
				displayName: 'Optimistic Lock (If-Match)',
				name: 'ifMatch',
				type: 'boolean',
				default: false,
				displayOptions: { show: { '/operation': ['update'] } },
				description:
					'Whether to send If-Match with the current DataVersion, so the update fails with HTTP 412 when the entity was changed in the meantime',
			},
			{
				displayName: 'Timeout (ms)',
				name: 'timeout',
				type: 'number',
				default: 0,
				description: 'Overrides the timeout from the credential for this node',
			},
		],
	},

	// ------------------------------------------------- update / delete / posting
	{
		displayName: 'Ref Key',
		name: 'refKey',
		type: 'string',
		default: '',
		required: true,
		displayOptions: {
			show: { resource: ['entity'], operation: ['update', 'delete', 'posting'] },
		},
		placeholder: '3f1c9b7e-9d2a-11ee-8f3a-00155d0a1b2c',
		description: 'GUID of the entity to change',
	},

	// ------------------------------------------------------------------- update
	{
		displayName: 'Fields (JSON)',
		name: 'fields',
		type: 'json',
		default: '',
		displayOptions: { show: UPDATE_SHOW },
		description: 'Fields to change as a JSON object. Only the listed fields are sent (HTTP PATCH).',
		placeholder: '{\n  "Артикул": "CBL-325-NEW"\n}',
	},

	// ------------------------------------------------------------------- posting
	{
		displayName: 'Action',
		name: 'postingAction',
		type: 'options',
		options: [
			{ name: 'Post', value: 'post', description: 'Post the document' },
			{ name: 'Unpost', value: 'unpost', description: 'Unpost the document' },
		],
		default: 'post',
		displayOptions: { show: POSTING_SHOW },
		description: 'Whether to post or unpost the document',
	},

	// --------------------------------------------------------------------- hints
	{
		displayName:
			'Field names and entity set names come from the infobase metadata. Use the <b>Metadata</b> resource to list entity sets and their fields.',
		name: 'entityHint',
		type: 'notice',
		default: '',
		displayOptions: { show: ENTITY_SET_SHOW },
	},
];

