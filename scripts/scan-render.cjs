// 扫描全库：把每道题的 content 过一遍 renderLaTeX，统计残余原始命令
const Database = require('better-sqlite3');
const path = require('path');
const dbPath = path.join(__dirname, '..', 'data.db');
const db = new Database(dbPath, { readonly: true });

// === 从 App.jsx 复制过来的渲染函数（保持完全一致） ===
const LATEX_SYMBOLS = {
  alpha:'α', beta:'β', gamma:'γ', delta:'δ', epsilon:'ε', varepsilon:'ε',
  zeta:'ζ', eta:'η', theta:'θ', vartheta:'ϑ', iota:'ι', kappa:'κ',
  lambda:'λ', mu:'μ', nu:'ν', xi:'ξ', pi:'π', varpi:'ϖ', rho:'ρ',
  varrho:'ϱ', sigma:'σ', varsigma:'ς', tau:'τ', upsilon:'υ',
  phi:'φ', varphi:'ϕ', chi:'χ', psi:'ψ', omega:'ω',
  Gamma:'Γ', Delta:'Δ', Theta:'Θ', Lambda:'Λ', Xi:'Ξ', Pi:'Π',
  Sigma:'Σ', Upsilon:'Υ', Phi:'Φ', Psi:'Ψ', Omega:'Ω',
  times:'×', div:'·', cdot:'·', pm:'±', mp:'∓', cap:'∩', cup:'∪',
  neq:'≠', leq:'≤', geq:'≥', ll:'≪', gg:'≫', approx:'≈', equiv:'≡',
  propto:'∝', infty:'∞', partial:'∂', nabla:'∇', forall:'∀', exists:'∃',
  neg:'¬', wedge:'∧', vee:'∨',
  in:'∈', ni:'∋', notin:'∉', subset:'⊂', supset:'⊃', subseteq:'⊆', supseteq:'⊇',
  to:'→', gets:'←', leftrightarrow:'↔', mapsto:'↦', rightarrow:'→',
  leftarrow:'←', implies:'⇒', iff:'⇔',
  sin:'sin', cos:'cos', tan:'tan', cot:'cot', sec:'csc',
  arcsin:'arcsin', arccos:'arccos', arctan:'arctan',
  sinh:'sinh', cosh:'cosh', tanh:'tanh',
  log:'log', ln:'ln', lg:'lg', exp:'exp', lim:'lim', max:'max', min:'min',
  sqrt:'√', cbrt:'∛', cdots:'⋯', vdots:'⋮', ddots:'⋱',
  int:'∫', iint:'∬', iiint:'∭', oint:'∮', sum:'∑', prod:'∏',
  bigoplus:'⊕', bigotimes:'⊗',
  left:'', right:'', big:'', bigl:'', bigr:'', bigm:'',
  mathrm:'', mathbf:'', mathit:'', text:'', rm:'', bf:'', it:'',
  ',':' ', '.':' ', ';':' ', '!':'', quad:'  ', qquad:'    ',
  hat:'^', bar:'ˉ', tilde:'~', dot:'˙', ddot:'¨', vec:'→',
  ell:'ℓ', Re:'ℑ', Im:'ℜ', aleph:'ℵ', hbar:'ħ', prime:'′',
  emptyset:'∅', angle:'∠', triangle:'△', bot:'⊥',
  diamondsuit:'♢', heartsuit:'♡', clubsuit:'♣', spadesuit:'♠',
  not:'¬', circ:'∘', ldots:'…',
};

function renderLaTeX(s) {
  if (!s) return '';
  let t = s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  t = t.replace(/(?<=[^\n])\s+(?=[A-D]\.\s)/g, '\n');
  t = t.replace(/\$\$([\s\S]*?)\$\$/g, (_, m) => '<div class="latex-block">' + convertLaTeX(m) + '</div>');
  t = t.replace(/\\\[([\s\S]*?)\\\]/g, (_, m) => '<div class="latex-block">' + convertLaTeX(m) + '</div>');
  t = t.replace(/\$([^$]+)\$/g, (_, m) => '<span class="latex-inline">' + convertLaTeX(m) + '</span>');
  t = t.replace(/\\\(([\s\S]*?)\\\)/g, (_, m) => '<span class="latex-inline">' + convertLaTeX(m) + '</span>');
  return t;
}

function extractBraces(s, i) {
  if (s[i] !== '{') return null;
  let depth = 0;
  for (let j = i; j < s.length; j++) {
    if (s[j] === '{') depth++;
    else if (s[j] === '}') { depth--; if (depth === 0) return { content: s.slice(i + 1, j), end: j + 1 }; }
  }
  return null;
}

const FRAC_SPAN = '<span style="display:inline-flex;flex-direction:column;align-items:center;vertical-align:middle;line-height:1.1">';

function replaceFrac(s) {
  let result = '';
  let i = 0;
  while (i < s.length) {
    const fracIdx = s.indexOf('\\frac', i);
    if (fracIdx === -1) { result += s.slice(i); break; }
    result += s.slice(i, fracIdx);
    let p = fracIdx + 5;
    let a, aEnd;
    if (s[p] === '{') { const e = extractBraces(s, p); a = replaceFrac(e.content); aEnd = e.end; }
    else { a = s[p]; aEnd = p + 1; }
    let b, bEnd;
    if (s[aEnd] === '{') { const e = extractBraces(s, aEnd); b = replaceFrac(e.content); bEnd = e.end; }
    else { b = s[aEnd]; bEnd = aEnd + 1; }
    result += FRAC_SPAN +
      '<sup style="font-size:0.62em">' + a + '</sup>' +
      '<span style="font-size:0.5em;color:#000">—</span>' +
      '<sub style="font-size:0.62em">' + b + '</sub></span>';
    i = bEnd;
  }
  return result;
}

function replaceSqrt(s) {
  let result = '';
  let i = 0;
  while (i < s.length) {
    const idx = s.indexOf('\\sqrt', i);
    if (idx === -1) { result += s.slice(i); break; }
    result += s.slice(i, idx);
    let p = idx + 5;
    let n = '';
    if (s[p] === '[') {
      const close = s.indexOf(']', p);
      if (close !== -1) { n = s.slice(p + 1, close); p = close + 1; }
    }
    let body, bEnd;
    if (s[p] === '{') { const e = extractBraces(s, p); body = replaceSqrt(e.content); bEnd = e.end; }
    else { body = s[p]; bEnd = p + 1; }
    const prefix = n ? '<sup style="font-size:0.55em">' + n + '</sup>' : '';
    result += prefix + '√(' + body + ')';
    i = bEnd;
  }
  return result;
}

function convertLaTeX(s) {
  if (!s) return '';
  let t = s;
  t = replaceFrac(t);
  t = replaceSqrt(t);
  t = t.replace(/\\begin\{cases\}([\s\S]*?)\\end\{cases\}/g, (_, m) => convertCases(m));
  t = t.replace(/\\begin\{aligned\}([\s\S]*?)\\end\{aligned\}/g, (_, m) => convertCases(m));
  t = t.replace(/\\begin\{array\}[^{]*\{[^}]*\}([\s\S]*?)\\end\{array\}/g, (_, m) => convertCases(m));
  t = t.replace(/\\begin\{(p|b|B|v|V)?matrix\}([\s\S]*?)\\end\{(p|b|B|v|V)?matrix\}/g, (_, open, m) => convertMatrix(m, open));
  t = t.replace(/\\left\\\{/g, '{');
  t = t.replace(/\\left\(/g, '(');
  t = t.replace(/\\left\[/g, '[');
  t = t.replace(/\\right\\}/g, '}');
  t = t.replace(/\\right\)/g, ')');
  t = t.replace(/\\right\]/g, ']');
  t = t.replace(/\\right\./g, '');
  t = t.replace(/\\right\b/g, '');
  t = t.replace(/\\left\b/g, '');
  t = t.replace(/\\\{/g, '{');
  t = t.replace(/\\\}/g, '}');
  t = replaceCmds(t);
  return t;
}

function convertCases(s) {
  let inner = s.trim();
  const rows = inner.split(/\\\\/).map(r => r.trim()).filter(r => r);
  const parts = rows.map(row => {
    const cols = row.split('&').map(c => replaceCmds(c.trim().replace(/^amp;\s*/, '')));
    if (cols.length === 1) return cols[0];
    return cols[0] + ' <span style="color:#666;font-size:0.85em">(' + cols[1] + ')</span>';
  });
  return '<span style="display:inline-block;vertical-align:middle;text-align:left">' + parts.join('<br/>') + '</span>';
}

function convertMatrix(s, type) {
  const rows = s.trim().split(/\\\\/).map(r => r.trim()).filter(r => r);
  const cells = rows.map(row =>
    '<span style="display:inline-flex;gap:1.2em">' +
    row.split('&').map(c => '<span>' + replaceCmds(c.trim().replace(/^amp;\s*/, '')) + '</span>').join('') +
    '</span>'
  );
  const left = type === 'p' ? '(' : type === 'b' ? '[' : type === 'B' ? '{' : type === 'v' ? '|' : type === 'V' ? '‖' : '';
  const right = type === 'p' ? ')' : type === 'b' ? ']' : type === 'B' ? '}' : type === 'v' ? '|' : type === 'V' ? '‖' : '';
  const content = cells.join('<br/>');
  if (!left) return '<span style="display:inline-block;vertical-align:middle">' + content + '</span>';
  return '<span style="display:inline-flex;align-items:stretch;vertical-align:middle">' +
    '<span style="font-size:1.2em;line-height:1.3">' + left + '</span>' +
    '<span style="line-height:1.4">' + content + '</span>' +
    '<span style="font-size:1.2em;line-height:1.3">' + right + '</span></span>';
}

function replaceCmds(t) {
  t = t.replace(/\^\{([^}]*)\}/g, '<sup style="font-size:0.7em">$1</sup>');
  t = t.replace(/\^(\w)/g, '<sup style="font-size:0.7em">$1</sup>');
  t = t.replace(/_\{([^}]*)\}/g, '<sub style="font-size:0.7em">$1</sub>');
  t = t.replace(/_(\w)/g, '<sub style="font-size:0.7em">$1</sub>');
  t = t.replace(/\\([a-zA-Z]+)/g, (m, name) => LATEX_SYMBOLS[name] !== undefined ? LATEX_SYMBOLS[name] : m);
  t = t.replace(/\\left/g, '').replace(/\\right/g, '').replace(/\\limits/g, '').replace(/\\displaystyle/g, '')
       .replace(/\\mathrm/g, '').replace(/\\mathbf/g, '').replace(/\\mathit/g, '').replace(/\\text/g, '').replace(/\\rm/g, '');
  let prev;
  do { prev = t; t = t.replace(/\{([^{}<]{1,40})\}/g, '$1'); } while (t !== prev);
  return t;
}

// === 扫描 ===
const rows = db.prepare('SELECT id, content, type, num FROM question').all();
let total = 0, bad = 0;
const badSamples = [];
const cmdCount = {};

for (const r of rows) {
  total++;
  const html = renderLaTeX(r.content);
  // 检测残余原始命令：\ 后跟字母（排除已转为 HTML 的）
  const rawCmds = html.match(/\\[a-zA-Z]+/g);
  if (rawCmds) {
    bad++;
    for (const c of rawCmds) {
      // 排除 HTML 标签里的 \（实际上 HTML 标签不含 \）
      cmdCount[c] = (cmdCount[c] || 0) + 1;
    }
    if (badSamples.length < 30) {
      badSamples.push({ id: r.id, type: r.type, num: r.num, cmds: [...new Set(rawCmds)].slice(0,5), src: r.content.slice(0,120) });
    }
  }
}

console.log(`总题数: ${total}`);
console.log(`有残余命令: ${bad} (${(bad/total*100).toFixed(2)}%)`);
console.log(`干净: ${total - bad}`);
console.log('\n残余命令频率:');
Object.entries(cmdCount).sort((a,b)=>b[1]-a[1]).slice(0,30).forEach(([k,v]) => console.log(`  ${k}: ${v}`));
console.log('\n样例（前30道）:');
for (const s of badSamples) {
  console.log(`  #${s.id} ${s.type}(${s.num}) cmds=[${s.cmds.join(', ')}]`);
  console.log(`    src: ${s.src}`);
}

// 深入：显示 \mathrm \int \cos \frac 的实际渲染结果
console.log('\n=== 深入：神秘残余命令的实际渲染 ===');
const mysteryCmds = ['\\mathrm', '\\int', '\\cos', '\\frac', '\\theta', '\\neq'];
for (const cmd of mysteryCmds) {
  const rows2 = db.prepare('SELECT id, content FROM question WHERE content LIKE ? LIMIT 5').all(`%${cmd}%`);
  let shown = 0;
  for (const r of rows2) {
    const html = renderLaTeX(r.content);
    const idx = html.indexOf(cmd);
    if (idx >= 0 && shown < 2) {
      const ctx = html.slice(Math.max(0,idx-30), idx+60);
      console.log(`  #${r.id} cmd=${cmd} (SURVIVES in html)`);
      console.log(`    src snippet: ${r.content.slice(r.content.indexOf(cmd), r.content.indexOf(cmd)+60)}`);
      console.log(`    html snippet: ${ctx}`);
      shown++;
    }
  }
  if (shown === 0) console.log(`  ${cmd}: all converted OK (false positive)`);
}

// 直接查：找 HTML 里真的含有 \mathrm 的题
console.log('\n=== 直接查 HTML 含 \\mathrm 的题 ===');
for (const r of rows) {
  const html = renderLaTeX(r.content);
  if (html.includes('\\mathrm')) {
    console.log(`  #${r.id} ${r.type}(${r.num})`);
    console.log(`    src: ${r.content.slice(0,100)}`);
    console.log(`    html: ${html.slice(html.indexOf('\\mathrm')-20, html.indexOf('\\mathrm')+50)}`);
    break; // 只看一个
  }
}
