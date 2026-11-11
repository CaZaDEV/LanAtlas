import {
  checkLabel,
  cleanRanges,
  computeAlerts,
  daysUntil,
  dhcpRangeOf,
  equipmentNetState,
  cleanManagedRanges,
  localDay,
  managedRangeOf,
  parseRange,
  rangeSize,
  nextCheckState,
  normalizeHost,
  normalizeIpv4,
  normalizeMac,
  normalizeMonth,
  privateIpv4,
  type SnapshotEquipment,
} from './equipment.rules';

const RANGES = [
  { from: '192.168.1.151', to: '192.168.1.199' },
  { from: '192.168.1.213', to: '192.168.1.254' },
];

function equip(partial: Partial<SnapshotEquipment> & { id: string }): SnapshotEquipment {
  return { name: partial.id, critical: false, status: 'ACTIVE', addresses: [], checks: [], ...partial };
}

describe('equipment.rules · adreces', () => {
  it('normalitza IPs amb zeros a l’esquerra i rebutja les invàlides', () => {
    expect(normalizeIpv4('192.168.1.013')).toBe('192.168.1.13');
    expect(normalizeIpv4(' 192.168.1.211 ')).toBe('192.168.1.211');
    expect(normalizeIpv4('192.168.1.256')).toBeNull();
    expect(normalizeIpv4('192.168.1')).toBeNull();
    expect(normalizeIpv4('VARIABLE')).toBeNull();
  });

  it('accepta noms de host però no res que sembli una opció', () => {
    expect(normalizeHost('ServerSage')).toBe('serversage');
    expect(normalizeHost('nas.local')).toBe('nas.local');
    expect(normalizeHost('-c 100 192.168.1.1')).toBeNull();
    expect(normalizeHost('a b')).toBeNull();
    expect(normalizeHost('192.168.1.999')).toBeNull();
  });

  it('detecta si una IP és dins d’un rang DHCP', () => {
    expect(dhcpRangeOf('192.168.1.161', RANGES)).toEqual(RANGES[0]);
    expect(dhcpRangeOf('192.168.1.150', RANGES)).toBeNull();
    expect(dhcpRangeOf('192.168.1.254', RANGES)).toEqual(RANGES[1]);
    expect(dhcpRangeOf('192.168.1.212', RANGES)).toBeNull();
  });

  it('neteja els rangs guardats', () => {
    expect(cleanRanges([{ from: ' 192.168.1.151', to: '192.168.001.199' }, { from: 'x', to: '1.1.1.1' }, null])).toEqual([
      { from: '192.168.1.151', to: '192.168.1.199' },
    ]);
    expect(cleanRanges('no')).toEqual([]);
  });

  it('normalitza MAC i mes d’adquisició', () => {
    expect(normalizeMac('aa-bb-cc-dd-ee-0f')).toBe('AA:BB:CC:DD:EE:0F');
    expect(normalizeMac('123')).toBeNull();
    expect(normalizeMonth('06-2026')).toBe('2026-06');
    expect(normalizeMonth('2016-5')).toBe('2016-05');
    expect(normalizeMonth('2022')).toBe('2022');
    expect(normalizeMonth('13-2020')).toBeNull();
  });
});

describe('equipment.rules · estat de les proves', () => {
  it('cau després de N fallades seguides i torna amb el primer OK', () => {
    let state = { state: 'UP' as const, consecutiveFails: 0 } as { state: 'UNKNOWN' | 'UP' | 'DOWN'; consecutiveFails: number };
    state = nextCheckState(state, false, 3);
    expect(state.state).toBe('UP');
    state = nextCheckState(state, false, 3);
    expect(state.state).toBe('UP');
    const third = nextCheckState(state, false, 3);
    expect(third).toEqual({ state: 'DOWN', consecutiveFails: 3, changed: true });
    const again = nextCheckState(third, false, 3);
    expect(again.changed).toBe(false);
    expect(nextCheckState(again, true, 3)).toEqual({ state: 'UP', consecutiveFails: 0, changed: true });
  });

  it('una prova nova queda desconeguda fins que arriba al llindar', () => {
    expect(nextCheckState({ state: 'UNKNOWN', consecutiveFails: 0 }, false, 2).state).toBe('UNKNOWN');
    expect(nextCheckState({ state: 'UNKNOWN', consecutiveFails: 1 }, false, 2).state).toBe('DOWN');
    expect(nextCheckState({ state: 'UNKNOWN', consecutiveFails: 0 }, true, 2).state).toBe('UP');
  });

  it('estat de xarxa de l’equip', () => {
    expect(equipmentNetState([])).toBe('NONE');
    expect(equipmentNetState([{ enabled: false, state: 'DOWN' }])).toBe('NONE');
    expect(equipmentNetState([{ enabled: true, state: 'UP' }, { enabled: true, state: 'DOWN' }])).toBe('DOWN');
    expect(equipmentNetState([{ enabled: true, state: 'UP' }, { enabled: true, state: 'UNKNOWN' }])).toBe('UNKNOWN');
    expect(equipmentNetState([{ enabled: true, state: 'UP' }])).toBe('UP');
  });

  it('dies i dia local', () => {
    expect(daysUntil(new Date('2026-12-09T00:00:00Z'), new Date('2026-11-09T18:00:00Z'))).toBe(30);
    expect(daysUntil(new Date('2026-11-08T00:00:00Z'), new Date('2026-11-09T10:00:00Z'))).toBe(-1);
    expect(localDay(new Date('2026-11-09T23:30:00Z'), 'Europe/Madrid')).toBe('2026-11-10');
  });

  it('etiqueta de la prova', () => {
    expect(checkLabel({ kind: 'PING', port: null, url: null }, '192.168.1.5')).toBe('Ping 192.168.1.5');
    expect(checkLabel({ kind: 'TCP', port: 9100, url: null }, '192.168.1.26')).toBe('Port 9100 de 192.168.1.26');
    expect(checkLabel({ kind: 'HTTP', port: null, url: null }, '192.168.1.9')).toBe('HTTP http://192.168.1.9/');
  });
});

describe('equipment.rules · alertes', () => {
  const now = new Date('2026-11-09T10:00:00Z');
  const base = { licenses: [], ranges: RANGES, licenseWarnDays: 30, certWarnDays: 21, now };

  it('només avisa de caigudes d’equips crítics', () => {
    const down = { id: 'c1', kind: 'PING' as const, enabled: true, state: 'DOWN' as const, lastError: 'Sense resposta', certExpiresAt: null, label: 'Ping 192.168.1.211' };
    const alerts = computeAlerts({
      ...base,
      equipment: [
        equip({ id: 'srv', name: 'SRV-02', critical: true, checks: [down] }),
        equip({ id: 'pc', name: 'PC01', checks: [{ ...down, id: 'c2' }] }),
        equip({ id: 'off', name: 'Vell', critical: true, status: 'RETIRED', checks: [{ ...down, id: 'c3' }] }),
        equip({ id: 'dis', name: 'Desactivada', critical: true, checks: [{ ...down, id: 'c4', enabled: false }] }),
      ],
    });
    expect(alerts).toEqual([
      expect.objectContaining({ key: 'DOWN:srv', kind: 'DOWN', checkId: 'c1', message: 'SRV-02 no respon (Ping 192.168.1.211: Sense resposta).' }),
    ]);
  });

  it('IPs fixes repetides i dins del rang dinàmic (DHCP no compta)', () => {
    const alerts = computeAlerts({
      ...base,
      equipment: [
        equip({ id: 'a', name: 'PC07', addresses: [{ ip: '192.168.1.66', mode: 'STATIC' }] }),
        equip({ id: 'b', name: 'Portàtil', addresses: [{ ip: '192.168.1.66', mode: 'STATIC' }] }),
        equip({ id: 'p', name: 'INVERSOR', addresses: [{ ip: '192.168.1.161', mode: 'STATIC' }] }),
        equip({ id: 'd', name: 'PC09', addresses: [{ ip: null, mode: 'DHCP' }, { ip: '192.168.1.170', mode: 'DHCP' }] }),
        equip({ id: 'r', name: 'Retirat', status: 'RETIRED', addresses: [{ ip: '192.168.1.66', mode: 'STATIC' }] }),
      ],
    });
    expect(alerts.map((alert) => alert.key)).toEqual(['IP_DUPLICATE:192.168.1.66', 'IP_IN_DHCP:p:192.168.1.161']);
    expect(alerts[0].message).toBe('La IP 192.168.1.66 està apuntada a 2 equips: PC07, Portàtil.');
  });

  it('llicències caducades, per caducar i amb massa equips (no les flotants)', () => {
    const alerts = computeAlerts({
      ...base,
      equipment: [],
      licenses: [
        { id: 'l1', label: 'CAD 2024', kind: 'SUBSCRIPTION', seats: 10, expiresAt: new Date('2026-11-20'), assigned: 12 },
        { id: 'l2', label: 'Antivirus', kind: 'SUBSCRIPTION', seats: null, expiresAt: new Date('2026-11-01'), assigned: 30 },
        { id: 'l3', label: 'CAD Pro …123', kind: 'FLOATING', seats: 1, expiresAt: null, assigned: 3 },
        { id: 'l4', label: 'Ofimàtica', kind: 'OTHER', seats: null, expiresAt: new Date('2027-06-01'), assigned: 25 },
      ],
    });
    expect(alerts.map((alert) => alert.key)).toEqual([
      'LICENSE_EXPIRING:l1',
      'LICENSE_OVERUSED:l1',
      'LICENSE_EXPIRED:l2',
    ]);
    expect(alerts[0].message).toBe("La llicència CAD 2024 caduca d'aquí a 11 dies.");
  });

  it('certificats HTTPS a punt de caducar', () => {
    const alerts = computeAlerts({
      ...base,
      equipment: [
        equip({
          id: 'nas',
          name: 'NAS',
          checks: [
            { id: 'h1', kind: 'HTTP', enabled: true, state: 'UP', lastError: null, certExpiresAt: new Date('2026-11-19'), label: 'HTTP https://nas/' },
            { id: 'h2', kind: 'HTTP', enabled: true, state: 'UP', lastError: null, certExpiresAt: new Date('2027-11-19'), label: 'HTTP https://nas:8443/' },
          ],
        }),
      ],
    });
    expect(alerts).toEqual([expect.objectContaining({ key: 'CERT:h1', kind: 'CERT_EXPIRING' })]);
  });
});

describe('privateIpv4', () => {
  it('accepta només IPs de xarxes privades', () => {
    expect(privateIpv4('192.168.1.013')).toBe('192.168.1.13');
    expect(privateIpv4('192.168.1.5')).toBe('192.168.1.5');
    expect(privateIpv4('172.20.0.1')).toBe('172.20.0.1');
    expect(privateIpv4('172.32.0.1')).toBeNull();
    expect(privateIpv4('8.8.8.8')).toBeNull();
    expect(privateIpv4('pc50')).toBeNull();
  });
});

describe('rangs gestionats', () => {
  it('llegeix CIDR, intervals i IPs soltes', () => {
    expect(parseRange('192.168.1.0/24')).toEqual({ from: '192.168.1.1', to: '192.168.1.254', cidr: '192.168.1.0/24' });
    expect(parseRange('192.168.1.77/24')?.cidr).toBe('192.168.1.0/24');
    expect(parseRange('10.1.0.0/22')).toEqual({ from: '10.1.0.1', to: '10.1.3.254', cidr: '10.1.0.0/22' });
    expect(parseRange('10.0.5.10/32')).toEqual({ from: '10.0.5.10', to: '10.0.5.10', cidr: '10.0.5.10/32' });
    expect(parseRange('192.168.1.10-192.168.1.50')).toEqual({ from: '192.168.1.10', to: '192.168.1.50', cidr: null });
    expect(parseRange('192.168.1.50 – 10')).toEqual({ from: '192.168.1.10', to: '192.168.1.50', cidr: null });
    expect(parseRange('172.16.0.1-1.20')).toEqual({ from: '172.16.0.1', to: '172.16.1.20', cidr: null });
    expect(parseRange('192.168.1.7')).toEqual({ from: '192.168.1.7', to: '192.168.1.7', cidr: null });
    expect(parseRange('192.168.1.0/4')).toBeNull();
    expect(parseRange('hola')).toBeNull();
  });

  it('mida i pertinença', () => {
    const ranges = cleanManagedRanges([{ name: 'Oficina', range: '192.168.1.0/24' }, { cidr: '10.0.0.0/8' }, { from: '172.16.0.1', to: '172.16.0.9' }]);
    expect(ranges.map((range) => range.name)).toEqual(['Oficina', '172.16.0.1 – 172.16.0.9']);
    expect(rangeSize(ranges[0])).toBe(254);
    expect(managedRangeOf('192.168.1.200', ranges)?.name).toBe('Oficina');
    expect(managedRangeOf('172.16.0.10', ranges)).toBeNull();
  });
});