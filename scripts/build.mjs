// Build wrapper: keeps esbuild's temporary files inside the workspace.
// On some Windows setups the system Temp directory rejects esbuild's cleanup
// ("Access is denied"), which aborts `vite build` after transpilation. Pointing
// TEMP/TMP at a project-owned folder before esbuild starts avoids that and is
// harmless on other platforms. Use `npm run build` as the normal entry point.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const temp = path.join(root, 'output', 'tmp');
fs.mkdirSync(temp, { recursive: true });
const env = { ...process.env, TEMP: temp, TMP: temp };

function run(args) {
    const result = spawnSync(process.execPath, args, { cwd: root, env, stdio: 'inherit' });
    if (result.error) {
        console.error(result.error);
        process.exit(1);
    }
    if (result.status !== 0)
        process.exit(result.status ?? 1);
}

run(['node_modules/typescript/bin/tsc', '--noEmit']);
run(['node_modules/vite/bin/vite.js', 'build']);
