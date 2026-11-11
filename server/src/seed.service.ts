import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';

import { PrismaService } from './prisma.service';
import { OPERATOR } from './common/operator';

/** Tipus d'equip per defecte (els ids els fa servir la identificació automàtica de la pestanya IPs). */
const DEFAULT_TYPES = [
  ['type-pc', 'Ordinador', 'monitor', '#2442b5'],
  ['type-laptop', 'Portàtil', 'laptop', '#1f7f9c'],
  ['type-server', 'Servidor', 'server', '#7147b6'],
  ['type-printer', 'Impressora', 'printer', '#bf6728'],
  ['type-machine', 'Màquina / PLC', 'factory', '#b42318'],
  ['type-terminal', 'Terminal', 'fingerprint', '#117963'],
  ['type-network', 'Xarxa', 'router', '#0f766e'],
  ['type-camera', 'Càmera', 'cctv', '#475569'],
  ['type-iot', 'Instal·lació / IoT', 'cpu', '#a16207'],
  ['type-other', 'Altres', 'box', '#64748b'],
] as const;

/** Primer arrencada: tipus per defecte, configuració i un mapa buit. No toca res si ja hi ha dades. */
@Injectable()
export class SeedService implements OnApplicationBootstrap {
  private readonly logger = new Logger('Seed');

  constructor(private readonly prisma: PrismaService) {}

  async onApplicationBootstrap() {
    if ((await this.prisma.equipmentType.count()) === 0) {
      await this.prisma.equipmentType.createMany({
        data: DEFAULT_TYPES.map(([id, name, icon, color], index) => ({ id, name, icon, color, position: index + 1 })),
      });
      this.logger.log('Tipus d’equip per defecte creats');
    }
    await this.prisma.equipmentSettings.upsert({ where: { id: 'default' }, create: { id: 'default' }, update: {} });
    if ((await this.prisma.mapPlan.count()) === 0) {
      await this.prisma.mapPlan.create({ data: { name: 'Planta principal', createdByName: OPERATOR } });
    }
  }
}
