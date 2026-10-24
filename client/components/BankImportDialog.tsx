import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Upload, FileJson, CheckCircle2, AlertCircle, Download, ArrowRight } from 'lucide-react';
import { MAX_IMPORT_BYTES, type ImportReport } from '../../shared/bankImport';
import { typeLabels } from '../../shared/model';
import { walkBlocks } from '../../shared/domain';
import { api, ApiError, bankImportFileUrl } from '../api';
import { Modal } from './ui';
import { QuestionRenderer } from './QuestionRenderer';
import { Markdown } from './Markdown';
import '../bankImport.css';

interface Result {
  bankId: string;
  title: string;
  state: string;
  questionCount: number;
  reused: boolean;
}
export function BankImportDialog({
  onClose,
  onImported,
}: {
  onClose: () => void;
  onImported: (bankId: string) => void;
}) {
  const [file, setFile] = useState<File | null>(null),
    [report, setReport] = useState<ImportReport | null>(null),
    [busy, setBusy] = useState(''),
    [error, setError] = useState(''),
    [publish, setPublish] = useState(false),
    [index, setIndex] = useState(0),
    [result, setResult] = useState<Result | null>(null);
  const request = useRef(0);
  const changeFile = (next: File | null) => {
    request.current++;
    setFile(next);
    setReport(null);
    setError('');
    setResult(null);
    setIndex(0);
    setPublish(false);
  };
  const send = async (commit = false) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.json')) {
      setError('请选择.json格式的题库文件');
      return;
    }
    if (file.size > MAX_IMPORT_BYTES) {
      setError('题库文件不能超过20 MiB');
      return;
    }
    const revision = ++request.current;
    setBusy(commit ? 'commit' : 'validate');
    setError('');
    if (!commit) setReport(null);
    try {
      const body = new FormData();
      if (commit) {
        body.append('digest', report!.digest!);
        body.append('publish', String(publish));
      }
      body.append('file', file);
      const response = await api<ImportReport | Result>(
        `/teacher/bank-import/${commit ? 'commit' : 'validate'}`,
        { method: 'POST', body },
      );
      if (revision !== request.current) return;
      if (commit) {
        const imported = response as Result;
        setResult(imported);
        onImported(imported.bankId);
      } else setReport(response as ImportReport);
    } catch (e) {
      if (revision !== request.current) return;
      setError((e as Error).message);
      if (e instanceof ApiError && e.body.report) setReport(e.body.report);
      if (e instanceof ApiError && e.status === 409) setReport(null);
    } finally {
      if (revision === request.current) setBusy('');
    }
  };
  const question = report?.preview?.questions[index];
  return (
    <Modal
      title="从文件导入题库"
      wide
      onClose={() => {
        if (!busy) {
          request.current++;
          onClose();
        }
      }}
    >
      {result ? (
        <div className="import-success" role="status">
          <CheckCircle2 size={40} />
          <h3>{result.reused ? '这份文件已经导入' : '题库已导入'}</h3>
          <p>
            <strong>{result.title}</strong> · {result.questionCount} 道题 ·{' '}
            {result.state === 'published'
              ? '已发布'
              : result.state === 'archived'
                ? '已归档'
                : '草稿'}
          </p>
          <p className="muted">
            {result.reused
              ? '已返回原有题库，本次没有重复创建或更改发布状态。'
              : '可继续在题目管理中校对内容、编辑排版和发布。'}
          </p>
          <Link
            className="button primary"
            to={`/teacher/library?tab=questions&bank=${result.bankId}`}
            onClick={onClose}
          >
            管理导入的题目 <ArrowRight size={16} />
          </Link>
        </div>
      ) : (
        <>
          <p className="muted">
            使用知序题库交换协议 v1.0。先校验内容与图片，预览无误后再导入。支持 bank.curriculum
            考试分类；旧文件未填写时保存为待分类，可在编辑题库中设置。
          </p>
          <div className="import-resources">
            <a href={bankImportFileUrl('protocol-v1.md')} download>
              <Download size={15} />
              协议说明
            </a>
            <a href={bankImportFileUrl('question-bank-v1.schema.json')} download>
              JSON Schema
            </a>
            <a href={bankImportFileUrl('minimal.zqb.json')} download>
              最小模板
            </a>
            <a href={bankImportFileUrl('six-types.zqb.json')} download>
              六题型示例
            </a>
            <a href={bankImportFileUrl('beijing-2022.zqb.json')} download>
              北京真题原图示例
            </a>
          </div>
          <details className="import-help">
            <summary>文件怎样组织？</summary>
            <p>
              一个 UTF-8 JSON
              文件包含协议标识、版本、题库信息、题目数组与内嵌图片。题干支持段落、公式、图片、表格、图文组合和子题。图片块使用
              assetId 引用文件内图片。最多200题、100张图，文件不超过20 MiB。
            </p>
            <p>
              单选、多选、填空、实验、科普阅读、计算题共用现有排版与作答组件。开放作答需人工评阅。错误列表中的数组下标从0开始。
            </p>
          </details>
          <div className="import-file-box">
            <FileJson size={30} />
            <label className="field">
              题库JSON文件
              <input
                type="file"
                accept=".json,application/json"
                disabled={!!busy}
                onChange={(e) => changeFile(e.target.files?.[0] ?? null)}
              />
            </label>
            <span className="muted small">
              {file
                ? `${file.name} · ${(file.size / 1024).toFixed(1)} KiB`
                : '推荐扩展名 .zqb.json；图片随文件携带，无需逐张上传。'}
            </span>
            <button className="button" disabled={!file || !!busy} onClick={() => void send()}>
              <Upload size={16} />
              {busy === 'validate' ? '正在校验…' : '校验文件'}
            </button>
          </div>
          {error && (
            <p className="inline-error" role="alert">
              {error}
            </p>
          )}
          {report && (
            <section className="import-report" aria-live="polite">
              <div className={`import-report-status ${report.valid ? 'valid' : 'invalid'}`}>
                {report.valid ? <CheckCircle2 size={20} /> : <AlertCircle size={20} />}
                <strong>
                  {report.valid ? '校验通过' : `校验未通过 · ${report.errors.length} 项错误`}
                </strong>
              </div>
              {!report.valid && (
                <div className="import-issues" role="alert">
                  {report.errors.map((issue, i) => (
                    <div key={i}>
                      <code>{issue.path}</code>
                      <p>{issue.message}</p>
                    </div>
                  ))}
                </div>
              )}
              {report.summary && (
                <>
                  <h3>{report.summary.title}</h3>
                  <div className="import-summary">
                    <span>
                      <strong>{report.summary.questionCount}</strong> 道题
                    </span>
                    <span>
                      <strong>{report.summary.totalScore}</strong> 分
                    </span>
                    <span>
                      <strong>{report.summary.imageCount}</strong> 张图
                    </span>
                    <span>
                      <strong>{report.summary.manualQuestionCount}</strong> 题含人工评阅
                    </span>
                  </div>
                  <p className="muted small">
                    {Object.entries(report.summary.types)
                      .map(([type, n]) => `${typeLabels[type as keyof typeof typeLabels]} ${n}`)
                      .join(' · ')}
                  </p>
                </>
              )}
              {!!report.warnings.length && (
                <details className="import-warnings">
                  <summary>{report.warnings.length} 项提示（不阻止导入）</summary>
                  {report.warnings.map((w, i) => (
                    <p key={i}>{w.message}</p>
                  ))}
                </details>
              )}
              {report.valid && report.existing && (
                <p className="import-existing">
                  该文件已导入「{report.existing.title}」。继续将返回原题库，不重复创建。
                </p>
              )}
              {question && (
                <div className="import-preview">
                  <label className="field">
                    题目预览
                    <select value={index} onChange={(e) => setIndex(Number(e.target.value))}>
                      {report.preview!.questions.map((q, i) => (
                        <option key={q.id} value={i}>
                          {i + 1}. {q.title} · {typeLabels[q.type]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="import-preview-paper">
                    <div className="import-preview-heading">
                      <strong>
                        {index + 1}. {question.title}
                      </strong>
                      <span>{question.score} 分</span>
                    </div>
                    <QuestionRenderer
                      key={question.id}
                      question={question}
                      disabled
                      assetSources={report.preview!.assetSources}
                    />
                    <details className="import-answer">
                      <summary>参考答案与解析</summary>
                      {!!question.solution?.choices.length && (
                        <p>
                          正确选项：
                          {question.solution.choices
                            .map((id) =>
                              String.fromCharCode(
                                65 + question.options.findIndex((o) => o.id === id),
                              ),
                            )
                            .join('、')}
                        </p>
                      )}
                      {question.blanks.map((b) => (
                        <p key={b.id}>
                          {b.label}：
                          {b.kind === 'manual'
                            ? '人工评阅'
                            : question.solution?.blanks[b.id]?.accepted.join(' / ')}
                        </p>
                      ))}
                      {walkBlocks(question.content).flatMap((b) => {
                        if (
                          b.type !== 'subquestion' ||
                          !['single', 'multiple'].includes(b.responseKind)
                        )
                          return [];
                        const correct = question.solution?.partChoices?.[b.id] ?? [];
                        return [
                          <p key={b.id}>
                            {b.label}：
                            {correct
                              .map((id) =>
                                String.fromCharCode(
                                  65 + (b.options ?? []).findIndex((o) => o.id === id),
                                ),
                              )
                              .join('、')}
                          </p>,
                        ];
                      })}
                      <Markdown text={question.solution?.explanation ?? ''} />
                    </details>
                  </div>
                </div>
              )}
            </section>
          )}
          <div className="import-commit-bar">
            <label className="field">
              导入后状态
              <select
                aria-label="导入后状态"
                value={String(publish)}
                disabled={!!busy || !!report?.existing}
                onChange={(e) => setPublish(e.target.value === 'true')}
              >
                <option value="false">保存为草稿（推荐）</option>
                <option value="true">导入并发布给学生</option>
              </select>
            </label>
            <p className="muted small">
              只有全部题目和图片通过校验才会入库。一次导入创建一个新题库。
            </p>
          </div>
          <div className="modal-actions">
            <button className="button" disabled={!!busy} onClick={onClose}>
              取消
            </button>
            <button
              className="button primary"
              disabled={!report?.valid || !report.digest || !!busy}
              onClick={() => void send(true)}
            >
              {busy === 'commit' ? '正在导入…' : '确认导入'}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
