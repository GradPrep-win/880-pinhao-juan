// 抽题算法：按 examType+subject+section 分池，每池独立无放回随机抽 n 道
// 参考 D:\program\GradPrep/src/lib/paper-generator.ts createAndSavePaper

export const TYPE_ORDER = { 选择题: 0, 填空题: 1, 解答题: 2 };
export const TYPE_LABEL_CHOICES = ['选择题', '填空题', '解答题'];

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// 按章节均匀分配 count 道题：每章分 floor(count/n) 道，余数随机补给部分章
// 池子不够时直接取全部现有题目，不跨章节补题（用户要求：缺题就缺题，不要从别处补）
function pickBalanced(pool, count) {
  // 按 chapter_order 分组，保留章节顺序
  const byChapter = {};
  for (const q of pool) {
    const key = q.chapter_order + '|' + q.chapter_name;
    (byChapter[key] ||= []).push(q);
  }
  const chapters = Object.keys(byChapter);
  if (chapters.length === 0) return [];

  // 每章先 shuffle
  for (const k of chapters) byChapter[k] = shuffle(byChapter[k]);

  // 池子总量不够时，直接取全部，不再补题
  const totalAvail = chapters.reduce((s, k) => s + byChapter[k].length, 0);
  if (totalAvail <= count) {
    const picked = [];
    for (const k of chapters) picked.push(...byChapter[k]);
    return picked;
  }

  const alloc = {}; // key -> 应抽几道
  const base = Math.floor(count / chapters.length);
  let remainder = count - base * chapters.length;
  // 随机挑 remainder 章各多抽 1 道
  const extraIdx = new Set();
  const idxPool = chapters.map((_, i) => i);
  shuffle(idxPool);
  for (let i = 0; i < remainder; i++) extraIdx.add(idxPool[i]);

  chapters.forEach((k, i) => { alloc[k] = base + (extraIdx.has(i) ? 1 : 0); });

  // 某章题不够时，该章取全部，缺额不补（保留给调用方提示）
  for (const k of chapters) {
    const have = byChapter[k].length;
    if (alloc[k] > have) alloc[k] = have;
  }

  const picked = [];
  for (const k of chapters) picked.push(...byChapter[k].slice(0, alloc[k]));
  return picked;
}

/**
 * @param {object} opts
 * @param {string} opts.examType  数一/数二
 * @param {string[]} opts.subjects  选中的篇章如 ["高数篇","线代篇"]
 * @param {Array<{subject,type,count}>} opts.picks  每个(篇章,题型)指定抽几道
 * @param {Function} opts.listQuestions  (subject,type) => Promise<Question[]>
 */
export async function compose({ examType, subjects, picks, sections, planId, listQuestions }) {
  const all = []; // {..., subject, section}
  for (const p of picks) {
    if (!p.count || p.count <= 0) continue;
    const pool = (await listQuestions({ examType, subject: p.subject, type: p.type, sections, planId })) || [];
    const picked = pickBalanced(pool, p.count);
    for (const q of picked) all.push({ ...q, subject: p.subject });
  }
  // 按题型分，题型内随机打乱（不再按章节顺序排列，让题目混合出现）
  all.sort((a, b) => (TYPE_ORDER[a.type] ?? 99) - (TYPE_ORDER[b.type] ?? 99));
  // 同题型内 shuffle
  const byType = [[], [], []]; // 选择/填空/解答
  for (const q of all) byType[TYPE_ORDER[q.type] ?? 0].push(q);
  const mixed = [];
  for (const group of byType) {
    mixed.push(...shuffle(group));
  }
  let no = 0;
  const questions = mixed.map(q => ({ ...q, paper_no: ++no }));
  const total = questions.length;
  const totalScore = questions.reduce((s, q) => s + (q.type === '解答题' ? 10 : 5), 0);
  return { examType, questions, total, totalScore };
}
