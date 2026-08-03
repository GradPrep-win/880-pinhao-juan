#!/usr/bin/env python3
"""按归一化文本内容匹配 markdown 图片到 DB 题目"""
import sqlite3, re

DB = "data.db"

def norm(s):
    s = s.replace(' ', '').replace('\t', '')
    s = re.sub(r'[\$]', '', s)
    s = re.sub(r'\\[a-zA-Z]+\{([^}]*)\}', r'\1', s)
    s = re.sub(r'\\[a-zA-Z]+', '', s)
    s = re.sub(r'[{}()\[\]_^]', '', s)
    return s

conn = sqlite3.connect(DB)
# markdown Q4 (微分)
md = "设函数 $f(x)$ 在 $(- \\infty , + \\infty )$ 内连续， $f''(x)$ 的图形如图所示，则曲线 $y = f(x)$ 的拐点个数为 ____."
md_n = norm(md)
print("MD:", md_n[:120])

rows = conn.execute('''SELECT q.id, q.content FROM question q
    JOIN chapter ch ON ch.id=q.chapter_id
    JOIN bank b ON b.id=ch.bank_id
    WHERE b.exam_type='数一' AND b.subject='高数篇' AND q.num=4
    AND ch.name LIKE '%微分%'
    ORDER BY q.id''').fetchall()
for r in rows:
    db_first = r[1].split('\n')[0] if r[1] else ''
    db_n = norm(db_first)
    # 互相包含？
    m_in_d = md_n[:50] in db_n
    d_in_m = db_n[:50] in md_n
    print(f'Q{r[0]}: mdinDB={m_in_d} dbinMD={d_in_m}')
    if m_in_d or d_in_m:
        print(f'  MATCH! db={db_n[:120]}')
