#!/usr/bin/env python3
"""
修复配图匹配：用原始 CDN markdown 的正确关联 + 重跑的本地图片。

核心发现：
- 原始 MinerU markdown（CDN URL）的题目→图片关联是正确的
- 重跑 MinerU（本地图片）在章节内的图片顺序与原始完全一致
- 所以：按 (章节, 章节内位置) 把原始关联映射到本地图片，再按内容匹配 DB

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
    # (原始markdown, PDF名, exam, subject[, 概率篇拆分])
    {"md": "MinerU_markdown_【A4紧凑版】880数一高数篇做题本_0_1784364586199_2078403318932008960.pdf",
     "pdf": "【A4紧凑版】880数一高数篇做题本.pdf", "exam": "数一", "subject": "高数篇",
     "md_path": "MinerU_markdown_【A4紧凑版】880数一高数篇做题本_0_1784364586199_2078403318932008960.md"},
    {"pdf": "【A4紧凑版】880数一线概篇做题本.pdf", "exam": "数一", "sections": ["线代篇", "概率篇"],
     "md_path": "MinerU_markdown_【A4紧凑版】880数一线概篇做题本_0_1784364609490_2078403649199894528.md"},
    {"pdf": "【A4紧凑版】李林880数二高数篇做题本.pdf", "exam": "数二", "subject": "高数篇",
     "md_path": "MinerU_markdown_【A4紧凑版】李林880数二高数篇做题本_0_1784338992079_2078379966842503168.md"},
    {"pdf": "【A4紧凑版】李林880数二线代篇做题本.pdf", "exam": "数二", "subject": "线代篇",
     "md_path": "MinerU_markdown_【A4紧凑版】李林880数二线代篇做题本_0_1784364627721_2078402841163038720.md"},
]

CHAPTER_RE = re.compile(r'^#{2,3}\s*第[一二三四五六七八九十]+章\s+(.+)$', re.M)
IMG_RE = re.compile(r'!\[[^\]]*\]\((?:https?://[^)]+|images/([a-f0-9]+\.[a-z]+))\)')
Q_RE = re.compile(r'^\s*\((\d+)\)\s*(.*)')
PROB_RE = re.compile(r'^#+.*概率.*统计', re.M)


def parse_chapter_images(md_text):
    """解析 markdown → {chapter_name: [(num, text, img_match_group)]}"""
    chapters = {}
    cur_ch = None
    cur_num = None
    cur_text = None
    for line in md_text.split("\n"):
        mc = CHAPTER_RE.match(line)
        if mc:
            cur_ch = mc.group(1).strip()
            chapters.setdefault(cur_ch, [])
            cur_num = None
            continue
        mq = Q_RE.match(line)
        if mq:
            cur_num = int(mq.group(1))
            cur_text = mq.group(2)
            continue
        mi = IMG_RE.search(line)
        if mi and cur_num is not None and cur_ch is not None:
            chapters[cur_ch].append((cur_num, cur_text, mi.group(1)))
            cur_num = None
    return chapters


def norm(s):
    """归一化：去空格、$、LaTeX命令保留参数、去括号"""
    s = s.replace(' ', '').replace('\t', '')
    s = re.sub(r'[\$]', '', s)
    s = re.sub(r'\\[a-zA-Z]+\{([^}]*)\}', r'\1', s)
    s = re.sub(r'\\[a-zA-Z]+', '', s)
    s = re.sub(r'[{}()\[\]_^]', '', s)
    return s


def main():
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row

    def load_chapters(exam, subject):
        rows = conn.execute(
            "SELECT ch.id, ch.name FROM chapter ch JOIN bank b ON b.id=ch.bank_id "
            "WHERE b.exam_type=? AND b.subject=? ORDER BY ch.ord",
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

    def find_qid(chapter_id, text_snippet):
        """按归一化全文匹配"""
        md_n = norm(text_snippet)
        if not md_n:
            return None
        rows = conn.execute(
            "SELECT id, content FROM question WHERE chapter_id=?",
            (chapter_id,)).fetchall()
        for r in rows:
            # 取 DB 内容第一行（题干）归一化
            db_first = (r["content"] or "").split("\n")[0]
            db_n = norm(db_first)
            if not db_n:
                continue
            # 互相包含（MD 可能稍长或稍短）
            if md_n[:60] in db_n or db_n[:60] in md_n:
                return r["id"]
        return None

    total = 0
    manifest = {}

    for cfg in SOURCES:
        md_path = PARENT / cfg["md_path"]
        if not md_path.exists():
            print(f"[skip] md not found: {md_path}")
            continue

        # 原始 markdown（CDN 图，正确关联）
        orig_md = md_path.read_text(encoding="utf-8")
        orig_chapters = parse_chapter_images(orig_md)

        # 重跑 markdown（本地图）
        pdf_stem = PARENT / cfg["pdf"]
        out_dir = WORK_DIR / pdf_stem.stem
        rerun_md_files = list(out_dir.rglob("*.md")) if out_dir.exists() else []
        if not rerun_md_files:
            print(f"[skip] no rerun for {cfg['pdf']}")
            continue
        rerun_md = rerun_md_files[0].read_text(encoding="utf-8")
        rerun_chapters = parse_chapter_images(rerun_md)

        # 收集重跑的图片文件
        rerun_images = []
        for d in out_dir.rglob("images"):
            rerun_images.extend([f for f in d.iterdir() if f.is_file()])
        rerun_img_map = {f.name: f for f in rerun_images}

        label = cfg.get("subject") or "+".join(cfg.get("sections", []))
        print(f"\n=== {cfg['exam']}/{label} ===")

        # 拆分线代/概率
        if "sections" in cfg:
            split_at = PROB_RE.search(orig_md)
            split_pos = split_at.start() if split_at else len(orig_md)
            orig_parts = {"线代篇": orig_md[:split_pos], "概率篇": orig_md[split_pos:]}
            # 重跑也拆分
            split_at2 = PROB_RE.search(rerun_md)
            split_pos2 = split_at2.start() if split_at2 else len(rerun_md)
            rerun_parts = {"线代篇": rerun_md[:split_pos2], "概率篇": rerun_md[split_pos2:]}

            sec_list = []
            for sec in cfg["sections"]:
                oc = parse_chapter_images(orig_parts[sec])
                rc = parse_chapter_images(rerun_parts[sec])
                sec_list.append((sec, oc, rc))
        else:
            sec_list = [(cfg["subject"], orig_chapters, rerun_chapters)]

        for subject, oc, rc in sec_list:
            db_chapters = load_chapters(cfg["exam"], subject)
            # 建立章节名映射
            chapter_map = {}
            for ch_name in oc:
                cid = chapter_id_by_name(ch_name, db_chapters)
                chapter_map[ch_name] = cid

            copied = 0
            # 对每个章节，按位置匹配原始(正确关联)与重跑(本地文件)
            for ch_name in oc:
                cid = chapter_map.get(ch_name)
                if not cid:
                    continue
                olist = oc[ch_name]
                rlist = rc.get(ch_name, [])
                if len(olist) != len(rlist):
                    print(f"  [warn] {ch_name[:15]}: count mismatch orig={len(olist)} rerun={len(rlist)}")
                    continue
                for (o_num, o_text, _), (r_num, _, r_hash) in zip(olist, rlist):
                    qid = find_qid(cid, o_text)
                    if not qid:
                        print(f"    [warn] no Q: ch={ch_name[:10]} num={o_num}")
                        continue
                    src = rerun_img_map.get(r_hash)
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
                                              "num": o_num, "src": r_hash}
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
