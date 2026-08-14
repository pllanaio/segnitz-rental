'use client';

import { useEffect, useRef } from 'react';
import { Icon } from '@/components/ui/icon';
import styles from './shop.module.css';

interface Point {
  x: number;
  y: number;
}

export function SignaturePad({ onChange }: { onChange: (value: string) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const lastPoint = useRef<Point | null>(null);
  const hasInk = useRef(false);
  const resizeGeneration = useRef(0);

  useEffect(() => {
    function resize() {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const generation = ++resizeGeneration.current;
      const snapshot = hasInk.current ? canvas.toDataURL('image/png') : null;
      const rect = canvas.getBoundingClientRect();
      const ratio = Math.max(window.devicePixelRatio || 1, 1);
      canvas.width = Math.max(Math.round(rect.width * ratio), 1);
      canvas.height = Math.max(Math.round(rect.height * ratio), 1);
      const context = canvas.getContext('2d');
      if (!context) return;
      context.scale(ratio, ratio);
      context.lineCap = 'round';
      context.lineJoin = 'round';
      context.lineWidth = 2.2;
      context.strokeStyle = '#041c40';
      if (!snapshot) return;
      const image = new Image();
      image.onload = () => {
        // ResizeObserver darf zwischen mehreren Größenänderungen feuern. Ein
        // veralteter Restore darf die neuere Zeichnung nicht überschreiben.
        if (canvasRef.current !== canvas || generation !== resizeGeneration.current) return;
        context.drawImage(image, 0, 0, rect.width, rect.height);
        onChange(canvas.toDataURL('image/png'));
      };
      image.src = snapshot;
    }

    resize();
    const observer = new ResizeObserver(resize);
    if (canvasRef.current) observer.observe(canvasRef.current);
    return () => observer.disconnect();
  }, [onChange]);

  function point(event: React.PointerEvent<HTMLCanvasElement>): Point {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function start(event: React.PointerEvent<HTMLCanvasElement>) {
    // Ein noch ladender Resize-Snapshot darf eine neue Eingabe nicht später
    // überzeichnen.
    resizeGeneration.current += 1;
    event.currentTarget.setPointerCapture(event.pointerId);
    drawing.current = true;
    lastPoint.current = point(event);
  }

  function move(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current || !lastPoint.current) return;
    const next = point(event);
    const context = event.currentTarget.getContext('2d');
    if (!context) return;
    context.beginPath();
    context.moveTo(lastPoint.current.x, lastPoint.current.y);
    context.lineTo(next.x, next.y);
    context.stroke();
    lastPoint.current = next;
    hasInk.current = true;
  }

  function end(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    drawing.current = false;
    lastPoint.current = null;
    if (hasInk.current) onChange(event.currentTarget.toDataURL('image/png'));
  }

  function clear() {
    resizeGeneration.current += 1;
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (canvas && context) context.clearRect(0, 0, canvas.width, canvas.height);
    hasInk.current = false;
    onChange('');
  }

  return (
    <div className={styles.signatureField}>
      <div className={styles.signatureHeader}>
        <span>Unterschrift <span aria-hidden="true">*</span></span>
        <button className="button buttonGhost" onClick={clear} type="button">
          <Icon name="refresh" size={17} /> Neu zeichnen
        </button>
      </div>
      <canvas
        aria-label="Unterschriftsfeld. Mit Maus, Finger oder Stift unterschreiben."
        className={styles.signatureCanvas}
        onPointerCancel={end}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        ref={canvasRef}
      />
      <p>Bitte unterschreiben Sie innerhalb des Feldes.</p>
    </div>
  );
}
