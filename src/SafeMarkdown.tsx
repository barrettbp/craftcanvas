import Markdown from "react-markdown";
export default function SafeMarkdown({ text }: { text: string }) {
  return (
    <div className="markdown">
      <Markdown
        skipHtml
        urlTransform={(url) => {
          try {
            return new URL(url).protocol === "https:" ? url : "";
          } catch {
            return "";
          }
        }}
        components={{
          img: ({ alt }) => (
            <span className="image-placeholder">
              {alt || "Image"} · embedded images are not loaded
            </span>
          ),
          a: ({ href, children }) =>
            href ? (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="nodrag"
              >
                {children}
              </a>
            ) : (
              <span>{children}</span>
            ),
        }}
      >
        {text}
      </Markdown>
    </div>
  );
}
