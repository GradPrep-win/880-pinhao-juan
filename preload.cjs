const { contextBridge, ipcRenderer } = require('electron');

// 注意：Electron 35 预加载沙箱里不可用 path/fs 等 Node 模块
// 所有 API 仅依赖 ipcRenderer

// 通用 db-api 调用：主进程按 method 白名单分发，渲染进程不可执行任意 SQL
function db(method, params) {
  return ipcRenderer.invoke('db-api', method, params).then((r) => {
    if (!r.ok) throw new Error(r.err);
    return r.data;
  });
}

contextBridge.exposeInMainWorld('electronAPI', {
  // 题库
  getBanks: () => db('getBanks'),
  aggregateCounts: (p) => db('aggregateCounts', p),
  planUsedCounts: (p) => db('planUsedCounts', p),
  listQuestions: (p) => db('listQuestions', p),

  // 方案
  listPlans: (p) => db('listPlans', p),
  createPlan: (p) => db('createPlan', p).then((r) => r.lastInsertRowid),
  deletePlan: (planId) => db('deletePlan', { planId }),
  recordPlanUsage: (planId, questionIds) => db('recordPlanUsage', { planId, questionIds }),
  recordPaperUsage: (questionIds) => db('recordPaperUsage', { questionIds }),
  resetPaperUsage: () => db('resetPaperUsage'),
  updatePlanCounts: (p) => db('updatePlanCounts', p),

  // 组卷历史
  savePaper: (p) => db('savePaper', p).then((r) => r.lastInsertRowid),
  listPapers: (examType) => db('listPapers', { examType }),
  getPaper: (id) => db('getPaper', { id }),
  deletePaper: (id) => db('deletePaper', { id }),

  // 加载题目本地配图（PDF 渲染页），返回 dataURL
  questionImage: (qid) => ipcRenderer.invoke('question-image', qid),
});
