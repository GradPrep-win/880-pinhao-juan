import React from 'react';
import { TYPE_LABEL_CHOICES } from '../lib/compose.js';

const SCORE = { 选择题: 5, 填空题: 5, 解答题: 10 };

export const CountsTable = React.memo(function CountsTable({ subjects, counts, remainOf, onUpdate }) {
  const rowTotal = (type) => subjects.reduce((s, subj) => s + ((counts[subj] || {})[type] || 0), 0);
  const subtotal = (subj) => TYPE_LABEL_CHOICES.reduce((a, t) => a + ((counts[subj] || {})[t] || 0) * SCORE[t], 0);
  const totalScore = TYPE_LABEL_CHOICES.reduce((s, t) => s + rowTotal(t) * SCORE[t], 0);

  return (
    <div className="difficulty-table">
      <table>
        <thead>
          <tr><th>题型</th>{subjects.map(s => <th key={s}>{s}</th>)}<th>合计</th></tr>
        </thead>
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
                        onChange={e => onUpdate(subj, t, e.target.value)} />
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
            {subjects.map(s => <td key={s} className="subtotal">{subtotal(s)}分</td>)}
            <td className="totalscore">{totalScore}分</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
});
