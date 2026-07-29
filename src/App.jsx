import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { getBanks, aggregateCounts, listQuestions, listPlans, createPlan, deletePlan, planUsedCounts, recordPlanUsage, savePaper, listPapers, getPaper, deletePaper } from './lib/db.js';
import { compose, TYPE_LABEL_CHOICES } from './lib/compose.js';
import Markdown from './components/Markdown.tsx';
import './App.css';

const EXAM_TYPES = ['数一', '数二', '数三'];
const SUBJECT_BY_EXAM = {
  '数一': ['高数篇', '线代篇', '概率篇'],
  '数二': ['高数篇', '线代篇'],
  '数三': ['高数篇', '线代篇', '概率篇'],
};
const ALL_SECTIONS = ['基础', '综合', '拓展'];
const SCORE = { 选择题: 5, 填空题: 5, 解答题: 10 };

function defaultCountsFor(examType, subjects) {
  const tpl = examType === '数二'
    ? { '高数篇': { 选择题: 7, 填空题: 5, 解答题: 5 }, '线代篇': { 选择题: 3, 填空题: 1, 解答题: 1 } }
    : { '高数篇': { 选择题: 4, 填空题: 4, 解答题: 4 }, '线代篇': { 选择题: 3, 填空题: 1, 解答题: 1 }, '概率篇': { 选择题: 3, 填空题: 1, 解答题: 1 } };
  const out = {};
  for (const s of subjects) out[s] = tpl[s] ? { ...tpl[s] } : { 选择题: 0, 填空题: 0, 解答题: 0 };
  return out;
}

export default function App() {
  const [banks, setBanks] = useState([]);
  const [examType, setExamType] = useState('数一');
  const [subjects, setSubjects] = useState(['高数篇']);
  const [counts, setCounts] = useState({ '高数篇': { 选择题: 4, 填空题: 4, 解答题: 4 } });
  const [sections, setSections] = useState(['基础']);
  const [title, setTitle] = useState('');
  const [aggRemain, setAggRemain] = useState({});
  const [aggLoaded, setAggLoaded] = useState(false);
  const [paper, setPaper] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState(null);

  // 方案
  const [plans, setPlans] = useState([]);
  const [planId, setPlanId] = useState(null);
  const [usedMap, setUsedMap] = useState({});
  const [showPlanName, setShowPlanName] = useState(false);
  const [planNameInput, setPlanNameInput] = useState('');

  // 组卷历史
  const [papers, setPapers] = useState([]);
  const [historyPaper, setHistoryPaper] = useState(null); // 从历史载入查看的试卷

  useEffect(() => { getBanks().then(setBanks).catch(e => setError(String(e))); }, []);

  const SUBJS = SUBJECT_BY_EXAM[examType] || [];

  // 余量聚合（含方案级扣除）— 组卷后也要刷新
  useEffect(() => {
    if (!examType || subjects.length === 0) { setAggRemain({}); setAggLoaded(false); return; }
    setAggLoaded(false);
    aggregateCounts({ examType, subjects, sections, planId }).then((r) => { setAggRemain(r); setAggLoaded(true); }).catch(() => { setAggRemain({}); setAggLoaded(true); });
  }, [examType, subjects, sections, planId, paper]);

  // 载入方案列表
  const loadPlans = useCallback(async () => {
    if (!examType || subjects.length === 0) { setPlans([]); return; }
    const p = await listPlans({ examType, subjects });
    setPlans(p);
    if (planId && !p.some(x => x.id === planId)) setPlanId(null);
  }, [examType, subjects, planId]);

  useEffect(() => { loadPlans(); }, [loadPlans]);

  // 载入组卷历史
  const loadPapers = useCallback(async () => {
    if (!examType) { setPapers([]); return; }
    try { setPapers(await listPapers(examType)); } catch { setPapers([]); }
  }, [examType]);

  useEffect(() => { loadPapers(); }, [loadPapers]);

  // 保存刚组出的卷子到历史
  const saveToHistory = useCallback(async (p) => {
    try {
      await savePaper({
        title: p.title,
        examType: p.examType,
        subjects: p.subjects,
        sections: p.sections,
        counts: p.counts,
        totalScore: p.totalScore,
        questions: p.questions,
      });
      loadPapers();
    } catch {}
  }, [examType, loadPapers]);

  // 载入方案已用题量
  useEffect(() => {
    if (!planId) { setUsedMap({}); return; }
    planUsedCounts({ planId }).then(setUsedMap).catch(() => setUsedMap({}));
  }, [planId, paper]); // 组卷后刷新

  function handleExamTypeChange(et) {
    setExamType(et);
    const defs = (SUBJECT_BY_EXAM[et] || ['高数篇']).slice(0, 1);
    setSubjects(defs);
    setCounts(defaultCountsFor(et, defs));
    setTitle(''); setPaper(null); setPlanId(null);
  }

  function toggleSubject(subj) {
    setSubjects(prev => {
      let next;
      if (prev.includes(subj)) { if (prev.length === 1) return prev; next = prev.filter(s => s !== subj); }
      else next = [...prev, subj];
      setCounts(c => { const nc = {}; for (const s of next) nc[s] = c[s] ? { ...c[s] } : { ...defaultCountsFor(examType, [s])[s] }; return nc; });
      setPlanId(null);
      return next;
    });
    setPaper(null);
  }

  function toggleSection(sec) {
    setSections(prev => prev.includes(sec) ? prev.filter(s => s !== sec) : [...prev, sec]);
    setPaper(null); setPlanId(null);
  }

  function selectPlan(p) {
    if (!p) return;
    setPlanId(p.id);
    try {
      const c = JSON.parse(p.counts);
      setCounts(c);
      const secs = JSON.parse(p.sections || '[]');
      if (secs.length > 0) setSections(secs);
    } catch {}
  }

  function openSavePlan() {
    setPlanNameInput(`${examType}·${subjects.join('+')} 方案${plans.length + 1}`);
    setShowPlanName(true);
  }

  async function confirmSavePlan() {
    const name = planNameInput.trim();
    if (!name) { setShowPlanName(false); return; }
    const id = await createPlan({ examType, subjects, sections: sections.length < 3 ? sections : [], counts, name });
    setShowPlanName(false);
    await loadPlans();
    setPlanId(id);
  }

  async function removePlan(p) {
    if (!confirm(`删除方案「${p.name}」？已组卷子的去重记录将一并清除。`)) return;
    await deletePlan(p.id);
    if (planId === p.id) setPlanId(null);
    await loadPlans();
  }

  async function loadHistoryPaper(id) {
    try {
      const raw = await getPaper(id);
      if (!raw) return;
      const qs = JSON.parse(raw.questions || '[]');
      const p = {
        id: raw.id,
        title: raw.title,
        examType: raw.exam_type,
        subjects: JSON.parse(raw.subjects || '[]'),
        sections: JSON.parse(raw.sections || '[]'),
        counts: JSON.parse(raw.counts || '{}'),
        totalScore: raw.total_score,
        questions: qs, // paper_no 已由 compose 连续编号，直接保留
      };
      setHistoryPaper(p);
      setPaper(p);
    } catch {}
  }

  async function removePaper(pp) {
    if (!confirm(`删除组卷记录「${pp.title}」？`)) return;
    await deletePaper(pp.id);
    if (historyPaper && historyPaper.id === pp.id) { setHistoryPaper(null); setPaper(null); }
    await loadPapers();
  }

  const rowTotal = (type) => subjects.reduce((s, subj) => s + ((counts[subj] || {})[type] || 0), 0);
  const totalScore = TYPE_LABEL_CHOICES.reduce((s, t) => s + rowTotal(t) * SCORE[t], 0);
  const remainOf = (subj, type) => (aggRemain[subj] || {})[type] || 0;
  const anyOver = aggLoaded && subjects.some(subj => TYPE_LABEL_CHOICES.some(t => ((counts[subj] || {})[t] || 0) > remainOf(subj, t)));

  const doCompose = useCallback(async () => {
    if (subjects.length === 0 || generating) return;
    setGenerating(true); setError(null);
    try {
      const picks = [];
      for (const subj of subjects) for (const type of TYPE_LABEL_CHOICES) {
        const c = (counts[subj] || {})[type] || 0;
        if (c > 0) picks.push({ subject: subj, type, count: c });
      }
      if (picks.length === 0) { setGenerating(false); return; }
      const p = await compose({
        examType, subjects, picks, sections, planId,
        listQuestions: async ({ subject, type, segs, pid }) => {
          const { listQuestions } = await import('./lib/db.js');
          return listQuestions({ examType, subject, type, sections: segs, planId: pid });
        }
      });
      const now = new Date();
      p.title = title || `${examType} · ${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
      p.examType = examType;
      p.subjects = subjects;
      p.sections = sections;
      p.counts = counts;
      p.totalScore = totalScore;
      setPaper(p);
      // 保存到组卷历史
      saveToHistory(p);
      // 记录方案已用题
      if (planId) {
        await recordPlanUsage(planId, p.questions.map(q => q.id));
        const u = await planUsedCounts({ planId });
        setUsedMap(u);
      }
    } catch (e) {
      setError(e.message || '组卷失败');
    } finally {
      setGenerating(false);
      // 组卷后滚动到顶部，确保 toolbar 可见
      setTimeout(() => {
        const main = document.querySelector('.main');
        if (main) main.scrollTop = 0;
      }, 100);
    }
  }, [examType, subjects, counts, sections, title, generating, planId, saveToHistory, totalScore]);

  const updateCount = (subj, type, val) => {
    setCounts(prev => ({ ...prev, [subj]: { ...(prev[subj] || {}), [type]: Math.max(0, +val || 0) } }));
    setPlanId(null); // 手动改配比后取消方案选中
  };

  // 方案进度条数据：每题型 已用/总量
  const planProgress = useMemo(() => {
    if (!planId) return null;
    const total = {}; // subject|type -> total pool
    const remain = aggRemain;
    const used = usedMap;
    const data = [];
    for (const t of TYPE_LABEL_CHOICES) {
      let usedSum = 0, totalSum = 0;
      for (const subj of subjects) {
        const r = remain[subj]?.[t] || 0;
        const u = used[subj]?.[t] || 0;
        totalSum += r + u;
        usedSum += u;
      }
      data.push({ type: t, used: usedSum, total: totalSum });
    }
    return data;
  }, [planId, aggRemain, usedMap, subjects]);

  return (
    <div className="app">
      <aside className="sidebar">
        <h1>🎓 GradPrep<span className="sub">考研智能组卷 · 精简版</span></h1>

        <div className="section-title">考试类型</div>
        <div className="exam-tabs">
          {EXAM_TYPES.map(et => (
            <button key={et} className={'exam-tab ' + (et === examType ? 'active' : '')} onClick={() => handleExamTypeChange(et)}>{et}</button>
          ))}
        </div>

        <div className="section-title">篇章（可多选，为每个篇章独立配比）</div>
        <div className="subject-list">
          {SUBJS.map(subj => {
            const qCount = aggRemain[subj] ? TYPE_LABEL_CHOICES.reduce((s,t)=>s+(aggRemain[subj][t]||0),0) : '…';
            return (
              <button key={subj} className={'subject-btn ' + (subjects.includes(subj) ? 'active' : '')} onClick={() => toggleSubject(subj)}>
                {subj} <span className="cnt">({qCount})</span>
              </button>
            );
          })}
        </div>

        <div className="section-title">难度分类（勾选参与组卷的分类）</div>
        <div className="section-list">
          {ALL_SECTIONS.map(sec => (
            <button key={sec} className={'section-btn ' + (sections.includes(sec) ? 'active' : '')} onClick={() => toggleSection(sec)}>{sec}</button>
          ))}
        </div>

        {/* 方案 */}
        <div className="section-title">
          我的组卷方案
          <span style={{float:'right',fontWeight:400,fontSize:11,cursor:'pointer',color:'var(--accent)'}} onClick={openSavePlan}>+ 新建方案</span>
        </div>
        <div style={{clear:'both'}} />
        {showPlanName && (
          <div style={{padding:'0 14px 10px',display:'flex',gap:6,alignItems:'center'}}>
            <input className="title-input" style={{margin:0,flex:1}} value={planNameInput} autoFocus
              onChange={e=>setPlanNameInput(e.target.value)}
              onKeyDown={e=>{if(e.key==='Enter')confirmSavePlan();if(e.key==='Escape')setShowPlanName(false);}}
              placeholder="方案名称" />
            <button className="section-btn" style={{flexShrink:0,padding:'6px 12px'}} onClick={confirmSavePlan}>保存</button>
            <button className="section-btn" style={{flexShrink:0,padding:'6px 12px'}} onClick={()=>setShowPlanName(false)}>取消</button>
          </div>
        )}
        <div className="plan-list">
          {plans.length === 0 && <div className="plan-empty">还没有方案，配好上方参数后点「+ 保存」创建</div>}
          {plans.map(p => {
            const active = planId === p.id;
            let pc = {};
            try { pc = JSON.parse(p.counts); } catch {}
            return (
              <div key={p.id} className={'plan-card ' + (active ? 'active' : '')} onClick={() => selectPlan(p)}>
                <div className="plan-head">
                  <span className="plan-name">{p.name}</span>
                  {active && <span className="plan-badge">使用中</span>}
                  <button className="plan-del" onClick={(e)=>{e.stopPropagation();removePlan(p);}} title="删除方案">✕</button>
                </div>
                <div className="plan-summary">
                  {subjects.map(s => <span key={s} className="plan-chip">{s}{(pc[s]||{}).选择题||0}选{(pc[s]||{}).填空题||0}填{(pc[s]||{}).解答题||0}解</span>)}
                </div>
                {active && (
                  <div className="plan-bars">
                    {(planProgress && planProgress.length ? planProgress : TYPE_LABEL_CHOICES.map(t => ({ type: t, used: 0, total: 0 }))).map(b => {
                      const pct = b.total > 0 ? (b.used / b.total) * 100 : 0;
                      const col = pct < 30 ? '#22c55e' : pct < 70 ? '#f59e0b' : '#ef4444';
                      return (
                        <div key={b.type} className="plan-bar-row">
                          <span className="plan-bar-label">{b.type}</span>
                          <div className="plan-bar-track"><div className="plan-bar-fill" style={{width: (b.total > 0 ? pct : 0) + '%', background: b.total > 0 ? col : '#ddd'}} /></div>
                          <span className="plan-bar-val">{b.used}/{b.total || '—'}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* 组卷历史 */}
        <div className="section-title">组卷历史</div>
        <div style={{clear:'both'}} />
        <div className="history-list">
          {papers.length === 0 && <div className="plan-empty">还没有组卷记录，组卷后自动保存</div>}
          {papers.map(pp => {
            const d = new Date(pp.created_at);
            const dt = `${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
            const qids = (() => { try { return JSON.parse(pp.questions || '[]'); } catch { return []; } })();
            return (
              <div key={pp.id} className={'history-card ' + (historyPaper && historyPaper.id === pp.id ? 'active' : '')} onClick={() => loadHistoryPaper(pp.id)}>
                <div className="plan-head">
                  <span className="plan-name">{pp.title}</span>
                  <button className="plan-del" onClick={(e)=>{e.stopPropagation();removePaper(pp);}} title="删除记录">✕</button>
                </div>
                <div className="plan-summary">
                  <span className="plan-chip">{pp.exam_type}</span>
                  <span className="plan-chip">{qids.length}题 {pp.total_score}分</span>
                  <span className="plan-chip">{dt}</span>
                </div>
              </div>
            );
          })}
        </div>

        <div className="section-title">各篇章题型数量</div>
        <div className="difficulty-table">
          <table>
            <thead><tr><th>题型</th>{subjects.map(s => <th key={s}>{s}</th>)}<th>合计</th></tr></thead>
            <tbody>
              {TYPE_LABEL_CHOICES.map(t => (
                <tr key={t}>
                  <td>{t}</td>
                  {subjects.map(subj => {
                    const val = (counts[subj] || {})[t] || 0;
                    const rem = remainOf(subj, t);
                    const over = val > rem;
                    return (
                      <td key={subj}>
                        <div className="num-cell">
                          <input type="number" min="0" value={val} className={over ? 'over' : ''}
                            onChange={e => updateCount(subj, t, e.target.value)} />
                          <span className={'remain ' + (over ? 'over' : '')}>
                            {over ? `不足 ${val - rem}` : `剩 ${rem}`}
                          </span>
                        </div>
                      </td>
                    );
                  })}
                  <td className="rowtotal"><b>{rowTotal(t)}</b><small> × {SCORE[t]} = {rowTotal(t) * SCORE[t]}</small></td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td>合计</td>
                {subjects.map(s => <td key={s} className="subtotal">{TYPE_LABEL_CHOICES.reduce((a,t)=>a+((counts[s]||{})[t]||0)*SCORE[t],0)}分</td>)}
                <td className="totalscore">{totalScore}分</td>
              </tr>
            </tfoot>
          </table>
        </div>

        <div className="section-title">卷面标题（留空自动生成）</div>
        <input className="title-input" type="text" placeholder="如：2026考研数学一模拟卷" value={title} onChange={e => setTitle(e.target.value)} />

        {error && <div className="err">{error}</div>}
        {anyOver && !historyPaper && <div className="warn">⚠ 部分题型数量超过剩余，超出部分按实际余量抽</div>}

        <button className="btn-primary" disabled={generating || subjects.length === 0} onClick={doCompose}>
          {generating ? '正在组卷…' : `组卷 (共 ${subjects.reduce((s,subj)=>s+TYPE_LABEL_CHOICES.reduce((a,t)=>a+((counts[subj]||{})[t]||0),0),0)} 题)`}
        </button>
      </aside>

      <main className="main">
        {!paper && <div className="empty-hint">← 选择考试类型、篇章、难度分类，配好题型数量后点「组卷」</div>}
        {paper && <PaperView paper={paper} onRegen={doCompose} isHistory={!!historyPaper} onCloseHistory={() => { setHistoryPaper(null); setPaper(null); }} />}
      </main>
    </div>
  );
}

// 选择题题干 + A/B/C/D 分离解析
// 新题标记：行首的下一题题号 "(13)..." 或 "12) ..."；仅在其后存在完整 A/B/C/D 组时才视为拼接（避免误判题干里的编号）
// 拼接题的切割点：行首题号，且前面已出现完整的 D. 选项（说明这是一道新题的开始）
const NEXT_Q_MARKER = /(?:^|\n)\s*([(（]\d+[)）]|\d+[)）])\s*[一-鿿]/g;
function findConcatSplit(content) {
  let m;
  NEXT_Q_MARKER.lastIndex = 0;
  while ((m = NEXT_Q_MARKER.exec(content)) !== null) {
    const before = content.slice(0, m.index);
    if (/D\.\s*\S/.test(before) && content.slice(m.index).match(/A\.\s*[\s\S]*?B\.\s*[\s\S]*?C\./)) return m.index;
  }
  return -1;
}
function parseChoiceOptions(content) {
  const cut = findConcatSplit(content);
  const first = cut >= 0 ? content.slice(0, cut) : content;
  const re = /([\s\S]*?)\s+A\.\s+([\s\S]*?)\s+B\.\s+([\s\S]*?)\s+C\.\s+([\s\S]*?)\s+D\.\s+([\s\S]*?)\s*$/;
  const match = first.match(re);
  if (!match) return null;
  const stem = match[1].replace(/[（(]\s*[)）]\s*$/, "").trim();
  return { stem, options: { A: match[2].trim(), B: match[3].trim(), C: match[4].trim(), D: match[5].trim() } };
}

function ChoiceContent({ content }) {
  const parsed = parseChoiceOptions(content);
  if (!parsed) return <Markdown content={content} />;
  return (
    <span className="choice-content">
      {parsed.stem && <Markdown content={parsed.stem} />}
      <span className="choice-options">
        {['A','B','C','D'].map(k => (
          <span key={k} className="choice-option">
            <span className="choice-opt-label">{k}.</span>
            <Markdown content={parsed.options[k]} />
          </span>
        ))}
      </span>
    </span>
  );
}

function PaperView({ paper, onRegen, isHistory, onCloseHistory }) {
  const [zoom, setZoom] = useState(1);
  const grouped = { 选择题: [], 填空题: [], 解答题: [] };
  for (const q of paper.questions) if (grouped[q.type]) grouped[q.type].push(q);

  // Ctrl+滚轮 / Ctrl++/- 缩放，类似网页放大效果
  useEffect(() => {
    const onWheel = (e) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      setZoom(z => Math.min(2, Math.max(0.5, z + (e.deltaY < 0 ? 0.1 : -0.1))));
    };
    const onKey = (e) => {
      if (!e.ctrlKey && !e.metaKey) return;
      if (e.key === '=' || e.key === '+') { e.preventDefault(); setZoom(z => Math.min(2, +(z + 0.1).toFixed(2))); }
      else if (e.key === '-') { e.preventDefault(); setZoom(z => Math.max(0.5, +(z - 0.1).toFixed(2))); }
      else if (e.key === '0') { e.preventDefault(); setZoom(1); }
    };
    window.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('wheel', onWheel); window.removeEventListener('keydown', onKey); };
  }, []);

  const zoomPct = Math.round(zoom * 100);
  return (
    <>
      <div className="toolbar">
        <button onClick={() => window.print()}>打印 / 导出 PDF</button>
        {!isHistory && <button onClick={onRegen}>重新生成</button>}
        {isHistory && <button onClick={onCloseHistory}>返回组卷</button>}
        <div className="font-size-ctrl" title="Ctrl+滚轮 或 Ctrl++/- 缩放">
          <button onClick={() => setZoom(z => Math.max(0.5, +(z - 0.1).toFixed(2)))}>－</button>
          <span className="font-size-val">{zoomPct}%</span>
          <button onClick={() => setZoom(z => Math.min(2, +(z + 0.1).toFixed(2)))}>＋</button>
          <button onClick={() => setZoom(1)} className="zoom-reset">重置</button>
        </div>
        <span className="paper-meta">{paper.examType} · {paper.questions.length} 题 · {paper.totalScore} 分 · {paper.title}</span>
      </div>
      <div className="paper-page" style={{ zoom }}>
        <div className="paper-header">
          <h2>{paper.title}</h2>
          <div className="meta">共 {paper.questions.length} 题 · 总分 {paper.totalScore} · 生成 {new Date().toLocaleDateString('zh-CN')}</div>
        </div>
        {TYPE_LABEL_CHOICES.map(ty => grouped[ty].length === 0 ? null : (
          <div className="paper-section" key={ty}>
            <h3>{ty}（{grouped[ty].length} 题）</h3>
            {grouped[ty].map(q => (
              <div className="paper-question" key={q.paper_no + '_' + q.id}>
                <span className="paper-q-no">{q.paper_no}.</span>
                <span className="paper-q-body">
                  {ty === '选择题' ? <ChoiceContent content={q.content} /> : <Markdown content={q.content} />}
                </span>
              </div>
            ))}
          </div>
        ))}
        {/* 题目来源汇总（卷面底部，按章节顺序→题型分组，方便纸质试卷翻阅） */}
        <div className="paper-source-footer">
          <div className="paper-source-title">题目来源</div>
          {(() => {
            // 跨题型按 chapter 归组，章节按 chapter_order 排序（第一章→第八章）
            const chapMap = {};
            for (const ty of TYPE_LABEL_CHOICES) {
              for (const q of grouped[ty]) {
                const key = (q.chapter_order ?? 9999) + '|||' + (q.bank_name || '') + '|||' + (q.chapter_name || '未知章节');
                (chapMap[key] = chapMap[key] || []).push(q);
              }
            }
            const chapKeys = Object.keys(chapMap).sort((a, b) => {
              const oa = parseInt(a.split('|||')[0], 10) || 0;
              const ob = parseInt(b.split('|||')[0], 10) || 0;
              return oa - ob;
            });
            return chapKeys.map(key => {
              const qs = chapMap[key];
              const chapter = qs[0].chapter_name || '未知章节';
              const bn = qs[0].bank_name || chapter;
              const m = bn.match(/^(.*?)([一-鿿]+篇)$/);
              const src = m ? m[2] : bn.replace(/^.*[一-鿿]([一-鿿]{0,4})$/, '$1') || bn;
              // 章节内按题型分组（选择→填空→解答），题型内按卷面号排序
              const byType = { 选择题: [], 填空题: [], 解答题: [] };
              for (const q of qs) if (byType[q.type]) byType[q.type].push(q);
              for (const t of TYPE_LABEL_CHOICES) byType[t].sort((a, b) => a.paper_no - b.paper_no);
              const parts = TYPE_LABEL_CHOICES
                .map(t => {
                  const arr = byType[t];
                  if (!arr.length) return null;
                  const paperNos = arr.map(q => q.paper_no).join('、');
                  const bookNos = arr.map(q => q.num || '?').join('、');
                  return t + '卷面第' + paperNos + '题（书第' + bookNos + '题）';
                })
                .filter(Boolean);
              return (
                <div key={key} className="paper-source-chapter">
                  <span className="paper-source-group-title">《{src}》{chapter}：</span>
                  <span className="paper-source-item">{parts.join('；')}</span>
                </div>
              );
            });
          })()}
        </div>
      </div>
    </>
  );
}
