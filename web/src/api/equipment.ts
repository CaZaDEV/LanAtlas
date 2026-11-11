import { api } from './client';

/** API de LanAtlas: inventari, llicències, credencials, proves, alertes, IPs i mapes. */

export type Ownership = 'COMPANY' | 'PERSONAL';
export type EquipmentStatus = 'ACTIVE' | 'SPARE' | 'RETIRED';
export type AddressMode = 'STATIC' | 'DHCP';
export type LicenseKind = 'PERPETUAL' | 'SUBSCRIPTION' | 'OEM' | 'FLOATING' | 'FIXED' | 'OTHER';
export type CheckKind = 'PING' | 'TCP' | 'HTTP';
export type CheckState = 'UNKNOWN' | 'UP' | 'DOWN';
export type NetState = CheckState | 'NONE';
export type AlertKind =
  | 'DOWN'
  | 'LICENSE_EXPIRING'
  | 'LICENSE_EXPIRED'
  | 'LICENSE_OVERUSED'
  | 'CERT_EXPIRING'
  | 'IP_DUPLICATE'
  | 'IP_IN_DHCP';

export interface EquipmentType {
  id: string;
  name: string;
  icon: string;
  color: string;
  position: number;
}

export interface EquipmentAddress {
  id?: string;
  ip: string | null;
  mode: AddressMode;
  label: string | null;
  mac: string | null;
}

export interface EquipmentSoftware {
  id?: string;
  name: string;
  version: string | null;
  notes: string | null;
}

export interface EquipmentSecretInfo {
  id: string;
  label: string;
  username: string | null;
  notes: string | null;
  updatedAt: string;
  updatedByName: string;
}

export interface EquipmentCheck {
  id: string;
  kind: CheckKind;
  target: string | null;
  port: number | null;
  url: string | null;
  label: string;
  intervalSec: number;
  failThreshold: number;
  enabled: boolean;
  state: CheckState;
  stateSince: string | null;
  lastRunAt: string | null;
  lastOk: boolean | null;
  lastLatencyMs: number | null;
  lastError: string | null;
  certExpiresAt: string | null;
  uptime30: number | null;
  avgLatencyMs: number | null;
}

export interface Equipment {
  id: string;
  number: string | null;
  name: string;
  typeId: string;
  brand: string | null;
  model: string | null;
  serial: string | null;
  acquired: string | null;
  /** Només per a qui gestiona. */
  price: number | null;
  location: string | null;
  os: string | null;
  assignedName: string | null;
  ownership: Ownership;
  status: EquipmentStatus;
  critical: boolean;
  notes: string | null;
  needsReview: boolean;
  reviewNote: string | null;
  /** Punt en un mapa 3D (metres) i codi de l'element del mapa on s'ha posat. */
  mapId: string | null;
  mapX: number | null;
  mapY: number | null;
  mapCode: string | null;
  createdByName: string;
  updatedByName: string | null;
  createdAt: string;
  updatedAt: string;
  addresses: EquipmentAddress[];
  software: EquipmentSoftware[];
  licenseIds: string[];
  /** Només per a qui gestiona (sense el valor). */
  secrets: EquipmentSecretInfo[];
  secretCount: number;
  checks: EquipmentCheck[];
  netState: NetState;
}

export interface EquipmentLicense {
  id: string;
  product: string;
  version: string | null;
  kind: LicenseKind;
  seats: number | null;
  hasKey: boolean;
  keyHint: string | null;
  vendor: string | null;
  purchasedAt: string | null;
  expiresAt: string | null;
  cost: number | null;
  notes: string | null;
  equipmentIds: string[];
  updatedAt: string;
  updatedByName: string;
}

export interface EquipmentAlert {
  id: string;
  kind: AlertKind;
  key: string;
  equipmentId: string | null;
  licenseId: string | null;
  checkId: string | null;
  message: string;
  openedAt: string;
  closedAt: string | null;
  ackedAt: string | null;
  ackedByName: string | null;
}

export interface DhcpRange {
  from: string;
  to: string;
}

export interface IpScanResult {
  at: string;
  /** El servidor no pot fer ping: el resultat no diu res. */
  unavailable: boolean;
  scanned: number;
  /** `via`: «ping» o «port 445»… (molts Windows no responen al ping). */
  responding: { ip: string; latencyMs: number | null; via: string }[];
}

/** Resultat de «Identifica» (backend equipment-discover.ts). */
export interface IpDiscovery {
  ip: string;
  at: string;
  durationMs: number;
  alive: boolean;
  names: { source: string; name: string }[];
  mac: string | null;
  workgroup: string | null;
  snmp: { descr: string | null; name: string | null; location: string | null; contact: string | null } | null;
  ports: { port: number; service: string }[];
  web: {
    port: number;
    scheme: 'http' | 'https';
    status: number | null;
    server: string | null;
    title: string | null;
    realm: string | null;
    location: string | null;
    certSubject: string | null;
    certIssuer: string | null;
  }[];
  banners: { port: number; text: string }[];
  guess: { typeId: string; label: string; confidence: 'alta' | 'mitjana' | 'baixa'; reasons: string[] };
}

/** Dades per obrir «Nou equip» ja omplert (des de la pestanya IPs). */
export interface EquipmentDraft {
  name: string;
  typeId: string;
  model: string | null;
  location: string | null;
  os: string | null;
  notes: string | null;
  ip: string;
  mac: string | null;
  reviewNote: string | null;
}

export interface ManagedRange {
  name: string;
  from: string;
  to: string;
  cidr: string | null;
}

export type WebhookFormat = 'json' | 'ntfy';

export interface Webhook {
  url: string;
  format: WebhookFormat;
}

export interface EquipmentSettings {
  managedRanges: ManagedRange[];
  dhcpRanges: DhcpRange[];
  webhooks: Webhook[];
  licenseWarnDays: number;
  certWarnDays: number;
  currency: string;
}

export interface SettingsInput {
  managedRanges: { name: string | null; range: string }[];
  dhcpRanges: DhcpRange[];
  webhooks: Webhook[];
  licenseWarnDays: number;
  certWarnDays: number;
  currency: string;
}

export interface MapSummary {
  id: string;
  name: string;
  position: number;
  updatedAt: string;
}

export interface EquipmentState {
  access: { manager: boolean };
  secretsEnabled: boolean;
  types: EquipmentType[];
  equipment: Equipment[];
  licenses: EquipmentLicense[];
  alerts: EquipmentAlert[];
  settings: EquipmentSettings;
  maps: MapSummary[];
}

export interface EquipmentHistory {
  daily: { checkId: string; day: string; okCount: number; failCount: number; latencySumMs: number }[];
  events: { id: string; checkId: string; at: string; state: CheckState; error: string | null }[];
}

export interface EquipmentInput {
  number: string | null;
  name: string;
  typeId: string;
  brand: string | null;
  model: string | null;
  serial: string | null;
  acquired: string | null;
  price: number | null;
  location: string | null;
  os: string | null;
  assignedName: string | null;
  ownership: Ownership;
  status: EquipmentStatus;
  critical: boolean;
  notes: string | null;
  needsReview: boolean;
  reviewNote: string | null;
  addresses: Omit<EquipmentAddress, 'id'>[];
  software: Omit<EquipmentSoftware, 'id'>[];
  licenseIds: string[];
  addPing?: boolean;
}

export interface LicenseInput {
  product: string;
  version: string | null;
  kind: LicenseKind;
  seats: number | null;
  /** Absent = no es toca; null = s'esborra. */
  key?: string | null;
  keyHint?: string | null;
  vendor: string | null;
  purchasedAt: string | null;
  expiresAt: string | null;
  cost: number | null;
  notes: string | null;
  equipmentIds: string[];
}

export interface SecretInput {
  label: string;
  username: string | null;
  value?: string;
  notes: string | null;
}

export interface CheckInput {
  kind: CheckKind;
  target: string | null;
  port: number | null;
  url: string | null;
  intervalSec: number;
  failThreshold: number;
  enabled: boolean;
}

export interface TypeInput {
  name: string;
  icon: string;
  color: string;
  position: number;
}

const base = '/equipment';

export const equipmentApi = {
  state: () => api.get<EquipmentState>(`${base}/state`).then((r) => r.data),
  history: (id: string) => api.get<EquipmentHistory>(`${base}/items/${id}/history`).then((r) => r.data),
  createItem: (body: EquipmentInput) => api.post<{ id: string }>(`${base}/items`, body).then((r) => r.data),
  updateItem: (id: string, body: EquipmentInput) => api.put(`${base}/items/${id}`, body).then((r) => r.data),
  deleteItem: (id: string) => api.delete(`${base}/items/${id}`).then((r) => r.data),
  setLocation: (id: string, body: { mapId: string | null; mapX: number | null; mapY: number | null; mapCode: string | null }) =>
    api.put(`${base}/items/${id}/location`, body).then((r) => r.data),
  runItem: (id: string) => api.post(`${base}/items/${id}/run`).then((r) => r.data),
  /** Rastreig d'una llista d'IPs (com a molt 1024). Una /24 triga ~15-30 s. */
  scan: (ips: string[]) => api.post<IpScanResult>(`${base}/scan`, { ips }, { timeout: 300_000 }).then((r) => r.data),
  /** Xarxes del servidor, per proposar rangs a Configuració. */
  networks: () => api.get<{ name: string; cidr: string; address: string }[]>(`${base}/networks`).then((r) => r.data),
  testWebhook: (body: Webhook) =>
    api.post<{ ok: boolean; status: number | null; error: string | null }>(`${base}/settings/webhook-test`, body).then((r) => r.data),
  /** Totes les proves d'identificació sobre una IP (~5 s). */
  identify: (ip: string) => api.post<IpDiscovery>(`${base}/identify`, { ip }, { timeout: 60_000 }).then((r) => r.data),
  createSecret: (equipmentId: string, body: SecretInput) =>
    api.post<{ id: string }>(`${base}/items/${equipmentId}/secrets`, body).then((r) => r.data),
  updateSecret: (id: string, body: SecretInput) => api.put(`${base}/secrets/${id}`, body).then((r) => r.data),
  deleteSecret: (id: string) => api.delete(`${base}/secrets/${id}`).then((r) => r.data),
  revealSecret: (id: string) => api.post<{ value: string }>(`${base}/secrets/${id}/reveal`).then((r) => r.data.value),
  createCheck: (equipmentId: string, body: CheckInput) =>
    api.post<{ id: string }>(`${base}/items/${equipmentId}/checks`, body).then((r) => r.data),
  updateCheck: (id: string, body: CheckInput) => api.put(`${base}/checks/${id}`, body).then((r) => r.data),
  deleteCheck: (id: string) => api.delete(`${base}/checks/${id}`).then((r) => r.data),
  runCheck: (id: string) =>
    api
      .post<{ ok: boolean; latencyMs: number | null; error: string | null; unavailable: boolean }>(`${base}/checks/${id}/run`)
      .then((r) => r.data),
  createLicense: (body: LicenseInput) => api.post<{ id: string }>(`${base}/licenses`, body).then((r) => r.data),
  updateLicense: (id: string, body: LicenseInput) => api.put(`${base}/licenses/${id}`, body).then((r) => r.data),
  deleteLicense: (id: string) => api.delete(`${base}/licenses/${id}`).then((r) => r.data),
  revealLicense: (id: string) => api.post<{ value: string }>(`${base}/licenses/${id}/reveal`).then((r) => r.data.value),
  createType: (body: TypeInput) => api.post<{ id: string }>(`${base}/types`, body).then((r) => r.data),
  updateType: (id: string, body: TypeInput) => api.put(`${base}/types/${id}`, body).then((r) => r.data),
  deleteType: (id: string) => api.delete(`${base}/types/${id}`).then((r) => r.data),
  updateSettings: (body: SettingsInput) => api.patch(`${base}/settings`, body).then((r) => r.data),
  ackAlert: (id: string) => api.post(`${base}/alerts/${id}/ack`).then((r) => r.data),
};

export interface MapAsset {
  id: string;
  fileName: string;
  mime: string;
  size: number;
}

export interface MapDetail<Scene = unknown> {
  id: string;
  name: string;
  position: number;
  scene: Scene;
  assets: MapAsset[];
  updatedAt: string;
  updatedByName: string;
}

export const mapsApi = {
  get: <Scene,>(id: string) => api.get<MapDetail<Scene>>(`/maps/${id}`).then((r) => r.data),
  create: (body: { name: string; scene?: unknown }) => api.post<{ id: string }>('/maps', body).then((r) => r.data),
  update: (id: string, body: { name?: string; scene?: unknown; position?: number }) => api.put(`/maps/${id}`, body, { timeout: 120_000 }).then((r) => r.data),
  remove: (id: string) => api.delete(`/maps/${id}`).then((r) => r.data),
  uploadAsset: (id: string, file: File, onProgress?: (fraction: number) => void) => {
    const form = new FormData();
    form.append('file', file);
    return api
      .post<MapAsset>(`/maps/${id}/assets`, form, {
        timeout: 600_000,
        onUploadProgress: (event) => onProgress?.(event.total ? event.loaded / event.total : 0),
      })
      .then((r) => r.data);
  },
  removeAsset: (assetId: string) => api.delete(`/maps/assets/${assetId}`).then((r) => r.data),
  assetUrl: (assetId: string) => `/api/maps/assets/${assetId}`,
};
