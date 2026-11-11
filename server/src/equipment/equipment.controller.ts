import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put } from '@nestjs/common';

import { CheckDto, EquipmentDto, IdentifyDto, LicenseDto, LocationDto, ScanDto, SecretDto, SettingsDto, TypeDto, WebhookDto } from './dto/equipment.dto';
import { EquipmentService } from './equipment.service';

/** API de l'inventari: equips, llicències, credencials, proves, alertes, IPs i configuració. */
@Controller('equipment')
export class EquipmentController {
  constructor(private readonly equipment: EquipmentService) {}

  @Get('state')
  state() {
    return this.equipment.state();
  }

  // Equips
  @Post('items')
  createItem(@Body() dto: EquipmentDto) {
    return this.equipment.createEquipment(dto);
  }

  @Put('items/:id')
  updateItem(@Param('id') id: string, @Body() dto: EquipmentDto) {
    return this.equipment.updateEquipment(id, dto);
  }

  @Delete('items/:id')
  deleteItem(@Param('id') id: string) {
    return this.equipment.deleteEquipment(id);
  }

  @Put('items/:id/location')
  setLocation(@Param('id') id: string, @Body() dto: LocationDto) {
    return this.equipment.setLocation(id, dto);
  }

  @Get('items/:id/history')
  history(@Param('id') id: string) {
    return this.equipment.history(id);
  }

  @Post('items/:id/run')
  @HttpCode(200)
  runItem(@Param('id') id: string) {
    return this.equipment.runEquipment(id);
  }

  // IPs
  @Post('scan')
  @HttpCode(200)
  scan(@Body() dto: ScanDto) {
    return this.equipment.scanIps(dto.ips);
  }

  @Post('identify')
  @HttpCode(200)
  identify(@Body() dto: IdentifyDto) {
    return this.equipment.identifyIp(dto.ip);
  }

  @Get('networks')
  networks() {
    return this.equipment.networkSuggestions();
  }

  // Credencials
  @Post('items/:id/secrets')
  createSecret(@Param('id') id: string, @Body() dto: SecretDto) {
    return this.equipment.createSecret(id, dto);
  }

  @Put('secrets/:id')
  updateSecret(@Param('id') id: string, @Body() dto: SecretDto) {
    return this.equipment.updateSecret(id, dto);
  }

  @Delete('secrets/:id')
  deleteSecret(@Param('id') id: string) {
    return this.equipment.deleteSecret(id);
  }

  @Post('secrets/:id/reveal')
  @HttpCode(200)
  revealSecret(@Param('id') id: string) {
    return this.equipment.revealSecret(id);
  }

  // Proves
  @Post('items/:id/checks')
  createCheck(@Param('id') id: string, @Body() dto: CheckDto) {
    return this.equipment.createCheck(id, dto);
  }

  @Put('checks/:id')
  updateCheck(@Param('id') id: string, @Body() dto: CheckDto) {
    return this.equipment.updateCheck(id, dto);
  }

  @Delete('checks/:id')
  deleteCheck(@Param('id') id: string) {
    return this.equipment.deleteCheck(id);
  }

  @Post('checks/:id/run')
  @HttpCode(200)
  runCheck(@Param('id') id: string) {
    return this.equipment.runCheck(id);
  }

  // Llicències
  @Post('licenses')
  createLicense(@Body() dto: LicenseDto) {
    return this.equipment.createLicense(dto);
  }

  @Put('licenses/:id')
  updateLicense(@Param('id') id: string, @Body() dto: LicenseDto) {
    return this.equipment.updateLicense(id, dto);
  }

  @Delete('licenses/:id')
  deleteLicense(@Param('id') id: string) {
    return this.equipment.deleteLicense(id);
  }

  @Post('licenses/:id/reveal')
  @HttpCode(200)
  revealLicense(@Param('id') id: string) {
    return this.equipment.revealLicenseKey(id);
  }

  // Tipus, configuració i alertes
  @Post('types')
  createType(@Body() dto: TypeDto) {
    return this.equipment.createType(dto);
  }

  @Put('types/:id')
  updateType(@Param('id') id: string, @Body() dto: TypeDto) {
    return this.equipment.updateType(id, dto);
  }

  @Delete('types/:id')
  deleteType(@Param('id') id: string) {
    return this.equipment.deleteType(id);
  }

  @Patch('settings')
  updateSettings(@Body() dto: SettingsDto) {
    return this.equipment.updateSettings(dto);
  }

  @Post('settings/webhook-test')
  @HttpCode(200)
  testWebhook(@Body() dto: WebhookDto) {
    return this.equipment.testWebhook(dto);
  }

  @Post('alerts/:id/ack')
  @HttpCode(200)
  ackAlert(@Param('id') id: string) {
    return this.equipment.ackAlert(id);
  }
}
