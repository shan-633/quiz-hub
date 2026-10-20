import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
export function Markdown({ text, inline = false }: { text: string; inline?: boolean }) {
  return (
    <ReactMarkdown
      skipHtml
      remarkPlugins={[remarkMath]}
      rehypePlugins={[[rehypeKatex, { trust: false, strict: false, maxExpand: 500 }]]}
      components={{
        ...(inline ? { p: ({ children }) => <span>{children}</span> } : {}),
        a: ({ href, children }) => (
          <a href={href} target="_blank" rel="noopener noreferrer">
            {children}
          </a>
        ),
        img: () => null,
      }}
    >
      {text}
    </ReactMarkdown>
  );
}
