#!/usr/bin/env node
/**
 * 极简 tar.gz 提取器（仅用于从 better-sqlite3 预编译包中提取 .node）。
 * 解决 Windows 上 Git GNU tar 把 D: 盘符当成远程主机、System32 tar 不支持 gzip 的问题。
 * 只处理普通文件条目（typeflag 0 或 \0），忽略目录/链接。
 */
const fs = require('fs');
const zlib = require('zlib');
const path = require('path');

const TAR = process.argv[2];
const DEST = process.argv[3];
if (!TAR || !DEST) { console.error('usage: node extract-tar.cjs <file.tar.gz> <destDir>'); process.exit(2); }

const buf = zlib.gunzipSync(fs.readFileSync(TAR));
fs.mkdirSync(DEST, { recursive: true });

const BLOCK = 512;
let offset = 0;
function readOctal(start, len) {
  return parseInt(buf.slice(start, start + len).toString('utf8').trim(), 8) || 0;
}

while (offset + BLOCK <= buf.length) {
  if (buf[offset] === 0) break;                       // 全 0 块 = 结尾
  const name = buf.slice(offset, offset + 100).toString('utf8').replace(/\0.*$/, '');
  const size = readOctal(offset + 124, 12);
  const typeflag = buf[offset + 156];
  const dataStart = offset + BLOCK;
  const dataEnd = dataStart + size;
  if (typeflag === 0 || typeflag === 48) {            // '0'(48) 或 '\0'(0) = 普通文件
    fs.writeFileSync(path.join(DEST, path.basename(name)), buf.slice(dataStart, dataEnd));
  }
  offset = dataEnd + ((BLOCK - (size % BLOCK)) % BLOCK); // 512 对齐
}
console.log('extracted');
