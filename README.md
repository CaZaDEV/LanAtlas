# LanAtlas

Self-hosted inventory for the computers, printers, machines and network devices of a small company or workshop — with an **IP map of the ranges you manage**, **network discovery**, **uptime checks and alerts**, **licences and encrypted credentials**, and an **editable 3D floor plan** where every device is a pin coloured by its network state.

> The user interface is currently in **Catalan**. Translations are welcome (see *Contributing*).

## Features

- **Inventory** — number, name, type (editable, with icon and colour), one or more addresses (static IP or DHCP, label, MAC), location, person, OS, brand/model/serial, purchase date and price, company/personal, in use / spare / retired, *critical* flag, notes, "to review". One search box over every field (accent-insensitive). Excel export.
- **IP ranges you manage** — define your networks as CIDR (`192.168.1.0/24`) or intervals (`10.0.0.1-10.0.0.254`, `10.0.0.1-254`), up to a /20 each. The server suggests the networks of its own interfaces. The *IPs* tab shows every address as used / free / DHCP / conflict / retired, the first free IP, and paginates large ranges by /24.
- **Discovery** — "Scan free IPs" (ping + common TCP ports, because Windows ignores ping) and **Identify** per IP: reverse DNS, mDNS, NetBIOS (Windows name + MAC), SNMP v1 `public` (exact printer/switch model), 29 TCP ports (office, printing, cameras, PLCs: S7, Modbus, OPC UA, EtherNet/IP…), web title/server/certificate, SSH/FTP/RTSP banners → probable device type with confidence and reasons, and "Add to inventory" pre-filled. Read-only probes; nothing is ever sent to port 9100. **Scans and identification are restricted to the ranges you manage** (or to private networks if none is configured).
- **Checks** — ping, TCP port and HTTP(S) (status < 500, certificate expiry), per-device interval and failure threshold, 30-day uptime bar and state history.
- **Alerts** — critical device down (and back), licence expired / expiring / over-assigned, HTTPS certificate expiring, duplicate static IP, static IP inside a DHCP range. Sent to **webhooks** (JSON for Slack, Discord, Mattermost, Google Chat, Teams workflows or your own service; or **ntfy**).
- **Licences** — product, version, kind (perpetual, subscription, OEM, floating, fixed), seats, encrypted key(s) with visible hint, vendor, dates, cost, assigned devices.
- **Credentials** — per device, encrypted with AES-256-GCM; revealed only on demand.
- **3D maps** — several maps (buildings, floors, warehouses):
  - **Import** DXF (CAD; blocks, arcs, polylines, texts and units are read) or SVG and choose per layer: walls, blocks (racks, machines…), floor zones, lines, texts or ignore. Short texts inside a block become its *code*.
  - **Import images** (PNG/JPG/WEBP) as a floor underlay to trace over, and **3D models**: GLB/GLTF, OBJ, STL, FBX, PLY, 3MF, DAE (with unit presets mm/cm/in/m).
  - **Edit everything**: draw walls, zones, blocks and labels; move / rotate / scale with gizmos and grid snapping; properties panel (size, height, rotation, colour, opacity, code, layer); layers (show/hide, rename, delete); duplicate, lock, undo/redo; measure tool; export/import the plan as JSON.
  - **Place devices** by clicking on the map; clicking on a block with a code snaps the device to it. Pins are green / red / amber / grey by network state; search highlights matches.

## Quick start

### Docker (Linux host, recommended)

```bash
git clone https://github.com/<you>/lanatlas.git
cd lanatlas
docker compose up -d --build
```

Open `http://127.0.0.1:8080` on that machine. Data (SQLite database, secret key, uploaded files) lives in `./data`.

`network_mode: host` is used so the container sees the LAN directly (needed for ping, NetBIOS, mDNS and MAC addresses). On Docker Desktop (Windows/macOS) replace it with `ports: ["8080:8080"]` — discovery will be less complete.

### Without Docker (Node 20.12+)

```bash
npm install
npm run build
npm start          # http://127.0.0.1:8080
```

Configuration: copy `.env.example` to `.env`. Development: `npm run dev` (API on :8080) and `npm run dev:web` (Vite on :5173).

## Security — read this

LanAtlas is a **single-user app without login**. Whoever reaches the port can read and change everything, including revealing stored passwords and licence keys.

- By default it listens on **127.0.0.1** only.
- To use it from other computers, put it behind a **reverse proxy with authentication** (Caddy `basic_auth`, Authelia, Authentik, nginx + auth…) or a VPN, set `HOST=0.0.0.0` and firewall the port. Set `ALLOWED_HOSTS` to the name you use.
- Writes require an `X-LanAtlas` header (blocks cross-site requests from other web pages) and, when listening locally, unexpected `Host` headers are rejected (DNS rebinding).
- Secrets are encrypted with a key from `LANATLAS_SECRET_KEY` or `data/secret.key` (generated on first start). **Back up the key together with the database**; without it secrets cannot be decrypted.
- Only scan networks you are allowed to scan.

Example with Caddy:

```
lanatlas.example.lan {
    basic_auth {
        admin <hash from `caddy hash-password`>
    }
    reverse_proxy 127.0.0.1:8080
}
```

## Configuration

| Variable | Default | |
|---|---|---|
| `HOST` | `127.0.0.1` | Listen address |
| `PORT` | `8080` | |
| `DATA_DIR` | `./data` | Database, secret key, map files |
| `LANATLAS_SECRET_KEY` | generated | ≥ 16 chars. Never change it once used |
| `ALLOWED_HOSTS` | `localhost,127.0.0.1` when local | Accepted `Host` names |
| `APP_TIMEZONE` | system | Day boundary for uptime stats |
| `OPERATOR_NAME` | `Admin` | Stored as "created/updated by" |
| `MONITOR_ENABLED` | `1` | `0` stops periodic checks |
| `MIGRATE_ON_START` | `1` | `0` skips automatic database migrations |

## Tips for the 3D map

- **DWG** files must be saved as **DXF** first (AutoCAD, LibreCAD, or the free ODA File Converter).
- Large CAD drawings: set dimension, hatch and grid layers to *ignore* in the import dialog.
- **GLTF** with external `.bin`/textures cannot be resolved — export as **GLB**. Draco/Meshopt-compressed models are not supported.
- Calibrate an underlay image with the *Measure* tool on a known distance, then adjust its width.

## Stack

NestJS + Prisma (SQLite) · React + Vite + Tailwind · three.js. Tests: `npm test`.

## Contributing

Issues and pull requests are welcome: translations (the UI strings are in Catalan), more discovery fingerprints, more importers (IFC, PDF), multi-user auth.

## License

MIT
