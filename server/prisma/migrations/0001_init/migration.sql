-- CreateTable
CREATE TABLE "EquipmentType" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "icon" TEXT NOT NULL DEFAULT 'box',
    "color" TEXT NOT NULL DEFAULT '#475569',
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Equipment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "number" TEXT,
    "name" TEXT NOT NULL,
    "typeId" TEXT NOT NULL,
    "brand" TEXT,
    "model" TEXT,
    "serial" TEXT,
    "acquired" TEXT,
    "price" REAL,
    "location" TEXT,
    "os" TEXT,
    "assignedName" TEXT,
    "ownership" TEXT NOT NULL DEFAULT 'COMPANY',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "critical" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "needsReview" BOOLEAN NOT NULL DEFAULT false,
    "reviewNote" TEXT,
    "mapId" TEXT,
    "mapX" REAL,
    "mapY" REAL,
    "mapCode" TEXT,
    "createdByName" TEXT NOT NULL,
    "updatedByName" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Equipment_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "EquipmentType" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Equipment_mapId_fkey" FOREIGN KEY ("mapId") REFERENCES "MapPlan" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "EquipmentAddress" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "equipmentId" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "ip" TEXT,
    "mode" TEXT NOT NULL DEFAULT 'STATIC',
    "label" TEXT,
    "mac" TEXT,
    CONSTRAINT "EquipmentAddress_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "Equipment" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "EquipmentSoftware" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "equipmentId" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "name" TEXT NOT NULL,
    "version" TEXT,
    "notes" TEXT,
    CONSTRAINT "EquipmentSoftware_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "Equipment" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "EquipmentLicense" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "product" TEXT NOT NULL,
    "version" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'OTHER',
    "seats" INTEGER,
    "keyCipher" TEXT,
    "keyHint" TEXT,
    "vendor" TEXT,
    "purchasedAt" DATETIME,
    "expiresAt" DATETIME,
    "cost" REAL,
    "notes" TEXT,
    "createdByName" TEXT NOT NULL,
    "updatedByName" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "EquipmentLicenseAssignment" (
    "licenseId" TEXT NOT NULL,
    "equipmentId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("licenseId", "equipmentId"),
    CONSTRAINT "EquipmentLicenseAssignment_licenseId_fkey" FOREIGN KEY ("licenseId") REFERENCES "EquipmentLicense" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "EquipmentLicenseAssignment_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "Equipment" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "EquipmentSecret" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "equipmentId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "username" TEXT,
    "valueCipher" TEXT NOT NULL,
    "notes" TEXT,
    "createdByName" TEXT NOT NULL,
    "updatedByName" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "EquipmentSecret_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "Equipment" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "EquipmentCheck" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "equipmentId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "target" TEXT,
    "port" INTEGER,
    "url" TEXT,
    "intervalSec" INTEGER NOT NULL DEFAULT 300,
    "failThreshold" INTEGER NOT NULL DEFAULT 3,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "state" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "stateSince" DATETIME,
    "consecutiveFails" INTEGER NOT NULL DEFAULT 0,
    "lastRunAt" DATETIME,
    "lastOk" BOOLEAN,
    "lastLatencyMs" INTEGER,
    "lastError" TEXT,
    "certExpiresAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "EquipmentCheck_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "Equipment" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "EquipmentCheckDaily" (
    "checkId" TEXT NOT NULL,
    "day" DATETIME NOT NULL,
    "okCount" INTEGER NOT NULL DEFAULT 0,
    "failCount" INTEGER NOT NULL DEFAULT 0,
    "latencySumMs" INTEGER NOT NULL DEFAULT 0,

    PRIMARY KEY ("checkId", "day"),
    CONSTRAINT "EquipmentCheckDaily_checkId_fkey" FOREIGN KEY ("checkId") REFERENCES "EquipmentCheck" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "EquipmentCheckEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "checkId" TEXT NOT NULL,
    "at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "state" TEXT NOT NULL,
    "error" TEXT,
    CONSTRAINT "EquipmentCheckEvent_checkId_fkey" FOREIGN KEY ("checkId") REFERENCES "EquipmentCheck" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "EquipmentAlert" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "kind" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "equipmentId" TEXT,
    "licenseId" TEXT,
    "checkId" TEXT,
    "message" TEXT NOT NULL,
    "openedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" DATETIME,
    "ackedAt" DATETIME,
    "ackedByName" TEXT,
    CONSTRAINT "EquipmentAlert_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "Equipment" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "EquipmentAlert_licenseId_fkey" FOREIGN KEY ("licenseId") REFERENCES "EquipmentLicense" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "EquipmentAlert_checkId_fkey" FOREIGN KEY ("checkId") REFERENCES "EquipmentCheck" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "EquipmentSettings" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'default',
    "managedRanges" TEXT NOT NULL DEFAULT '[]',
    "dhcpRanges" TEXT NOT NULL DEFAULT '[]',
    "webhooks" TEXT NOT NULL DEFAULT '[]',
    "licenseWarnDays" INTEGER NOT NULL DEFAULT 30,
    "certWarnDays" INTEGER NOT NULL DEFAULT 21,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "updatedByName" TEXT,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "MapPlan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "scene" TEXT NOT NULL DEFAULT '{"version":1,"layers":[],"elements":[]}',
    "createdByName" TEXT NOT NULL,
    "updatedByName" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "MapAsset" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "mapId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MapAsset_mapId_fkey" FOREIGN KEY ("mapId") REFERENCES "MapPlan" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "EquipmentType_name_key" ON "EquipmentType"("name");

-- CreateIndex
CREATE INDEX "Equipment_typeId_idx" ON "Equipment"("typeId");

-- CreateIndex
CREATE INDEX "Equipment_number_idx" ON "Equipment"("number");

-- CreateIndex
CREATE INDEX "Equipment_mapId_idx" ON "Equipment"("mapId");

-- CreateIndex
CREATE INDEX "EquipmentAddress_equipmentId_idx" ON "EquipmentAddress"("equipmentId");

-- CreateIndex
CREATE INDEX "EquipmentAddress_ip_idx" ON "EquipmentAddress"("ip");

-- CreateIndex
CREATE INDEX "EquipmentSoftware_equipmentId_idx" ON "EquipmentSoftware"("equipmentId");

-- CreateIndex
CREATE INDEX "EquipmentLicense_product_idx" ON "EquipmentLicense"("product");

-- CreateIndex
CREATE INDEX "EquipmentLicenseAssignment_equipmentId_idx" ON "EquipmentLicenseAssignment"("equipmentId");

-- CreateIndex
CREATE INDEX "EquipmentSecret_equipmentId_idx" ON "EquipmentSecret"("equipmentId");

-- CreateIndex
CREATE INDEX "EquipmentCheck_equipmentId_idx" ON "EquipmentCheck"("equipmentId");

-- CreateIndex
CREATE INDEX "EquipmentCheck_enabled_lastRunAt_idx" ON "EquipmentCheck"("enabled", "lastRunAt");

-- CreateIndex
CREATE INDEX "EquipmentCheckEvent_checkId_at_idx" ON "EquipmentCheckEvent"("checkId", "at");

-- CreateIndex
CREATE INDEX "EquipmentAlert_key_closedAt_idx" ON "EquipmentAlert"("key", "closedAt");

-- CreateIndex
CREATE INDEX "EquipmentAlert_closedAt_openedAt_idx" ON "EquipmentAlert"("closedAt", "openedAt");

-- CreateIndex
CREATE INDEX "MapAsset_mapId_idx" ON "MapAsset"("mapId");

-- Una sola alerta oberta per clau (el monitor ho aprofita per no duplicar-les).
CREATE UNIQUE INDEX "EquipmentAlert_open_key" ON "EquipmentAlert"("key") WHERE "closedAt" IS NULL;

