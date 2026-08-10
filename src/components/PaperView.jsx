import React, { useState, useEffect, useMemo, useRef } from 'react';
import Markdown from './Markdown.tsx';
import { TYPE_LABEL_CHOICES } from '../lib/compose.js';

// ─── 选择题解析 ───
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
  const parsed = useMemo(() => parseChoiceOptions(content), [content]);
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

// ─── 题目来源汇总 ───
const SECTION_ORDER = { '基础': 0, '综合': 1, '拓展': 2 };

function buildSourceFooter(grouped) {
  const chapMap = {};
  for (const ty of ['选择题', '填空题', '解答题']) {
    for (const q of (grouped[ty] || [])) {
      const key = (q.chapter_order ?? 9999) + '|||' + (q.bank_name || '') + '|||' + (q.chapter_name || '未知章节') + '|||' + (q.section || '');
      (chapMap[key] = chapMap[key] || []).push(q);
    }
  }
  const chapKeys = Object.keys(chapMap).sort((a, b) => {
    const pa = a.split('|||'), pb = b.split('|||');
    const oa = parseInt(pa[0], 10) || 0, ob = parseInt(pb[0], 10) || 0;
    if (oa !== ob) return oa - ob;
    return (SECTION_ORDER[pa[3]] ?? 9) - (SECTION_ORDER[pb[3]] ?? 9);
  });
  return chapKeys.map(key => {
    const qs = chapMap[key];
    const parts = key.split('|||');
    const chapter = parts[2] || '未知章节';
    const section = parts[3] || '';
    const bn = parts[1] || chapter;
    const m = bn.match(/^(.*?)([一-鿿]+篇)$/);
    const src = m ? m[2] : bn;
    const byType = { 选择题: [], 填空题: [], 解答题: [] };
    for (const q of qs) if (byType[q.type]) byType[q.type].push(q);
    for (const t of ['选择题', '填空题', '解答题']) byType[t].sort((a, b) => a.paper_no - b.paper_no);
    const typeParts = ['选择题', '填空题', '解答题']
      .map(t => {
        const arr = byType[t];
        if (!arr.length) return null;
        const paperNos = arr.map(q => q.paper_no).join('、');
        const bookNos = arr.map(q => q.num || '?').join('、');
        return t + '卷面第' + paperNos + '题（书第' + bookNos + '题）';
      })
      .filter(Boolean);
    return { src, chapter, section, typeParts };
  });
}

// ─── 试卷视图 ───
export function PaperView({ paper, onRegen, isHistory, onCloseHistory }) {
  const [zoom, setZoom] = useState(1);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;

  const grouped = useMemo(() => {
    const g = { 选择题: [], 填空题: [], 解答题: [] };
    for (const q of paper.questions) if (g[q.type]) g[q.type].push(q);
    return g;
  }, [paper.questions]);

  const sourceFooter = useMemo(() => buildSourceFooter(grouped), [grouped]);

  useEffect(function setupZoomHandlers() {
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
        <div className="paper-source-footer">
          <div className="paper-source-title">题目来源</div>
          {sourceFooter.map(({ src, chapter, section, typeParts }, i) => (
            <div key={i} className="paper-source-chapter">
              <span className="paper-source-group-title">《{src}》{chapter}（{section}）：</span>
              <span className="paper-source-item">{typeParts.join('；')}</span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
