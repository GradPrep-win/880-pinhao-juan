import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import "katex/dist/katex.min.css";

const WATERMARK_RE = /为了防止被小坏蛋拿去转卖抹掉的水印.*$|https?:\/\/nocode\.host[^\s)]*/g;

/** 剥离内容里的水印行和外部链接 */
function stripWatermark(content: string): string {
  return content
    .split("\n")
    .filter((ln) => !/为了防止被小坏蛋拿去转卖抹掉的水印/.test(ln))
    .join("\n")
    .replace(WATERMARK_RE, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** 本地配图组件：把 local:qN 转成 base64 dataURL 渲染 */
function LocalQImg({ qid }: { qid: number }) {
  const [src, setSrc] = useState<string>("");
  const [err, setErr] = useState(false);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await window.electronAPI?.questionImage(qid);
        if (alive && r?.ok) setSrc(r.data);
        else if (alive) setErr(true);
      } catch { if (alive) setErr(true); }
    })();
    return () => { alive = false; };
  }, [qid]);
  if (src) return <img src={src} alt={`配图 q${qid}`} className="md-local-img" />;
  if (err) return <span className="md-img-err">[配图 q${qid} 加载失败]</span>;
  return <span className="md-img-loading">[配图加载中…]</span>;
}

export default function Markdown({ content }: { content: string }) {
  const cleaned = stripWatermark(content || "");
  return (
    <span className="md-body">
      <ReactMarkdown
        remarkPlugins={[remarkMath, remarkGfm]}
        rehypePlugins={[rehypeRaw, rehypeKatex]}
        components={{
          img({ node, ...props }) {
            const src = (props as { src?: string }).src || "";
            // 本地题目配图：local:q{N}
            const m = src.match(/^local:q(\d+)$/);
            if (m) {
              return <LocalQImg qid={Number(m[1])} />;
            }
            return (
              <img
                {...props}
                style={{ maxWidth: "100%", height: "auto", display: "block", margin: "0.5em auto" }}
                loading="lazy"
              />
            );
          },
        }}
      >
        {cleaned}
      </ReactMarkdown>
    </span>
  );
}
