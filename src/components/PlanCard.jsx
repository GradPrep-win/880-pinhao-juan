import React, { useMemo } from 'react';
import { TYPE_LABEL_CHOICES } from '../lib/compose.js';

const PLAN_PROGRESS_FALLBACK = TYPE_LABEL_CHOICES.map(t => ({ type: t, used: 0, total: 0 }));

function parseCounts(raw) {
  try { return JSON.parse(raw); } catch { return {}; }
}

export const PlanCard = React.memo(function PlanCard({ plan, active, subjects, progress, onSelect, onDelete }) {
  const pc = useMemo(() => parseCounts(plan.counts), [plan.counts]);
  const bars = (progress && progress.length ? progress : PLAN_PROGRESS_FALLBACK);

  return (
    <div className={'plan-card ' + (active ? 'active' : '')} onClick={() => onSelect(plan)}>
      <div className="plan-head">
        <span className="plan-name">{plan.name}</span>
        {active && <span className="plan-badge">使用中</span>}
        <button className="plan-del" onClick={(e) => { e.stopPropagation(); onDelete(plan); }} title="删除方案">✕</button>
      </div>
      <div className="plan-summary">
        {subjects.map(s => (
          <span key={s} className="plan-chip">
            {s}{(pc[s]||{}).选择题||0}选{(pc[s]||{}).填空题||0}填{(pc[s]||{}).解答题||0}解
          </span>
        ))}
      </div>
      {active && (
        <div className="plan-bars">
          {bars.map(b => {
            const pct = b.total > 0 ? (b.used / b.total) * 100 : 0;
            const col = b.total === 0 ? '#ddd' : pct < 30 ? '#22c55e' : pct < 70 ? '#f59e0b' : '#ef4444';
            return (
              <div key={b.type} className="plan-bar-row">
                <span className="plan-bar-label">{b.type}</span>
                <div className="plan-bar-track">
                  <div className="plan-bar-fill" style={{ width: (b.total > 0 ? pct : 0) + '%', background: col }} />
                </div>
                <span className="plan-bar-val">{b.used}/{b.total || '—'}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
});
