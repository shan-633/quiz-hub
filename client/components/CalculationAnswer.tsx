import { useState } from 'react';
import { Code2, Eye, Type, PenLine, Camera, Check } from 'lucide-react';
import type { ResponseValue } from '../../shared/model';
import type { AnswerContext } from '../uploadContext';
import { Markdown } from './Markdown';
import { DrawingBoard } from './DrawingBoard';
import { PhotoAnswer } from './PhotoAnswer';
export function CalculationAnswer({
  value,
  onChange,
  disabled = false,
  context,
  allowedModes = ['text', 'drawing', 'photo'],
}: {
  value: ResponseValue;
  onChange: (value: ResponseValue) => void;
  disabled?: boolean;
  context?: AnswerContext;
  allowedModes?: string[];
}) {
  const [mode, setMode] = useState(allowedModes.includes('text') ? 'text' : allowedModes[0]),
    [preview, setPreview] = useState(disabled);
  const selected = allowedModes.includes(mode) ? mode : allowedModes[0];
  return (
    <div className="calculation-answer">
      <div className="answer-tabs" role="tablist" aria-label="计算题作答方式">
        {[
          {
            id: 'text',
            label: '文字与公式',
            short: '文字',
            Icon: Type,
            has: !!value.markdown.trim(),
          },
          {
            id: 'drawing',
            label: '手写作答',
            short: '手写',
            Icon: PenLine,
            has: value.drawingPages.some((p) => p.strokes.length > 0),
          },
          {
            id: 'photo',
            label: '拍照上传',
            short: '照片',
            Icon: Camera,
            has: value.imagePages.length > 0,
          },
        ]
          .filter((m) => allowedModes.includes(m.id))
          .map(({ id, label, short, Icon, has }) => (
            <button
              role="tab"
              aria-selected={selected === id}
              aria-label={label}
              key={id}
              className={`answer-tab ${selected === id ? 'active' : ''}`}
              onClick={() => setMode(id)}
            >
              <Icon size={16} />
              <span className="mode-label">{label}</span>
              <span className="mode-short">{short}</span>
              {has && <Check size={11} />}
            </button>
          ))}
      </div>
      {selected === 'text' && (
        <div role="tabpanel" aria-label="文字与公式">
          <div className="text-answer-toolbar">
            <span>写下思路，再写公式</span>
            <button
              className="text-button preview-button"
              type="button"
              onClick={() => setPreview(!preview)}
            >
              {preview ? <Code2 size={15} /> : <Eye size={15} />} {preview ? '编辑' : '预览'}
            </button>
          </div>
          {preview ? (
            <div className="markdown-preview">
              {value.markdown ? (
                <Markdown text={value.markdown} />
              ) : (
                <p className="muted">还没有输入解题过程</p>
              )}
            </div>
          ) : (
            <textarea
              aria-label="计算题文字答案"
              className="answer-textarea"
              placeholder={
                '在这里写下你的思路和计算过程…\n\n可以直接输入文字，也支持 Markdown 与 $数学公式$。'
              }
              rows={8}
              disabled={disabled}
              value={value.markdown}
              onChange={(e) => onChange({ ...value, markdown: e.target.value })}
            />
          )}
          <div className="editor-hint">
            <span>
              公式示例：<code>{'$v=\\frac{s}{t}$'}</code>
            </span>
            <span>支持 Markdown</span>
          </div>
        </div>
      )}
      {selected === 'drawing' && (
        <div role="tabpanel" aria-label="手写作答">
          <DrawingBoard
            pages={value.drawingPages}
            onChange={(drawingPages) => onChange({ ...value, drawingPages })}
            disabled={disabled}
          />
        </div>
      )}
      {selected === 'photo' && (
        <div role="tabpanel" aria-label="照片作答">
          <PhotoAnswer
            pages={value.imagePages}
            onChange={(imagePages) => onChange({ ...value, imagePages })}
            context={context}
            disabled={disabled}
          />
        </div>
      )}
      <div className="mixed-answer-note">三种方式可以一起用，切换不会清空已有答案。</div>
    </div>
  );
}
