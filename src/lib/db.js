// 数据库访问层 —— 通过 Electron preload 暴露的 electronAPI.dbQuery
// 返回完整响应 { ok, rows, lastInsertRowid, changes }
async function query(sql, params = []) {
  if (window.electronAPI?.dbQuery) {
    const r = await window.electronAPI.dbQuery(sql, params);
    if (!r.ok) throw new Error(r.err);
    return r;
  }
  throw new Error('dbQuery 不可用:请在 Electron 环境中运行');
}

// 便捷：只取 rows
async function rows(sql, params = []) {
  return (await query(sql, params)).rows;
}

export async function getBanks() {
  return rows('SELECT id, name, exam_type AS examType, subject FROM bank ORDER BY id');
}

// 聚合余量：totalMap[subject][type]
// 若传 planId，则扣除该方案已用题
export async function aggregateCounts({ examType, subjects, sections, planId }) {
  const ph = subjects.map(() => '?').join(',');
  const params = [examType, ...subjects];
  let sql = `SELECT b.subject, q.type, COUNT(*) AS cnt
    FROM question q
    JOIN chapter ch ON ch.id = q.chapter_id
    JOIN bank b ON b.id = ch.bank_id
    WHERE b.exam_type = ? AND b.subject IN (${ph})`;
  if (sections && sections.length > 0 && sections.length < 3) {
    sql += ` AND q.section IN (${sections.map(() => '?').join(',')})`;
    params.push(...sections);
  }
  if (planId) {
    sql += ` AND q.id NOT IN (SELECT question_id FROM plan_usage WHERE plan_id = ?)`;
    params.push(planId);
  }
  sql += ' GROUP BY b.subject, q.type';
  const resultRows = await rows(sql, params);
  console.log('AGGREGATE rows:', JSON.stringify(resultRows), 'subjects:', JSON.stringify(subjects));
  const totalMap = {};
  for (const s of subjects) totalMap[s] = { 选择题: 0, 填空题: 0, 解答题: 0 };
  for (const r of resultRows) {
    if (totalMap[r.subject]) totalMap[r.subject][r.type] = (totalMap[r.subject][r.type] || 0) + r.cnt;
  }
  console.log('AGGREGATE result:', JSON.stringify(totalMap));
  return totalMap;
}

// 查某方案已用的 (subject,type) 数量，用于进度条
export async function planUsedCounts({ planId }) {
  const resultRows = await rows(
    `SELECT b.subject, q.type, COUNT(*) AS cnt
     FROM plan_usage pu
     JOIN question q ON q.id = pu.question_id
     JOIN chapter ch ON ch.id = q.chapter_id
     JOIN bank b ON b.id = ch.bank_id
     WHERE pu.plan_id = ?
     GROUP BY b.subject, q.type`,
    [planId]
  );
  const m = {};
  for (const r of resultRows) m[r.subject] = m[r.subject] || {}, m[r.subject][r.type] = r.cnt;
  return m;
}

export async function listQuestions({ examType, subject, type, sections, planId }) {
  const params = [examType, subject, type];
  let sql = `SELECT q.id, q.type, q.section, q.num, q.content, q.answer, ch.name AS chapter_name, ch.ord AS chapter_order, b.name AS bank_name
    FROM question q
    JOIN chapter ch ON ch.id = q.chapter_id
    JOIN bank b ON b.id = ch.bank_id
    WHERE b.exam_type = ? AND b.subject = ? AND q.type = ?`;
  if (sections && sections.length > 0 && sections.length < 3) {
    sql += ` AND q.section IN (${sections.map(() => '?').join(',')})`;
    params.push(...sections);
  }
  if (planId) {
    sql += ` AND q.id NOT IN (SELECT question_id FROM plan_usage WHERE plan_id = ?)`;
    params.push(planId);
  }
  sql += ' ORDER BY ch.ord, q.num';
  return rows(sql, params);
}

// ======== 方案 CRUD ========
export async function listPlans({ examType, subjects }) {
  const all = await rows('SELECT id,name,exam_type,subjects,sections,counts,created_at FROM plan WHERE exam_type = ? ORDER BY created_at', [examType]);
  const key = subjects.slice().sort().join(',');
  return all.filter(p => {
    try { const s = JSON.parse(p.subjects); return s.slice().sort().join(',') === key; } catch { return false; }
  });
}

export async function createPlan({ examType, subjects, sections, counts, name }) {
  const res = await query(
    'INSERT INTO plan (name,exam_type,subjects,sections,counts,created_at) VALUES (?,?,?,?,?,?)',
    [name, examType, JSON.stringify(subjects), JSON.stringify(sections), JSON.stringify(counts), Date.now()]
  );
  return res.lastInsertRowid;
}

export async function deletePlan(planId) {
  await query('DELETE FROM plan_usage WHERE plan_id = ?', [planId]);
  await query('DELETE FROM plan WHERE id = ?', [planId]);
}

// 记录方案已用题
export async function recordPlanUsage(planId, questionIds) {
  if (!questionIds || !questionIds.length) return;
  const ins = `INSERT OR IGNORE INTO plan_usage (plan_id, question_id) VALUES (?,?)`;
  for (const qid of questionIds) await query(ins, [planId, qid]);
}

// ======== 组卷历史 ========
export async function savePaper({ title, examType, subjects, sections, counts, totalScore, questions }) {
  const res = await query(
    `INSERT INTO paper (title, exam_type, subjects, sections, counts, total_score, questions, created_at)
     VALUES (?,?,?,?,?,?,?,?)`,
    [title, examType, JSON.stringify(subjects), JSON.stringify(sections), JSON.stringify(counts), totalScore, JSON.stringify(questions), Date.now()]
  );
  return res.lastInsertRowid;
}

export async function listPapers(examType) {
  const r = await query(
    `SELECT id, title, exam_type, subjects, sections, counts, total_score, created_at FROM paper
     WHERE exam_type = ? ORDER BY created_at DESC LIMIT 100`,
    [examType]
  );
  return r.rows;
}

export async function getPaper(id) {
  const r = await query('SELECT * FROM paper WHERE id = ?', [id]);
  return r.rows[0] || null;
}

export async function deletePaper(id) {
  await query('DELETE FROM paper WHERE id = ?', [id]);
}

