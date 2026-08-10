import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { aggregateCounts, listQuestions, listPlans, createPlan, deletePlan, planUsedCounts, recordPlanUsage, recordPaperUsage, resetPaperUsage, updatePlanCounts, savePaper, listPapers, getPaper, deletePaper } from './lib/db.js';
import { compose, TYPE_LABEL_CHOICES } from './lib/compose.js';
import { PlanCard } from './components/PlanCard.jsx';
import { HistoryCard } from './components/HistoryCard.jsx';
import { CountsTable } from './components/CountsTable.jsx';
import { ErrorBoundary } from './components/ErrorBoundary.jsx';
import { PaperView } from './components/PaperView.jsx';
import './App.css';

const EXAM_TYPES = ['数一', '数二'];
const SUBJECT_BY_EXAM = {
  '数一': ['高数篇', '线代篇', '概率篇'],
  '数二': ['高数篇', '线代篇'],
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
  // ── 分组状态 ──
  const [ui, setUi] = useState({ loading: true, generating: false, error: null, toast: null });
  const [config, setConfig] = useState({
    examType: '数一',
    subjects: ['高数篇'],
    counts: { '高数篇': { 选择题: 4, 填空题: 4, 解答题: 4 } },
    sections: ['基础'],
    title: '',
  });
  const [data, setData] = useState({ aggRemain: {}, aggLoaded: false, paper: null, historyPaper: null });
  const [planState, setPlanState] = useState({ plans: [], planId: null, usedMap: {}, showPlanName: false, planNameInput: '' });
  const [papers, setPapers] = useState([]);

  const toastTimer = useRef(null);
  const showToast = useCallback((msg) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setUi(s => ({ ...s, toast: msg }));
    toastTimer.current = setTimeout(() => setUi(s => ({ ...s, toast: null })), 2500);
  }, []);

  // ── 派生值 ──
  const SUBJS = SUBJECT_BY_EXAM[config.examType] || [];
  const remainOf = useCallback((subj, type) => (data.aggRemain[subj] || {})[type] || 0, [data.aggRemain]);

  const totalQuestionCount = useMemo(() =>
    config.subjects.reduce((s, subj) => s + TYPE_LABEL_CHOICES.reduce((a, t) => a + ((config.counts[subj] || {})[t] || 0), 0), 0),
    [config.subjects, config.counts]
  );

  const totalScore = useMemo(() =>
    TYPE_LABEL_CHOICES.reduce((s, t) => s + config.subjects.reduce((a, subj) => a + ((config.counts[subj] || {})[t] || 0), 0) * SCORE[t], 0),
    [config.subjects, config.counts]
  );

  const anyOver = data.aggLoaded && config.subjects.some(subj =>
    TYPE_LABEL_CHOICES.some(t => ((config.counts[subj] || {})[t] || 0) > remainOf(subj, t))
  );

  // ── 初始化 ──
  useEffect(function initDb() {
    aggregateCounts({ examType: '数一', subjects: ['高数篇'], sections: [] })
      .then(() => setUi(s => ({ ...s, loading: false })))
      .catch(e => setUi(s => ({ ...s, error: String(e), loading: false })));
  }, []);

  // ── 数据加载回调（稳定引用） ──
  const loadPlans = useCallback(async (examType, subjects, currentPlanId) => {
    if (!examType || subjects.length === 0) { setPlanState(s => ({ ...s, plans: [] })); return; }
    const p = await listPlans({ examType, subjects });
    setPlanState(s => ({ ...s, plans: p, planId: currentPlanId && p.some(x => x.id === currentPlanId) ? currentPlanId : null }));
  }, []);

  const loadPapers = useCallback(async (examType) => {
    if (!examType) { setPapers([]); return; }
    try { setPapers(await listPapers(examType)); } catch { setPapers([]); }
  }, []);

  // ── 副作用 ──
  useEffect(function fetchAggCounts() {
    if (!config.examType || config.subjects.length === 0) { setData(s => ({ ...s, aggRemain: {}, aggLoaded: false })); return; }
    setData(s => ({ ...s, aggLoaded: false }));
    aggregateCounts({ examType: config.examType, subjects: config.subjects, sections: config.sections, planId: planState.planId })
      .then(r => setData(s => ({ ...s, aggRemain: r, aggLoaded: true })))
      .catch(() => setData(s => ({ ...s, aggRemain: {}, aggLoaded: true })));
  }, [config.examType, config.subjects, config.sections, planState.planId, data.paper]);

  useEffect(function syncPlans() { loadPlans(config.examType, config.subjects, planState.planId); }, [config.examType, config.subjects, planState.planId, loadPlans]);
  useEffect(function syncPapers() { loadPapers(config.examType); }, [config.examType, loadPapers]);

  useEffect(function syncUsedCounts() {
    if (!planState.planId) { setPlanState(s => ({ ...s, usedMap: {} })); return; }
    planUsedCounts({ planId: planState.planId }).then(u => setPlanState(s => ({ ...s, usedMap: u }))).catch(() => setPlanState(s => ({ ...s, usedMap: {} })));
  }, [planState.planId, data.paper]);

  // ── 事件处理 ──
  function handleExamTypeChange(et) {
    setConfig(s => {
      const defs = (SUBJECT_BY_EXAM[et] || ['高数篇']).slice(0, 1);
      return { ...s, examType: et, subjects: defs, counts: defaultCountsFor(et, defs), title: '' };
    });
    setData(s => ({ ...s, paper: null }));
    setPlanState(s => ({ ...s, planId: null }));
  }

  function toggleSubject(subj) {
    setConfig(s => {
      const prev = s.subjects;
      if (prev.includes(subj)) { if (prev.length === 1) return s; }
      const next = prev.includes(subj) ? prev.filter(x => x !== subj) : [...prev, subj];
      const nc = {};
      for (const sub of next) nc[sub] = s.counts[sub] ? { ...s.counts[sub] } : { ...defaultCountsFor(s.examType, [sub])[sub] };
      return { ...s, subjects: next, counts: nc };
    });
    setData(s => ({ ...s, paper: null }));
    setPlanState(s => ({ ...s, planId: null }));
  }

  function toggleSection(sec) {
    setConfig(s => ({ ...s, sections: s.sections.includes(sec) ? s.sections.filter(x => x !== sec) : [...s.sections, sec] }));
    setData(s => ({ ...s, paper: null }));
    setPlanState(s => ({ ...s, planId: null }));
  }

  function selectSectionOnly(sec) {
    setConfig(s => ({ ...s, sections: [sec] }));
    setData(s => ({ ...s, paper: null }));
    setPlanState(s => ({ ...s, planId: null }));
  }

  const selectPlan = useCallback((p) => {
    if (!p) return;
    setPlanState(s => ({ ...s, planId: p.id }));
    try {
      const c = JSON.parse(p.counts);
      setConfig(s => ({ ...s, counts: c, sections: JSON.parse(p.sections || '[]') }));
    } catch {}
  }, []);

  function openSavePlan() {
    setPlanState(s => ({ ...s, planNameInput: `${config.examType}·${config.subjects.join('+')} 方案${planState.plans.length + 1}`, showPlanName: true }));
  }

  async function confirmSavePlan() {
    const name = planState.planNameInput.trim();
    if (!name) { setPlanState(s => ({ ...s, showPlanName: false })); return; }
    const id = await createPlan({ examType: config.examType, subjects: config.subjects, sections: config.sections.length < 3 ? config.sections : [], counts: config.counts, name });
    setPlanState(s => ({ ...s, showPlanName: false }));
    await loadPlans(config.examType, config.subjects, id);
    setPlanState(s => ({ ...s, planId: id }));
    showToast(`方案「${name}」已创建`);
  }

  async function removePlan(p) {
    if (!confirm(`删除方案「${p.name}」？已组卷子的去重记录将一并清除。`)) return;
    await deletePlan(p.id);
    if (planState.planId === p.id) setPlanState(s => ({ ...s, planId: null }));
    await loadPlans(config.examType, config.subjects, planState.planId);
  }

  const loadHistoryPaper = useCallback(async (id) => {
    try {
      const raw = await getPaper(id);
      if (!raw) return;
      const p = {
        id: raw.id, title: raw.title, examType: raw.exam_type,
        subjects: JSON.parse(raw.subjects || '[]'),
        sections: JSON.parse(raw.sections || '[]'),
        counts: JSON.parse(raw.counts || '{}'),
        totalScore: raw.total_score,
        questions: JSON.parse(raw.questions || '[]'),
      };
      setData(s => ({ ...s, historyPaper: p, paper: p }));
    } catch (e) { setUi(s => ({ ...s, error: '载入历史记录失败: ' + e.message })); }
  }, []);

  const removePaper = useCallback(async (pp) => {
    if (!confirm(`删除组卷记录「${pp.title}」？`)) return;
    await deletePaper(pp.id);
    setData(s => (s.historyPaper && s.historyPaper.id === pp.id) ? { ...s, historyPaper: null, paper: null } : s);
    await loadPapers(config.examType);
  }, [loadPapers, config.examType]);

  const saveToHistory = useCallback(async (p) => {
    try {
      await savePaper({ title: p.title, examType: p.examType, subjects: p.subjects, sections: p.sections, counts: p.counts, totalScore: p.totalScore, questions: p.questions });
      await loadPapers(p.examType);
    } catch (e) { setUi(s => ({ ...s, error: '保存历史失败: ' + e.message })); }
  }, [loadPapers]);

  const doCompose = useCallback(async () => {
    if (config.subjects.length === 0 || ui.generating) return;
    setUi(s => ({ ...s, generating: true, error: null }));
    setData(s => ({ ...s, historyPaper: null }));
    try {
      const picks = [];
      for (const subj of config.subjects) for (const type of TYPE_LABEL_CHOICES) {
        const c = (config.counts[subj] || {})[type] || 0;
        if (c > 0) picks.push({ subject: subj, type, count: c });
      }
      if (picks.length === 0) { setUi(s => ({ ...s, generating: false })); return; }
      const p = await compose({
        examType: config.examType, subjects: config.subjects, picks, sections: config.sections, planId: planState.planId,
        listQuestions: async ({ subject, type, sections: segs, pid }) =>
          listQuestions({ examType: config.examType, subject, type, sections: segs, planId: pid }),
      });
      const now = new Date();
      p.title = config.title || `${config.examType} · ${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
      p.examType = config.examType;
      p.subjects = config.subjects;
      p.sections = config.sections;
      p.counts = config.counts;
      p.totalScore = totalScore;
      setData(s => ({ ...s, paper: p }));
      saveToHistory(p);
      if (planState.planId) {
        await recordPlanUsage(planState.planId, p.questions.map(q => q.id));
        const u = await planUsedCounts({ planId: planState.planId });
        setPlanState(s => ({ ...s, usedMap: u }));
      }
      await recordPaperUsage(p.questions.map(q => q.id));
    } catch (e) {
      setUi(s => ({ ...s, error: e.message || '组卷失败' }));
    } finally {
      setUi(s => ({ ...s, generating: false }));
      setTimeout(() => { const main = document.querySelector('.main'); if (main) main.scrollTop = 0; }, 100);
    }
  }, [config.examType, config.subjects, config.counts, config.sections, config.title, ui.generating, planState.planId, saveToHistory, totalScore]);

  const updateCount = useCallback((subj, type, val) => {
    setConfig(s => ({ ...s, counts: { ...s.counts, [subj]: { ...(s.counts[subj] || {}), [type]: Math.max(0, +val || 0) } } }));
  }, []);

  const savePlanCounts = useCallback(async () => {
    if (!planState.planId) return;
    try { await updatePlanCounts({ planId: planState.planId, counts: config.counts }); }
    catch (e) { setUi(s => ({ ...s, error: '保存方案题数失败: ' + e.message })); }
  }, [planState.planId, config.counts]);

  const handleResetUsed = useCallback(async () => {
    if (!confirm('确定重置已用题记录？重置后，之前组过的题目可以再次被抽到。')) return;
    try {
      await resetPaperUsage();
      setData(s => ({ ...s, aggRemain: {} }));
      aggregateCounts({ examType: config.examType, subjects: config.subjects, sections: config.sections, planId: planState.planId })
        .then(r => setData(s => ({ ...s, aggRemain: r, aggLoaded: true }))).catch(() => {});
      if (planState.planId) {
        const u = await planUsedCounts({ planId: planState.planId });
        setPlanState(s => ({ ...s, usedMap: u }));
      }
    } catch (e) { setUi(s => ({ ...s, error: '重置失败: ' + e.message })); }
  }, [config.examType, config.subjects, config.sections, planState.planId]);

  const planProgress = useMemo(() => {
    if (!planState.planId) return null;
    return TYPE_LABEL_CHOICES.map(t => {
      let usedSum = 0, totalSum = 0;
      for (const subj of config.subjects) {
        const r = data.aggRemain[subj]?.[t] || 0;
        const u = planState.usedMap[subj]?.[t] || 0;
        totalSum += r + u;
        usedSum += u;
      }
      return { type: t, used: usedSum, total: totalSum };
    });
  }, [planState.planId, planState.usedMap, config.subjects, data.aggRemain]);

  // ── 渲染 ──
  if (ui.loading) {
    return (
      <div className="app">
        <div className="loading-screen">加载中…</div>
      </div>
    );
  }

  return (
    <ErrorBoundary>
      <div className="app">
        <aside className="sidebar">
          <h1>📝 880AutoPaper<span className="sub">考研数学智能组卷</span></h1>

          <div className="section-title">考试类型</div>
          <div className="exam-tabs">
            {EXAM_TYPES.map(et => (
              <button key={et} className={'exam-tab ' + (et === config.examType ? 'active' : '')} onClick={() => handleExamTypeChange(et)}>{et}</button>
            ))}
          </div>

          <div className="section-title">篇章（可多选）</div>
          <div className="subject-list">
            {SUBJS.map(subj => {
              const qCount = data.aggRemain[subj] ? TYPE_LABEL_CHOICES.reduce((s, t) => s + (data.aggRemain[subj][t] || 0), 0) : '…';
              return (
                <button key={subj} className={'subject-btn ' + (config.subjects.includes(subj) ? 'active' : '')} onClick={() => toggleSubject(subj)}>
                  {subj} <span className="cnt">({qCount})</span>
                </button>
              );
            })}
          </div>

          <div className="section-title">
            难度分类（点击单选，Ctrl/Cmd+点击可多选）
            <span className="section-hint">已选：{config.sections.join('+')}</span>
          </div>
          <div className="section-list">
            {ALL_SECTIONS.map(sec => (
              <button key={sec} className={'section-btn ' + (config.sections.includes(sec) ? 'active' : '')}
                onClick={e => { if (e.ctrlKey || e.metaKey) toggleSection(sec); else selectSectionOnly(sec); }}
                title="点击=仅选此项，Ctrl+点击=多选">{sec}</button>
            ))}
          </div>

          {/* 方案 */}
          <div className="section-title">
            我的组卷方案
            <span className="section-action" onClick={openSavePlan}>+ 新建方案</span>
          </div>
          <div style={{clear:'both'}} />
          {planState.showPlanName && (
            <div className="plan-name-row">
              <input className="title-input" value={planState.planNameInput} autoFocus
                onChange={e => setPlanState(s => ({ ...s, planNameInput: e.target.value }))}
                onKeyDown={e => { if (e.key === 'Enter') confirmSavePlan(); if (e.key === 'Escape') setPlanState(s => ({ ...s, showPlanName: false })); }}
                placeholder="方案名称" />
              <button className="section-btn" onClick={confirmSavePlan}>保存</button>
              <button className="section-btn" onClick={() => setPlanState(s => ({ ...s, showPlanName: false }))}>取消</button>
            </div>
          )}
          <div className="plan-list">
            {planState.plans.length === 0 && <div className="plan-empty">还没有方案，配好上方参数后点「+ 保存」创建</div>}
            {planState.plans.map(p => (
              <PlanCard key={p.id} plan={p} active={planState.planId === p.id} subjects={config.subjects}
                progress={planProgress} onSelect={selectPlan} onDelete={removePlan} />
            ))}
          </div>

          {/* 组卷历史 */}
          <div className="section-title">组卷历史</div>
          <div style={{clear:'both'}} />
          <div className="history-list">
            {papers.length === 0 && <div className="plan-empty">还没有组卷记录，组卷后自动保存</div>}
            {papers.map(pp => (
              <HistoryCard key={pp.id} paper={pp} active={data.historyPaper && data.historyPaper.id === pp.id}
                onSelect={loadHistoryPaper} onDelete={removePaper} />
            ))}
          </div>

          <div className="section-title">各篇章题型数量</div>
          <CountsTable subjects={config.subjects} counts={config.counts} remainOf={remainOf} onUpdate={updateCount} />

          <div className="section-title">卷面标题（留空自动生成）</div>
          <input className="title-input" type="text" placeholder="如：2026考研数学一模拟卷" value={config.title} onChange={e => setConfig(s => ({ ...s, title: e.target.value }))} />

          {ui.error && <div className="err">{ui.error}</div>}
          {anyOver && !data.historyPaper && <div className="warn">⚠ 部分题型数量超过剩余，超出部分按实际余量抽</div>}
          {!planState.planId && <div className="warn">⚠ 请先选择或创建一个组卷方案，再点组卷</div>}

          <div className="compose-btns">
            <button className="btn-primary" disabled={ui.generating || config.subjects.length === 0 || !planState.planId} onClick={doCompose}
              title={!planState.planId ? '请先选择或创建组卷方案' : ''}>
              {ui.generating ? '正在组卷…' : `组卷 (共 ${totalQuestionCount} 题)`}
            </button>
            {planState.planId && (
              <button className="btn-secondary" onClick={savePlanCounts} title="把当前题数保存到方案">保存题数</button>
            )}
            <button className="btn-secondary" onClick={handleResetUsed} title="重置后，之前组过的题可再次被抽到">重置已用题</button>
          </div>
        </aside>

        <main className="main">
          {!data.paper ? (
            <div className="empty-hint">
              <div className="empty-hint-title">👈 开始使用</div>
              <ol className="empty-hint-steps">
                <li>选择 <b>考试类型</b>（数一/数二）</li>
                <li>选择 <b>篇章</b>（高数/线代/概率）</li>
                <li>选择 <b>难度分类</b>（基础/综合/拓展）</li>
                <li>点 <b>+ 新建方案</b> 创建组卷方案</li>
                <li>配好各题型数量，点 <b>组卷</b></li>
              </ol>
              {!planState.planId && <div className="empty-hint-warn">⚠ 需先创建组卷方案才能组卷</div>}
            </div>
          ) : (
            <PaperView paper={data.paper} onRegen={doCompose} isHistory={!!data.historyPaper}
              onCloseHistory={() => setData(s => ({ ...s, historyPaper: null, paper: null }))} />
          )}
        </main>
        {ui.toast && <div className="toast">{ui.toast}</div>}
      </div>
    </ErrorBoundary>
  );
}