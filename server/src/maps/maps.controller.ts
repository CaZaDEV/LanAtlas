import { Body, Controller, Delete, Get, Param, Post, Put, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';

import { MAX_ASSET_BYTES, MapsService } from './maps.service';

/** Mapes 3D: escena editable (JSON) i fitxers pujats (models 3D i imatges de fons). */
@Controller('maps')
export class MapsController {
  constructor(private readonly maps: MapsService) {}

  @Get(':id')
  get(@Param('id') id: string) {
    return this.maps.get(id);
  }

  @Post()
  create(@Body() body: { name?: string; scene?: unknown }) {
    return this.maps.create(body);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() body: { name?: string; scene?: unknown; position?: number }) {
    return this.maps.update(id, body);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.maps.remove(id);
  }

  @Post(':id/assets')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_ASSET_BYTES } }))
  addAsset(@Param('id') id: string, @UploadedFile() file: { originalname: string; size: number; buffer: Buffer } | undefined) {
    return this.maps.addAsset(id, file);
  }

  @Get('assets/:assetId')
  async asset(@Param('assetId') assetId: string, @Res() res: Response) {
    const { asset, stream } = await this.maps.openAsset(assetId);
    res.setHeader('Content-Type', asset.mime);
    res.setHeader('Content-Length', String(asset.size));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
    stream.pipe(res);
  }

  @Delete('assets/:assetId')
  removeAsset(@Param('assetId') assetId: string) {
    return this.maps.removeAsset(assetId);
  }
}
