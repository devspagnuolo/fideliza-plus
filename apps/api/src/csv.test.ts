import { describe, expect, it } from 'vitest';
import { parseCsv } from './csv.js';

describe('CSV', () => {
  it('aceita campos entre aspas e vírgulas', () => {
    expect(parseCsv('name,email\n"Souza, Ana",ana@example.com')).toEqual([
      { name: 'Souza, Ana', email: 'ana@example.com' }
    ]);
  });
});
