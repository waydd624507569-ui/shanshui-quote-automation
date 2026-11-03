// check-version.mjs — 查文件 mtime 判断是否有变化，输出 changed=true/false 供 workflow 条件跳步。
import fs from 'node:fs';
import { execSync } from 'node:child_process';

const url = 'https://www.kdocs.cn/l/cpn7SRJAtLzt';
const lastFile = 'last-mtime';

function kdocs(args) {
  const token = process.env.KDOCS_TOKEN;
  const tokenArg = token ? `--token "${token}" ` : '';
  const out = execSync(`kdocs-cli ${tokenArg}${args}`, { encoding: 'utf8' });
  return JSON.parse(out);
}

// 稳健提取 mtime（兼容 kdocs-cli 返回单层/双层 data 结构）
function extractMtime(node) {
  if (node && typeof node === 'object') {
    if (typeof node.mtime === 'number') return node.mtime;
    for (const key of Object.keys(node)) {
      const found = extractMtime(node[key]);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

const info = kdocs(`drive get-file-info url="${url}"`);
const mtime = extractMtime(info);
if (mtime === undefined) {
  console.error('无法从 get-file-info 提取 mtime');
  process.exit(2);
}

const last = fs.existsSync(lastFile) ? fs.readFileSync(lastFile, 'utf8').trim() : '';
const changed = String(mtime) !== last;
if (changed) fs.writeFileSync(lastFile, String(mtime));

console.log(`mtime=${mtime} last=${last || '(none)'} changed=${changed}`);

const ghOutput = process.env.GITHUB_OUTPUT;
if (ghOutput) fs.appendFileSync(ghOutput, `changed=${changed}\n`);
