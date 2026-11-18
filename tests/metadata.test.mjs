import assert from 'node:assert/strict';
import { test } from 'node:test';

import { require } from './helpers.mjs';

const {
	parseMetadata,
	parseEntitySets,
	entityKind,
	findEntitySet,
	entityFields,
	entityNavigationProperties,
} = require('../dist/nodes/OData1c/metadata.js');

const EDMX = `<?xml version="1.0" encoding="utf-8"?>
<edmx:Edmx Version="1.0" xmlns:edmx="http://schemas.microsoft.com/ado/2007/06/edmx">
  <edmx:DataServices m:DataServiceVersion="3.0" xmlns:m="http://schemas.microsoft.com/ado/2007/08/dataservices/metadata">
    <Schema Namespace="StandardODATA" xmlns="http://schemas.microsoft.com/ado/2008/09/edm">
      <EntityType Name="Catalog_Номенклатура">
        <Key><PropertyRef Name="Ref_Key"/></Key>
        <Property Name="Ref_Key" Type="Edm.Guid" Nullable="false"/>
        <Property Name="DeletionMark" Type="Edm.Boolean" Nullable="false"/>
        <Property Name="Description" Type="Edm.String" Nullable="true"/>
        <Property Name="Цена" Type="Edm.Double" Nullable="true"/>
        <NavigationProperty Name="ЕдиницаИзмерения" Relationship="StandardODATA.Catalog_Номенклатура_ЕдиницаИзмерения" FromRole="Catalog_Номенклатура" ToRole="ЕдиницаИзмерения"/>
      </EntityType>
      <EntityType Name="Document_ЗаказКлиента">
        <Property Name="Ref_Key" Type="Edm.Guid" Nullable="false"/>
        <Property Name="Date" Type="Edm.DateTime" Nullable="false"/>
      </EntityType>
      <EntityContainer Name="StandardODATA" m:IsDefaultEntityContainer="true">
        <EntitySet Name="Catalog_Номенклатура" EntityType="StandardODATA.Catalog_Номенклатура"/>
        <EntitySet Name="Document_ЗаказКлиента" EntityType="StandardODATA.Document_ЗаказКлиента"/>
      </EntityContainer>
    </Schema>
  </edmx:DataServices>
</edmx:Edmx>`;

test('detects 1C metadata kinds from entity set names', () => {
	assert.equal(entityKind('Catalog_Номенклатура'), 'Catalog');
	assert.equal(entityKind('Document_ЗаказКлиента'), 'Document');
	assert.equal(entityKind('InformationRegister_ЦеныНоменклатуры'), 'InformationRegister');
	assert.equal(entityKind('AccumulationRegister_ТоварыНаСкладах'), 'AccumulationRegister');
	assert.equal(entityKind('Constant_Настройка'), 'Constant');
	assert.equal(entityKind('Enum_Статусы'), 'Enum');
	assert.equal(entityKind('Catalog_X_Y'), 'Catalog');
	assert.equal(entityKind('Something_Else'), 'Unknown');
});

test('parses entity sets and entity types from EDMX', () => {
	const metadata = parseMetadata(EDMX);
	assert.deepEqual(
		metadata.entitySets.map((set) => set.name),
		['Catalog_Номенклатура', 'Document_ЗаказКлиента'],
	);
	assert.equal(metadata.entitySets[0].entityType, 'Catalog_Номенклатура');
	assert.equal(metadata.entitySets[0].kind, 'Catalog');

	const type = metadata.entityTypes.get('Catalog_Номенклатура');
	assert.ok(type);
	assert.deepEqual(
		type.properties.map((property) => property.name),
		['Ref_Key', 'DeletionMark', 'Description', 'Цена'],
	);
	assert.equal(type.properties[0].key, true);
	assert.equal(type.properties[1].nullable, false);
	assert.equal(type.properties[2].nullable, true);
	assert.equal(type.navigationProperties[0].name, 'ЕдиницаИзмерения');
});

test('finds entity sets case-insensitively and returns fields', () => {
	const metadata = parseMetadata(EDMX);
	assert.ok(findEntitySet(metadata, 'catalog_номенклатура'));
	const fields = entityFields(metadata, 'Catalog_Номенклатура');
	assert.deepEqual(
		fields.map((field) => field.name),
		['Ref_Key', 'DeletionMark', 'Description', 'Цена'],
	);
	assert.deepEqual(entityFields(metadata, 'Catalog_Unknown'), []);
	assert.equal(
		entityNavigationProperties(metadata, 'Catalog_Номенклатура')[0].name,
		'ЕдиницаИзмерения',
	);
});

test('entity without a Key element falls back to Ref_Key', () => {
	const metadata = parseMetadata(EDMX);
	const document = metadata.entityTypes.get('Document_ЗаказКлиента');
	assert.equal(document.properties[0].key, true);
	assert.equal(document.properties[1].key, false);
});

test('parses a document without a namespace prefix', () => {
	const metadata = parseMetadata(
		'<Edmx><DataServices><Schema Namespace="S"><EntityType Name="Catalog_A"><Property Name="Ref_Key" Type="Edm.Guid"/></EntityType><EntityContainer><EntitySet Name="Catalog_A" EntityType="Catalog_A"/></EntityContainer></Schema></DataServices></Edmx>',
	);
	assert.equal(metadata.entitySets.length, 1);
	assert.equal(metadata.entitySets[0].entityType, 'Catalog_A');
});

test('reads only the entity sets when the fields are not needed', () => {
	const entitySets = parseEntitySets(EDMX);
	assert.deepEqual(
		entitySets.map((set) => `${set.name}:${set.kind}`),
		['Catalog_Номенклатура:Catalog', 'Document_ЗаказКлиента:Document'],
	);
	// Same result as the full parse, which the dropdown relies on.
	assert.deepEqual(entitySets, parseMetadata(EDMX).entitySets);
});
