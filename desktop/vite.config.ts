// Build a separate local-only control panel; it never imports the reader or provider credentials.
import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
export default defineConfig({root:path.dirname(fileURLToPath(import.meta.url)),plugins:[react()],clearScreen:false,build:{outDir:'dist',emptyOutDir:true}});
