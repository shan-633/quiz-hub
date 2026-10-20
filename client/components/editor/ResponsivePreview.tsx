import { useEffect, useRef, useState } from 'react';
import type { AnswerData, Question } from '../../../shared/model';
import { typeLabels } from '../../../shared/model';
import { QuestionRenderer } from '../QuestionRenderer';
export function ResponsivePreview({
  question,
  width,
  answer,
  onChange,
}: {
  question: Question;
  width: number;
  answer: AnswerData;
  onChange: (a: AnswerData) => void;
}) {
  const outer = useRef<HTMLDivElement>(null),
    inner = useRef<HTMLDivElement>(null),
    [available, setAvailable] = useState(width),
    [height, setHeight] = useState(400);
  const scale = Math.min(1, available / width);
  useEffect(() => {
    const observer = new ResizeObserver(() => {
      if (outer.current) setAvailable(outer.current.clientWidth);
      if (inner.current) setHeight(inner.current.offsetHeight);
    });
    if (outer.current) observer.observe(outer.current);
    if (inner.current) observer.observe(inner.current);
    return () => observer.disconnect();
  }, [width]);
  return (
    <div className="responsive-preview-frame" ref={outer} style={{ height: height * scale }}>
      <div
        className="preview-viewport exact-preview"
        ref={inner}
        style={{ width, transform: `scale(${scale})`, transformOrigin: 'top left' }}
      >
        <div className="preview-title">
          <span className="question-index">01</span>
          <span>
            {typeLabels[question.type]} · {question.score} 分
          </span>
        </div>
        <QuestionRenderer question={question} answer={answer} onChange={onChange} />
      </div>
    </div>
  );
}
