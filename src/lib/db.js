// 数据库访问层 —— 通过 Electron preload 暴露的 electronAPI（白名单化方法，无任意 SQL 执行）

export async function getBanks() {
  if (!window.electronAPI?.getBanks) throw new Error('getBanks 不可用:请在 Electron 环境中运行');
  return window.electronAPI.getBanks();
}

export async function aggregateCounts({ examType, subjects, sections, planId }) {
  return window.electronAPI.aggregateCounts({ examType, subjects, sections, planId });
}

export async function planUsedCounts({ planId }) {
  return window.electronAPI.planUsedCounts({ planId });
}

export async function listQuestions({ examType, subject, type, sections, planId }) {
  return window.electronAPI.listQuestions({ examType, subject, type, sections, planId });
}

// ======== 方案 CRUD ========
export async function listPlans({ examType, subjects }) {
  return window.electronAPI.listPlans({ examType, subjects });
}

export async function createPlan({ examType, subjects, sections, counts, name }) {
  return window.electronAPI.createPlan({ examType, subjects, sections, counts, name });
}

export async function deletePlan(planId) {
  return window.electronAPI.deletePlan(planId);
}

export async function recordPlanUsage(planId, questionIds) {
  return window.electronAPI.recordPlanUsage(planId, questionIds);
}

// ======== 全局去重（跨组卷） ========
export async function recordPaperUsage(questionIds) {
  return window.electronAPI.recordPaperUsage(questionIds);
}

export async function resetPaperUsage() {
  return window.electronAPI.resetPaperUsage();
}

// ======== 方案更新题数 ========
export async function updatePlanCounts({ planId, counts }) {
  return window.electronAPI.updatePlanCounts({ planId, counts });
}

// ======== 组卷历史 ========
export async function savePaper({ title, examType, subjects, sections, counts, totalScore, questions }) {
  return window.electronAPI.savePaper({ title, examType, subjects, sections, counts, totalScore, questions });
}

export async function listPapers(examType) {
  return window.electronAPI.listPapers(examType);
}

export async function getPaper(id) {
  return window.electronAPI.getPaper(id);
}

export async function deletePaper(id) {
  return window.electronAPI.deletePaper(id);
}
