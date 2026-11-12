import { cp, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const src = path.join(root, 'node_modules', 'cesium', 'Build', 'Cesium');
const dest = path.join(root, 'public', 'cesium');

if (existsSync(dest)) await rm(dest, { recursive: true, force: true });
await mkdir(dest, { recursive: true });
for (const dir of ['Workers', 'ThirdParty', 'Assets', 'Widgets']) {
  await cp(path.join(src, dir), path.join(dest, dir), { recursive: true });
}
console.log('Cesium static assets copied to public/cesium');
