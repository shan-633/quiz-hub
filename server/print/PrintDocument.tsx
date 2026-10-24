import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import katex from 'katex';
import type { Block, LibraryItem, Question } from '../../shared/model';
import { typeLabels } from '../../shared/model';
import { Markdown } from '../../client/components/Markdown';

export interface PrintDocumentInput {
  item: LibraryItem;
  questions: Question[];
  images: Record<string, string>;
  fontCss: string;
  mathCss: string;
}
function Options({
  options,
  multiple = false,
}: {
  options: Question['options'];
  multiple?: boolean;
}) {
  const short = options.every(
    (o) => o.text.replace(/\$[^$]+\$/g, '公式').length <= 26 && !o.text.includes('\n'),
  );
  return (
    <div
      className={`print-options ${short ? 'two-columns' : ''}`}
      aria-label={multiple ? '多选选项' : '单选选项'}
    >
      {options.map((o, i) => (
        <div className="print-option" key={o.id}>
          <span className="option-label">{String.fromCharCode(65 + i)}.</span>
          <div>
            <Markdown text={o.text} inline />
          </div>
        </div>
      ))}
    </div>
  );
}
function PrintQuestion({
  question: q,
  index,
  images,
}: {
  question: Question;
  index: number;
  images: Record<string, string>;
}) {
  const originalScan = q.tags.includes('原卷图文');
  const inline = (text: string): ReactNode => (
    <>
      {text.split(/(\{\{[a-zA-Z0-9_-]+\}\})/g).map((chunk, i) => {
        const ref = chunk.match(/^\{\{(.+)\}\}$/),
          blank = ref ? q.blanks.find((b) => b.id === ref[1]) : undefined;
        return ref ? (
          <span key={i} className="print-blank" aria-label={blank?.label ?? '填空'}>
            　　　　　　　　
          </span>
        ) : (
          <Markdown key={i} text={chunk} inline />
        );
      })}
    </>
  );
  const block = (b: Block): ReactNode => {
    switch (b.type) {
      case 'paragraph':
        return (
          <div className="print-paragraph" key={b.id}>
            {b.text.includes('{{') ? inline(b.text) : <Markdown text={b.text} />}
          </div>
        );
      case 'formula':
        return (
          <div
            className="print-formula"
            key={b.id}
            dangerouslySetInnerHTML={{
              __html: katex.renderToString(b.latex, {
                displayMode: true,
                throwOnError: false,
                trust: false,
                maxExpand: 500,
              }),
            }}
          />
        );
      case 'image':
        return (
          <figure className="print-figure" key={b.id} style={{ width: `${b.width}%` }}>
            <img src={images[b.assetId ?? b.src ?? '']} alt={b.alt} />
            {b.caption && <figcaption>{b.caption.replace(/[（(]点击放大[）)]/g, '')}</figcaption>}
          </figure>
        );
      case 'table':
        return (
          <table className="print-table" key={b.id}>
            <thead>
              <tr>
                {b.headers.map((cell, i) => (
                  <th key={i}>{inline(cell)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {b.rows.map((row, i) => (
                <tr key={i}>
                  {row.map((cell, j) => (
                    <td key={j}>{inline(cell)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        );
      case 'group':
        return (
          <div className={`print-group ${b.layout}`} key={b.id}>
            {b.children.map(block)}
          </div>
        );
      case 'subquestion':
        return (
          <section className="print-subquestion" key={b.id}>
            <h3>
              {b.label}
              <small>{b.score} 分</small>
            </h3>
            {b.children.map(block)}
            {(b.responseKind === 'single' || b.responseKind === 'multiple') && (
              <Options options={b.options ?? []} multiple={b.responseKind === 'multiple'} />
            )}{' '}
          </section>
        );
    }
  };
  // Section introductions belong above the first question, preserving their original words.
  const intro: Block[] = [],
    content = [...q.content];
  while (
    content[0]?.type === 'paragraph' &&
    /^\s*#{1,6}\s+[一二三四五六七八九十]+、/.test(content[0].text)
  )
    intro.push(content.shift()!);
  const figures = content.filter((b): b is Extract<Block, { type: 'image' }> => b.type === 'image');
  const candidate = figures[0],
    ratio =
      candidate?.intrinsicWidth && candidate.intrinsicHeight
        ? candidate.intrinsicHeight / candidate.intrinsicWidth
        : 0;
  const aside =
    (q.type === 'single' || q.type === 'multiple') &&
    figures.length === 1 &&
    candidate.width <= 60 &&
    ratio >= 0.6 &&
    ratio <= 1.8 &&
    q.options.every((o) => o.text.length < 70)
      ? candidate
      : undefined;
  return (
    <>
      {intro.length > 0 && <div className="print-section-intro">{intro.map(block)}</div>}
      <article
        className={`print-question type-${q.type}${originalScan ? ' original-scan' : ''}`}
        data-question-id={q.id}
        data-question-index={index + 1}
        data-version={q.version}
      >
        <header className="question-header">
          <h2>第 {index + 1} 题</h2>
          <span>{typeLabels[q.type]}</span>
          <strong>{q.score} 分</strong>
        </header>
        <div className={`question-body ${aside ? 'has-aside' : ''}`}>
          {aside && <aside className="print-aside">{block(aside)}</aside>}
          {content.filter((b) => b !== aside && !(originalScan && b.id === 'response')).map(block)}
          {q.type === 'multiple' && q.multipleScoring === 'half' && (
            <p className="scoring-note">
              全选对得 {q.score} 分，选对但不全得 {q.score / 2} 分，有错选或未选得 0 分。
            </p>
          )}
          {!originalScan && (q.type === 'single' || q.type === 'multiple') && (
            <Options options={q.options} multiple={q.type === 'multiple'} />
          )}{' '}
        </div>
      </article>
    </>
  );
}
export function renderPrintDocument({
  item,
  questions,
  images,
  fontCss,
  mathCss,
}: PrintDocumentInput): string {
  const total = questions.reduce((sum, q) => sum + q.score, 0);
  const body = renderToStaticMarkup(
    <html lang="zh-CN">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width" />
        <meta
          httpEquiv="Content-Security-Policy"
          content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; script-src 'none'"
        />
        <title>{`${item.title} · 阅读版`}</title>
        <style dangerouslySetInnerHTML={{ __html: fontCss + '\n' + mathCss }} />
      </head>
      <body>
        <main>
          <header className="document-heading">
            <div className="document-brand">
              知序 · 考试学习空间<span>阅读版 / A4</span>
            </div>
            <h1>{item.title}</h1>
            <p>
              {item.kind === 'paper' ? '试卷' : '题库'} · {questions.length} 道题 ·{' '}
              {Number(total.toFixed(3))} 分 · 建议用时 {item.minutes} 分钟
            </p>
          </header>
          <div className="print-questions">
            {questions.map((q, i) => (
              <PrintQuestion key={q.id} question={q} index={i} images={images} />
            ))}
          </div>
        </main>
      </body>
    </html>,
  );
  return '<!DOCTYPE html>' + body;
}
