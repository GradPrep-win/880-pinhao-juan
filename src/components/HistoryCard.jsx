import React, { useMemo } from 'react';

function parseQuestions(raw) {
  try { return JSON.parse(raw || '[]'); } catch { return []; }
}

function formatDate(ts) {
  const d = new Date(ts);
  return `${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

export const HistoryCard = React.memo(function HistoryCard({ paper, active, onSelect, onDelete }) {
  const qids = useMemo(() => parseQuestions(paper.questions), [paper.questions]);
  const dt = useMemo(() => formatDate(paper.created_at), [paper.created_at]);

  return (
    <div className={'history-card ' + (active ? 'active' : '')} onClick={() => onSelect(paper.id)}>
      <div className="plan-head">
        <span className="plan-name">{paper.title}</span>
        <button className="plan-del" onClick={(e) => { e.stopPropagation(); onDelete(paper); }} title="删除记录">✕</button>
      </div>
      <div className="plan-summary">
        <span className="plan-chip">{paper.exam_type}</span>
        <span className="plan-chip">{qids.length}题 {paper.total_score}分</span>
        <span className="plan-chip">{dt}</span>
      </div>
    </div>
  );
});
