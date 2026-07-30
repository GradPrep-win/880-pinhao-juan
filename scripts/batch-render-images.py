#!/usr/bin/env python3
"""
批量渲染题目配图：从原始 markdown 提取图片引用 → 对应 PDF 页面 → PNG → 更新数据库为 local:qN。

依赖: pip install pymupdf
用法: python scripts/batch-render-images.py
"""
import fitz  # pymupdf
import os
import re
import sqlite3
import json

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(SCRIPT_DIR)  # gradprep-new/
PARENT = os.path.dirname(ROOT)      # D:\progress project\
DB_PATH = os.path.join(ROOT, "data.db")
OUT_DIR = os.path.join(ROOT, "resources", "_qimgs")
os.makedirs(OUT_DIR, exist_ok=True)

# 源文件配置：markdown → PDF → (exam_type, subject, [可选 split])
SOURCES = [
    {
        "md": "MinerU_markdown_【A4紧凑版】880数一高数篇做题本_0_1784364586199_2078403318932008960.md",
        "pdf": "【A4紧凑版】880数一高数篇做题本.pdf",
        "exam": "数一", "subject": "高数篇",
    },
    {
        "md": "MinerU_markdown_【A4紧凑版】880数一线概篇做题本_0_1784364609490_2078403649199894528.md",
        "pdf": "【A4紧凑版】880数一线概篇做题本.pdf",
        "exam": "数一", "subject": "线代篇", "split": "线代篇",
    },
    {
        "md": "MinerU_markdown_【A4紧凑版】880数一线概篇做题本_0_1784364609490_2078403649199894528.md",
        "pdf": "【A4紧凑版】880数一线概篇做题本.pdf",
        "exam": "数一", "subject": "概率篇", "split": "概率篇",
    },
    {
        "md": "MinerU_markdown_【A4紧凑版】李林880数二高数篇做题本_0_1784338992079_2078379966842503168.md",
        "pdf": "【A4紧凑版】李林880数二高数篇做题本.pdf",
        "exam": "数二", "subject": "高数篇",
    },
    {
        "md": "MinerU_markdown_【A4紧凑版】李林880数二线代篇做题本_0_1784364627721_2078402841163038720.md",
        "pdf": "【A4紧凑版】李林880数二线代篇做题本.pdf",
        "exam": "数二", "subject": "线代篇",
    },
]

# 匹配题号: (数字) 或 (罗马数字)
Q_RE_CN = re.compile(r'^\((\d+)\)\s+(.*)$')
Q_RE_ROMAN = re.compile(r'^\(([IVXLCDM]{1,7})\)\s+(.*)$')
ROMAN_VAL = {'I':1,'V':5,'X':10,'L':50,'C':100,'D':500,'M':1000}
def roman_to_int(r):
    n=0
    for i in range(len(r)):
        v=ROMAN_VAL[r[i]]
        n += -v if i+1<len(r) and v<ROMAN_VAL[r[i+1]] else v
    return n

# 图片引用
IMG_RE = re.compile(r'!\[([^\]]*)\]\(([^)]+)\)')


def parse_md_images(md_path):
    """从 markdown 提取: 题号(num) → 图片URL 列表, 顺序对应 PDF 页码"""
    with open(md_path, encoding='utf-8') as f:
        text = f.read()
    lines = text.split('\n')
    results = []  # [(num, [img_urls])]
    cur_num = None
    cur_imgs = []
    cur_streak = 0  # 连续图片行（MinerU 把图拆成多行）

    def commit():
        nonlocal cur_num, cur_imgs
        if cur_num is not None and cur_imgs:
            results.append((cur_num, list(cur_imgs)))
        cur_num = None
        cur_imgs = []

    for line in lines:
        s = line.strip()
        m_cn = Q_RE_CN.match(s)
        m_rm = Q_RE_ROMAN.match(s) if not m_cn else None
        if m_cn:
            commit()
            body = m_cn.group(2)
            if not re.match(r'^[+\-*/\\]', body):
                cur_num = int(m_cn.group(1))
                cur_imgs = IMG_RE.findall(body)
            continue
        if m_rm and roman_to_int(m_rm.group(1)) > 0:
            body = m_rm.group(2)
            if not re.match(r'^[+\-*/\\]', body):
                commit()
                cur_num = 1000 + roman_to_int(m_rm.group(1))
                cur_imgs = IMG_RE.findall(body)
                continue
        # 图片行
        imgs = IMG_RE.findall(s)
        if imgs and cur_num is not None:
            cur_imgs.extend(imgs)
    commit()
    return results


def main():
    # 1. 从 markdown 收集所有图片引用 (按 source 分组)
    by_source = {}
    for cfg in SOURCES:
        md_path = os.path.join(PARENT, cfg["md"])
        md_path = os.path.normpath(md_path)
        if not os.path.exists(md_path):
            print(f"[skip] md not found: {md_path}")
            continue
        imgs = parse_md_images(md_path)
        by_source[id(cfg)] = (cfg, imgs)
        print(f"[md] {cfg['md'][:30]}... → {len(imgs)} 图片题")

    # 2. 打开数据库，按 (exam, subject) 建立 num → question_id 的映射
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row

    def qid_for(exam, subject, num):
        sql = """SELECT q.id FROM question q
                 JOIN chapter ch ON ch.id=q.chapter_id
                 JOIN bank b ON b.id=ch.bank_id
                 WHERE b.exam_type=? AND b.subject=? AND q.num=?"""
        r = conn.execute(sql, (exam, subject, num)).fetchone()
        return r['id'] if r else None

    manifest = {}
    rendered = 0
    skipped_existing = 0

    for cfg_id, (cfg, imgs) in by_source.items():
        pdf_path = os.path.join(PARENT, cfg["pdf"])
        pdf_path = os.path.normpath(pdf_path)
        if not os.path.exists(pdf_path):
            print(f"[skip] pdf not found: {pdf_path}")
            continue
        doc = fitz.open(pdf_path)
        print(f"[pdf] {cfg['pdf'][:30]}... {len(doc)} pages")

        for num, urls in imgs:
            qid = qid_for(cfg['exam'], cfg['subject'], num)
            if not qid:
                print(f"  [warn] no Q for {cfg['exam']}/{cfg['subject']} num={num}")
                continue
            out = os.path.join(OUT_DIR, f"q{qid}.png")
            if os.path.exists(out):
                skipped_existing += 1
                # 确保 DB 有 local:qN 引用
                row = conn.execute("SELECT content FROM question WHERE id=?", (qid,)).fetchone()
                if row and f"local:q{qid}" not in row['content']:
                    conn.execute("UPDATE question SET content=? WHERE id=?",
                                 (row['content'] + f"\n\n![image](local:q{qid})", qid))
                continue
            # 找到该题在 PDF 的页码（按题目顺序扫描页面，匹配题号文本）
            page_idx = find_question_page(doc, num, urls)
            if page_idx is None:
                print(f"  [warn] page not found for Q{qid} num={num}")
                continue
            # 渲染
            page = doc[page_idx]
            mat = fitz.Matrix(2, 2)  # 2x 缩放 → ~300dpi
            pix = page.get_pixmap(matrix=mat)
            pix.save(out)
            # 更新 DB
            row = conn.execute("SELECT content FROM question WHERE id=?", (qid,)).fetchone()
            content = row['content'] if row else ""
            if f"local:q{qid}" not in content:
                content = content + f"\n\n![image](local:q{qid})"
                conn.execute("UPDATE question SET content=? WHERE id=?", (content, qid))
            manifest[str(qid)] = {
                "file": cfg["pdf"], "page": page_idx + 1,
                "w": pix.width, "h": pix.height, "out": f"resources/_qimgs\\q{qid}.png"
            }
            rendered += 1
            print(f"  [ok] Q{qid} num={num} → page {page_idx+1} ({pix.width}x{pix.height})")
        doc.close()

    conn.commit()
    conn.close()

    # 写 manifest
    with open(os.path.join(OUT_DIR, "manifest.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)

    print(f"\n=== 完成: 新渲染 {rendered}, 跳过已有 {skipped_existing} ===")
    print(f"manifest: {os.path.join(OUT_DIR, 'manifest.json')}")


def find_question_page(doc, num, urls):
    """在 PDF 中找到题号为 num 的页面（通过文本匹配）"""
    # 策略：页面包含 "(num)" 或题号对应的 CDN URL
    url_pattern = None
    if urls:
        # 取 URL 的最后一段作为特征
        for _alt, url in urls:
            url_pattern = url.split('/')[-1].split('?')[0][:20]
            break
    target = f"({num})"
    for i, page in enumerate(doc):
        text = page.get_text()
        if target in text:
            # 额外校验：第一行就是该题（避免匹配到解析里的引用）
            lines = [l.strip() for l in text.split('\n') if l.strip()]
            for l in lines[:5]:
                if l.startswith(target):
                    return i
    # fallback: URL 特征匹配
    if url_pattern:
        for i, page in enumerate(doc):
            if url_pattern in page.get_text():
                return i
    return None


if __name__ == "__main__":
    main()
