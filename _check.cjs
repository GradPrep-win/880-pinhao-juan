const Database = require('better-sqlite3');
const db = new Database('./data.db', { readonly: true });
const banks = db.prepare('SELECT id,exam,name FROM bank ORDER BY id').all();
for (const b of banks) {
  const cnt = db.prepare('SELECT count(*) c FROM question q JOIN chapter ch ON ch.id=q.chapter_id WHERE ch.bank_id=?').get(b.id).c;
  const diffs = db.prepare('SELECT difficulty,count(*) c FROM question q JOIN chapter ch ON ch.id=q.chapter_id WHERE ch.bank_id=? GROUP BY difficulty').all(b.id);
  console.log(b.exam, b.name.slice(0,12), 'total='+cnt, diffs.map(d=>d.difficulty+'='+d.c).join(' '));
}
const s1 = db.prepare("SELECT count(*) c FROM question q JOIN chapter ch ON ch.id=q.chapter_id JOIN bank b ON b.id=ch.bank_id WHERE b.exam=?").get('数一').c;
const s2 = db.prepare("SELECT count(*) c FROM question q JOIN chapter ch ON ch.id=q.chapter_id JOIN bank b ON b.id=ch.bank_id WHERE b.exam=?").get('数二').c;
console.log('数一='+s1, '(目标1126)', '数二='+s2, '(目标929)', 'total='+(s1+s2));
