#!/usr/bin/env node
/**
 * 确保 better_sqlite3.node 是针对 Electron（而非系统 Node）编译的。
 *
 * 背景：Electron 35 使用 NODE_MODULE_VERSION 133，而系统 Node v24 是 137。
 * 本机网络不稳，electron-builder 的自动 rebuild 经常下载不到 Electron 头文件，
 * 回退到系统 Node 头文件编译，产出 137 的 .node，启动时报 NODE_MODULE_VERSION 错。
 *
 * 该脚本直接到 GitHub releases 下载 better-sqlite3 官方为 Electron 预编译的二进制，
 * 替换掉 node_modules 里的 .node，从而绕开本地编译。
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const { execSync } = require('child_process');

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    const mod = url.startsWith('https') ? https : require('http');
    mod.get(url, { headers: { 'User-Agent': 'gradprep-build' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return download(res.headers.location, dest).then(resolve, reject);
      }
      if (res.statusCode !== 200) return reject(new Error('HTTP ' + res.statusCode + ' for ' + url));
      res.pipe(file);
      file.on('finish', () => { file.close(resolve); });
    }).on('error', reject);
  });
}

async function main() {
  const root = path.resolve(__dirname, '..');

  // 1. 确定 Electron 版本与其 NODE_MODULE_VERSION (ABI)
  let electronVer, abi;
  try {
    electronVer = require(path.join(root, 'node_modules/electron/package.json')).version;
    abi = require('node-abi').getAbi(electronVer, 'electron');
  } catch (e) {
    console.log('[use-electron-sqlite] 无法读取 electron 版本或 node-abi，跳过（', e.message, '）');
    return;
  }

  // 2. 当前 .node 是否已是目标 ABI？(node-abi 的 getModuleFile 可查)
  const releaseDir = path.join(root, 'node_modules/better-sqlite3/build/Release');
  const nodeFile = path.join(releaseDir, 'better_sqlite3.node');
  const forgeMeta = path.join(releaseDir, '.forge-meta');
  if (fs.existsSync(forgeMeta)) {
    const tag = fs.readFileSync(forgeMeta, 'utf8').trim();
    if (tag === 'x64--' + abi && fs.existsSync(nodeFile)) {
      console.log('[use-electron-sqlite] 已是 electron ABI ' + abi + '，无需替换');
      return;
    }
  }

  // 3. 确定 better-sqlite3 版本
  let pkgVer;
  try {
    pkgVer = require(path.join(root, 'node_modules/better-sqlite3/package.json')).version;
  } catch {
    console.log('[use-electron-sqlite] better-sqlite3 未安装，跳过');
    return;
  }

  const url = `https://github.com/WiseLibs/better-sqlite3/releases/download/v${pkgVer}/better-sqlite3-v${pkgVer}-electron-v${abi}-win32-x64.tar.gz`;
  const tmpZip = path.join(require('os').tmpdir(), `bs3-${pkgVer}-electron-v${abi}.tar.gz`);
  const tmpDir = path.join(require('os').tmpdir(), `bs3-extract-${process.pid}`);

  console.log(`[use-electron-sqlite] 下载 electron-v${abi} 预编译包 (better-sqlite3 v${pkgVer})…`);
  try {
    await download(url, tmpZip);
  } catch (e) {
    console.log('[use-electron-sqlite] 下载失败，回退尝试本地 node-gyp 编译：', e.message);
    try {
      execSync('npx @electron/rebuild -f -o better-sqlite3', { cwd: root, stdio: 'inherit' });
      return;
    } catch {
      console.log('[use-electron-sqlite] 本地编译也失败，保留现有 .node');
      return;
    }
  }

  // 4. 解压（纯 Node 实现，避免 Windows 上 shell tar 的盘符/ gzip 兼容问题）
  fs.mkdirSync(tmpDir, { recursive: true });
  const extractScript = path.join(__dirname, 'extract-tar.cjs');
  try {
    execSync(`node "${extractScript}" "${tmpZip}" "${tmpDir}"`, { stdio: 'pipe' });
  } catch (e) {
    console.log('[use-electron-sqlite] 解压失败，保留现有 .node：', (e.stderr || e.message).toString().slice(0, 120));
    return;
  }
  let built = path.join(tmpDir, 'build/Release/better_sqlite3.node');
  if (!fs.existsSync(built)) built = path.join(tmpDir, 'better_sqlite3.node');
  if (!fs.existsSync(built)) {
    console.log('[use-electron-sqlite] 解压后未找到 .node，保留现有 .node');
    return;
  }
  fs.copyFileSync(built, nodeFile);
  fs.writeFileSync(forgeMeta, `x64--${abi}`);
  console.log(`[use-electron-sqlite] 已替换为 electron ABI ${abi} 版本`)

  // 清理
  try { fs.unlinkSync(tmpZip); } catch {}
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
}

main().catch((e) => { console.error('[use-electron-sqlite] 异常：', e.message); process.exit(0); });
