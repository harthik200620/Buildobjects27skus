import { describe, expect, it } from 'vitest';
import {
  arr,
  assertGeminiSchema,
  bool,
  cleanString,
  coerceByDataType,
  enumOf,
  fromSentinel,
  int,
  nullableViaSentinel,
  num,
  obj,
  score,
  str,
} from '../src/schema';

describe('schema helpers', () => {
  it('build the Gemini subset without null unions', () => {
    const s = obj(
      {
        name: str('product'),
        qty: int('count', { minimum: 0 }),
        price: num(),
        ok: bool('flag'),
        kind: enumOf(['a', 'b'], 'k'),
        tags: arr(str(), { maxItems: 3 }),
        conf: score('confidence'),
      },
      { required: ['name', 'qty'] },
    );
    expect(s).toEqual({
      type: 'object',
      properties: {
        name: { type: 'string', description: 'product' },
        qty: { type: 'integer', description: 'count', minimum: 0 },
        price: { type: 'number' },
        ok: { type: 'boolean', description: 'flag' },
        kind: { type: 'string', enum: ['a', 'b'], description: 'k' },
        tags: { type: 'array', items: { type: 'string' }, maxItems: 3 },
        conf: { type: 'number', description: 'confidence (0–1)', minimum: 0, maximum: 1 },
      },
      required: ['name', 'qty'],
    });
    expect(obj({ a: num() }).required).toEqual(['a']);
    expect(obj({ a: num() }, { required: 'none' }).required).toBeUndefined();
    expect(() => assertGeminiSchema(s)).not.toThrow();
    expect(() => assertGeminiSchema(obj({ a: { type: ['number', 'null'] } }))).toThrow(/\$\.a/);
    expect(() => assertGeminiSchema(arr({ type: 'null' }))).toThrow(/\[\]/);
  });

  it('nullableViaSentinel / fromSentinel', () => {
    expect(nullableViaSentinel(num('width'))).toEqual({ type: 'number', description: 'width Use -1 when unknown or not applicable.' });
    expect(nullableViaSentinel(str())).toEqual({ type: 'string', description: 'Use "" when unknown or not applicable.' });
    expect(nullableViaSentinel(int('n'), 0).description).toContain('Use 0 when');
    expect(fromSentinel(-1)).toBeNull();
    expect(fromSentinel(12)).toBe(12);
    expect(fromSentinel('')).toBeNull();
    expect(fromSentinel('x')).toBe('x');
    expect(fromSentinel(0, 0)).toBeNull();
  });

  it('cleanString normalises whitespace, invisible characters and wrapping quotes', () => {
    expect(cleanString('  "OPC 53​ Grade"  ')).toBe('OPC 53 Grade');
    expect(cleanString('“quoted”')).toBe('quoted');
    expect(cleanString('`code`')).toBe('code');
    expect(cleanString('a\n\n  b\t c')).toBe('a b c');
    expect(cleanString(null)).toBe('');
    expect(cleanString(42)).toBe('42');
  });
});

describe('coerceByDataType', () => {
  const number = (unit: string | null = null) => ({ data_type: 'number', unit });
  it('numbers: clean values, units, thousands separators, ranges, text', () => {
    expect(coerceByDataType(number(), 53)).toEqual({ value: 53, confidencePenalty: 0 });
    expect(coerceByDataType(number(), '53')).toEqual({ value: 53, confidencePenalty: 0 });
    expect(coerceByDataType(number('MPa'), '53 MPa')).toEqual({ value: 53, confidencePenalty: 0 });
    expect(coerceByDataType(number('mm'), '1,200 mm')).toEqual({ value: 1200, confidencePenalty: 0 });
    expect(coerceByDataType(number('%'), '95%')).toEqual({ value: 95, confidencePenalty: 0 });
    expect(coerceByDataType(number(), '-2.5')).toEqual({ value: -2.5, confidencePenalty: 0 });
    expect(coerceByDataType(number('MPa'), '43-53')).toMatchObject({ value: 43, confidencePenalty: 0.15 });
    expect(coerceByDataType(number('mm'), '600 x 600')).toMatchObject({ value: 600, confidencePenalty: 0.15 });
    expect(coerceByDataType(number('kg'), 'approx. 2.5 kg')).toMatchObject({ value: 2.5, confidencePenalty: 0.1 });
    expect(coerceByDataType(number('kg'), 'approx. 2.5 kg').note).toContain('expected unit kg');
    expect(coerceByDataType(number(), 'n/a')).toEqual({ value: null, confidencePenalty: 0 });
    expect(coerceByDataType(number(), 'Not specified')).toEqual({ value: null, confidencePenalty: 0 });
    expect(coerceByDataType(number(), 'As per IS')).toMatchObject({ value: null, confidencePenalty: 0 });
    expect(coerceByDataType(number(), 'As per IS').note).toContain('no numeric value');
    expect(coerceByDataType(number(), true)).toMatchObject({ value: null });
    expect(coerceByDataType(number(), Number.NaN)).toMatchObject({ value: null });
    expect(coerceByDataType(number(), null)).toEqual({ value: null, confidencePenalty: 0 });
  });

  it('booleans: exact tokens, negations, affirmative phrases, unknowns', () => {
    const b = { data_type: 'boolean' };
    expect(coerceByDataType(b, true)).toEqual({ value: true, confidencePenalty: 0 });
    expect(coerceByDataType(b, 'Yes')).toEqual({ value: true, confidencePenalty: 0 });
    expect(coerceByDataType(b, 'no')).toEqual({ value: false, confidencePenalty: 0 });
    expect(coerceByDataType(b, 1)).toEqual({ value: true, confidencePenalty: 0 });
    expect(coerceByDataType(b, 0)).toEqual({ value: false, confidencePenalty: 0 });
    expect(coerceByDataType(b, 'Yes (optional)')).toMatchObject({ value: true, confidencePenalty: 0.1 });
    expect(coerceByDataType(b, 'ISI marked')).toMatchObject({ value: true, confidencePenalty: 0.1 });
    expect(coerceByDataType(b, 'Not ISI marked')).toMatchObject({ value: false, confidencePenalty: 0.1 });
    expect(coerceByDataType(b, 'Not available')).toEqual({ value: null, confidencePenalty: 0 });
    expect(coerceByDataType(b, 'Optional')).toMatchObject({ value: null });
    expect(coerceByDataType(b, 'Optional').note).toContain('unrecognised boolean');
    expect(coerceByDataType(b, 3)).toMatchObject({ value: null });
  });

  it('enums: exact, case-insensitive, fuzzy, token and multi-token matches, rejects', () => {
    const e = { data_type: 'enum', enum_values: ['OPC', 'PPC', 'PSC'] };
    expect(coerceByDataType(e, 'PPC')).toEqual({ value: 'PPC', confidencePenalty: 0 });
    expect(coerceByDataType(e, 'ppc')).toEqual({ value: 'PPC', confidencePenalty: 0 });
    expect(coerceByDataType(e, 'OPC 53 Grade')).toMatchObject({ value: 'OPC', confidencePenalty: 0.1 });
    expect(coerceByDataType(e, 'OPC/PPC')).toMatchObject({ value: 'OPC', confidencePenalty: 0.25 });
    expect(coerceByDataType(e, 'OPC/PPC').note).toContain('PPC');
    expect(coerceByDataType(e, 'White cement')).toMatchObject({ value: null, confidencePenalty: 0 });
    expect(coerceByDataType(e, 'White cement').note).toContain('OPC | PPC | PSC');
    expect(coerceByDataType({ data_type: 'enum', enum_values: ['Mono PERC', 'TOPCon'] }, 'Mono-PERC')).toMatchObject({
      value: 'Mono PERC',
      confidencePenalty: 0.05,
    });
    expect(coerceByDataType({ data_type: 'enum', enum_values: ['B22', 'E27'] }, 'B22 bayonet')).toMatchObject({ value: 'B22', confidencePenalty: 0.1 });
    expect(coerceByDataType({ data_type: 'enum', enum_values: ['IP65', 'IP66'] }, 'IP665')).toMatchObject({ value: null });
    expect(coerceByDataType({ data_type: 'enum' }, 'free text')).toEqual({ value: 'free text', confidencePenalty: 0 });
  });

  it('text: cleans, truncates, stringifies', () => {
    const t = { data_type: 'text' };
    expect(coerceByDataType(t, '  "Portland Pozzolana"  ')).toEqual({ value: 'Portland Pozzolana', confidencePenalty: 0 });
    expect(coerceByDataType(t, 53)).toEqual({ value: '53', confidencePenalty: 0 });
    const long = coerceByDataType(t, 'x'.repeat(600));
    expect((long.value as string).length).toBe(512);
    expect(long).toMatchObject({ confidencePenalty: 0.05 });
    expect(coerceByDataType(t, '')).toEqual({ value: null, confidencePenalty: 0 });
  });
});
