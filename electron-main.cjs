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
  `);
}

ipcMain.handle('db-query', (e, sql, params = []) => {
  try {
    const stmt = openDb().prepare(sql);
    if (sql.trimStart().match(/^(INSERT|UPDATE|DELETE)/i)) {
      const info = stmt.run(...params);
      return { ok: true, rows: [], lastInsertRowid: info.lastInsertRowid, changes: info.changes };
    }
    // 序列化为纯对象，避免 Electron IPC 克隆 better-sqlite3 行对象失败
    return { ok: true, rows: stmt.all(...params).map(r => ({ ...r })) };
  } catch (err) { return { ok: false, err: String(err) }; }
});

ipcMain.handle('db-get', (e, sql, params = []) => {
  try {
    return { ok: true, row: { ...openDb().prepare(sql).get(...params) } };
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
