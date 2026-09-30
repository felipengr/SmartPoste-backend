import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    env: { NODE_ENV: 'test' },
    setupFiles: ['dotenv/config'],
    // Os testes compartilham o mesmo banco; rodar em série evita um interferir no outro
    fileParallelism: false,
  },
});
