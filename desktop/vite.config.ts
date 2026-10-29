// Keep desktop assets and dependency caches separate from pnpm dev so both previews can run together.
import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {desktopPreview} from './library-preview';
export default defineConfig({root:path.dirname(fileURLToPath(import.meta.url)),cacheDir:path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../node_modules/.vite-desktop'),plugins:[react(),desktopPreview()],server:{host:'127.0.0.1',port:1420,strictPort:true,fs:{deny:['.env','.env.*','*.{crt,pem}','**/.git/**','**/.data/**','**/backups/**','**/*-backups/**','**/*.{sqlite,sqlite-wal,sqlite-shm,db,db-wal,db-shm}','**/media/**','**/reader-cache/**']}},clearScreen:false,build:{outDir:'dist',emptyOutDir:true}});
