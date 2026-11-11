import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

/** Pestanya IPs: llista d'IPs a rastrejar (el client parteix els rangs grans en trossos de 1024). */
export class ScanDto {
  @IsArray()
  @ArrayMaxSize(1024)
  @IsString({ each: true })
  @MaxLength(15, { each: true })
  ips!: string[];
}

/** Pestanya IPs: identificar l'aparell d'una IP. */
export class IdentifyDto {
  @IsString()
  @MaxLength(15)
  ip!: string;
}

const OWNERSHIP = ['COMPANY', 'PERSONAL'] as const;
const STATUS = ['ACTIVE', 'SPARE', 'RETIRED'] as const;
const ADDRESS_MODE = ['STATIC', 'DHCP'] as const;
const LICENSE_KIND = ['PERPETUAL', 'SUBSCRIPTION', 'OEM', 'FLOATING', 'FIXED', 'OTHER'] as const;
const CHECK_KIND = ['PING', 'TCP', 'HTTP'] as const;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export class AddressDto {
  /** IPv4 o nom de host. Buida si és DHCP sense IP coneguda. */
  @IsOptional()
  @IsString()
  @MaxLength(253)
  ip?: string | null;

  @IsIn(ADDRESS_MODE)
  mode!: (typeof ADDRESS_MODE)[number];

  @IsOptional()
  @IsString()
  @MaxLength(60)
  label?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  mac?: string | null;
}

export class SoftwareDto {
  @IsString()
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  version?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  notes?: string | null;
}

/** Alta i edició d'un equip. Les llistes (IPs, programes, llicències) substitueixen les anteriors. */
export class EquipmentDto {
  @IsOptional()
  @IsString()
  @MaxLength(20)
  number?: string | null;

  @IsString()
  @MaxLength(120)
  name!: string;

  @IsString()
  @MaxLength(40)
  typeId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  brand?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  model?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  serial?: string | null;

  /** «2016-05», «05-2016» o «2016». */
  @IsOptional()
  @IsString()
  @MaxLength(10)
  acquired?: string | null;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(10_000_000)
  price?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  location?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  os?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  assignedName?: string | null;

  @IsIn(OWNERSHIP)
  ownership!: (typeof OWNERSHIP)[number];

  @IsIn(STATUS)
  status!: (typeof STATUS)[number];

  @IsBoolean()
  critical!: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  notes?: string | null;

  @IsBoolean()
  needsReview!: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reviewNote?: string | null;

  @IsArray()
  @ArrayMaxSize(16)
  @ValidateNested({ each: true })
  @Type(() => AddressDto)
  addresses!: AddressDto[];

  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => SoftwareDto)
  software!: SoftwareDto[];

  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  licenseIds!: string[];

  /** En crear: afegeix una prova de ping a la primera IP fixa. */
  @IsOptional()
  @IsBoolean()
  addPing?: boolean;
}

export class LicenseDto {
  @IsString()
  @MaxLength(120)
  product!: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  version?: string | null;

  @IsIn(LICENSE_KIND)
  kind!: (typeof LICENSE_KIND)[number];

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100_000)
  seats?: number | null;

  /** Clau: absent = no es toca; null o buit = s'esborra; text = es desa xifrada. */
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  key?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  keyHint?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  vendor?: string | null;

  @IsOptional()
  @Matches(DATE)
  purchasedAt?: string | null;

  @IsOptional()
  @Matches(DATE)
  expiresAt?: string | null;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(10_000_000)
  cost?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string | null;

  @IsArray()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  equipmentIds!: string[];
}

export class SecretDto {
  @IsString()
  @MaxLength(80)
  label!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  username?: string | null;

  /** Absent en editar = no es canvia. Obligatori en crear. */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  value?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string | null;
}

export class CheckDto {
  @IsIn(CHECK_KIND)
  kind!: (typeof CHECK_KIND)[number];

  @IsOptional()
  @IsString()
  @MaxLength(253)
  target?: string | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  port?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  url?: string | null;

  @IsInt()
  @Min(60)
  @Max(86_400)
  intervalSec!: number;

  @IsInt()
  @Min(1)
  @Max(20)
  failThreshold!: number;

  @IsBoolean()
  enabled!: boolean;
}

export class TypeDto {
  @IsString()
  @MaxLength(60)
  name!: string;

  @IsString()
  @Matches(/^[a-z0-9-]{1,40}$/)
  icon!: string;

  @IsString()
  @Matches(/^#[0-9a-fA-F]{6}$/)
  color!: string;

  @IsInt()
  @Min(0)
  @Max(1000)
  position!: number;
}

export class RangeDto {
  @IsString()
  @MaxLength(15)
  from!: string;

  @IsString()
  @MaxLength(15)
  to!: string;
}

/** Rang gestionat: «192.168.1.0/24», «10.0.0.1-10.0.0.254» o «10.0.0.1-254». */
export class ManagedRangeDto {
  @IsOptional()
  @IsString()
  @MaxLength(60)
  name?: string | null;

  @IsString()
  @MaxLength(40)
  range!: string;
}

const WEBHOOK_FORMAT = ['json', 'ntfy'] as const;

export class WebhookDto {
  @IsString()
  @MaxLength(500)
  url!: string;

  @IsIn(WEBHOOK_FORMAT)
  format!: (typeof WEBHOOK_FORMAT)[number];
}

export class SettingsDto {
  @IsArray()
  @ArrayMaxSize(32)
  @ValidateNested({ each: true })
  @Type(() => ManagedRangeDto)
  managedRanges!: ManagedRangeDto[];

  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => RangeDto)
  dhcpRanges!: RangeDto[];

  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => WebhookDto)
  webhooks!: WebhookDto[];

  @IsString()
  @Matches(/^[A-Za-z]{3}$/)
  currency!: string;

  @IsInt()
  @Min(1)
  @Max(365)
  licenseWarnDays!: number;

  @IsInt()
  @Min(1)
  @Max(365)
  certWarnDays!: number;
}

/** Punt en un mapa 3D (metres, coordenades de l'escena). Tot null = treure'l del mapa. */
export class LocationDto {
  @IsOptional()
  @IsString()
  @MaxLength(40)
  mapId?: string | null;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(-100_000)
  @Max(100_000)
  mapX?: number | null;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(-100_000)
  @Max(100_000)
  mapY?: number | null;

  /** Codi de l'element del mapa («049A», «RACK-3») si s'ha posat sobre un. */
  @IsOptional()
  @IsString()
  @Matches(/^[0-9A-Za-z._-]{1,24}$/)
  mapCode?: string | null;
}
