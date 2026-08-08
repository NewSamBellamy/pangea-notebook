/**
 * "Draw on it, say what's wrong, regenerate" — the modal opened by
 * clicking any image on a page. Lets the creator scribble on a canvas
 * copy of the image with the red pen, type an instruction, and sends the
 * marked-up image + instruction to Gemini image editing (or a palette-
 * shifted procedural plate in demo mode) to produce a revised image in
 * place on the page.
 */

import React, { useEffect, useRef, useState } from 'react';
import type { Block, Book } from '../types';
import { useStore } from '../store';
import * as ai from '../ai';
import { addLog } from '../actions';

export function ImageStudio({ book, pageId, block, onClose }: {
  book: Book; pageId: string; block: Block; onClose: () => void;
}) {
  const { settings, mutateBook, showToast } = useStore();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [drawing, setDrawing] = useState(false);
  const [marked, setMarked] = useState(false);
  const [instruction, setInstruction] = useState('');
  const [busy, setBusy] = useState(false);
  const last = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      imgRef.current = img;
      const c = canvasRef.current;
      if (!c) return;
      const maxW = 760;
      const scale = Math.min(1, maxW / img.width);
      c.width = img.width * scale;
      c.height = img.height * scale;
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    };
    img.src = block.imageData ?? '';
  }, [block.imageData]);

  const pos = (e: React.PointerEvent) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * canvasRef.current!.width, y: ((e.clientY - r.top) / r.height) * canvasRef.current!.height };
  };

  function draw(e: React.PointerEvent) {
    if (!drawing) return;
    const ctx = canvasRef.current!.getContext('2d')!;
    const p = pos(e);
    ctx.strokeStyle = '#e0301e';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(last.current?.x ?? p.x, last.current?.y ?? p.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last.current = p;
    setMarked(true);
  }

  function reset() {
    const c = canvasRef.current;
    const img = imgRef.current;
    if (!c || !img) return;
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    setMarked(false);
  }

  async function regenerate() {
    if (busy) return;
    setBusy(true);
    try {
      const markedUrl = canvasRef.current!.toDataURL('image/png');
      const next = await ai.regenerateImage(
        settings, book, markedUrl,
        instruction.trim() || 'Apply the changes indicated by the red markings.',
        block.imagePrompt ?? block.caption ?? 'illustration',
      );
      mutateBook(book.id, (b) => {
        const pg = b.pages.find((p) => p.id === pageId);
        const bl = pg?.blocks.find((x) => x.id === block.id);
        if (bl) bl.imageData = next;
      });
      addLog((fn) => mutateBook(book.id, fn), 'image', `Image regenerated: “${(instruction || 'per markings').slice(0, 60)}”`, pageId);
      showToast('Image regenerated onto the page');
      onClose();
    } catch (e) {
      showToast(`Regeneration failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="imgstudio" onClick={(e) => e.stopPropagation()}>
        <h3>✎ Mark it up, say what’s wrong, regenerate.</h3>
        <p className="imgstudio-hint">Draw on the image with the red pen — circle the ears, cross out the extra mast — then tell the agent what you want.</p>
        <canvas
          ref={canvasRef}
          className="imgstudio-canvas"
          onPointerDown={(e) => { setDrawing(true); last.current = pos(e); }}
          onPointerMove={draw}
          onPointerUp={() => { setDrawing(false); last.current = null; }}
          onPointerLeave={() => { setDrawing(false); last.current = null; }}
        />
        <input
          className="imgstudio-input"
          placeholder='e.g. "his ears need to be bigger" · "make the storm feel closer"'
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void regenerate(); }}
        />
        <div className="nb-actions">
          <button className="btn btn-gold" disabled={busy || (!marked && !instruction.trim())} onClick={() => void regenerate()}>
            {busy ? 'Regenerating…' : '⟳ Regenerate image'}
          </button>
          <button className="btn btn-ghost" disabled={busy} onClick={reset}>Clear ink</button>
          <button className="btn btn-ghost" disabled={busy} onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
