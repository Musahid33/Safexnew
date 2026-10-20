'use client';

import { useEffect, useRef } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';

/**
 * A signature box.
 *
 * The officer signs with a finger on the phone and a mouse on the desktop, so the pad is a
 * canvas driven by pointer events rather than an image or a typed name: `touch-action: none`
 * stops a stroke from scrolling the form, and pointer capture keeps the line attached when
 * the finger leaves the box mid-stroke.
 *
 * The canvas has a fixed paper resolution (600 × 200) and is scaled by CSS. That way the
 * stroke is the same physical thickness on a 360 px phone and a 1440 px monitor, and the
 * exported PNG is always the same size regardless of the screen it was drawn on.
 */

const WIDTH = 600;
const HEIGHT = 200;
const INK = '#0b2340';

export function SignaturePad({
  value, onChange, disabled, label
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  label: string;
}) {
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  /** A stray tap is not a signature; only a real stroke is exported. */
  const ink = useRef(false);

  const context = () => {
    const element = canvas.current;
    const ctx = element?.getContext('2d');
    if (!ctx) return null;
    ctx.lineWidth = 3.4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = INK;
    ctx.fillStyle = INK;
    return ctx;
  };

  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    element.width = WIDTH;
    element.height = HEIGHT;
  }, []);

  // Clearing from outside — the form reset, or a filed plan — must empty the paper too.
  useEffect(() => {
    if (value) return;
    const element = canvas.current;
    const ctx = element?.getContext('2d');
    if (element && ctx) ctx.clearRect(0, 0, element.width, element.height);
    ink.current = false;
  }, [value]);

  const point = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const element = event.currentTarget;
    const rect = element.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) * (element.width / Math.max(1, rect.width)),
      y: (event.clientY - rect.top) * (element.height / Math.max(1, rect.height))
    };
  };

  const start = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (disabled) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const ctx = context();
    if (!ctx) return;
    const at = point(event);
    drawing.current = true;
    last.current = at;
    // A dot on touch-down, so a deliberate full stop is not lost between events.
    ctx.beginPath();
    ctx.arc(at.x, at.y, 1.8, 0, Math.PI * 2);
    ctx.fill();
    ink.current = true;
  };

  const move = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current || disabled) return;
    const ctx = context();
    const previous = last.current;
    if (!ctx || !previous) return;
    const at = point(event);
    ctx.beginPath();
    ctx.moveTo(previous.x, previous.y);
    ctx.lineTo(at.x, at.y);
    ctx.stroke();
    last.current = at;
  };

  const finish = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    drawing.current = false;
    last.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    const element = canvas.current;
    if (element && ink.current) onChange(element.toDataURL('image/png'));
  };

  const clear = () => {
    const element = canvas.current;
    const ctx = element?.getContext('2d');
    if (element && ctx) ctx.clearRect(0, 0, element.width, element.height);
    ink.current = false;
    onChange('');
  };

  return <div className={`dm-signature${value ? ' is-signed' : ''}`}>
    <canvas
      ref={canvas}
      className="dm-signature-pad"
      role="img"
      aria-label={label}
      onPointerDown={start}
      onPointerMove={move}
      onPointerUp={finish}
      onPointerCancel={finish}
    />
    {!value && <span className="dm-signature-hint">Sign here — finger ya mouse se</span>}
    <div className="dm-signature-actions">
      <button type="button" className="dm-ghost" onClick={clear} disabled={disabled || !value}>
        Clear signature
      </button>
    </div>
  </div>;
}
