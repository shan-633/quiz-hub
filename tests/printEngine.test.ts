import { afterEach, expect, it, vi } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { createPdfRenderer, findPdfBrowser } from '../server/print/pdf';
import { loadPrintStyles } from '../server/print/resources';
import { preparePrintLayout } from '../server/print/layout';
import katex from 'katex';
afterEach(() => vi.unstubAllEnvs());
it('浏览器配置无效时给出可处理的服务错误', () => {
  vi.stubEnv('PDF_BROWSER_PATH', 'C:/nonexistent-zhixu-pdf/browser.exe');
  expect(() => findPdfBrowser()).toThrow('PDF_BROWSER_PATH');
});
let installed = false;
try {
  installed = Boolean(findPdfBrowser());
} catch {
  /* Optional local browser dependency. */
}
it.skipIf(!installed)(
  '真实排版将长公式选项改为单列并拒绝跨单元格的超宽公式',
  async () => {
    const { default: puppeteer } = await import('puppeteer-core');
    const browser = await puppeteer.launch({ executablePath: findPdfBrowser(), headless: true });
    try {
      const page = await browser.newPage();
      const { fontCss, mathCss } = await loadPrintStyles();
      const css = fontCss + mathCss;
      const formula = katex.renderToString(`v=\\frac{${'1'.repeat(80)}}{t}`);
      const html = (body: string) =>
        `<html><head><style>${css}</style></head><body><main><header class="document-heading">排版验收</header>${body}</main></body></html>`;
      await page.setContent(
        html(
          `<div class="print-options two-columns"><div class="print-option"><span class="option-label">A.</span><div>${formula}</div></div><div class="print-option"><span class="option-label">B.</span><div>乙</div></div></div>`,
        ),
      );
      expect(await page.evaluate(preparePrintLayout)).toBe('');
      expect(await page.$eval('.print-options', (el) => el.classList.contains('two-columns'))).toBe(
        false,
      );
      const enormous = katex.renderToString(`v=\\frac{${'1'.repeat(500)}}{t}`);
      await page.setContent(
        html(
          `<table class="print-table"><tr><td>${enormous}</td><td>相邻实验结果</td></tr></table>`,
        ),
      );
      expect(await page.evaluate(preparePrintLayout)).toContain('过宽');
    } finally {
      await browser.close();
    }
  },
  60000,
);
it.skipIf(!installed)(
  '真实引擎生成A4双页PDF、拒绝缺图并在关闭后停止服务',
  async () => {
    const renderer = createPdfRenderer();
    const { fontCss, mathCss } = await loadPrintStyles();
    const html = (content: string) =>
      `<!doctype html><html><head><meta charset="utf-8"><style>${fontCss}\n${mathCss}</style></head><body><main><header class="document-heading">中文与公式打印</header>${content}</main></body></html>`;
    try {
      const result = await renderer.render(
        html('<p>第1页：速度与路程</p><p style="break-before:page">第2页：实验记录</p>'),
      );
      expect(result.bytes.subarray(0, 5).toString()).toBe('%PDF-');
      expect(result.pages).toBe(2);
      const pdf = await PDFDocument.load(result.bytes);
      for (const page of pdf.getPages()) {
        expect(page.getWidth()).toBeCloseTo(595.28, 0);
        expect(page.getHeight()).toBeCloseTo(841.89, 0);
      }
      await expect(
        renderer.render(html('<img src="data:image/png;base64,YmFk">')),
      ).rejects.toMatchObject({ statusCode: 422 });
    } finally {
      await renderer.close();
    }
    await expect(renderer.render(html('关闭后'))).rejects.toThrow('PDF服务正在关闭');
  },
  90000,
);
