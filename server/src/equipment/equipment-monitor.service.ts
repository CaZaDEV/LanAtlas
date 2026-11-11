import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../prisma.service';
import { cleanWebhooks, sendWebhook } from './equipment-webhooks';
import { probeHttp, probePing, probeTcp, type ProbeResult } from './equipment-probe';
import {
  checkLabel,
  cleanRanges,
  computeAlerts,
  localDay,
  nextCheckState,
  normalizeHost,
  type AlertKind,
  type CheckState,
  type DesiredAlert,
  type SnapshotEquipment,
} from './equipment.rules';

const TICK_MS = 30_000;
const RECONCILE_MS = 60 * 60_000;
const CONCURRENCY = 8;
/** Quant temps es guarden resums diaris, canvis d'estat i alertes tancades. */
const RETENTION_DAYS = 400;

const checkInclude = {
  equipment: {
    select: {
      id: true,
      name: true,
      status: true,
      addresses: { orderBy: { position: 'asc' }, select: { ip: true, mode: true } },
    },
  },
} satisfies Prisma.EquipmentCheckInclude;

type CheckRow = Prisma.EquipmentCheckGetPayload<{ include: typeof checkInclude }>;

const KIND_LABEL: Record<AlertKind, string> = {
  DOWN: 'Equip caigut',
  LICENSE_EXPIRING: 'Llicència a punt de caducar',
  LICENSE_EXPIRED: 'Llicència caducada',
  LICENSE_OVERUSED: 'Llicència amb massa equips',
  CERT_EXPIRING: 'Certificat a punt de caducar',
  IP_DUPLICATE: 'IP repetida',
  IP_IN_DHCP: 'IP fixa dins del rang DHCP',
};

/** Host d'una prova: el seu objectiu o la primera IP fixa de l'equip. */
export function checkHost(check: { target: string | null }, addresses: { ip: string | null; mode: string }[]): string | null {
  if (check.target) return normalizeHost(check.target);
  const first = addresses.find((address) => address.mode === 'STATIC' && address.ip);
  return first?.ip ? normalizeHost(first.ip) : null;
}

/**
 * Monitor del mòdul Equips i xarxa: cada 30 s llança les proves vençudes
 * (màxim 8 alhora) i, quan algun estat canvia i cada hora, recalcula les
 * alertes i avisa pels webhooks de Configuració. `MONITOR_ENABLED=0`
 * l'apaga; «Prova ara» funciona igualment.
 */
@Injectable()
export class EquipmentMonitorService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('EquipmentMonitor');
  private timers: ReturnType<typeof setInterval>[] = [];
  private starters: ReturnType<typeof setTimeout>[] = [];
  private ticking = false;
  private reconciling: Promise<void> | null = null;
  private reconcileAgain = false;

  constructor(
    private readonly prisma: PrismaService,
  ) {}

  onModuleInit() {
    if (process.env.MONITOR_ENABLED === '0' || process.env.NODE_ENV === 'test') return;
    this.timers.push(setInterval(() => void this.tick(), TICK_MS));
    this.timers.push(setInterval(() => void this.hourly(), RECONCILE_MS));
    this.starters.push(setTimeout(() => void this.tick(), 30_000));
    this.starters.push(setTimeout(() => void this.hourly(), 60_000));
  }

  onModuleDestroy() {
    this.timers.forEach((timer) => clearInterval(timer));
    this.starters.forEach((timer) => clearTimeout(timer));
  }

  // ── Proves ───────────────────────────────────────────────────────────────

  async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const now = Date.now();
      const checks = await this.prisma.equipmentCheck.findMany({
        where: { enabled: true, equipment: { status: { not: 'RETIRED' } } },
        include: checkInclude,
      });
      const due = checks.filter((check) => !check.lastRunAt || now - check.lastRunAt.getTime() >= check.intervalSec * 1000 - 2000);
      let changed = false;
      for (let index = 0; index < due.length; index += CONCURRENCY) {
        const results = await Promise.all(due.slice(index, index + CONCURRENCY).map((check) => this.execute(check)));
        changed = changed || results.some((result) => result.changed);
      }
      if (changed) await this.reconcile();
    } catch (error) {
      this.logger.warn(`Error al monitor: ${(error as Error).message}`);
    } finally {
      this.ticking = false;
    }
  }

  /** «Prova ara» d'una prova. Retorna el resultat i reprèn les alertes si cal. */
  async runCheck(checkId: string): Promise<ProbeResult & { changed: boolean }> {
    const check = await this.prisma.equipmentCheck.findUniqueOrThrow({ where: { id: checkId }, include: checkInclude });
    const result = await this.execute(check);
    if (result.changed) await this.reconcile();
    return result;
  }

  async runEquipment(equipmentId: string): Promise<void> {
    const checks = await this.prisma.equipmentCheck.findMany({ where: { equipmentId }, include: checkInclude });
    const results = await Promise.all(checks.map((check) => this.execute(check)));
    if (results.some((result) => result.changed)) await this.reconcile();
  }

  private async execute(check: CheckRow): Promise<ProbeResult & { changed: boolean }> {
    const host = checkHost(check, check.equipment.addresses);
    let result: ProbeResult;
    if (check.kind === 'HTTP' && check.url) {
      result = await probeHttp(check.url);
    } else if (!host) {
      result = { ok: false, latencyMs: null, error: 'L’equip no té cap IP fixa per provar', unavailable: true };
    } else if (check.kind === 'PING') {
      result = await probePing(host);
    } else if (check.kind === 'TCP') {
      result = check.port ? await probeTcp(host, check.port) : { ok: false, latencyMs: null, error: 'Falta el port', unavailable: true };
    } else {
      result = await probeHttp(`http://${host}/`);
    }
    return { ...result, changed: await this.store(check, result) };
  }

  /** Desa el resultat; true si l'estat de la prova ha canviat. */
  private async store(check: CheckRow, result: ProbeResult): Promise<boolean> {
    const now = new Date();
    if (result.unavailable) {
      await this.prisma.equipmentCheck.update({
        where: { id: check.id },
        data: { lastRunAt: now, lastOk: null, lastLatencyMs: null, lastError: result.error },
      });
      return false;
    }
    const next = nextCheckState(
      { state: check.state as CheckState, consecutiveFails: check.consecutiveFails },
      result.ok,
      check.failThreshold,
    );
    const day = new Date(`${localDay(now)}T00:00:00Z`);
    await this.prisma.$transaction([
      this.prisma.equipmentCheck.update({
        where: { id: check.id },
        data: {
          lastRunAt: now,
          lastOk: result.ok,
          lastLatencyMs: result.latencyMs,
          lastError: result.ok ? null : result.error,
          state: next.state,
          consecutiveFails: next.consecutiveFails,
          ...(next.changed ? { stateSince: now } : {}),
          ...(result.certExpiresAt !== undefined && check.kind === 'HTTP' ? { certExpiresAt: result.certExpiresAt } : {}),
        },
      }),
      this.prisma.equipmentCheckDaily.upsert({
        where: { checkId_day: { checkId: check.id, day } },
        create: {
          checkId: check.id,
          day,
          okCount: result.ok ? 1 : 0,
          failCount: result.ok ? 0 : 1,
          latencySumMs: result.ok ? result.latencyMs ?? 0 : 0,
        },
        update: result.ok
          ? { okCount: { increment: 1 }, latencySumMs: { increment: result.latencyMs ?? 0 } }
          : { failCount: { increment: 1 } },
      }),
      ...(next.changed && next.state !== 'UNKNOWN'
        ? [this.prisma.equipmentCheckEvent.create({ data: { checkId: check.id, at: now, state: next.state, error: result.ok ? null : result.error } })]
        : []),
    ]);
    return next.changed;
  }

  // ── Alertes ──────────────────────────────────────────────────────────────

  /** Recalcula les alertes ara (sense encavalcar-se: si ja n'hi ha una en curs, en farà una altra després). */
  async reconcile(): Promise<void> {
    if (this.reconciling) {
      this.reconcileAgain = true;
      return this.reconciling;
    }
    this.reconciling = (async () => {
      do {
        this.reconcileAgain = false;
        try {
          await this.reconcileOnce();
        } catch (error) {
          this.logger.warn(`Error recalculant alertes: ${(error as Error).message}`);
        }
      } while (this.reconcileAgain);
    })().finally(() => {
      this.reconciling = null;
    });
    return this.reconciling;
  }

  /** Per a les escriptures del servei: no fa esperar la resposta. */
  requestReconcile() {
    void this.reconcile();
  }

  private async hourly() {
    await this.reconcile();
    const limit = new Date(Date.now() - RETENTION_DAYS * 86_400_000);
    try {
      await this.prisma.$transaction([
        this.prisma.equipmentCheckDaily.deleteMany({ where: { day: { lt: limit } } }),
        this.prisma.equipmentCheckEvent.deleteMany({ where: { at: { lt: limit } } }),
        this.prisma.equipmentAlert.deleteMany({ where: { closedAt: { lt: limit } } }),
      ]);
    } catch (error) {
      this.logger.warn(`Error netejant l'historial: ${(error as Error).message}`);
    }
  }

  private async reconcileOnce() {
    const now = new Date();
    const [settings, equipment, licenses, open] = await Promise.all([
      this.prisma.equipmentSettings.findUnique({ where: { id: 'default' } }),
      this.prisma.equipment.findMany({
        select: {
          id: true,
          name: true,
          critical: true,
          status: true,
          addresses: { orderBy: { position: 'asc' }, select: { ip: true, mode: true } },
          checks: true,
        },
      }),
      this.prisma.equipmentLicense.findMany({ include: { _count: { select: { assignments: true } } } }),
      this.prisma.equipmentAlert.findMany({ where: { closedAt: null } }),
    ]);

    const desired = computeAlerts({
      now,
      ranges: cleanRanges(parseJson(settings?.dhcpRanges)),
      licenseWarnDays: settings?.licenseWarnDays ?? 30,
      certWarnDays: settings?.certWarnDays ?? 21,
      equipment: equipment.map((item) => ({
        id: item.id,
        name: item.name,
        critical: item.critical,
        status: item.status as SnapshotEquipment['status'],
        addresses: item.addresses as SnapshotEquipment['addresses'],
        checks: item.checks.map((check) => ({
          id: check.id,
          kind: check.kind as 'PING' | 'TCP' | 'HTTP',
          enabled: check.enabled,
          state: check.state as CheckState,
          lastError: check.lastError,
          certExpiresAt: check.certExpiresAt,
          label: checkLabel({ kind: check.kind as 'PING' | 'TCP' | 'HTTP', port: check.port, url: check.url }, checkHost(check, item.addresses)),
        })),
      })),
      licenses: licenses.map((license) => ({
        id: license.id,
        label: [license.product, license.version].filter(Boolean).join(' '),
        kind: license.kind,
        seats: license.seats,
        expiresAt: license.expiresAt,
        assigned: license._count.assignments,
      })),
    });

    const wanted = new Map(desired.map((alert) => [alert.key, alert]));
    const openKeys = new Set(open.map((alert) => alert.key));
    const opened: DesiredAlert[] = [];
    for (const alert of desired) {
      if (openKeys.has(alert.key)) continue;
      try {
        await this.prisma.equipmentAlert.create({
          data: {
            kind: alert.kind,
            key: alert.key,
            equipmentId: alert.equipmentId ?? null,
            licenseId: alert.licenseId ?? null,
            checkId: alert.checkId ?? null,
            message: alert.message,
            openedAt: now,
          },
        });
        opened.push(alert);
      } catch (error) {
        // P2002: una altra execució l'ha oberta just ara (índex únic de les obertes, a la migració).
        if ((error as Prisma.PrismaClientKnownRequestError).code !== 'P2002') throw error;
      }
    }
    const recovered: string[] = [];
    for (const alert of open) {
      const still = wanted.get(alert.key);
      if (still) {
        if (still.message !== alert.message) {
          await this.prisma.equipmentAlert.update({ where: { id: alert.id }, data: { message: still.message } });
        }
        continue;
      }
      await this.prisma.equipmentAlert.update({ where: { id: alert.id }, data: { closedAt: now } });
      if (alert.kind === 'DOWN') {
        const item = equipment.find((row) => row.id === alert.equipmentId);
        if (item) recovered.push(`✅ ${item.name} torna a respondre.`);
      }
    }

    if (opened.length || recovered.length) {
      const lines = [
        ...opened.map((alert) => `${alert.kind === 'DOWN' ? '🔴' : '⚠️'} ${KIND_LABEL[alert.kind as AlertKind]}: ${alert.message}`),
        ...recovered,
      ];
      await this.notify(cleanWebhooks(parseJson(settings?.webhooks)), lines);
    }
  }

  private async notify(hooks: ReturnType<typeof cleanWebhooks>, lines: string[]) {
    for (const hook of hooks) {
      const result = await sendWebhook(hook, 'LanAtlas · alertes', lines);
      if (!result.ok) this.logger.warn(`No s'ha pogut avisar ${new URL(hook.url).host}: ${result.error}`);
    }
  }
}

function parseJson(value: string | null | undefined): unknown {
  try {
    return JSON.parse(value ?? '[]');
  } catch {
    return [];
  }
}