import type { Equipment, EquipmentLicense, EquipmentType } from '@/api/equipment';
import { downloadXlsx } from '@/lib/xlsx';
import { OWNERSHIP_LABEL, STATUS_LABEL, assigneeName, licenseLabel } from './equipmentUi';

const NET_LABEL = { UP: 'Respon', DOWN: 'No respon', UNKNOWN: 'Comprovant', NONE: 'Sense proves' } as const;

/** Exporta els equips (els filtrats a pantalla) a Excel, com el full d'abans però sense secrets. */
export function exportEquipment(items: Equipment[], types: Map<string, EquipmentType>, licenses: Map<string, EquipmentLicense>, withPrice: boolean) {
  const rows = items.map((item) => [
    item.number,
    item.name,
    types.get(item.typeId)?.name ?? '',
    item.addresses
      .map((address) => `${address.mode === 'DHCP' ? `DHCP${address.ip ? ` ${address.ip}` : ''}` : address.ip}${address.label ? ` (${address.label})` : ''}`)
      .join(', '),
    item.addresses.map((address) => address.mac).filter(Boolean).join(', '),
    item.location,
    assigneeName(item),
    item.os,
    item.licenseIds.map((id) => licenses.get(id)).filter(Boolean).map((license) => licenseLabel(license!)).join(', '),
    item.software.map((row) => [row.name, row.version].filter(Boolean).join(' ')).join(', '),
    [item.brand, item.model].filter(Boolean).join(' '),
    item.serial,
    item.acquired,
    ...(withPrice ? [item.price] : []),
    OWNERSHIP_LABEL[item.ownership],
    STATUS_LABEL[item.status],
    item.critical ? 'Sí' : '',
    NET_LABEL[item.netState],
    item.needsReview ? item.reviewNote || 'Sí' : '',
    item.notes,
  ]);
  const today = new Date().toISOString().slice(0, 10);
  downloadXlsx(`Equips ${today}.xlsx`, {
    name: 'Equips',
    columns: [
      { header: 'Número', width: 9 },
      { header: 'Nom', width: 26 },
      { header: 'Tipus', width: 18 },
      { header: 'IP', width: 22 },
      { header: 'MAC', width: 19 },
      { header: 'Ubicació', width: 28 },
      { header: 'Persona', width: 18 },
      { header: 'Sistema', width: 16 },
      { header: 'Llicències', width: 44 },
      { header: 'Programes', width: 30 },
      { header: 'Marca / model', width: 22 },
      { header: 'Núm. de sèrie', width: 18 },
      { header: 'Adquirit', width: 10 },
      ...(withPrice ? [{ header: 'Preu', width: 10 }] : []),
      { header: 'Propietat', width: 11 },
      { header: 'Estat', width: 10 },
      { header: 'Crític', width: 7 },
      { header: 'Xarxa', width: 13 },
      { header: 'A revisar', width: 30 },
      { header: 'Observacions', width: 60 },
    ],
    rows,
  });
}
