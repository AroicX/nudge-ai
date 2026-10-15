import { useEffect, useRef, useState } from 'react';

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
}

/**
 * A canvas editor that only honours trusted (real) input, like many design tools.
 * Synthetic DOM events are counted and ignored.
 */
export function CanvasEditorFixture() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const [box, setBox] = useState<Box>({ x: 80, y: 80, width: 240, height: 60, text: 'Your text here' });
  const [selected, setSelected] = useState(false);
  const [editing, setEditing] = useState(false);
  const [ignored, setIgnored] = useState(0);
  const drag = useRef<{ dx: number; dy: number } | undefined>(undefined);

  useEffect(() => {
    const context = canvasRef.current?.getContext('2d');
    if (!context) return;
    context.clearRect(0, 0, 800, 450);
    context.fillStyle = '#fdf6e3';
    context.fillRect(0, 0, 800, 450);
    context.fillStyle = selected ? '#e9e7fb' : '#ffffff';
    context.fillRect(box.x, box.y, box.width, box.height);
    context.strokeStyle = selected ? '#6254e7' : '#cccccc';
    context.strokeRect(box.x, box.y, box.width, box.height);
    context.fillStyle = '#172033';
    context.font = '20px sans-serif';
    context.fillText(box.text, box.x + 12, box.y + 37);
  }, [box, selected]);

  const local = (event: { clientX: number; clientY: number }) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };
  const inside = (point: { x: number; y: number }) =>
    point.x >= box.x && point.x <= box.x + box.width && point.y >= box.y && point.y <= box.y + box.height;

  return (
    <main className="canvas-editor">
      <header>
        <p className="eyebrow">Nudge test design editor</p>
        <h1>Flyer</h1>
      </header>
      <canvas
        ref={canvasRef}
        width={800}
        height={450}
        aria-label="Design canvas"
        onPointerDown={(event) => {
          if (!event.isTrusted) return setIgnored((count) => count + 1);
          const point = local(event);
          if (inside(point)) {
            setSelected(true);
            if (editing) {
              event.preventDefault();
              return;
            }
            drag.current = { dx: point.x - box.x, dy: point.y - box.y };
            event.currentTarget.setPointerCapture?.(event.pointerId);
          } else {
            setSelected(false);
            setEditing(false);
          }
        }}
        onMouseDown={(event) => {
          if (editing) event.preventDefault();
        }}
        onPointerMove={(event) => {
          if (!event.isTrusted || !drag.current || !(event.buttons & 1)) return;
          const point = local(event);
          setBox((current) => ({ ...current, x: Math.round(point.x - drag.current!.dx), y: Math.round(point.y - drag.current!.dy) }));
        }}
        onPointerUp={() => {
          drag.current = undefined;
        }}
        onDoubleClick={(event) => {
          if (!event.isTrusted) return setIgnored((count) => count + 1);
          if (!inside(local(event))) return;
          setEditing(true);
          const area = textRef.current!;
          area.value = box.text;
          area.focus();
          area.select();
        }}
      />
      <textarea
        ref={textRef}
        aria-hidden="true"
        tabIndex={-1}
        className="canvas-text-input"
        onInput={(event) => {
          if (!event.isTrusted || !editing) return setIgnored((count) => count + 1);
          const text = event.currentTarget.value;
          setBox((current) => ({ ...current, text }));
        }}
      />
      <p aria-live="polite" data-testid="canvas-status">
        Text box at x={box.x}, y={box.y} · text: {box.text} · {editing ? 'editing' : selected ? 'selected' : 'idle'} · ignored synthetic events: {ignored}
      </p>
    </main>
  );
}
