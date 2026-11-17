// Copies non-TypeScript assets (icons, JSON) into dist after compilation.
import { cpSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const assets = [
	['src/nodes/OData1c/odata1c.svg', 'dist/nodes/OData1c/odata1c.svg'],
	['src/credentials/odata1c.svg', 'dist/credentials/odata1c.svg'],
];

mkdirSync(join(root, 'dist'), { recursive: true });
for (const [from, to] of assets) {
	const source = join(root, from);
	if (!existsSync(source)) {
		console.warn(`[copy-assets] missing ${from}, skipped`);
		continue;
	}
	const target = join(root, to);
	mkdirSync(dirname(target), { recursive: true });
	cpSync(source, target);
	console.log(`[copy-assets] ${from} -> ${to}`);
}
