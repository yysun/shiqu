// Build the browser application independently of the Node API server.
import path from 'node:path';
import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({plugins:[react()],resolve:{alias:{'@':path.resolve(import.meta.dirname)}},build:{outDir:'dist/client'},server:{strictPort:true}});
