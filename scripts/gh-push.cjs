#!/usr/bin/env node
/**
 * 通过 GitHub Git Database API 推送提交（用于 git push 443 被网络屏蔽时）。
 * api.github.com 可达，利用它创建 blob -> tree -> commit -> ref。
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const OWNER = 'GradPrep-win';
const REPO = 'gradprep-learn';
const MESSAGE = 'feat: init GradPrep exam composer';
const BRANCH = 'main';

function ghApi(method, route, body) {
  const args = ['api', `-X${method}`, `-HAccept: application/vnd.github+json`];
  if (body) {
    const tmp = path.join(require('os').tmpdir(), `gh-body-${Date.now()}.json`);
    fs.writeFileSync(tmp, JSON.stringify(body));
    args.push(`--input`, tmp);
  }
  args.push(route);
  const out = execSync('gh ' + args.map(a => `"${a.replace(/"/g, '\\"')}"`).join(' '), { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  if (body) try { fs.unlinkSync(tmp); } catch {}
  return JSON.parse(out);
}

function isBinary(file) {
  return ['.db', '.png', '.jpg', '.ico', '.node', '.exe', '.dll', '.asar'].includes(path.extname(file).toLowerCase());
}

async function main() {
  const root = path.resolve(__dirname, '..');

  // 1. 列出要提交的文件（与 git 索引一致）
  const files = execSync('git diff --cached --name-only && git ls-files --others --exclude-standard', { cwd: root, encoding: 'utf8' })
    .split('\n').filter(Boolean);
  // 如果暂存区为空，用 HEAD 的文件列表
  let fileList = files;
  if (fileList.length === 0) {
    fileList = execSync('git ls-tree -r --name-only HEAD', { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean);
  }
  console.log(`[gh-push] ${fileList.length} 个文件`);

  // 2. 创建 blobs
  const treeEntries = [];
  for (const file of fileList) {
    const abs = path.join(root, file);
    if (!fs.existsSync(abs)) continue;
    const bin = isBinary(file);
    const content = bin
      ? fs.readFileSync(abs).toString('base64')
      : fs.readFileSync(abs, 'utf8');
    const blob = ghApi('POST', `/repos/${OWNER}/${REPO}/git/blobs`, {
      content,
      encoding: bin ? 'base64' : 'utf-8',
    });
    treeEntries.push({ path: file, mode: '100644', type: 'blob', sha: blob.sha });
    console.log(`[gh-push] blob ${file} -> ${blob.sha.slice(0, 7)}`);
  }

  // 3. 创建 tree
  const tree = ghApi('POST', `/repos/${OWNER}/${REPO}/git/trees`, { tree: treeEntries });
  console.log(`[gh-push] tree -> ${tree.sha.slice(0, 7)}`);

  // 4. 创建 commit（无 parent，因为是新仓库）
  const commit = ghApi('POST', `/repos/${OWNER}/${REPO}/git/commits`, {
    message: MESSAGE,
    tree: tree.sha,
    parents: [],
  });
  console.log(`[gh-push] commit -> ${commit.sha.slice(0, 7)}`);

  // 5. 创建 ref
  try {
    const ref = ghApi('POST', `/repos/${OWNER}/${REPO}/git/refs`, {
      ref: `refs/heads/${BRANCH}`,
      sha: commit.sha,
    });
    console.log(`[gh-push] ref ${BRANCH} 已创建 -> ${ref.ref}`);
  } catch (e) {
    // 如果 ref 已存在，用 PATCH 更新
    console.log('[gh-push] ref 已存在，尝试更新…');
    ghApi('PATCH', `/repos/${OWNER}/${REPO}/git/refs/heads/${BRANCH}`, { sha: commit.sha, force: true });
    console.log(`[gh-push] ref ${BRANCH} 已更新`);
  }

  console.log(`\n✅ 推送完成: https://github.com/${OWNER}/${REPO}`);
}

main().catch(e => { console.error('[gh-push] 失败:', e.message); process.exit(1); });
