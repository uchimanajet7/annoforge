import assert from 'node:assert/strict';

// AnnoForgeの出力契約で使うJSON Schemaキーワードだけを検査するテスト用ヘルパー。
// 未対応のキーワードを黙って無視せず、契約を拡張した際に検査の更新を要求する。
const keywords = new Set(['type', 'const', 'enum', 'oneOf', 'properties', 'required',
  'additionalProperties', 'items', 'minimum', 'maximum', 'minLength', 'maxLength', 'pattern', 'minItems']);

export function assertOutputSchema(schema, value, path = '$') {
  for (const key of Object.keys(schema)) {
    if (!keywords.has(key)) throw new TypeError(`未対応のスキーマキーワード: ${key}`);
  }
  if (schema.oneOf) {
    const matches = schema.oneOf.filter(branch => {
      try { assertOutputSchema(branch, value, path); return true; }
      catch (error) {
        if (!(error instanceof assert.AssertionError)) throw error;
        return false;
      }
    });
    assert.equal(matches.length, 1, `${path}: oneOf`);
  }
  if (Object.hasOwn(schema, 'const')) assert.deepEqual(value, schema.const, `${path}: const`);
  if (schema.enum) assert.ok(schema.enum.includes(value), `${path}: enum`);
  if (schema.type) {
    const types = {
      object: value !== null && typeof value === 'object' && !Array.isArray(value),
      array: Array.isArray(value), integer: Number.isInteger(value),
      number: typeof value === 'number' && Number.isFinite(value),
      string: typeof value === 'string', boolean: typeof value === 'boolean', null: value === null
    };
    assert.equal(types[schema.type], true, `${path}: ${schema.type}`);
  }
  if (schema.properties) {
    for (const key of schema.required || []) assert.ok(Object.hasOwn(value, key), `${path}.${key}: required`);
    for (const [key, item] of Object.entries(value)) {
      if (schema.additionalProperties === false) assert.ok(Object.hasOwn(schema.properties, key), `${path}.${key}: additionalProperties`);
      if (schema.properties[key]) assertOutputSchema(schema.properties[key], item, `${path}.${key}`);
    }
  }
  if (schema.items) value.forEach((item, index) => assertOutputSchema(schema.items, item, `${path}[${index}]`));
  if (schema.minimum !== undefined) assert.ok(value >= schema.minimum, `${path}: minimum`);
  if (schema.maximum !== undefined) assert.ok(value <= schema.maximum, `${path}: maximum`);
  if (schema.minLength !== undefined) assert.ok([...value].length >= schema.minLength, `${path}: minLength`);
  if (schema.maxLength !== undefined) assert.ok([...value].length <= schema.maxLength, `${path}: maxLength`);
  if (schema.pattern) assert.match(value, new RegExp(schema.pattern), `${path}: pattern`);
  if (schema.minItems !== undefined) assert.ok(value.length >= schema.minItems, `${path}: minItems`);
}
