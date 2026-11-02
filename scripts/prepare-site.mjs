import { cp, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = resolve(root, 'web', 'dist');
const destination = resolve(root, 'dist');

await rm(destination, { recursive: true, force: true });
await cp(source, destination, { recursive: true });
console.log(`Prepared Site output at ${destination}`);
