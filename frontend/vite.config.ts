import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

// Получаем __dirname для ESM модулей
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Читаем версию из package.json
const packageJson = JSON.parse(readFileSync(join(__dirname, 'package.json'), 'utf-8'))
const version = packageJson.version || '0.0.0'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(version),
  },
})
