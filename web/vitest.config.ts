import path from 'path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src/common'),
      '@app': path.resolve(__dirname, 'src/app'),
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
  },
})
