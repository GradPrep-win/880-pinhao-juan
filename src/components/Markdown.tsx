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

export default function Markdown({ content }: { content: string }) {
  const cleaned = stripWatermark(content || "");
  return (
    <span className="md-body">
      <ReactMarkdown
        remarkPlugins={[remarkMath, remarkGfm]}
        rehypePlugins={[rehypeRaw, rehypeKatex]}
        components={{
          img({ node, ...props }) {
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
