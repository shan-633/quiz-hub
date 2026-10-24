import { writeFileSync } from 'node:fs';
import { createPdfRenderer } from '../server/print/pdf';
import { loadPrintStyles } from '../server/print/resources';
import { renderPrintDocument } from '../server/print/PrintDocument';
import { newQuestion } from '../shared/domain';
const renderer = createPdfRenderer();
try {
  const question = {
    ...newQuestion('single', 'deployment-probe'),
    title: '中文打印验证',
    content: [
      { id: 'p', type: 'paragraph' as const, text: '中文题干、数学与物理：1 + 1 = 2，F = ma。' },
    ],
  };
  const html = renderPrintDocument({
    item: {
      id: 'deployment-probe',
      kind: 'paper',
      title: '知序 · 部署打印验证',
      description: '',
      chapter: '',
      accent: 'exam',
      state: 'draft',
      questionCount: 1,
      minutes: 5,
      totalScore: question.score,
    },
    questions: [question],
    images: {},
    ...(await loadPrintStyles()),
  });
  const result = await renderer.render(html);
  if (!result.pages || result.bytes.length < 1000) throw new Error('Empty PDF output');
  if (process.argv[2]) writeFileSync(process.argv[2], result.bytes);
  console.log(JSON.stringify({ pdf: true, pages: result.pages, bytes: result.bytes.length }));
} finally {
  await renderer.close();
}
