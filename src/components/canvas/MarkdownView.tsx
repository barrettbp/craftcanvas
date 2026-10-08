"use client";

import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const plugins = [remarkGfm];

/** Renders markdown for text cards and note previews. Links open in a new tab. */
export const MarkdownView = memo(function MarkdownView({ text, className }: { text: string; className?: string }) {
  return (
    <div className={`cc-md ${className ?? ""}`}>
      <ReactMarkdown
        remarkPlugins={plugins}
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer noopener" className="nodrag">
              {children}
            </a>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
});
