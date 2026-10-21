import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Browser } from 'puppeteer-core';
import { HttpError } from '../auth';
export interface PdfResult {
  bytes: Buffer;
  pages: number;
}
export interface PdfRenderer {
  render(html: string): Promise<PdfResult>;
  close(): Promise<void>;
}
export function findPdfBrowser(): string {
  const explicit = process.env.PDF_BROWSER_PATH;
  if (explicit) {
    if (existsSync(explicit)) return explicit;
    throw new HttpError(503, 'PDF_BROWSER_PATH 指向的浏览器不存在，请检查服务配置');
  }
  const candidates = [
    ...[
      process.env.PROGRAMFILES,
      process.env['PROGRAMFILES(X86)'],
      process.env.LOCALAPPDATA,
      'C:/Program Files',
      'C:/Program Files (x86)',
    ]
      .filter(Boolean)
      .flatMap((root) => [
        join(root!, 'Google/Chrome/Application/chrome.exe'),
        join(root!, 'Microsoft/Edge/Application/msedge.exe'),
      ]),
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ];
  const found = candidates.find(existsSync);
  if (!found)
    throw new HttpError(503, 'PDF生成需要本机Chrome或Edge，请安装浏览器或设置PDF_BROWSER_PATH');
  return found;
}
/** A private, headless document renderer; it never attaches to the user's browser. */
export function createPdfRenderer(): PdfRenderer {
  let browser: Promise<Browser> | undefined,
    active = 0,
    closed = false;
  const connect = () =>
    (browser ??= import('puppeteer-core')
      .then(({ default: puppeteer }) =>
        puppeteer.launch({
          executablePath: findPdfBrowser(),
          headless: true,
          timeout: 20000,
          protocolTimeout: 90000,
          args: [
            '--disable-background-networking',
            '--disable-component-update',
            '--disable-sync',
            '--no-first-run',
          ],
        }),
      )
      .then((b) => {
        b.on('disconnected', () => {
          browser = undefined;
        });
        return b;
      })
      .catch((e) => {
        browser = undefined;
        throw e;
      }));
  return {
    async render(html) {
      if (closed) throw new HttpError(503, 'PDF服务正在关闭，请稍后重试');
      if (active >= 2) throw new HttpError(429, '正在生成其他PDF，请稍后重试');
      active++;
      let context: Awaited<ReturnType<Browser['createBrowserContext']>> | undefined;
      try {
        const engine = await connect();
        context = await engine.createBrowserContext();
        const page = await context.newPage();
        await page.setViewport({ width: 794, height: 1123, deviceScaleFactor: 1 });
        await page.setRequestInterception(true);
        page.on('request', (req) => {
          if (req.isInterceptResolutionHandled()) return;
          void (/^(data:|about:)/.test(req.url()) ? req.continue() : req.abort()).catch(() => {});
        });
        await page.emulateMediaType('print');
        await page.setContent(html, { waitUntil: 'load', timeout: 60000 });
        const { preparePrintLayout } = await import('./layout');
        const check = await page.evaluate(preparePrintLayout);
        if (check) throw new HttpError(422, check);
        const bytes = Buffer.from(
          await page.pdf({
            format: 'A4',
            preferCSSPageSize: true,
            printBackground: true,
            tagged: true,
            displayHeaderFooter: true,
            headerTemplate: '<span></span>',
            footerTemplate:
              '<div style="width:100%;text-align:center;font-family:Arial,sans-serif;font-size:9px;color:#666"><span class="pageNumber"></span> / <span class="totalPages"></span></div>',
            margin: { top: '16mm', right: '18mm', bottom: '18mm', left: '18mm' },
            timeout: 60000,
            waitForFonts: true,
          }),
        );
        const { PDFDocument } = await import('pdf-lib');
        const pdfDocument = await PDFDocument.load(bytes, { updateMetadata: false });
        return { bytes, pages: pdfDocument.getPageCount() };
      } catch (error) {
        if (error instanceof HttpError) throw error;
        const failure = new HttpError(
          503,
          'PDF暂时无法生成，请稍后重试；若持续失败，请检查本机打印浏览器配置',
        );
        failure.cause = error;
        throw failure;
      } finally {
        await context?.close().catch(() => {});
        active--;
      }
    },
    async close() {
      closed = true;
      const b = await browser?.catch(() => undefined);
      await b?.close();
      browser = undefined;
    },
  };
}
