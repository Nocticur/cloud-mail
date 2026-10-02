import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { environment: 'node', include: ['test/ui-storage.spec.js'] },
});
