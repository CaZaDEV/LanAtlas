import { Module } from '@nestjs/common';

import { PrismaService } from './prisma.service';
import { EquipmentController } from './equipment/equipment.controller';
import { EquipmentMonitorService } from './equipment/equipment-monitor.service';
import { EquipmentService } from './equipment/equipment.service';
import { SeedService } from './seed.service';
import { MapsController } from './maps/maps.controller';
import { MapsService } from './maps/maps.service';

@Module({
  controllers: [EquipmentController, MapsController],
  providers: [PrismaService, EquipmentService, EquipmentMonitorService, MapsService, SeedService],
})
export class AppModule {}
