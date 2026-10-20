// @vitest-environment jsdom
import React, { useState } from 'react';
import { it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { DrawingBoard } from '../client/components/DrawingBoard';
import type { DrawingPage } from '../shared/model';
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it('第二个指针不能覆盖正在书写的笔画或结束它', () => {
  class Pointer extends MouseEvent {
    pointerId: number;
    pointerType: string;
    pressure: number;
    constructor(type: string, init: any) {
      super(type, init);
      this.pointerId = init.pointerId;
      this.pointerType = init.pointerType;
      this.pressure = init.pressure ?? 0.5;
    }
  }
  vi.stubGlobal('PointerEvent', Pointer);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  const noop = () => {};
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    setTransform: noop,
    clearRect: noop,
    fillRect: noop,
    beginPath: noop,
    moveTo: noop,
    lineTo: noop,
    stroke: noop,
    arc: noop,
    fill: noop,
  } as any);
  vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue({
    left: 0,
    top: 0,
    width: 1000,
    height: 700,
    right: 1000,
    bottom: 700,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });
  HTMLCanvasElement.prototype.setPointerCapture = noop;
  let saved: DrawingPage[] = [];
  function Editor() {
    const [pages, setPages] = useState<DrawingPage[]>([]);
    return (
      <DrawingBoard
        pages={pages}
        onChange={(next) => {
          saved = next;
          setPages(next);
        }}
      />
    );
  }
  render(<Editor />);
  const canvas = screen.getByLabelText('手写作答画布，第 1 页');
  const event = (id: number, type: string, x: number) => ({
    pointerId: id,
    pointerType: type,
    button: 0,
    clientX: x,
    clientY: 10,
    pressure: 0.5,
  });
  fireEvent.pointerDown(canvas, event(1, 'pen', 10));
  fireEvent.pointerMove(canvas, event(1, 'pen', 20));
  fireEvent.pointerDown(canvas, event(2, 'touch', 500));
  fireEvent.pointerUp(canvas, event(2, 'touch', 500));
  fireEvent.pointerMove(canvas, event(1, 'pen', 30));
  fireEvent.pointerUp(canvas, event(1, 'pen', 30));
  expect(saved[0].strokes).toHaveLength(1);
  expect(saved[0].strokes[0].points.map((p) => p.x)).toEqual([10, 20, 30]);
});
