import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import tailwindcss from '@tailwindcss/vite';
const backend=process.env.VITE_BFF_PROXY||'http://127.0.0.1:3001';
export default defineConfig({ plugins: [vue(), tailwindcss()], server: { port: 5173, strictPort: true, proxy: { '/api': { target: backend, changeOrigin: false }, '/downloads': {target:backend,changeOrigin:false} } }, build: { outDir: 'dist' } });
