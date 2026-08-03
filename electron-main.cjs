const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

// 判断是否运行自 asar（__dirname 形如 .../app.asar/electron-main）
const isAsar = __dirname.includes('.asar');

// 把 asar 外部的 node_modules 加入模块搜索路径（原生模块 .node 必须在 asar 外）
if (isAsar || app.isPackaged) {
  const externalModules = path.join(path.dirname(process.execPath), 'resources', 'app.asar.unpacked', 'node_modules');
  if (fs.existsSync(externalModules)) {
    module.paths.push(externalModules);
    try {
      for (const d of fs.readdirSync(externalModules)) {
        const sub = path.join(externalModules, d, 'node_modules');
        if (fs.statSync(sub).isDirectory()) module.paths.push(sub);
      }
    } catch {}
  }
}

// 应用根目录: asar/exe 模式 = exe 所在目录; dev = __dirname
function getAppDir() {
  if (app.isPackaged || isAsar) {
    return path.dirname(process.execPath);
  }
  return __dirname;
}

// preload 必须在 asar 外部
function getPreloadPath() {
  if (app.isPackaged || isAsar) {
    const r1 = path.join(path.dirname(process.execPath), 'resources', 'preload.cjs');
    if (fs.existsSync(r1)) return r1;
    return path.join(path.dirname(process.execPath), 'preload.cjs');
  }
  return path.join(__dirname, 'preload.cjs');
}

// index.html 路径
function getIndexHtml() {
  if (app.isPackaged) {
    // packaged: resources/app.asar/dist/index.html (通过 asar 协议)
    return 'index.html'; // 由 loadURL 拼 asar:// 协议
  }
  return null;
}

function findDb() {
  const d = getAppDir();
  const candidates = [
    path.join(d, 'resources', 'data.db'),           // packaged(extraResources)
    path.join(d, 'data.db'),                        // packaged(legacy)
    path.join(__dirname, 'data.db'),                // dev
  ];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  return candidates[0];
}

let db;
function openDb() {
  if (db) return db;
  const Database = require('better-sqlite3');
  const dbPath = findDb();
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  migrate(db);
  return db;
}

// 增量建表（首次启动或新增表时自动创建）
function migrate(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS paper (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT,
      exam_type TEXT,
      subjects TEXT,
      sections TEXT,
      counts TEXT,
      total_score INTEGER,
      questions TEXT,
      created_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS paper_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      question_id INTEGER NOT NULL,
      used_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_pu_q ON paper_usage(question_id);
  `);
}

// ======== 数据库 API（白名单化，渲染进程不可执行任意 SQL） ========
function dbApi(method, params = {}) {
  const db = openDb();
  switch (method) {
    case 'getBanks':
      return db.prepare('SELECT id, name, exam_type AS examType, subject FROM bank ORDER BY id').all();

    case 'aggregateCounts': {
      const { examType, subjects, sections, planId } = params;
      const ph = subjects.map(() => '?').join(',');
      const p = [examType, ...subjects];
      let sql = `SELECT b.subject, q.type, COUNT(*) AS cnt
        FROM question q JOIN chapter ch ON ch.id = q.chapter_id JOIN bank b ON b.id = ch.bank_id
        WHERE b.exam_type = ? AND b.subject IN (${ph}) AND q.num >= 1
        AND LENGTH(q.content) >= 15 AND q.content NOT LIKE '%$$'`;
      if (sections && sections.length > 0) {
        sql += ` AND q.section IN (${sections.map(() => '?').join(',')})`;
        p.push(...sections);
      }
      if (planId) {
        sql += ` AND q.id NOT IN (SELECT question_id FROM plan_usage WHERE plan_id = ?)`;
        p.push(planId);
      }
      sql += ` AND q.id NOT IN (SELECT question_id FROM paper_usage)`;
      sql += ' GROUP BY b.subject, q.type';
      const m = {};
      for (const s of subjects) m[s] = { 选择题: 0, 填空题: 0, 解答题: 0 };
      for (const r of db.prepare(sql).all(...p)) m[r.subject][r.type] = (m[r.subject][r.type] || 0) + r.cnt;
      return m;
    }

    case 'planUsedCounts': {
      const { planId } = params;
      const rows = db.prepare(`SELECT b.subject, q.type, COUNT(*) AS cnt
        FROM plan_usage pu JOIN question q ON q.id = pu.question_id
        JOIN chapter ch ON ch.id = q.chapter_id JOIN bank b ON b.id = ch.bank_id
        WHERE pu.plan_id = ? GROUP BY b.subject, q.type`).all(planId);
      const m = {};
      for (const r of rows) (m[r.subject] = m[r.subject] || {})[r.type] = r.cnt;
      return m;
    }

    case 'listQuestions': {
      const { examType, subject, type, sections, planId } = params;
      const p = [examType, subject, type];
      let sql = `SELECT q.id, q.type, q.section, q.num, q.content, q.answer,
        ch.name AS chapter_name, ch.ord AS chapter_order, b.name AS bank_name
        FROM question q JOIN chapter ch ON ch.id = q.chapter_id JOIN bank b ON b.id = ch.bank_id
        WHERE b.exam_type = ? AND b.subject = ? AND q.type = ? AND q.num >= 1
        AND LENGTH(q.content) >= 15 AND q.content NOT LIKE '%$$'`;
      if (sections && sections.length > 0) {
        sql += ` AND q.section IN (${sections.map(() => '?').join(',')})`;
        p.push(...sections);
      }
      if (planId) {
        sql += ` AND q.id NOT IN (SELECT question_id FROM plan_usage WHERE plan_id = ?)`;
        p.push(planId);
      }
      sql += ` AND q.id NOT IN (SELECT question_id FROM paper_usage)`;
      sql += ' ORDER BY ch.ord, q.num';
      return db.prepare(sql).all(...p);
    }

    case 'listPlans': {
      const { examType, subjects } = params;
      const key = [...subjects].sort().join(',');
      const all = db.prepare('SELECT id,name,exam_type,subjects,sections,counts,created_at FROM plan WHERE exam_type = ? ORDER BY created_at').all(examType);
      return all.filter(pl => { try { return [...JSON.parse(pl.subjects)].sort().join(',') === key; } catch { return false; } });
    }

    case 'createPlan': {
      const { examType, subjects, sections, counts, name } = params;
      const info = db.prepare('INSERT INTO plan (name,exam_type,subjects,sections,counts,created_at) VALUES (?,?,?,?,?,?)')
        .run(name, examType, JSON.stringify(subjects), JSON.stringify(sections), JSON.stringify(counts), Date.now());
      return { lastInsertRowid: info.lastInsertRowid };
    }

    case 'deletePlan': {
      const { planId } = params;
      db.prepare('DELETE FROM plan_usage WHERE plan_id = ?').run(planId);
      db.prepare('DELETE FROM plan WHERE id = ?').run(planId);
      return { ok: true };
    }

    case 'recordPlanUsage': {
      const { planId, questionIds } = params;
      if (!questionIds || !questionIds.length) return { ok: true };
      const ins = db.prepare('INSERT OR IGNORE INTO plan_usage (plan_id, question_id) VALUES (?,?)');
      const tx = db.transaction((ids) => { for (const id of ids) ins.run(planId, id); });
      tx(questionIds);
      return { ok: true };
    }

    case 'recordPaperUsage': {
      const { questionIds } = params;
      if (!questionIds || !questionIds.length) return { ok: true };
      const ins = db.prepare('INSERT OR IGNORE INTO paper_usage (question_id, used_at) VALUES (?,?)');
      const tx = db.transaction((ids) => { const now = Date.now(); for (const id of ids) ins.run(id, now); });
      tx(questionIds);
      return { ok: true };
    }

    case 'resetPaperUsage': {
      db.prepare('DELETE FROM paper_usage').run();
      return { ok: true };
    }

    case 'updatePlanCounts': {
      const { planId, counts } = params;
      db.prepare('UPDATE plan SET counts = ? WHERE id = ?').run(JSON.stringify(counts), planId);
      return { ok: true };
    }

    case 'savePaper': {
      const { title, examType, subjects, sections, counts, totalScore, questions } = params;
      const info = db.prepare(`INSERT INTO paper (title, exam_type, subjects, sections, counts, total_score, questions, created_at)
        VALUES (?,?,?,?,?,?,?,?)`).run(title, examType, JSON.stringify(subjects), JSON.stringify(sections), JSON.stringify(counts), totalScore, JSON.stringify(questions), Date.now());
      return { lastInsertRowid: info.lastInsertRowid };
    }

    case 'listPapers': {
      const { examType } = params;
      return db.prepare('SELECT id, title, exam_type, subjects, sections, counts, total_score, created_at FROM paper WHERE exam_type = ? ORDER BY created_at DESC LIMIT 100').all(examType);
    }

    case 'getPaper': {
      const { id } = params;
      return db.prepare('SELECT * FROM paper WHERE id = ?').get(id) || null;
    }

    case 'deletePaper': {
      const { id } = params;
      db.prepare('DELETE FROM paper WHERE id = ?').run(id);
      return { ok: true };
    }

    default:
      throw new Error('unknown db method: ' + method);
  }
}
ipcMain.handle('db-api', (e, method, params) => {
  try {
    return { ok: true, data: dbApi(method, params || {}) };
  } catch (err) { return { ok: false, err: String(err) }; }
});

// ======== 题目配图（本地 PDF 渲染页） ========
// 兼容多种路径：dev(resources/_qimgs)、打包(resources/_qimgs 或 resources/resources/_qimgs)
function findQImg(qid) {
  const d = getAppDir();
  const candidates = [
    path.join(d, '_qimgs', `q${qid}.png`),
    path.join(d, 'resources', '_qimgs', `q${qid}.png`),
    path.join(d, 'resources', 'resources', '_qimgs', `q${qid}.png`),
    path.join(__dirname, 'resources', '_qimgs', `q${qid}.png`),
    path.join(__dirname, '_qimgs', `q${qid}.png`),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}
ipcMain.handle('question-image', (e, qid) => {
  try {
    // 严格校验 qid 为正整数，防止路径遍历
    if (!Number.isInteger(qid) || qid <= 0 || qid > 1e7) return { ok: false, err: 'invalid qid' };
    const imgPath = findQImg(qid);
    if (!imgPath) return { ok: false, err: 'not found: q' + qid };
    const buf = fs.readFileSync(imgPath);
    return { ok: true, data: 'data:image/png;base64,' + buf.toString('base64') };
  } catch (err) { return { ok: false, err: String(err) }; }
});

// ======== 组卷历史 ========
ipcMain.handle('paper-save', (e, payload) => {
  try {
    const { title, examType, subjects, sections, counts, totalScore, questions } = payload;
    const info = openDb().prepare(
      `INSERT INTO paper (title, exam_type, subjects, sections, counts, total_score, questions, created_at)
       VALUES (?,?,?,?,?,?,?,?)`
    ).run(title, examType, JSON.stringify(subjects), JSON.stringify(sections), JSON.stringify(counts), totalScore, JSON.stringify(questions), Date.now());
    return { ok: true, id: info.lastInsertRowid };
  } catch (err) { return { ok: false, err: String(err) }; }
});

ipcMain.handle('paper-list', (e, examType) => {
  try {
    const rows = openDb().prepare(
      `SELECT id, title, exam_type, subjects, sections, counts, total_score, created_at FROM paper
       WHERE exam_type = ? ORDER BY created_at DESC LIMIT 100`
    ).all(examType).map(r => ({ ...r }));
    return { ok: true, rows };
  } catch (err) { return { ok: false, err: String(err) }; }
});

ipcMain.handle('paper-get', (e, id) => {
  try {
    const row = { ...openDb().prepare('SELECT * FROM paper WHERE id = ?').get(id) };
    return { ok: true, row };
  } catch (err) { return { ok: false, err: String(err) }; }
});

ipcMain.handle('paper-delete', (e, id) => {
  try {
    openDb().prepare('DELETE FROM paper WHERE id = ?').run(id);
    return { ok: true };
  } catch (err) { return { ok: false, err: String(err) }; }
});

let mainWindow;
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280, height: 840,
    title: 'GradPrep 考研组卷',
    autoHideMenuBar: true,
    webPreferences: {
      preload: getPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (!app.isPackaged) mainWindow.webContents.openDevTools({ mode: 'bottom' });

  mainWindow.webContents.on('preload-error', (e, p, err) => {
    console.error('PRELOAD ERROR:', p, err?.message || err);
  });

  if (app.isPackaged || isAsar) {
    mainWindow.loadFile(path.join(__dirname, 'dist', 'index.html'));
  } else {
    mainWindow.loadURL('http://127.0.0.1:5173');
  }
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { app.quit(); });
