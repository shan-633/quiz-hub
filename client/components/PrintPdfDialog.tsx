import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Printer,
  Download,
  ExternalLink,
  CheckCircle2,
  LoaderCircle,
  FileText,
  PenLine,
} from 'lucide-react';
import type { LibraryItem } from '../../shared/model';
import type { PrintOptions } from '../../shared/print';
import { printFontLabels, printModeLabels } from '../../shared/print';
import { apiFile, json, type DownloadFile } from '../api';
import { useAuth } from '../context';
import { Modal } from './ui';
import '../print.css';
export function PrintPdfDialog({ item, onClose }: { item: LibraryItem; onClose: () => void }) {
  const { user } = useAuth(),
    [options, setOptions] = useState<PrintOptions>({ mode: 'reading', fontSize: 'standard' }),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [file, setFile] = useState<(DownloadFile & { url: string }) | null>(null);
  const state = useRef<{ alive: boolean; url?: string; controller?: AbortController }>({
    alive: true,
  });
  const release = () => {
    if (state.current.url) {
      URL.revokeObjectURL(state.current.url);
      state.current.url = undefined;
    }
  };
  useEffect(() => {
    state.current.alive = true;
    return () => {
      state.current.alive = false;
      state.current.controller?.abort();
      release();
    };
  }, []);
  const change = (patch: Partial<PrintOptions>) => {
    setOptions((v) => ({ ...v, ...patch }));
    release();
    setFile(null);
    setError('');
  };
  const generate = async () => {
    setBusy(true);
    setError('');
    release();
    setFile(null);
    const controller = new AbortController();
    state.current.controller = controller;
    try {
      const result = await apiFile(`/library/${encodeURIComponent(item.id)}/pdf`, {
        method: 'POST',
        body: json(options),
        signal: controller.signal,
      });
      if (!state.current.alive) return;
      const url = URL.createObjectURL(result.blob);
      state.current.url = url;
      setFile({ ...result, url });
    } catch (e) {
      if (state.current.alive && (e as Error).name !== 'AbortError') setError((e as Error).message);
    } finally {
      if (state.current.alive) setBusy(false);
    }
  };
  return (
    <Modal title="生成打印 PDF" onClose={onClose} wide>
      <div className="pdf-dialog-grid">
        <div className="pdf-settings">
          <div className="pdf-selected-item">
            <span className="pdf-icon">
              <Printer size={22} />
            </span>
            <div>
              <strong>{item.title}</strong>
              <p>
                {item.kind === 'paper' ? '试卷' : '题库'} · {item.questionCount} 道题 ·{' '}
                {item.totalScore} 分
              </p>
            </div>
          </div>
          <fieldset className="pdf-mode-options" disabled={busy}>
            <legend>打印用途</legend>
            {(['reading', 'writing'] as const).map((mode) => (
              <label
                className={`pdf-mode-option ${options.mode === mode ? 'selected' : ''}`}
                key={mode}
              >
                <input
                  type="radio"
                  name="pdf-mode"
                  aria-label={printModeLabels[mode]}
                  value={mode}
                  checked={options.mode === mode}
                  onChange={() => change({ mode })}
                />
                <span className="pdf-mode-icon">
                  {mode === 'reading' ? <FileText size={19} /> : <PenLine size={19} />}
                </span>
                <span>
                  <strong>{printModeLabels[mode]}</strong>
                  <small>
                    {mode === 'reading'
                      ? '题目紧凑排版，适合阅读与讲解'
                      : '计算题、开放小问保留书写区域'}
                  </small>
                </span>
                <CheckCircle2 className="pdf-selected-check" size={17} />
              </label>
            ))}
          </fieldset>
          <fieldset className="pdf-font-options" disabled={busy}>
            <legend>正文字号</legend>
            <div>
              {(['standard', 'large'] as const).map((size) => (
                <label key={size} className={options.fontSize === size ? 'selected' : ''}>
                  <input
                    type="radio"
                    name="pdf-font-size"
                    aria-label={printFontLabels[size]}
                    checked={options.fontSize === size}
                    onChange={() => change({ fontSize: size })}
                  />
                  {printFontLabels[size]}
                </label>
              ))}
            </div>
          </fieldset>
          <p className="pdf-answer-note">
            只导出题目与原图，填空保留空线；不包含标准答案、你的作答或教师评语。
          </p>
          <details className="pdf-print-tips">
            <summary>打印建议</summary>
            <p>
              A4竖向，按“实际大小 /
              100%”打印。双面打印可选长边翻转。图片保留原色，黑白打印也保留题目结构。实际页数生成后显示。
            </p>
          </details>
        </div>
        <aside className="pdf-layout-preview" aria-label="版式示意">
          <div className={`pdf-mini-page ${options.fontSize === 'large' ? 'large' : ''}`}>
            <div className="pdf-mini-top">
              知序 · 物理练习<span>A4</span>
            </div>
            <h3>{item.title}</h3>
            <div className="pdf-mini-meta">
              {item.questionCount} 道题 · {printModeLabels[options.mode]}
            </div>
            <div className="pdf-mini-rule" />
            <div className="pdf-mini-question">
              <b>01</b>
              <span>题干、公式与原图</span>
            </div>
            <i className="pdf-mini-line" />
            <i className="pdf-mini-line short" />
            <div className="pdf-mini-illustration">
              <span>F</span>
              <i />
              <span>→</span>
            </div>
            <div className="pdf-mini-choices">
              <span>A. ______</span>
              <span>B. ______</span>
              <span>C. ______</span>
              <span>D. ______</span>
            </div>
            <div className="pdf-mini-rule" />
            <div className="pdf-mini-question">
              <b>02</b>
              <span>计算与开放题</span>
            </div>
            <i className="pdf-mini-line" />
            <i className="pdf-mini-line short" />
            {options.mode === 'writing' ? (
              <div className="pdf-mini-answer">作答区域</div>
            ) : (
              <>
                <i className="pdf-mini-line" />
                <div className="pdf-mini-question last">
                  <b>03</b>
                  <span>接着下一道题</span>
                </div>
              </>
            )}
            <div className="pdf-mini-footer">1 / …</div>
          </div>
          <p>版式示意 · 非最终预览</p>
          <div className="pdf-layout-dimensions">
            <span>210 × 297 mm</span>
            <span>左右边距 18 mm</span>
          </div>
        </aside>
      </div>
      {error && (
        <div className="inline-error pdf-error" role="alert">
          {error}
        </div>
      )}
      {file ? (
        <section className="pdf-ready" aria-live="polite">
          <div>
            <CheckCircle2 size={23} />
            <div>
              <strong>PDF 已生成</strong>
              <p>
                {file.pages ? `共 ${file.pages} 页 · ` : ''}
                {file.questionCount ?? item.questionCount} 道题 ·{' '}
                {(file.blob.size / 1024 / 1024).toFixed(2)} MB · 可预览后打印
              </p>
            </div>
          </div>
          <div className="pdf-ready-actions">
            <a className="button" href={file.url} target="_blank" rel="noopener noreferrer">
              <ExternalLink size={16} />
              打开 PDF 预览
            </a>
            <a className="button primary" href={file.url} download={file.filename}>
              <Download size={16} />
              下载 PDF
            </a>
          </div>
        </section>
      ) : (
        <div className="pdf-generate-actions">
          <p>
            {busy
              ? '正在排版、载入字体与生成文件，请稍候…'
              : '生成不会提交练习，也不会改变你的作答进度。'}
          </p>
          {user ? (
            <button
              className="button primary"
              disabled={busy || !item.questionCount}
              onClick={() => void generate()}
            >
              {busy ? <LoaderCircle size={17} className="spin" /> : <Printer size={17} />}{' '}
              {busy ? '正在生成 PDF…' : '生成 PDF'}
            </button>
          ) : (
            <Link className="button primary" to={`/login?print=${encodeURIComponent(item.id)}`}>
              登录后生成
            </Link>
          )}
        </div>
      )}
      <p className="pdf-device-note">手机或iPad可在PDF预览器中选择保存、分享或打印。</p>
    </Modal>
  );
}
