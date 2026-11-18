"use client"

import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import type { BlockOf } from "@/lib/schema"
import { isSafeHref } from "@/lib/utils"

export function NotesWidget({ block, editing }: { block: BlockOf<"notes">; editing: boolean }) {
  const content = block.props.content.trim()
  if (!content) {
    return <p className="px-4 pb-4 text-sm text-muted-foreground">{editing ? "Open the settings to write something." : "Empty note."}</p>
  }
  return (
    <div className="prose-notes h-full overflow-y-auto px-4 pb-4">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <a href={href && isSafeHref(href) ? href : undefined} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
          img: ({ src, alt }) =>
            typeof src === "string" && /^https?:\/\//.test(src) ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={src} alt={alt ?? ""} className="max-w-full rounded-md" referrerPolicy="no-referrer" />
            ) : null,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
