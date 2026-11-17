import type { INodeProperties } from 'n8n-workflow';

const METADATA_SHOW = { resource: ['metadata'] };

export const metadataDescription: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: METADATA_SHOW },
		options: [
			{
				name: 'Get Entity Sets',
				value: 'list',
				description: 'List the entity sets published in the OData interface',
				action: 'List entity sets',
			},
			{
				name: 'Get Fields',
				value: 'fields',
				description: 'List the fields and navigation properties of one entity set',
				action: 'Get entity set fields',
			},
			{
				name: 'Get Raw $metadata',
				value: 'raw',
				description: 'Return the whole EDMX document as XML',
				action: 'Get raw metadata',
			},
		],
		default: 'list',
	},
	{
		displayName: 'Entity Set',
		name: 'metadataEntitySet',
		type: 'resourceLocator',
		default: { mode: 'list', value: '' },
		required: true,
		displayOptions: { show: { ...METADATA_SHOW, operation: ['fields'] } },
		description: 'Entity set whose fields should be listed',
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
	{
		displayName: 'Name Filter',
		name: 'nameFilter',
		type: 'string',
		default: '',
		displayOptions: { show: { ...METADATA_SHOW, operation: ['list'] } },
		placeholder: 'Catalog_',
		description: 'Only return entity sets whose name or kind contains this text',
	},
	{
		displayName:
			'The metadata document can be several megabytes for a large infobase. Prefer <b>Get Entity Sets</b> and <b>Get Fields</b>: they return compact JSON.',
		name: 'metadataHint',
		type: 'notice',
		default: '',
		displayOptions: { show: { ...METADATA_SHOW, operation: ['raw'] } },
	},
];
