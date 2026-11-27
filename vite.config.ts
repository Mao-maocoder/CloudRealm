import { defineConfig } from 'vite';

export default defineConfig({
    base: './',
    server: {
        watch: {
            ignored: ['**/release/**', '**/output/**', '**/*.tmpdir/**', '**/*.tmp'],
        },
    },
    build: {
        rollupOptions: {
            output: {
                manualChunks(id) {
                    if (id.includes('node_modules/three')) return 'three';
                    if (id.includes('/src/world/') || id.includes('\\src\\world\\') || id.includes('/src/rendering/') || id.includes('\\src\\rendering\\')) {
                        return 'world-engine';
                    }
                },
            },
        },
    },
});
