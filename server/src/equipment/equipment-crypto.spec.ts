import { decryptSecret, encryptSecret, secretHint, secretsKey } from './equipment-crypto';

describe('equipment-crypto', () => {
  const key = secretsKey({ LANATLAS_SECRET_KEY: 'una-clau-prou-llarga-per-provar' } as NodeJS.ProcessEnv)!;

  it('sense variable (o massa curta) no hi ha clau', () => {
    expect(secretsKey({} as NodeJS.ProcessEnv)).toBeNull();
    expect(secretsKey({ LANATLAS_SECRET_KEY: 'curta' } as NodeJS.ProcessEnv)).toBeNull();
  });

  it('xifra i desxifra; cada xifrat és diferent', () => {
    const a = encryptSecret('XXXX-123', key);
    const b = encryptSecret('XXXX-123', key);
    expect(a).not.toBe(b);
    expect(a.startsWith('v1:')).toBe(true);
    expect(a).not.toContain('123');
    expect(decryptSecret(a, key)).toBe('XXXX-123');
  });

  it('amb una altra clau o un text manipulat no retorna res', () => {
    const other = secretsKey({ LANATLAS_SECRET_KEY: 'una-altra-clau-diferent-del-tot' } as NodeJS.ProcessEnv)!;
    const stored = encryptSecret('secret', key);
    expect(decryptSecret(stored, other)).toBeNull();
    const parts = stored.split(':');
    parts[3] = Buffer.from('altre').toString('base64');
    expect(decryptSecret(parts.join(':'), key)).toBeNull();
    expect(decryptSecret('brossa', key)).toBeNull();
  });

  it('pista dels 3 últims caràcters només per a claus llargues', () => {
    expect(secretHint('ABCD-EFGH-J123')).toBe('123');
    expect(secretHint('1234')).toBeNull();
  });
});
