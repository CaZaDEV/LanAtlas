import { ber, berOid, guessDevice, htmlTitle, nbstatQuery, parseNbstat, parsePtr, parseSnmp, ptrQuery, snmpGet, SNMP_OIDS } from './equipment-discover';

function nbName(label: string, suffix: number, group: boolean): Buffer {
  const out = Buffer.alloc(18, 0x20);
  out.write(label, 0, 'latin1');
  out[15] = suffix;
  out.writeUInt16BE(group ? 0x8400 : 0x0400, 16);
  return out;
}

describe('NetBIOS', () => {
  it('codifica la consulta «*»', () => {
    const query = nbstatQuery(1);
    expect(query.length).toBe(50);
    expect(query.subarray(13, 15).toString('ascii')).toBe('CK');
    expect(query.subarray(15, 45).toString('ascii')).toBe('A'.repeat(30));
    expect(query.readUInt16BE(46)).toBe(0x21);
  });

  it('llegeix nom, grup de treball, compartició i MAC', () => {
    const header = Buffer.from([0, 1, 0x84, 0, 0, 0, 0, 1, 0, 0, 0, 0]);
    const question = nbstatQuery().subarray(12, 46);
    const rr = Buffer.from([0, 0x21, 0, 1, 0, 0, 0, 0, 0, 0]);
    const names = [nbName('PC01', 0x00, false), nbName('WORKGROUP', 0x00, true), nbName('PC01', 0x20, false)];
    const mac = Buffer.from([0x00, 0x1a, 0x2b, 0x3c, 0x4d, 0x5e]);
    const info = parseNbstat(Buffer.concat([header, question, rr, Buffer.from([names.length]), ...names, mac]));
    expect(info).toEqual({ name: 'PC01', workgroup: 'WORKGROUP', fileServer: true, mac: '00:1A:2B:3C:4D:5E' });
  });

  it('una resposta sense respostes no diu res', () => {
    expect(parseNbstat(Buffer.from([0, 1, 0x84, 0, 0, 0, 0, 0, 0, 0, 0, 0]))).toBeNull();
  });
});

describe('mDNS PTR', () => {
  it('llegeix el nom amb punters i treu «.local»', () => {
    const query = ptrQuery('192.168.1.77', 7);
    const header = Buffer.from([0, 7, 0x84, 0, 0, 1, 0, 1, 0, 0, 0, 0]);
    const question = query.subarray(12);
    // Resposta: nom = punter a la pregunta (offset 12), PTR, rdata «impressora» + punter a «local» escrit a continuació.
    const rdata = Buffer.concat([Buffer.from([10]), Buffer.from('impressora'), Buffer.from([5]), Buffer.from('local'), Buffer.from([0])]);
    const answer = Buffer.concat([Buffer.from([0xc0, 12, 0, 12, 0, 1, 0, 0, 0, 120, 0, rdata.length]), rdata]);
    expect(parsePtr(Buffer.concat([header, question, answer]))).toBe('impressora');
  });
});

describe('SNMP', () => {
  it('la consulta és un missatge v1 amb la comunitat public', () => {
    const message = snmpGet();
    expect(message[0]).toBe(0x30);
    expect(message.includes(Buffer.from('public'))).toBe(true);
    expect(message.includes(berOid(SNMP_OIDS.descr))).toBe(true);
  });

  it('llegeix els textos de la resposta', () => {
    const varbind = (oid: string, text: string) => ber(0x30, Buffer.concat([berOid(oid), ber(0x04, Buffer.from(text))]));
    const pdu = ber(
      0xa2,
      Buffer.concat([
        ber(0x02, Buffer.from([1])),
        ber(0x02, Buffer.from([0])),
        ber(0x02, Buffer.from([0])),
        ber(0x30, Buffer.concat([varbind(SNMP_OIDS.descr, 'HP LaserJet Pro M404'), varbind(SNMP_OIDS.name, 'HPM404')])),
      ]),
    );
    const response = ber(0x30, Buffer.concat([ber(0x02, Buffer.from([0])), ber(0x04, Buffer.from('public')), pdu]));
    expect(parseSnmp(response)).toEqual({ [SNMP_OIDS.descr]: 'HP LaserJet Pro M404', [SNMP_OIDS.name]: 'HPM404' });
  });

  it('codifica OIDs amb números grans', () => {
    expect([...berOid('1.3.6.1.4.1.311')]).toEqual([0x06, 0x07, 0x2b, 0x06, 0x01, 0x04, 0x01, 0x82, 0x37]);
  });
});

describe('htmlTitle', () => {
  it('neteja espais i entitats', () => {
    expect(htmlTitle('<html><head><TITLE>\n  Web Image Monitor &amp; Co </TITLE>')).toBe('Web Image Monitor & Co');
    expect(htmlTitle('<p>res</p>')).toBeNull();
  });
});

describe('guessDevice', () => {
  const base = { names: [], mac: null, snmp: null, ports: [], web: [], banners: [] };

  it('impressora per SNMP', () => {
    const guess = guessDevice({ ...base, snmp: { descr: 'HP LaserJet Pro M404', name: null, location: null, contact: null }, ports: [{ port: 9100, service: '' }] });
    expect(guess).toMatchObject({ typeId: 'type-printer', confidence: 'alta' });
    expect(guess.reasons).toHaveLength(2);
  });

  it('Windows per NetBIOS i SMB', () => {
    const guess = guessDevice({ ...base, names: [{ source: 'NetBIOS', name: 'PC02' }], ports: [{ port: 445, service: '' }, { port: 3389, service: '' }] });
    expect(guess).toMatchObject({ typeId: 'type-pc', confidence: 'mitjana' });
  });

  it('càmera pel web abans que pel port', () => {
    const guess = guessDevice({ ...base, ports: [{ port: 80, service: '' }, { port: 554, service: '' }], web: [{ port: 80, scheme: 'http', status: 200, server: null, title: 'HIKVISION', realm: null, location: null, certSubject: null, certIssuer: null }] });
    expect(guess).toMatchObject({ typeId: 'type-camera', confidence: 'alta' });
  });

  it('PLC pels ports industrials', () => {
    expect(guessDevice({ ...base, ports: [{ port: 102, service: '' }] }).typeId).toBe('type-machine');
  });

  it('sense pistes, desconegut', () => {
    expect(guessDevice(base)).toMatchObject({ label: 'Desconegut', confidence: 'baixa' });
  });
});
