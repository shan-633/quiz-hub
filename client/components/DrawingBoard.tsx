import { useEffect, useRef, useState } from 'react';
import {
  PenLine,
  Eraser,
  Undo2,
  Redo2,
  Grid2X2,
  Plus,
  ChevronLeft,
  ChevronRight,
  Expand,
  Trash2,
} from 'lucide-react';
import type { DrawingPage, Stroke, Point } from '../../shared/model';
import { drawPage } from '../drawing';
import { Modal } from './ui';
const freshPage = (): DrawingPage => ({
  id: crypto.randomUUID(),
  width: 1000,
  height: 700,
  strokes: [],
});
export function DrawingBoard({
  pages,
  onChange,
  disabled = false,
}: {
  pages: DrawingPage[];
  onChange: (pages: DrawingPage[]) => void;
  disabled?: boolean;
}) {
  const [virtual] = useState(freshPage),
    [index, setIndex] = useState(0),
    [tool, setTool] = useState<'pen' | 'eraser'>('pen'),
    [color, setColor] = useState('#263d39'),
    [width, setWidth] = useState(3),
    [grid, setGrid] = useState(true),
    [penOnly, setPenOnly] = useState(false),
    [expanded, setExpanded] = useState(false),
    [, tick] = useState(0);
  const list = pages.length ? pages : [virtual],
    page = list[Math.min(index, list.length - 1)],
    canvas = useRef<HTMLCanvasElement>(null),
    live = useRef(page),
    current = useRef<Stroke | null>(null),
    activePointer = useRef<number | null>(null),
    erasing = useRef(false),
    history = useRef<Record<string, { undo: Stroke[][]; redo: Stroke[][] }>>({}),
    latest = useRef({ list, onChange });
  latest.current = { list, onChange };
  if (!current.current && !erasing.current) live.current = page;
  const redraw = () => {
    if (canvas.current) drawPage(canvas.current, live.current, grid);
  };
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const observer = new ResizeObserver(() => {
      const r = element.getBoundingClientRect();
      element.width = Math.max(1, Math.round(r.width * devicePixelRatio));
      element.height = Math.max(1, Math.round(r.height * devicePixelRatio));
      drawPage(element, live.current, grid);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [expanded, page.id, grid]);
  useEffect(() => {
    redraw();
  }, [page, grid, expanded]);
  const save = (next: DrawingPage, remember = true) => {
    const h = (history.current[page.id] ??= { undo: [], redo: [] });
    if (remember) {
      h.undo.push(page.strokes);
      if (h.undo.length > 30) h.undo.shift();
      h.redo = [];
    }
    live.current = next;
    onChange(list.map((p) => (p.id === next.id ? { ...next, previewAssetId: undefined } : p)));
    redraw();
    tick((n) => n + 1);
  };
  const point = (event: React.PointerEvent<HTMLCanvasElement>): Point => {
    const r = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(page.width, ((event.clientX - r.left) / r.width) * page.width)),
      y: Math.max(0, Math.min(page.height, ((event.clientY - r.top) / r.height) * page.height)),
      p: event.pressure || 0.5,
      t: Date.now(),
    };
  };
  const erase = (p: Point) => {
    live.current = {
      ...live.current,
      strokes: live.current.strokes.filter(
        (s) => !s.points.some((t) => Math.hypot(t.x - p.x, t.y - p.y) < 24),
      ),
    };
    redraw();
  };
  const down = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (
      activePointer.current !== null ||
      disabled ||
      (penOnly && event.pointerType !== 'pen') ||
      event.button !== 0
    )
      return;
    activePointer.current = event.pointerId;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    if (tool === 'eraser') {
      erasing.current = true;
      erase(point(event));
    } else {
      current.current = { id: crypto.randomUUID(), color, width, points: [point(event)] };
      live.current = { ...page, strokes: [...page.strokes, current.current] };
      redraw();
    }
  };
  const move = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (event.pointerId !== activePointer.current) return;
    if (erasing.current) {
      erase(point(event));
      return;
    }
    if (!current.current) return;
    const next = point(event),
      prev = current.current.points.at(-1)!;
    if (
      Math.hypot(next.x - prev.x, next.y - prev.y) > 0.7 &&
      current.current.points.length < 10000
    ) {
      current.current.points.push(next);
      redraw();
    }
  };
  const up = (event?: React.PointerEvent<HTMLCanvasElement>) => {
    if (event && event.pointerId !== activePointer.current) return;
    const pointer = activePointer.current;
    activePointer.current = null;
    if (pointer !== null && canvas.current?.hasPointerCapture?.(pointer))
      canvas.current.releasePointerCapture(pointer);
    if (!current.current && !erasing.current) return;
    const next = {
      ...live.current,
      strokes: live.current.strokes.map((s) => ({ ...s, points: [...s.points] })),
    };
    current.current = null;
    erasing.current = false;
    save(next);
  };
  const undo = () => {
    const h = history.current[page.id];
    if (!h?.undo.length) return;
    h.redo.push(page.strokes);
    const strokes = h.undo.pop()!;
    save({ ...page, strokes }, false);
  };
  const redo = () => {
    const h = history.current[page.id];
    if (!h?.redo.length) return;
    h.undo.push(page.strokes);
    save({ ...page, strokes: h.redo.pop()! }, false);
  };
  const board = (
    <div className="drawing-board">
      <div className="drawing-toolbar">
        <div className="drawing-tool-group">
          <button
            className={tool === 'pen' ? 'active' : ''}
            aria-label="画笔"
            aria-pressed={tool === 'pen'}
            disabled={disabled}
            onClick={() => setTool('pen')}
          >
            <PenLine size={17} />
          </button>
          <button
            className={tool === 'eraser' ? 'active' : ''}
            aria-label="橡皮擦"
            aria-pressed={tool === 'eraser'}
            disabled={disabled}
            onClick={() => setTool('eraser')}
          >
            <Eraser size={17} />
          </button>
          <span className="tool-divider" />
          {['#263d39', '#167d76', '#bd6449'].map((c) => (
            <button
              className={`pen-color ${color === c ? 'active' : ''}`}
              key={c}
              style={{ '--pen-color': c } as React.CSSProperties}
              aria-label={`笔迹颜色 ${c}`}
              disabled={disabled}
              onClick={() => {
                setColor(c);
                setTool('pen');
              }}
            >
              <i />
            </button>
          ))}
          <select
            aria-label="画笔粗细"
            value={width}
            disabled={disabled}
            onChange={(e) => setWidth(Number(e.target.value))}
          >
            <option value="2">细</option>
            <option value="3">中</option>
            <option value="5">粗</option>
          </select>
        </div>
        <div className="drawing-tool-group">
          <button
            aria-label="撤销笔迹"
            disabled={disabled || !history.current[page.id]?.undo.length}
            onClick={undo}
          >
            <Undo2 size={17} />
          </button>
          <button
            aria-label="重做笔迹"
            disabled={disabled || !history.current[page.id]?.redo.length}
            onClick={redo}
          >
            <Redo2 size={17} />
          </button>
          <button
            aria-label="切换方格纸"
            aria-pressed={grid}
            className={grid ? 'active' : ''}
            onClick={() => setGrid(!grid)}
          >
            <Grid2X2 size={16} />
          </button>
          <button
            aria-label={expanded ? '退出放大书写' : '放大书写'}
            onClick={() => setExpanded(!expanded)}
          >
            <Expand size={16} />
          </button>
        </div>
      </div>
      <div className="canvas-wrap" style={{ aspectRatio: `${page.width}/${page.height}` }}>
        <canvas
          ref={canvas}
          aria-label={`手写作答画布，第 ${Math.min(index, list.length - 1) + 1} 页`}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
          style={{
            touchAction: 'none',
            cursor: disabled ? 'default' : tool === 'pen' ? 'crosshair' : 'cell',
          }}
        />
        {!page.strokes.length && !disabled && (
          <span className="canvas-placeholder">
            在这里写下你的推导
            <br />
            <small>{penOnly ? '仅接受触控笔输入' : '支持触控笔、手指或鼠标'}</small>
          </span>
        )}
      </div>
      <div className="drawing-pagebar">
        <div>
          <button
            className="icon-button"
            aria-label="上一页笔迹"
            disabled={index === 0}
            onClick={() => {
              up();
              setIndex(Math.max(0, index - 1));
            }}
          >
            <ChevronLeft size={17} />
          </button>
          <span>
            {Math.min(index, list.length - 1) + 1} / {list.length} 页
          </span>
          <button
            className="icon-button"
            aria-label="下一页笔迹"
            disabled={index >= list.length - 1}
            onClick={() => {
              up();
              setIndex(index + 1);
            }}
          >
            <ChevronRight size={17} />
          </button>
        </div>
        <div>
          {!disabled && (
            <>
              <button
                className="text-button"
                onClick={() => save({ ...page, height: Math.min(2800, page.height + 350) })}
                disabled={page.height >= 2800}
              >
                加长本页
              </button>
              <button
                className="text-button"
                disabled={list.length >= 20}
                onClick={() => {
                  onChange([...list, freshPage()]);
                  setIndex(list.length);
                }}
              >
                <Plus size={14} />
                加一页
              </button>
              <button
                className="icon-button danger"
                aria-label="删除当前手写页"
                onClick={() => {
                  onChange(list.filter((p) => p.id !== page.id));
                  setIndex(Math.max(0, index - 1));
                }}
              >
                <Trash2 size={15} />
              </button>
            </>
          )}
        </div>
      </div>
      {!disabled && (
        <label className="pen-only">
          <input type="checkbox" checked={penOnly} onChange={(e) => setPenOnly(e.target.checked)} />
          仅触控笔书写<span>从画布外滚动页面</span>
        </label>
      )}
    </div>
  );
  return expanded ? (
    <Modal
      title="专心写下每一步"
      onClose={() => {
        up();
        setExpanded(false);
      }}
      wide
    >
      {board}
    </Modal>
  ) : (
    board
  );
}
