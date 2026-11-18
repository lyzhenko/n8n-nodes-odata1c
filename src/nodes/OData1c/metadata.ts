export interface ODataProperty {
	name: string;
	type: string;
	nullable: boolean;
	key: boolean;
}

export interface ODataNavigationProperty {
	name: string;
	relationship: string;
	fromRole?: string;
	toRole?: string;
}

export interface ODataEntityType {
	name: string;
	properties: ODataProperty[];
	navigationProperties: ODataNavigationProperty[];
}

export interface ODataEntitySet {
	name: string;
	entityType: string;
	kind: string;
}

export interface ODataMetadata {
	entitySets: ODataEntitySet[];
	entityTypes: Map<string, ODataEntityType>;
}

/** `Catalog_`, `Document_`, `InformationRegister_`, ... prefixes used by 1C:Enterprise. */
const KIND_PREFIXES: Array<[string, string]> = [
	['Catalog_', 'Catalog'],
	['Document_', 'Document'],
	['DocumentJournal_', 'DocumentJournal'],
	['Constant_', 'Constant'],
	['ExchangePlan_', 'ExchangePlan'],
	['ChartOfAccounts_', 'ChartOfAccounts'],
	['ChartOfCalculationTypes_', 'ChartOfCalculationTypes'],
	['ChartOfCharacteristicTypes_', 'ChartOfCharacteristicTypes'],
	['InformationRegister_', 'InformationRegister'],
	['AccumulationRegister_', 'AccumulationRegister'],
	['AccountingRegister_', 'AccountingRegister'],
	['CalculationRegister_', 'CalculationRegister'],
	['BusinessProcess_', 'BusinessProcess'],
	['Task_', 'Task'],
	['Enum_', 'Enum'],
	['Sequence_', 'Sequence'],
	['FilterCriterion_', 'FilterCriterion'],
	['SettingsStorage_', 'SettingsStorage'],
];

/** Detects the 1C metadata kind encoded in an entity set name. */
export function entityKind(entitySetName: string): string {
	for (const [prefix, kind] of KIND_PREFIXES) {
		if (entitySetName.startsWith(prefix) && entitySetName.length > prefix.length) {
			return kind;
		}
	}
	return 'Unknown';
}

function decodeEntities(value: string): string {
	if (!value.includes('&')) {
		return value;
	}
	return value
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
		.replace(/&amp;/g, '&');
}

const ATTRIBUTE_RE = /([^\s=/]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

/** Parses the attributes of one opening tag: ` Name="X" Type="Edm.Guid"`. */
function parseAttributes(raw: string): Record<string, string> {
	const attributes: Record<string, string> = {};
	ATTRIBUTE_RE.lastIndex = 0;
	let match: RegExpExecArray | null;
	while ((match = ATTRIBUTE_RE.exec(raw)) !== null) {
		attributes[match[1]] = decodeEntities(match[2] ?? match[3] ?? '');
	}
	return attributes;
}

function stripNamespace(typeName: string): string {
	const dot = typeName.lastIndexOf('.');
	return dot === -1 ? typeName : typeName.slice(dot + 1);
}

/**
 * Reads only the entity sets of an EDMX document.
 *
 * The `<EntityType>` blocks carry every field of every object and make up almost the
 * whole document (an ERP 2.5 `$metadata` is about 20 MB), while a resource locator
 * list needs the set names alone. Scanning only `<EntitySet>` tags keeps this in the
 * low milliseconds, which matters because n8n calls the search method on every
 * keystroke in the dropdown.
 */
export function parseEntitySets(xml: string): ODataEntitySet[] {
	const entitySets: ODataEntitySet[] = [];
	const entitySetRe = /<EntitySet\b([^>]*?)\/?>/g;
	let entitySetMatch: RegExpExecArray | null;
	while ((entitySetMatch = entitySetRe.exec(xml)) !== null) {
		const attributes = parseAttributes(entitySetMatch[1]);
		const name = attributes.Name ?? '';
		if (!name) {
			continue;
		}
		entitySets.push({
			name,
			entityType: stripNamespace(attributes.EntityType ?? ''),
			kind: entityKind(name),
		});
	}

	entitySets.sort((left, right) => left.name.localeCompare(right.name));

	return entitySets;
}

/**
 * Parses the EDMX document returned by `$metadata`.
 *
 * The document is machine-generated and can be tens of megabytes for a real ERP
 * infobase (an ERP 2.5 `$metadata` is about 20 MB with 3,500 entity sets), so it is
 * scanned with narrow tag patterns instead of a general XML parser: this keeps the
 * node's memory footprint small and parsing well below a second.
 */
export function parseMetadata(xml: string): ODataMetadata {
	const entityTypes = new Map<string, ODataEntityType>();

	const entityTypeRe = /<EntityType\b([^>]*?)>([\s\S]*?)<\/EntityType>/g;
	let entityTypeMatch: RegExpExecArray | null;
	while ((entityTypeMatch = entityTypeRe.exec(xml)) !== null) {
		const attributes = parseAttributes(entityTypeMatch[1]);
		const name = attributes.Name ?? '';
		if (!name) {
			continue;
		}
		const block = entityTypeMatch[2];

		const keyNames = new Set<string>();
		const keyBlock = /<Key\b[^>]*>([\s\S]*?)<\/Key>/.exec(block);
		if (keyBlock) {
			const propertyRefRe = /<PropertyRef\b([^>]*?)\/?>/g;
			let propertyRefMatch: RegExpExecArray | null;
			while ((propertyRefMatch = propertyRefRe.exec(keyBlock[1])) !== null) {
				const keyName = parseAttributes(propertyRefMatch[1]).Name;
				if (keyName) {
					keyNames.add(keyName);
				}
			}
		}

		const properties: ODataProperty[] = [];
		const propertyRe = /<Property\b([^>]*?)\/?>/g;
		let propertyMatch: RegExpExecArray | null;
		while ((propertyMatch = propertyRe.exec(block)) !== null) {
			const propertyAttributes = parseAttributes(propertyMatch[1]);
			const propertyName = propertyAttributes.Name ?? '';
			if (!propertyName) {
				continue;
			}
			properties.push({
				name: propertyName,
				type: propertyAttributes.Type ?? '',
				nullable: (propertyAttributes.Nullable ?? 'true').toLowerCase() !== 'false',
				key: keyNames.size > 0 ? keyNames.has(propertyName) : propertyName === 'Ref_Key',
			});
		}

		const navigationProperties: ODataNavigationProperty[] = [];
		const navigationRe = /<NavigationProperty\b([^>]*?)\/?>/g;
		let navigationMatch: RegExpExecArray | null;
		while ((navigationMatch = navigationRe.exec(block)) !== null) {
			const navigationAttributes = parseAttributes(navigationMatch[1]);
			const navigationName = navigationAttributes.Name ?? '';
			if (!navigationName) {
				continue;
			}
			navigationProperties.push({
				name: navigationName,
				relationship: navigationAttributes.Relationship ?? '',
				fromRole: navigationAttributes.FromRole,
				toRole: navigationAttributes.ToRole,
			});
		}

		entityTypes.set(name, { name, properties, navigationProperties });
	}

	return { entitySets: parseEntitySets(xml), entityTypes };
}

/** Finds a published entity set by its exact name (case-insensitive). */
export function findEntitySet(
	metadata: ODataMetadata,
	name: string,
): ODataEntitySet | undefined {
	const exact = metadata.entitySets.find((set) => set.name === name);
	if (exact) {
		return exact;
	}
	const lower = name.toLowerCase();
	return metadata.entitySets.find((set) => set.name.toLowerCase() === lower);
}

/** Returns the field list of an entity set, or an empty array when it is unknown. */
export function entityFields(metadata: ODataMetadata, entitySetName: string): ODataProperty[] {
	const entitySet = findEntitySet(metadata, entitySetName);
	if (!entitySet) {
		return [];
	}
	return metadata.entityTypes.get(entitySet.entityType)?.properties ?? [];
}

/** Navigation properties (reference fields and tabular sections) of an entity set. */
export function entityNavigationProperties(
	metadata: ODataMetadata,
	entitySetName: string,
): ODataNavigationProperty[] {
	const entitySet = findEntitySet(metadata, entitySetName);
	if (!entitySet) {
		return [];
	}
	return metadata.entityTypes.get(entitySet.entityType)?.navigationProperties ?? [];
}
