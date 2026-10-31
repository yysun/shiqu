// A Standard installer must never ship a different Node version or a host binary for another target.
import test from 'node:test';
import assert from 'node:assert/strict';
import {validateNodeTarget} from '../scripts/desktop-node.mjs';

test('bundled Node staging requires the exact pinned version and native target',()=>{
 validateNodeTarget('24.22.1','24.22.1','darwin','arm64',{TAURI_ENV_PLATFORM:'darwin',TAURI_ENV_ARCH:'aarch64',TAURI_ENV_TARGET_TRIPLE:'aarch64-apple-darwin'});
 validateNodeTarget('24.22.1','24.22.1','win32','x64',{TAURI_ENV_PLATFORM:'windows',TAURI_ENV_ARCH:'x86_64',TAURI_ENV_TARGET_TRIPLE:'x86_64-pc-windows-msvc'});
 assert.throws(()=>validateNodeTarget('24.22.1','24.22.1','win32','x64',{TAURI_ENV_TARGET_TRIPLE:'aarch64-pc-windows-msvc'}),/matching native/);
 validateNodeTarget('24.22.1','24.22.1','linux','x64',{});
 assert.throws(()=>validateNodeTarget('24.14.0','24.22.1','darwin','arm64',{}),/requires build Node/);
 for(const environment of [{TAURI_ENV_ARCH:'x86_64'},{TAURI_ENV_PLATFORM:'windows'},{TAURI_ENV_TARGET_TRIPLE:'universal-apple-darwin'},{TAURI_ENV_ARCH:'armv7'},{TAURI_ENV_TARGET_TRIPLE:'aarch64-unknown-linux-musl'}])assert.throws(()=>validateNodeTarget('24.22.1','24.22.1','darwin','arm64',environment),/matching native/);
});
