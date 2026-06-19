import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const agentPort = process.env.AGENT_PORT || '3001'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 3005,
    proxy: {
      '/api': {
        target: `http://localhost:${agentPort}`,
        changeOrigin: true,
      },
    },
  },
})
