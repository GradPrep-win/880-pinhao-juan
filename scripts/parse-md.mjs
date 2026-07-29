// 把 md 习题册转成 SQLite
// 三级结构: exam_type(数一/数二/数三) × subject(高数篇/线代篇/概率篇) × section(基础/综合/拓展)
// 参考 D:\program\GradPrep
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sqlite3 from 'better-sqlite3';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const SRC  = path.resolve(HERE, '../../');

const SOURCES = [
  { file: 'MinerU_markdown_【A4紧凑版】880数一高数篇做题本_0_1784364586199_2078403318932008960.md', exam: '数一', subject: '高数篇', source: '精讲精练880题2027(李林)数一高数篇' },
  { file: 'MinerU_markdown_【A4紧凑版】880数一线概篇做题本_0_1784364609490_2078403649199894528.md', exam: '数一', subject: '线代篇', source: '精讲精练880题2027(李林)数一线代篇', split: '线代篇' },
  { file: 'MinerU_markdown_【A4紧凑版】880数一线概篇做题本_0_1784364609490_2078403649199894528.md', exam: '数一', subject: '概率篇', source: '精讲精练880题2027(李林)数一概率篇', split: '概率篇' },
  { file: 'MinerU_markdown_【A4紧凑版】李林880数二高数篇做题本_0_1784338992079_2078379966842503168.md', exam: '数二', subject: '高数篇', source: '李林880题数二高数篇' },
  { file: 'MinerU_markdown_【A4紧凑版】李林880数二线代篇做题本_0_1784364627721_2078402841163038720.md', exam: '数二', subject: '线代篇', source: '李林880题数二线代篇' },
];

const CHAPTER_RE = /^第[一二三四五六七八九十百千]+章\s/;
const DIFFS = new Set(['基础题', '综合题', '拓展题']);
const isRoman = s => /^(M{0,3})(CM|CD|D?C{0,3})(XC|XL|L?X{0,3})(IX|IV|V?I{0,3})$/.test(s);
const rnToInt  = r => { const m={I:1,V:5,X:10,L:50,C:100,D:500,M:1000}; let n=0; for(let i=0;i<r.length;i++){const v=m[r[i]];n+=i+1<r.length&&v<m[r[i+1]]?-v:v;}return n; };
const strip = l => l.replace(/^#+\s*/,'').trim();
const cnNum={ '一':1,'二':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9,'十':10,'十一':11,'十二':12,'十三':13 };
function chapterOrder(name){const m=name.match(/第([一二三四五六七八九十]+)章/);return m?(cnNum[m[1]]??999):999;}

function detectType(l){
  const m=l.match(/^([一二三四五六七八九十]+)、\s*(选择|填空|解答)\s*题?\s*$/); if(m)return m[2]+'题';
  if(l==='选择题'||l==='填空题'||l==='解答题') return l;
  return null;
}

const XIANDAI_KW = ['行列式','矩阵','向量','线性方程组','相似矩阵','二次型'];
const GAISAN_KW = ['随机事件','随机变量','多维随机变量','随机变量的数字特征','大数定律','中心极限定理','数理统计','参数估计','假设检验'];
function subjectOfChapter(name){
  if (XIANDAI_KW.some(k => name.includes(k))) return '线代篇';
  if (GAISAN_KW.some(k => name.includes(k))) return '概率篇';
  return '高数篇';
}

function parseFile(file){
  const txt = fs.readFileSync(path.join(SRC, file),'utf8');
  // 先把粘在选项末尾的下一题题号 (数字) 拆成独立行
  let txt2 = txt.replace(/\((\d+)\)(?=\s*[^\s(])/g, '\n($1)');
  // 把 $$..$$ 跨行显示数学块合并为单行（用 <DD> 占位），避免定界符被过滤
  txt2 = txt2.replace(/\$\$([\s\S]*?)\$\$/g, (m, inner) => '$$' + inner.replace(/\s+/g, ' ') + '$$');
  const rawLines = txt2.split('\n').filter(l=>!/\.\.\d+$/.test(l.trim()));
  const lines = rawLines.map(strip).filter(l=>l);
  let ch=null, df=null, tp=null;
  const qs=[];
  let cur=null;
  const close=()=>{ if(cur)qs.push(cur); cur=null; };
  for(const l of lines){
    if(CHAPTER_RE.test(l)){ ch=l; df=null; tp=null; close(); continue; }
    if(DIFFS.has(l)){ df=l; tp=null; close(); continue; }
    const t=detectType(l); if(t){ tp=t; close(); continue; }
    const qn=l.match(/^\((\d+)\)\s+(.*)$/);
    const qr=l.match(/^\(([IVXLCDM]{1,7})\)\s+(.*)$/);
    let qId=null;
    if(qn){ if(!/^[+\-*/\\\\]/.test(qn[2])) qId=parseInt(qn[1]); }
    else if(qr&&isRoman(qr[1])){ if(!/^[+\-*/\\\\]/.test(qr[2])) qId=1000+rnToInt(qr[1]); }
    if(qId!=null&&ch&&df&&tp){ close(); cur={ch,df,tp,num:qId,body:[l]}; }
    else if(cur) cur.body.push(l);
  }
  close();
  return qs;
}

function build(){
  const outDb=path.join(ROOT,'data.db');
  if(fs.existsSync(outDb)) fs.unlinkSync(outDb);
  const db=new sqlite3(outDb);
  db.pragma('journal_mode=WAL');
  db.exec(`
    CREATE TABLE bank (id INTEGER PRIMARY KEY, name TEXT, exam_type TEXT, subject TEXT, created_at INTEGER);
    CREATE TABLE chapter (id INTEGER PRIMARY KEY, bank_id INTEGER, name TEXT, ord INTEGER, weight REAL DEFAULT 1.0);
    CREATE TABLE question (id INTEGER PRIMARY KEY, chapter_id INTEGER, source TEXT, type TEXT, section TEXT, num INTEGER, content TEXT, answer TEXT);
    CREATE INDEX idx_q_chap ON question(chapter_id);
    CREATE INDEX idx_bank_exam ON bank(exam_type, subject);
    CREATE INDEX idx_ch_bank ON chapter(bank_id);
    CREATE TABLE plan (
      id INTEGER PRIMARY KEY,
      name TEXT,
      exam_type TEXT,
      subjects TEXT,
      sections TEXT,
      counts TEXT,
      created_at INTEGER
    );
    CREATE TABLE plan_usage (
      id INTEGER PRIMARY KEY,
      plan_id INTEGER,
      question_id INTEGER,
      UNIQUE(plan_id, question_id)
    );
    CREATE INDEX idx_pu_plan ON plan_usage(plan_id);
    CREATE INDEX idx_plan_exam ON plan(exam_type);
  `);
  const insBank=db.prepare('INSERT INTO bank (name,exam_type,subject,created_at) VALUES (?,?,?,?)');
  const insCh=db.prepare('INSERT INTO chapter (bank_id,name,ord,weight) VALUES (?,?,?,?)');
  const insQ  =db.prepare('INSERT INTO question (chapter_id,source,type,section,num,content,answer) VALUES (?,?,?,?,?,?,?)');

  let globalQ=0;
  for(const cfg of SOURCES){
    const allQ = parseFile(cfg.file);
    const filtered = cfg.split ? allQ.filter(q => subjectOfChapter(q.ch) === cfg.split) : allQ;
    const chMap = new Map();
    for(const q of filtered){
      if(!chMap.has(q.ch)) chMap.set(q.ch,{ord:chapterOrder(q.ch),qs:[]});
      chMap.get(q.ch).qs.push(q);
    }
    const sorted=[...chMap.entries()].sort((a,b)=>a[1].ord-b[1].ord);

    const br=insBank.run(cfg.source, cfg.exam, cfg.subject, Date.now());
    const bankId=br.lastInsertRowid;
    let qcount=0; const seen=new Set();
    for(const [chName,info] of sorted){
      const chRow=insCh.run(bankId,chName,info.ord,1.0);
      const chId=chRow.lastInsertRowid;
      for(const q of info.qs){
        const head=q.body[0]||'';
        const hm=head.match(/^\((\d+)\)/);
        const hrm=head.match(/^\(([IVXLCDM]{1,7})\)/);
        let num=-1;
        if(hm) num=parseInt(hm[1]);
        else if(hrm&&isRoman(hrm[1])) num=1000+rnToInt(hrm[1]);
        else continue;
        const dupKey=`${q.df}|${q.tp}|${num}|${chId}`;
        if(seen.has(dupKey)) continue;
        seen.add(dupKey);
        const section=q.df.replace(/题$/,'');
        const content=[]; let answer=null;
        for(let i=0;i<q.body.length;i++){
          let l=q.body[i];
          if(/这是一条为了防止/.test(l))continue;
          if(/^发出来的资料/.test(l))continue;
          const am=l.match(/^(?:答案|解答|解)[：:：]\s*(.+)$/);
          if(am){if(!answer)answer=am[1];continue;}
          if(/^[【\[]?(?:答案|解析|分析)[】\]]/.test(l))continue;
          l=l.trim().replace(/\s+/g,' ');
          // 去掉首行开头的 (数字) 或 (罗马数字) 题号
          if(i===0) l=l.replace(/^\(([IVXLCDM]+|\d+)\)\s*/,'');
          if(l) content.push(l);
        }
        if(content.length===0) continue;
        insQ.run(chId, cfg.source, q.tp, section, num, content.join('\n'), answer);
        qcount++; globalQ++;
      }
    }
    console.log(`  [${cfg.exam}/${cfg.subject}] bankId=${bankId} chapters=${sorted.length} questions=${qcount}`);
  }
  console.log('TOTAL=',globalQ);
  db.close();
}
build();
