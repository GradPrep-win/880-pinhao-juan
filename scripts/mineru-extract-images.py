#!/usr/bin/env python3
"""
用 MinerU 批量提取 PDF 题目配图到本地，关联数据库题目。
不分卷，直接整 PDF 跑（一次一个，串行）。

流程:
1. 对每个 PDF 跑 MinerU → 得到 markdown（images/hash.jpg）+ 图片文件
2. 解析 markdown 得到题目顺序: [(num, image_hash)]
3. 线概篇 PDF 按章节头拆分线代/概率
4. num → qid（通过 exam+subject）
5. 复制图片为 q{qid}.png，更新 DB content 加入 local:qN

用法: python scripts/mineru-extract-images.py
"""
import fitz
import os
import re
import sqlite3
import json
import shutil
import subprocess
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
ROOT = SCRIPT_DIR.parent  # gradprep-new/
PARENT = ROOT.parent      # D:\progress project\
DB_PATH = ROOT / "data.db"
OUT_DIR = ROOT / "resources" / "_qimgs"
OUT_DIR.mkdir(parents=True, exist_ok=True)

# PDF → (exam, subject)。线代/概率共用同一 PDF，用 section_split 区分
SOURCES = [
    {"pdf": "【A4紧凑版】880数一高数篇做题本.pdf", "exam": "数一", "subject": "高数篇"},
    {"pdf": "【A4紧凑版】880数一线概篇做题本.pdf", "exam": "数一",
     "sections": ["线代篇", "概率篇"]},
    {"pdf": "【A4紧凑版】李林880数二高数篇做题本.pdf", "exam": "数二", "subject": "高数篇"},
    {"pdf": "【A4紧凑版】李林880数二线代篇做题本.pdf", "exam": "数二", "subject": "线代篇"},
]

PROB_HEADER_RE = re.compile(r'^#+.*概率.*统计', re.M)


def run_mineru(pdf_path, output_dir):
    """跑 MinerU，返回 (markdown_text, [image_path])"""
    print(f"  [mineru] running on {pdf_path.name}...")
    r = subprocess.run(
        ["mineru", "-p", str(pdf_path), "-o", str(output_dir), "--backend", "pipeline"],
        capture_output=True, text=True, timeout=1800
    )
    if r.returncode != 0:
        print(f"  [mineru ERR] {r.stderr[-300:]}")
        return "", []
    md_files = list(output_dir.rglob("*.md"))
    images = []
    for d in output_dir.rglob("images"):
        if d.is_dir():
            images.extend([f for f in d.iterdir() if f.is_file()])
    if not md_files:
        return "", images
    return md_files[0].read_text(encoding="utf-8"), images


def parse_md_images(md_text):
    """解析 MinerU markdown → [(num, image_filename)]，只返回有图的题"""
    img_re = re.compile(r'!\[[^\]]*\]\(images/([a-f0-9]+\.[a-z]+)\)')
    q_re = re.compile(r'^\s*\((\d+)\)\s')
    results = []
    cur_num = None
    for line in md_text.split("\n"):
        m_q = q_re.match(line)
        if m_q:
            cur_num = int(m_q.group(1))
            continue
        m_img = img_re.search(line)
        if m_img and cur_num is not None:
            results.append((cur_num, m_img.group(1)))
            cur_num = None
    return results


def split_sections(md_text):
    """把线概篇 markdown 拆成 {section_name: text}。按概率头切分。"""
    m = PROB_HEADER_RE.search(md_text)
    if not m:
        return {"线代篇": md_text, "概率篇": ""}
    split_pos = m.start()
    return {"线代篇": md_text[:split_pos], "概率篇": md_text[split_pos:]}


def main():
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row

    def qid_for(exam, subject, num):
        sql = """SELECT q.id FROM question q
                 JOIN chapter ch ON ch.id=q.chapter_id
                 JOIN bank b ON b.id=ch.bank_id
                 WHERE b.exam_type=? AND b.subject=? AND q.num=?"""
        r = conn.execute(sql, (exam, subject, num)).fetchone()
        return r["id"] if r else None

    work_dir = PARENT / "_mineru_imgs_work"
    work_dir.mkdir(exist_ok=True)

    total_copied = 0
    manifest = {}

    for cfg in SOURCES:
        pdf_path = PARENT / cfg["pdf"]
        if not pdf_path.exists():
            print(f"[skip] pdf not found: {pdf_path}")
            continue

        subject_label = cfg.get("subject") or "+".join(cfg.get("sections", []))
        print(f"\n=== {cfg['exam']}/{subject_label} ===")

        # 跑 MinerU（断点续传：已有输出则跳过）
        out_dir = work_dir / pdf_path.stem
        existing_md = list(out_dir.rglob("*.md")) if out_dir.exists() else []
        if existing_md:
            print("  [skip] mineru output exists, reusing")
            md_text = existing_md[0].read_text(encoding="utf-8")
            images = []
            for d in out_dir.rglob("images"):
                images.extend([f for f in d.iterdir() if f.is_file()])
        else:
            md_text, images = run_mineru(pdf_path, out_dir)

        print(f"  md chars={len(md_text)}, images={len(images)}")
        img_map = {f.name: f for f in images}

        # 确定要处理的 (section_name, md_part) 列表
        if "sections" in cfg:
            parts = split_sections(md_text)
            section_list = [(sec, parts[sec]) for sec in cfg["sections"] if parts.get(sec)]
        else:
            section_list = [(cfg["subject"], md_text)]

        for subject, part_md in section_list:
            qimgs = parse_md_images(part_md)
            print(f"  [{subject}] {len(qimgs)} image-questions")

            copied = 0
            for num, img_name in qimgs:
                qid = qid_for(cfg["exam"], subject, num)
                if not qid:
                    continue
                src = img_map.get(img_name)
                if not src:
                    print(f"    [warn] image file missing: {img_name}")
                    continue
                out = OUT_DIR / f"q{qid}.png"
                # jpg → png（统一格式）
                if src.suffix.lower() == ".jpg":
                    try:
                        pix = fitz.Pixmap(str(src))
                        if pix.n - pix.alpha > 3:
                            pix = fitz.Pixmap(fitz.csRGB, pix)
                        pix.save(str(out))
                        pix = None
                    except Exception as e:
                        print(f"    [warn] convert fail Q{qid}: {e}")
                        continue
                else:
                    shutil.copy2(src, out)

                # 更新 DB
                row = conn.execute("SELECT content FROM question WHERE id=?", (qid,)).fetchone()
                if row:
                    content = row["content"]
                    ref = f"local:q{qid}"
                    if ref not in content:
                        content = content + f"\n\n![image]({ref})"
                        conn.execute("UPDATE question SET content=? WHERE id=?", (content, qid))
                    manifest[str(qid)] = {"exam": cfg["exam"], "subject": subject,
                                          "num": num, "src": img_name}
                    copied += 1

            print(f"  [{subject}] copied {copied} images")
            total_copied += copied

    conn.commit()
    conn.close()

    # 写 manifest
    mpath = OUT_DIR / "manifest_mineru.json"
    mpath.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"\n=== DONE: {total_copied} images copied ===")
    print(f"manifest: {mpath}")


if __name__ == "__main__":
    main()
