#!/usr/bin/env python3
"""
修复配图匹配：按题目内容精确匹配（而非题号，避免同章同号冲突）。
用 MinerU 提取的图片替换错误的 PDF 整页裁剪。

用法: python scripts/fix-image-matching.py
"""
import fitz
import re
import sqlite3
import json
import shutil
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
ROOT = SCRIPT_DIR.parent
PARENT = ROOT.parent
DB_PATH = ROOT / "data.db"
OUT_DIR = ROOT / "resources" / "_qimgs"
WORK_DIR = PARENT / "_mineru_imgs_work"

SOURCES = [
    {"pdf": "【A4紧凑版】880数一高数篇做题本.pdf", "exam": "数一", "subject": "高数篇"},
    {"pdf": "【A4紧凑版】880数一线概篇做题本.pdf", "exam": "数一", "sections": ["线代篇", "概率篇"]},
    {"pdf": "【A4紧凑版】李林880数二高数篇做题本.pdf", "exam": "数二", "subject": "高数篇"},
    {"pdf": "【A4紧凑版】李林880数二线代篇做题本.pdf", "exam": "数二", "subject": "线代篇"},
]

CHAPTER_RE = re.compile(r'^#{2,3}\s*第[一二三四五六七八九十]+章\s+(.+)$', re.M)
IMG_RE = re.compile(r'!\[[^\]]*\]\(images/([a-f0-9]+\.[a-z]+)\)')
# 题目行: (数字) 后面可能直接跟文字（无空格）
Q_RE = re.compile(r'^\s*\((\d+)\)\s*(.*)')
PROB_RE = re.compile(r'^#+.*概率.*统计', re.M)


def norm(s):
    """归一化：去掉所有 LaTeX 标记，保留 CJK+字母数字+基础符号"""
    s = s.replace(' ', '').replace('\t', '')
    s = s.replace('\\', '').replace('{', '').replace('}', '')
    s = s.replace('$', '').replace('^', '').replace('_', '')
    s = re.sub(r'[^一-鿿\w=<>+\-*/|∞∈]', '', s)
    return s[:80]


def parse_md_images(md_text):
    """解析 markdown → [(chapter_name, num, text_after_paren, image_filename)]"""
    results = []
    lines = md_text.split("\n")
    cur_chapter = None
    cur_num = None
    cur_text = None
    for line in lines:
        m_ch = CHAPTER_RE.match(line)
        if m_ch:
            cur_chapter = m_ch.group(1).strip()
            cur_num = None
            continue
        m_q = Q_RE.match(line)
        if m_q:
            cur_num = int(m_q.group(1))
            cur_text = m_q.group(2).strip()
            continue
        m_img = IMG_RE.search(line)
        if m_img and cur_num is not None:
            results.append((cur_chapter, cur_num, cur_text, m_img.group(1)))
            cur_num = None
            cur_text = None
    return results


def main():
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row

    def load_chapters(exam, subject):
        rows = conn.execute(
            """SELECT ch.id, ch.name FROM chapter ch JOIN bank b ON b.id=ch.bank_id
               WHERE b.exam_type=? AND b.subject=? ORDER BY ch.ord""",
            (exam, subject)).fetchall()
        return [(r["id"], r["name"]) for r in rows]

    def chapter_id_by_name(md_name, db_chapters):
        for cid, cname in db_chapters:
            clean = cname
            for p in ["第一章 ","第二章 ","第三章 ","第四章 ","第五章 ",
                      "第六章 ","第七章 ","第八章 ","第九章 ","第十章 "]:
                clean = clean.replace(p, "")
            if md_name in clean or clean in md_name:
                return cid
        return None

    def find_cjk(s):
        return ''.join(re.findall(r'[一-鿿]', s))

    def find_qid_by_content(chapter_id, num, text_snippet):
        """按 (chapter, num, 中文字符) 匹配题目"""
        md_cjk = find_cjk(text_snippet)
        if not md_cjk:
            return None
        rows = conn.execute(
            "SELECT id, content FROM question WHERE chapter_id=? AND num=?",
            (chapter_id, num)).fetchall()
        for r in rows:
            if md_cjk in find_cjk(r["content"]):
                return r["id"]
        return None

    total = 0
    manifest = {}

    for cfg in SOURCES:
        pdf_path = PARENT / cfg["pdf"]
        out_dir = WORK_DIR / pdf_path.stem
        md_files = list(out_dir.rglob("*.md")) if out_dir.exists() else []
        if not md_files:
            print(f"[skip] {cfg['pdf']}: no mineru output")
            continue

        md_text = md_files[0].read_text(encoding="utf-8")
        images = []
        for d in out_dir.rglob("images"):
            images.extend([f for f in d.iterdir() if f.is_file()])
        img_map = {f.name: f for f in images}

        label = cfg.get("subject") or "+".join(cfg.get("sections", []))
        print(f"\n=== {cfg['exam']}/{label} ===")

        if "sections" in cfg:
            split_at = PROB_RE.search(md_text)
            split_pos = split_at.start() if split_at else len(md_text)
            parts = {cfg["sections"][0]: md_text[:split_pos],
                     cfg["sections"][1]: md_text[split_pos:]}
            sec_list = [(s, parts[s]) for s in cfg["sections"]]
        else:
            sec_list = [(cfg["subject"], md_text)]

        for subject, part_md in sec_list:
            db_chapters = load_chapters(cfg["exam"], subject)
            qimgs = parse_md_images(part_md)
            print(f"  [{subject}] {len(qimgs)} img-questions")

            copied = 0
            for ch_name, num, text_snippet, img_name in qimgs:
                ch_id = chapter_id_by_name(ch_name, db_chapters)
                if not ch_id:
                    print(f"    [warn] no chapter: {ch_name}")
                    continue
                qid = find_qid_by_content(ch_id, num, text_snippet)
                if not qid:
                    print(f"    [warn] no Q: ch={ch_name} num={num} txt={text_snippet[:30]}")
                    continue
                src = img_map.get(img_name)
                if not src:
                    continue
                out = OUT_DIR / f"q{qid}.png"
                try:
                    if src.suffix.lower() == ".jpg":
                        pix = fitz.Pixmap(str(src))
                        if pix.n - pix.alpha > 3:
                            pix = fitz.Pixmap(fitz.csRGB, pix)
                        pix.save(str(out))
                        pix = None
                    else:
                        shutil.copy2(src, out)
                except Exception as e:
                    print(f"    [warn] convert Q{qid}: {e}")
                    continue

                row = conn.execute("SELECT content FROM question WHERE id=?", (qid,)).fetchone()
                if row:
                    ref = f"local:q{qid}"
                    content = row["content"]
                    if ref not in content:
                        content = content + f"\n\n![image]({ref})"
                        conn.execute("UPDATE question SET content=? WHERE id=?", (content, qid))
                    manifest[str(qid)] = {"exam": cfg["exam"], "subject": subject,
                                          "num": num, "src": img_name}
                    copied += 1

            print(f"  [{subject}] copied {copied}")
            total += copied

    conn.commit()
    conn.close()

    mpath = OUT_DIR / "manifest_mineru.json"
    mpath.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n=== DONE: {total} images ===")


if __name__ == "__main__":
    main()
