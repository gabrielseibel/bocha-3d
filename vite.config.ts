import { defineConfig } from 'vitest/config';

// base: './' mantém os caminhos relativos: o build funciona em
// gabrielseibel.github.io/bocha-3d/ e em qualquer outro subcaminho.
export default defineConfig({
  base: './',
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 900,
  },
  server: { port: 5191, host: true },
  preview: { port: 5192 },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
