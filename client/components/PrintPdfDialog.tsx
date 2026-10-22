import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Printer, Download, ExternalLink, CheckCircle2, LoaderCircle } from 'lucide-react';
import type { LibraryItem } from '../../shared/model';
import { apiFile, json, type DownloadFile } from '../api';
import { useAuth } from '../context';
import { Modal } from './ui';
import '../print.css';
export function PrintPdfDialog({
  item,
  assignmentId,
  onClose,
}: {
  item: Pick<LibraryItem, 'id' | 'title' | 'kind' | 'questionCount' | 'totalScore'>;
  assignmentId?: string;
  onClose: () => void;
}) {
  const { user } = useAuth(),
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
        body: json(assignmentId ? { assignmentId } : {}),
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
    <Modal title="生成打印 PDF" onClose={onClose}>
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
      <p className="pdf-format">A4 阅读版 · 正文 12 磅</p>
      <p className="pdf-answer-note">
        保留题干、原图、公式与填空线，不包含标准答案、你的作答或教师评语。
      </p>
      <details className="pdf-print-tips">
        <summary>打印建议</summary>
        <p>A4竖向，按“实际大小 / 100%”打印。双面打印可选长边翻转。实际页数生成后显示。</p>
      </details>
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
