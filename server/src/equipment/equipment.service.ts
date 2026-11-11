import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { networkInterfaces } from 'node:os';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../prisma.service';
import { OPERATOR } from '../common/operator';
import { CheckDto, EquipmentDto, LicenseDto, LocationDto, SecretDto, SettingsDto, TypeDto, WebhookDto } from './dto/equipment.dto';
import { decryptSecret, encryptSecret, secretHint, secretsKey } from './equipment-crypto';
import { EquipmentMonitorService, checkHost } from './equipment-monitor.service';
import { cleanWebhooks, sendWebhookTest } from './equipment-webhooks';
import {
  MAX_RANGE_SIZE,
  checkLabel,
  cleanManagedRanges,
  cleanRanges,
  equipmentNetState,
  ipv4ToNumber,
  localDay,
  managedRangeOf,
  normalizeHost,
  normalizeIpv4,
  normalizeMac,
  normalizeMonth,
  parseRange,
  privateIpv4,
  rangeSize,
  type ManagedRange,
} from './equipment.rules';
import { probePing } from './equipment-probe';
import { anyPortOpen, discoverHost } from './equipment-discover';

/** Dies d'historial que es mostren (disponibilitat i alertes tancades). */
const HISTORY_DAYS = 30;
/** IPs per crida de rastreig (el client parteix els rangs grans). */
const SCAN_MAX = 1024;
const SCAN_CONCURRENCY = 24;

const equipmentInclude = {
  type: true,
  addresses: { orderBy: { position: 'asc' } },
  software: { orderBy: { position: 'asc' } },
  licenses: { select: { licenseId: true } },
  secrets: { orderBy: { label: 'asc' } },
  checks: { orderBy: { createdAt: 'asc' } },
} satisfies Prisma.EquipmentInclude;

type EquipmentRow = Prisma.EquipmentGetPayload<{ include: typeof equipmentInclude }>;

/** JSON desat com a text (SQLite). */
export function parseJson(value: string | null | undefined): unknown {
  try {
    return JSON.parse(value ?? '[]');
  } catch {
    return [];
  }
}

/**
 * Equips i xarxa: inventari d'equips i màquines, llicències, credencials, proves, alertes, IPs i mapes.
 * Aplicació d'un sol usuari: qui l'obre ho pot fer tot (vegeu HOST al README).
 */
@Injectable()
export class EquipmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly monitor: EquipmentMonitorService,
  ) {}

  // ── Lectura ─────────────────────────────────────────────────────────────

  async state() {
    const since = new Date(Date.now() - HISTORY_DAYS * 86_400_000);
    const sinceDay = new Date(`${localDay(since)}T00:00:00Z`);
    const [types, equipment, licenses, alerts, settings, uptime, maps] = await Promise.all([
      this.prisma.equipmentType.findMany({ orderBy: [{ position: 'asc' }, { name: 'asc' }] }),
      this.prisma.equipment.findMany({ include: equipmentInclude, orderBy: [{ name: 'asc' }] }),
      this.prisma.equipmentLicense.findMany({
        include: { assignments: { select: { equipmentId: true } } },
        orderBy: [{ product: 'asc' }, { version: 'asc' }],
      }),
      this.prisma.equipmentAlert.findMany({
        where: { OR: [{ closedAt: null }, { closedAt: { gte: since } }] },
        orderBy: { openedAt: 'desc' },
        take: 300,
      }),
      this.settingsRow(),
      this.prisma.equipmentCheckDaily.groupBy({
        by: ['checkId'],
        where: { day: { gte: sinceDay } },
        _sum: { okCount: true, failCount: true, latencySumMs: true },
      }),
      this.prisma.mapPlan.findMany({
        orderBy: [{ position: 'asc' }, { name: 'asc' }],
        select: { id: true, name: true, position: true, updatedAt: true },
      }),
    ]);
    const uptimeByCheck = new Map(uptime.map((row) => [row.checkId, row._sum]));

    return {
      access: { manager: true },
      secretsEnabled: !!secretsKey(),
      types,
      equipment: equipment.map((item) => this.equipmentView(item, uptimeByCheck)),
      licenses: licenses.map((license) => ({
        id: license.id,
        product: license.product,
        version: license.version,
        kind: license.kind,
        seats: license.seats,
        hasKey: !!license.keyCipher,
        keyHint: license.keyHint,
        vendor: license.vendor,
        purchasedAt: license.purchasedAt,
        expiresAt: license.expiresAt,
        cost: license.cost,
        notes: license.notes,
        equipmentIds: license.assignments.map((row) => row.equipmentId),
        updatedAt: license.updatedAt,
        updatedByName: license.updatedByName ?? license.createdByName,
      })),
      alerts,
      settings: {
        managedRanges: cleanManagedRanges(parseJson(settings.managedRanges)),
        dhcpRanges: cleanRanges(parseJson(settings.dhcpRanges)),
        webhooks: cleanWebhooks(parseJson(settings.webhooks)),
        licenseWarnDays: settings.licenseWarnDays,
        certWarnDays: settings.certWarnDays,
        currency: settings.currency,
      },
      maps,
    };
  }

  /** Historial d'un equip: disponibilitat per dia i canvis d'estat de les seves proves. */
  async history(equipmentId: string) {
    const checks = await this.prisma.equipmentCheck.findMany({ where: { equipmentId }, select: { id: true } });
    const ids = checks.map((check) => check.id);
    const since = new Date(`${localDay(new Date(Date.now() - HISTORY_DAYS * 86_400_000))}T00:00:00Z`);
    const [daily, events] = await Promise.all([
      this.prisma.equipmentCheckDaily.findMany({ where: { checkId: { in: ids }, day: { gte: since } }, orderBy: { day: 'asc' } }),
      this.prisma.equipmentCheckEvent.findMany({ where: { checkId: { in: ids } }, orderBy: { at: 'desc' }, take: 50 }),
    ]);
    return {
      daily: daily.map((row) => ({ ...row, day: row.day.toISOString().slice(0, 10) })),
      events,
    };
  }

  // ── Equips ──────────────────────────────────────────────────────────────

  async createEquipment(dto: EquipmentDto) {
    const data = await this.equipmentData(dto);
    const created = await this.prisma.$transaction(async (tx) => {
      const row = await tx.equipment.create({ data: { ...data.fields, createdByName: OPERATOR } });
      await this.writeChildren(tx, row.id, data);
      const firstStatic = data.addresses.find((address) => address.mode === 'STATIC' && address.ip);
      if (dto.addPing && firstStatic) {
        await tx.equipmentCheck.create({ data: { equipmentId: row.id, kind: 'PING' } });
      }
      return row;
    });
    this.monitor.requestReconcile();
    if (dto.addPing) void this.monitor.runEquipment(created.id).catch(() => undefined);
    return { id: created.id };
  }

  async updateEquipment(id: string, dto: EquipmentDto) {
    await this.requireEquipment(id);
    const data = await this.equipmentData(dto);
    await this.prisma.$transaction(async (tx) => {
      await tx.equipment.update({ where: { id }, data: { ...data.fields, updatedByName: OPERATOR } });
      await tx.equipmentAddress.deleteMany({ where: { equipmentId: id } });
      await tx.equipmentSoftware.deleteMany({ where: { equipmentId: id } });
      await tx.equipmentLicenseAssignment.deleteMany({ where: { equipmentId: id } });
      await this.writeChildren(tx, id, data);
    });
    this.monitor.requestReconcile();
    return { ok: true };
  }

  async deleteEquipment(id: string) {
    await this.requireEquipment(id);
    await this.prisma.equipment.delete({ where: { id } });
    this.monitor.requestReconcile();
    return { ok: true };
  }

  /** Posa (o treu) l'equip en un mapa 3D. */
  async setLocation(id: string, dto: LocationDto) {
    await this.requireEquipment(id);
    const placed = dto.mapX !== null && dto.mapX !== undefined && dto.mapY !== null && dto.mapY !== undefined;
    if (!placed && (dto.mapX != null || dto.mapY != null)) throw new BadRequestException('Falten coordenades del punt');
    let mapId: string | null = null;
    if (placed) {
      mapId = dto.mapId ?? null;
      if (!mapId) throw new BadRequestException('Falta el mapa');
      const exists = await this.prisma.mapPlan.count({ where: { id: mapId } });
      if (!exists) throw new BadRequestException('El mapa no existeix');
    }
    const data = placed
      ? { mapId, mapX: Math.round(dto.mapX! * 100) / 100, mapY: Math.round(dto.mapY! * 100) / 100, mapCode: clean(dto.mapCode)?.toUpperCase() ?? null }
      : { mapId: null, mapX: null, mapY: null, mapCode: null };
    await this.prisma.equipment.update({ where: { id }, data: { ...data, updatedByName: OPERATOR } });
    return { ok: true };
  }

  // ── Llicències ──────────────────────────────────────────────────────────

  async createLicense(dto: LicenseDto) {
    const data = await this.licenseData(dto, null);
    const created = await this.prisma.$transaction(async (tx) => {
      const row = await tx.equipmentLicense.create({ data: { ...data.fields, createdByName: OPERATOR } });
      if (data.equipmentIds.length) {
        await tx.equipmentLicenseAssignment.createMany({
          data: data.equipmentIds.map((equipmentId) => ({ licenseId: row.id, equipmentId })),
        });
      }
      return row;
    });
    this.monitor.requestReconcile();
    return { id: created.id };
  }

  async updateLicense(id: string, dto: LicenseDto) {
    const current = await this.prisma.equipmentLicense.findUnique({ where: { id } });
    if (!current) throw new NotFoundException('La llicència no existeix');
    const data = await this.licenseData(dto, current);
    await this.prisma.$transaction(async (tx) => {
      await tx.equipmentLicense.update({ where: { id }, data: { ...data.fields, updatedByName: OPERATOR } });
      await tx.equipmentLicenseAssignment.deleteMany({ where: { licenseId: id } });
      if (data.equipmentIds.length) {
        await tx.equipmentLicenseAssignment.createMany({
          data: data.equipmentIds.map((equipmentId) => ({ licenseId: id, equipmentId })),
        });
      }
    });
    this.monitor.requestReconcile();
    return { ok: true };
  }

  async deleteLicense(id: string) {
    const current = await this.prisma.equipmentLicense.count({ where: { id } });
    if (!current) throw new NotFoundException('La llicència no existeix');
    await this.prisma.equipmentLicense.delete({ where: { id } });
    this.monitor.requestReconcile();
    return { ok: true };
  }

  async revealLicenseKey(id: string) {
    const license = await this.prisma.equipmentLicense.findUnique({ where: { id } });
    if (!license) throw new NotFoundException('La llicència no existeix');
    if (!license.keyCipher) throw new NotFoundException('Aquesta llicència no té clau desada');
    const value = decryptSecret(license.keyCipher, this.requireKey());
    if (value === null) throw new ConflictException('No es pot desxifrar la clau (ha canviat la clau secreta?)');
    return { value };
  }

  // ── Credencials ─────────────────────────────────────────────────────────

  async createSecret(equipmentId: string, dto: SecretDto) {
    await this.requireEquipment(equipmentId);
    const value = dto.value ?? '';
    if (!value) throw new BadRequestException('Escriu la contrasenya');
    const row = await this.prisma.equipmentSecret.create({
      data: {
        equipmentId,
        label: required(dto.label, 'Posa un nom a la credencial'),
        username: clean(dto.username),
        valueCipher: encryptSecret(value, this.requireKey()),
        notes: multiline(dto.notes),
        createdByName: OPERATOR,
      },
    });
    return { id: row.id };
  }

  async updateSecret(id: string, dto: SecretDto) {
    const current = await this.prisma.equipmentSecret.count({ where: { id } });
    if (!current) throw new NotFoundException('La credencial no existeix');
    await this.prisma.equipmentSecret.update({
      where: { id },
      data: {
        label: required(dto.label, 'Posa un nom a la credencial'),
        username: clean(dto.username),
        notes: multiline(dto.notes),
        ...(dto.value ? { valueCipher: encryptSecret(dto.value, this.requireKey()) } : {}),
        updatedByName: OPERATOR,
      },
    });
    return { ok: true };
  }

  async deleteSecret(id: string) {
    const current = await this.prisma.equipmentSecret.count({ where: { id } });
    if (!current) throw new NotFoundException('La credencial no existeix');
    await this.prisma.equipmentSecret.delete({ where: { id } });
    return { ok: true };
  }

  async revealSecret(id: string) {
    const secret = await this.prisma.equipmentSecret.findUnique({ where: { id } });
    if (!secret) throw new NotFoundException('La credencial no existeix');
    const value = decryptSecret(secret.valueCipher, this.requireKey());
    if (value === null) throw new ConflictException('No es pot desxifrar (ha canviat la clau secreta?)');
    return { value };
  }

  // ── Proves ──────────────────────────────────────────────────────────────

  async createCheck(equipmentId: string, dto: CheckDto) {
    await this.requireEquipment(equipmentId);
    const row = await this.prisma.equipmentCheck.create({ data: { equipmentId, ...this.checkData(dto) } });
    void this.monitor.runCheck(row.id).catch(() => undefined);
    return { id: row.id };
  }

  async updateCheck(id: string, dto: CheckDto) {
    const current = await this.prisma.equipmentCheck.findUnique({ where: { id } });
    if (!current) throw new NotFoundException('La prova no existeix');
    const data = this.checkData(dto);
    // Si canvia què es prova, l'estat anterior ja no val.
    const retarget = data.kind !== current.kind || data.target !== current.target || data.port !== current.port || data.url !== current.url;
    await this.prisma.equipmentCheck.update({
      where: { id },
      data: {
        ...data,
        ...(retarget || !data.enabled
          ? { state: 'UNKNOWN', stateSince: null, consecutiveFails: 0, lastOk: null, lastError: null, certExpiresAt: null }
          : {}),
      },
    });
    this.monitor.requestReconcile();
    if (data.enabled && retarget) void this.monitor.runCheck(id).catch(() => undefined);
    return { ok: true };
  }

  async deleteCheck(id: string) {
    const current = await this.prisma.equipmentCheck.count({ where: { id } });
    if (!current) throw new NotFoundException('La prova no existeix');
    await this.prisma.equipmentCheck.delete({ where: { id } });
    this.monitor.requestReconcile();
    return { ok: true };
  }

  async runCheck(id: string) {
    const exists = await this.prisma.equipmentCheck.count({ where: { id } });
    if (!exists) throw new NotFoundException('La prova no existeix');
    const result = await this.monitor.runCheck(id);
    return { ok: result.ok, latencyMs: result.latencyMs, error: result.error, unavailable: !!result.unavailable };
  }

  async runEquipment(id: string) {
    await this.requireEquipment(id);
    await this.monitor.runEquipment(id);
    return { ok: true };
  }

  // ── IPs: rastreig i identificació ───────────────────────────────────────

  /**
   * Pestanya IPs: busca aparells a una llista d'IPs que no són a l'inventari. Una IP té algú si respon al ping o té
   * obert algun port habitual (molts Windows no responen al ping). Només IPs dels rangs gestionats (o, si no se n'ha
   * definit cap, de xarxes privades).
   */
  async scanIps(ips: string[]) {
    const targets = await this.allowedTargets(ips);
    if (targets.length > SCAN_MAX) throw new BadRequestException(`Com a molt ${SCAN_MAX} IPs per rastreig`);
    const results: { ip: string; ok: boolean; latencyMs: number | null; via: string }[] = [];
    let unavailable = false;
    let next = 0;
    const worker = async () => {
      while (next < targets.length) {
        const ip = targets[next++];
        const [ping, port] = await Promise.all([probePing(ip), anyPortOpen(ip)]);
        if (ping.unavailable) unavailable = true;
        if (ping.ok || port !== null) results.push({ ip, ok: true, latencyMs: ping.ok ? ping.latencyMs : null, via: ping.ok ? 'ping' : `port ${port}` });
      }
    };
    await Promise.all(Array.from({ length: Math.min(SCAN_CONCURRENCY, targets.length) }, worker));
    results.sort((a, b) => (ipv4ToNumber(a.ip) ?? 0) - (ipv4ToNumber(b.ip) ?? 0));
    // Sense ping, els ports encara diuen alguna cosa: només es marca «no fiable» si no s'ha trobat res.
    return { at: new Date().toISOString(), unavailable: unavailable && !results.length, responding: results, scanned: targets.length };
  }

  /** Totes les proves d'identificació sobre una IP (DNS, NetBIOS, SNMP, ports, web…). ~5 s. */
  async identifyIp(ip: string) {
    const [target] = await this.allowedTargets([ip]);
    if (!target) throw new BadRequestException('Cal una IP');
    const ping = await probePing(target);
    return discoverHost(target, ping.ok ? true : null);
  }

  /** Xarxes del servidor (per proposar rangs a Configuració). Les més grans que /20 es proposen com a /24. */
  networkSuggestions() {
    const out: { name: string; cidr: string; address: string }[] = [];
    for (const [name, list] of Object.entries(networkInterfaces())) {
      for (const row of list ?? []) {
        if (row.family !== 'IPv4' || row.internal || !row.cidr) continue;
        const bits = Number(row.cidr.split('/')[1]) || 24;
        const parsed = parseRange(`${row.address}/${bits < 20 || bits > 30 ? 24 : bits}`);
        if (parsed?.cidr && !out.some((item) => item.cidr === parsed.cidr)) out.push({ name, cidr: parsed.cidr, address: row.address });
      }
    }
    return out;
  }

  private async allowedTargets(ips: string[]): Promise<string[]> {
    const ranges = await this.managedRanges();
    const list = [...new Set(ips.map((ip) => normalizeIpv4(ip)))];
    if (list.some((ip) => !ip)) throw new BadRequestException('Alguna IP no és vàlida');
    for (const ip of list as string[]) {
      if (ranges.length ? !managedRangeOf(ip, ranges) : !privateIpv4(ip)) {
        throw new BadRequestException(
          ranges.length
            ? `La IP ${ip} no és de cap dels rangs gestionats (Configuració)`
            : 'Sense rangs gestionats només es poden rastrejar IPs de xarxes privades: afegeix els teus rangs a Configuració',
        );
      }
    }
    return list as string[];
  }

  private async managedRanges(): Promise<ManagedRange[]> {
    const settings = await this.settingsRow();
    return cleanManagedRanges(parseJson(settings.managedRanges));
  }

  // ── Tipus, configuració i alertes ───────────────────────────────────────

  async createType(dto: TypeDto) {
    const name = required(dto.name, 'Posa un nom al tipus');
    try {
      const row = await this.prisma.equipmentType.create({ data: { name, icon: dto.icon, color: dto.color, position: dto.position } });
      return { id: row.id };
    } catch (error) {
      throw this.uniqueName(error);
    }
  }

  async updateType(id: string, dto: TypeDto) {
    const name = required(dto.name, 'Posa un nom al tipus');
    try {
      await this.prisma.equipmentType.update({ where: { id }, data: { name, icon: dto.icon, color: dto.color, position: dto.position } });
    } catch (error) {
      if ((error as Prisma.PrismaClientKnownRequestError).code === 'P2025') throw new NotFoundException('El tipus no existeix');
      throw this.uniqueName(error);
    }
    return { ok: true };
  }

  async deleteType(id: string) {
    const used = await this.prisma.equipment.count({ where: { typeId: id } });
    if (used > 0) throw new ConflictException(`Hi ha ${used} equips d’aquest tipus: canvia’ls de tipus abans d’esborrar-lo`);
    const row = await this.prisma.equipmentType.delete({ where: { id } }).catch(() => null);
    if (!row) throw new NotFoundException('El tipus no existeix');
    return { ok: true };
  }

  async updateSettings(dto: SettingsDto) {
    const ranges = dto.dhcpRanges.map((range) => {
      const from = normalizeIpv4(range.from);
      const to = normalizeIpv4(range.to);
      if (!from || !to) throw new BadRequestException(`Rang DHCP no vàlid: ${range.from} – ${range.to}`);
      return { from, to };
    });
    const managed = dto.managedRanges.map((range) => {
      const parsed = parseRange(range.range);
      if (!parsed) throw new BadRequestException(`Rang no vàlid: «${range.range}». Escriu-lo com 192.168.1.0/24 o 192.168.1.1-192.168.1.254`);
      if (rangeSize(parsed) > MAX_RANGE_SIZE) throw new BadRequestException(`El rang «${range.range}» és massa gran (màxim ${MAX_RANGE_SIZE} adreces, una /20)`);
      return { name: clean(range.name) ?? parsed.cidr ?? `${parsed.from} – ${parsed.to}`, ...parsed };
    });
    const webhooks = dto.webhooks.map((hook) => ({ url: validUrl(hook.url), format: hook.format }));
    const data = {
      managedRanges: JSON.stringify(managed),
      dhcpRanges: JSON.stringify(ranges),
      webhooks: JSON.stringify(webhooks),
      licenseWarnDays: dto.licenseWarnDays,
      certWarnDays: dto.certWarnDays,
      currency: dto.currency.toUpperCase(),
      updatedByName: OPERATOR,
    };
    await this.prisma.equipmentSettings.upsert({ where: { id: 'default' }, create: { id: 'default', ...data }, update: data });
    this.monitor.requestReconcile();
    return { ok: true };
  }

  async testWebhook(dto: WebhookDto) {
    return sendWebhookTest({ url: validUrl(dto.url), format: dto.format });
  }

  async ackAlert(id: string) {
    const updated = await this.prisma.equipmentAlert.updateMany({
      where: { id, ackedAt: null },
      data: { ackedAt: new Date(), ackedByName: OPERATOR },
    });
    if (updated.count === 0) {
      const exists = await this.prisma.equipmentAlert.count({ where: { id } });
      if (!exists) throw new NotFoundException('L’alerta no existeix');
    }
    return { ok: true };
  }

  // ── Peces internes ──────────────────────────────────────────────────────

  private async settingsRow() {
    return (
      (await this.prisma.equipmentSettings.findUnique({ where: { id: 'default' } })) ??
      (await this.prisma.equipmentSettings.create({ data: { id: 'default' } }))
    );
  }

  private equipmentView(item: EquipmentRow, uptime: Map<string, { okCount: number | null; failCount: number | null; latencySumMs: number | null }>) {
    const checks = item.checks.map((check) => {
      const sums = uptime.get(check.id);
      const ok = sums?.okCount ?? 0;
      const total = ok + (sums?.failCount ?? 0);
      const kind = check.kind as 'PING' | 'TCP' | 'HTTP';
      return {
        id: check.id,
        kind,
        target: check.target,
        port: check.port,
        url: check.url,
        label: checkLabel({ kind, port: check.port, url: check.url }, checkHost(check, item.addresses)),
        intervalSec: check.intervalSec,
        failThreshold: check.failThreshold,
        enabled: check.enabled,
        state: check.state as 'UNKNOWN' | 'UP' | 'DOWN',
        stateSince: check.stateSince,
        lastRunAt: check.lastRunAt,
        lastOk: check.lastOk,
        lastLatencyMs: check.lastLatencyMs,
        lastError: check.lastError,
        certExpiresAt: check.certExpiresAt,
        uptime30: total > 0 ? ok / total : null,
        avgLatencyMs: ok > 0 ? Math.round((sums?.latencySumMs ?? 0) / ok) : null,
      };
    });
    return {
      id: item.id,
      number: item.number,
      name: item.name,
      typeId: item.typeId,
      brand: item.brand,
      model: item.model,
      serial: item.serial,
      acquired: item.acquired,
      price: item.price,
      location: item.location,
      os: item.os,
      assignedName: item.assignedName,
      ownership: item.ownership,
      status: item.status,
      critical: item.critical,
      notes: item.notes,
      needsReview: item.needsReview,
      reviewNote: item.reviewNote,
      mapId: item.mapId,
      mapX: item.mapX,
      mapY: item.mapY,
      mapCode: item.mapCode,
      createdByName: item.createdByName,
      updatedByName: item.updatedByName,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      addresses: item.addresses.map((address) => ({ id: address.id, ip: address.ip, mode: address.mode, label: address.label, mac: address.mac })),
      software: item.software.map((row) => ({ id: row.id, name: row.name, version: row.version, notes: row.notes })),
      licenseIds: item.licenses.map((row) => row.licenseId),
      secrets: item.secrets.map((secret) => ({
        id: secret.id,
        label: secret.label,
        username: secret.username,
        notes: secret.notes,
        updatedAt: secret.updatedAt,
        updatedByName: secret.updatedByName ?? secret.createdByName,
      })),
      secretCount: item.secrets.length,
      checks,
      netState: equipmentNetState(checks),
    };
  }

  private async equipmentData(dto: EquipmentDto) {
    const type = await this.prisma.equipmentType.findUnique({ where: { id: dto.typeId }, select: { id: true } });
    if (!type) throw new BadRequestException('Tria un tipus d’equip');

    let acquired: string | null = null;
    if (clean(dto.acquired)) {
      acquired = normalizeMonth(dto.acquired);
      if (!acquired) throw new BadRequestException('La data d’adquisició ha de ser com «2016-05» o «2016»');
    }

    const addresses = dto.addresses.map((address, index) => {
      const raw = clean(address.ip);
      const ip = raw ? normalizeHost(raw) : null;
      if (raw && !ip) throw new BadRequestException(`L’adreça «${raw}» no és una IP ni un nom de host vàlid`);
      if (address.mode === 'STATIC' && !ip) throw new BadRequestException('Una adreça fixa necessita la IP');
      const rawMac = clean(address.mac);
      const mac = rawMac ? normalizeMac(rawMac) : null;
      if (rawMac && !mac) throw new BadRequestException(`La MAC «${rawMac}» no és vàlida`);
      return { position: index, ip, mode: address.mode, label: clean(address.label), mac };
    });

    const software = dto.software
      .map((row, index) => ({ position: index, name: clean(row.name), version: clean(row.version), notes: clean(row.notes) }))
      .filter((row): row is { position: number; name: string; version: string | null; notes: string | null } => !!row.name);

    const licenseIds = [...new Set(dto.licenseIds)];
    if (licenseIds.length) {
      const found = await this.prisma.equipmentLicense.count({ where: { id: { in: licenseIds } } });
      if (found !== licenseIds.length) throw new BadRequestException('Alguna llicència ja no existeix');
    }

    return {
      fields: {
        number: clean(dto.number),
        name: required(dto.name, 'Posa un nom a l’equip'),
        typeId: type.id,
        brand: clean(dto.brand),
        model: clean(dto.model),
        serial: clean(dto.serial),
        acquired,
        price: dto.price ?? null,
        location: clean(dto.location),
        os: clean(dto.os),
        assignedName: clean(dto.assignedName),
        ownership: dto.ownership,
        status: dto.status,
        critical: dto.critical,
        notes: multiline(dto.notes),
        needsReview: dto.needsReview,
        reviewNote: dto.needsReview ? clean(dto.reviewNote) : null,
      },
      addresses,
      software,
      licenseIds,
    };
  }

  private async writeChildren(
    tx: Prisma.TransactionClient,
    equipmentId: string,
    data: Awaited<ReturnType<EquipmentService['equipmentData']>>,
  ) {
    if (data.addresses.length) {
      await tx.equipmentAddress.createMany({ data: data.addresses.map((address) => ({ ...address, equipmentId })) });
    }
    if (data.software.length) {
      await tx.equipmentSoftware.createMany({ data: data.software.map((row) => ({ ...row, equipmentId })) });
    }
    if (data.licenseIds.length) {
      await tx.equipmentLicenseAssignment.createMany({
        data: data.licenseIds.map((licenseId) => ({ licenseId, equipmentId })),
      });
    }
  }

  private async licenseData(dto: LicenseDto, current: { keyCipher: string | null; keyHint: string | null } | null) {
    let keyCipher = current?.keyCipher ?? null;
    let keyHint = dto.keyHint !== undefined ? clean(dto.keyHint) : current?.keyHint ?? null;
    if (dto.key !== undefined) {
      const key = cleanLines(dto.key);
      if (key) {
        keyCipher = encryptSecret(key, this.requireKey());
        const lines = key.split('\n').length;
        if (dto.keyHint === undefined || !clean(dto.keyHint)) keyHint = lines > 1 ? `${lines} claus` : secretHint(key) ?? keyHint;
      } else {
        keyCipher = null;
      }
    }
    const equipmentIds = [...new Set(dto.equipmentIds)];
    if (equipmentIds.length) {
      const found = await this.prisma.equipment.count({ where: { id: { in: equipmentIds } } });
      if (found !== equipmentIds.length) throw new BadRequestException('Algun equip ja no existeix');
    }
    return {
      fields: {
        product: required(dto.product, 'Escriu el programa de la llicència'),
        version: clean(dto.version),
        kind: dto.kind,
        seats: dto.seats ?? null,
        keyCipher,
        keyHint,
        vendor: clean(dto.vendor),
        purchasedAt: dto.purchasedAt ? new Date(`${dto.purchasedAt}T00:00:00Z`) : null,
        expiresAt: dto.expiresAt ? new Date(`${dto.expiresAt}T00:00:00Z`) : null,
        cost: dto.cost ?? null,
        notes: multiline(dto.notes),
      },
      equipmentIds,
    };
  }

  private checkData(dto: CheckDto) {
    const rawTarget = clean(dto.target);
    const target = rawTarget ? normalizeHost(rawTarget) : null;
    if (rawTarget && !target) throw new BadRequestException(`«${rawTarget}» no és una IP ni un nom de host vàlid`);
    let url: string | null = null;
    if (dto.kind === 'HTTP' && clean(dto.url)) {
      try {
        const parsed = new URL(clean(dto.url)!);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error();
        url = parsed.toString();
      } catch {
        throw new BadRequestException('L’adreça ha de començar per http:// o https://');
      }
    }
    if (dto.kind === 'TCP' && !dto.port) throw new BadRequestException('Indica el port que s’ha de provar');
    return {
      kind: dto.kind,
      target,
      port: dto.kind === 'TCP' ? dto.port ?? null : null,
      url,
      intervalSec: dto.intervalSec,
      failThreshold: dto.failThreshold,
      enabled: dto.enabled,
    };
  }

  private async requireEquipment(id: string) {
    const exists = await this.prisma.equipment.count({ where: { id } });
    if (!exists) throw new NotFoundException('L’equip no existeix');
  }

  private requireKey(): Buffer {
    const key = secretsKey();
    if (!key) throw new BadRequestException('Les dades sensibles estan desactivades: no hi ha clau secreta al servidor');
    return key;
  }

  private uniqueName(error: unknown) {
    if ((error as Prisma.PrismaClientKnownRequestError).code === 'P2002') return new ConflictException('Ja hi ha un tipus amb aquest nom');
    return error;
  }
}

function validUrl(value: string): string {
  try {
    const parsed = new URL(clean(value) ?? '');
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error();
    return parsed.toString();
  } catch {
    throw new BadRequestException(`Adreça no vàlida: ${value}`);
  }
}

/** Com `clean`, però conserva els salts de línia (una clau per línia) i treu les línies buides. */
function cleanLines(value: string | null | undefined): string | null {
  const lines = (value ?? '').split(/\r?\n/).map((line) => line.trim().replace(/\s+/g, ' ')).filter(Boolean);
  return lines.length ? lines.join('\n') : null;
}

export function clean(value: string | null | undefined): string | null {
  const trimmed = value?.trim().replace(/\s+/g, ' ');
  return trimmed ? trimmed : null;
}

export function required(value: string | null | undefined, message: string): string {
  const text = clean(value);
  if (!text) throw new BadRequestException(message);
  return text;
}

/** Text llarg (observacions): conserva els salts de línia. */
function multiline(value: string | null | undefined): string | null {
  const trimmed = value?.replace(/\r\n/g, '\n').trim();
  return trimmed ? trimmed : null;
}
