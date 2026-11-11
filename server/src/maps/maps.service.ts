import { BadRequestException, Injectable, NotFoundException, PayloadTooLargeException } from '@nestjs/common';
import { createReadStream, existsSync } from 'node:fs';
import { unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { PrismaService } from '../prisma.service';
import { OPERATOR } from '../common/operator';
import { ASSETS_DIR } from '../common/paths';
import { clean, required } from '../equipment/equipment.service';

/** Escena buida d'un mapa nou (format: web/src/features/equipment/map/scene.ts). */
const EMPTY_SCENE = { version: 1, units: 'm', layers: [], elements: [] };
/** Mida màxima de l'escena desada (JSON). */
const MAX_SCENE_BYTES = 30 * 1024 * 1024;
export const MAX_ASSET_BYTES = 150 * 1024 * 1024;

/** Formats que es poden pujar: models 3D i imatges de fons. (SVG i DXF es converteixen al navegador en elements.) */
const ASSET_TYPES: Record<string, string> = {
  glb: 'model/gltf-binary',
  gltf: 'model/gltf+json',
  obj: 'model/obj',
  mtl: 'text/plain',
  stl: 'model/stl',
  fbx: 'application/octet-stream',
  ply: 'application/octet-stream',
  '3mf': 'model/3mf',
  dae: 'model/vnd.collada+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};

@Injectable()
export class MapsService {
  constructor(private readonly prisma: PrismaService) {}

  async get(id: string) {
    const map = await this.prisma.mapPlan.findUnique({
      where: { id },
      include: { assets: { orderBy: { createdAt: 'asc' }, select: { id: true, fileName: true, mime: true, size: true, createdAt: true } } },
    });
    if (!map) throw new NotFoundException('El mapa no existeix');
    let scene: unknown = EMPTY_SCENE;
    try {
      scene = JSON.parse(map.scene);
    } catch {
      // Escena malmesa: es torna buida perquè es pugui tornar a desar.
    }
    return { id: map.id, name: map.name, position: map.position, scene, assets: map.assets, updatedAt: map.updatedAt, updatedByName: map.updatedByName ?? map.createdByName };
  }

  async create(body: { name?: string; scene?: unknown }) {
    const count = await this.prisma.mapPlan.count();
    const row = await this.prisma.mapPlan.create({
      data: {
        name: required(body.name, 'Posa un nom al mapa'),
        position: count,
        scene: this.sceneText(body.scene ?? EMPTY_SCENE),
        createdByName: OPERATOR,
      },
    });
    return { id: row.id };
  }

  async update(id: string, body: { name?: string; scene?: unknown; position?: number }) {
    await this.require(id);
    await this.prisma.mapPlan.update({
      where: { id },
      data: {
        ...(body.name !== undefined ? { name: required(body.name, 'Posa un nom al mapa') } : {}),
        ...(body.scene !== undefined ? { scene: this.sceneText(body.scene) } : {}),
        ...(typeof body.position === 'number' ? { position: Math.max(0, Math.trunc(body.position)) } : {}),
        updatedByName: OPERATOR,
      },
    });
    return { ok: true };
  }

  async remove(id: string) {
    await this.require(id);
    const assets = await this.prisma.mapAsset.findMany({ where: { mapId: id }, select: { id: true } });
    await this.prisma.$transaction([
      this.prisma.equipment.updateMany({ where: { mapId: id }, data: { mapId: null, mapX: null, mapY: null, mapCode: null } }),
      this.prisma.mapPlan.delete({ where: { id } }),
    ]);
    await Promise.all(assets.map((asset) => unlink(this.assetPath(asset.id)).catch(() => undefined)));
    return { ok: true };
  }

  async addAsset(mapId: string, file: { originalname: string; size: number; buffer: Buffer } | undefined) {
    await this.require(mapId);
    if (!file?.buffer?.length) throw new BadRequestException('Falta el fitxer');
    if (file.size > MAX_ASSET_BYTES) throw new PayloadTooLargeException('El fitxer és massa gran');
    const fileName = clean(path.basename(file.originalname).replace(/[^\w.\- ()]/g, '_')) ?? 'fitxer';
    const extension = fileName.split('.').pop()?.toLowerCase() ?? '';
    const mime = ASSET_TYPES[extension];
    if (!mime) throw new BadRequestException(`Format no admès (.${extension}). Admesos: ${Object.keys(ASSET_TYPES).join(', ')}`);
    const row = await this.prisma.mapAsset.create({ data: { mapId, fileName, mime, size: file.size } });
    try {
      await writeFile(this.assetPath(row.id), file.buffer);
    } catch (error) {
      await this.prisma.mapAsset.delete({ where: { id: row.id } });
      throw error;
    }
    return { id: row.id, fileName, mime, size: file.size };
  }

  async openAsset(id: string) {
    const asset = await this.prisma.mapAsset.findUnique({ where: { id } });
    if (!asset || !existsSync(this.assetPath(id))) throw new NotFoundException('El fitxer no existeix');
    return { asset, stream: createReadStream(this.assetPath(id)) };
  }

  async removeAsset(id: string) {
    const asset = await this.prisma.mapAsset.findUnique({ where: { id } });
    if (!asset) throw new NotFoundException('El fitxer no existeix');
    await this.prisma.mapAsset.delete({ where: { id } });
    await unlink(this.assetPath(id)).catch(() => undefined);
    return { ok: true };
  }

  private assetPath(id: string) {
    if (!/^[a-z0-9]+$/i.test(id)) throw new BadRequestException('Fitxer no vàlid');
    return path.join(ASSETS_DIR, id);
  }

  private sceneText(scene: unknown): string {
    if (!scene || typeof scene !== 'object' || !Array.isArray((scene as { elements?: unknown }).elements)) {
      throw new BadRequestException('L’escena no té el format esperat');
    }
    const text = JSON.stringify(scene);
    if (Buffer.byteLength(text) > MAX_SCENE_BYTES) throw new PayloadTooLargeException('L’escena és massa gran: simplifica el plànol importat');
    return text;
  }

  private async require(id: string) {
    const exists = await this.prisma.mapPlan.count({ where: { id } });
    if (!exists) throw new NotFoundException('El mapa no existeix');
  }
}
