/**
 * Renders one page's content (BlockView) plus the annotation system:
 * - `PageCanvas` — the live, editable page: right-click opens a radial
 *   tool ring (pen/highlighter/underline/circle/sticky-note/eraser); the
 *   ring stays open until a tool is picked, Escape, or the hub is
 *   clicked. The chosen tool shows as a dismissible chip. Also renders
 *   the "Audit this page" / "End audit" controls and the floating
 *   end-audit button (audit-fab) so it's reachable no matter how far
 *   you've scrolled.
 * - `StaticPageFace` — a read-only render of a page's blocks, used ONLY
 *   as the content riding the turning leaf during a page-flip animation
 *   (see BookView.tsx).
 * - `CoverPage` — the book cover + table of contents, with inline TOC
 *   title editing and the "waiting on you" open-notes list.
 */

import React, { useEffect, useRef, useState } from 'react';
import type { Annotation, Block, Book, Note, Page, Tool } from '../types';
import { uid } from '../types';
import { PALETTES, SPINE_FONTS } from '../store';

// ---------------- annotation geometry helpers ----------------

interface Pt { x: number; y: number }

function pathFor(a: Annotation, w: number): string {
  const pts = a.points.map((p) => ({ x: p.x * w, y: p.y }));
  if (pts.length === 0) return '';
  if (a.tool === 'underline' && pts.length >= 2) {
    const y = (pts[0].y + pts[pts.length - 1].y) / 2;
    return `M ${pts[0].x} ${y} L ${pts[pts.length - 1].x} ${y}`;
  }
  if (a.tool === 'circle' && pts.length >= 2) {
    const xs = pts.map((p) => p.x); const ys = pts.map((p) => p.y);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    const rx = Math.max(18, (Math.max(...xs) - Math.min(...xs)) / 2 + 8);
    const ry = Math.max(14, (Math.max(...ys) - Math.min(...ys)) / 2 + 8);
    return `M ${cx - rx} ${cy} A ${rx} ${ry} 0 1 0 ${cx + rx} ${cy} A ${rx} ${ry} 0 1 0 ${cx - rx} ${cy}`;
  }
  return pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
}

const TOOL_STYLE: Record<Annotation['tool'], { stroke: string; width: number; opacity: number; blend?: string }> = {
  pen: { stroke: '#c0392b', width: 2.6, opacity: 0.95 },
  highlight: { stroke: '#f7d43d', width: 16, opacity: 0.45, blend: 'multiply' },
  underline: { stroke: '#c0392b', width: 2.4, opacity: 0.95 },
  circle: { stroke: '#c0392b', width: 2.6, opacity: 0.9 },
};

const TOOLS: { id: Tool; icon: React.ReactNode; label: string }[] = [
  { id: 'cursor', icon: '☞', label: 'Read' },
  { id: 'highlight', icon: <span className="ico-hl" />, label: 'Highlighter' },
  { id: 'pen', icon: <span className="ico-pen">✎</span>, label: 'Red pen' },
  { id: 'underline', icon: <span className="ico-ul">U</span>, label: 'Underline' },
  { id: 'circle', icon: '◯', label: 'Circle' },
  { id: 'note', icon: <span className="ico-note" />, label: 'Leave a note' },
  { id: 'erase', icon: '⌫', label: 'Erase mark' },
];

// ---------------- block renderer ----------------

function BlockView({ b, onImageClick }: { b: Block; onImageClick: (b: Block) => void }) {
  switch (b.type) {
    case 'heading': return <h2 className="pg-h">{b.text}</h2>;
    case 'quote': return <blockquote className="pg-q">{b.text}</blockquote>;
    case 'list': return <ul className="pg-l">{(b.items ?? []).map((it, i) => <li key={i}>{it}</li>)}</ul>;
    case 'image':
      return (
        <figure className="pg-fig">
          {b.imageData
            ? <img src={b.imageData} alt={b.caption ?? ''} onClick={() => onImageClick(b)} title="Click to mark up & regenerate" />
            : <div className="pg-fig-empty">image pending…</div>}
          {b.caption && <figcaption>{b.caption}</figcaption>}
        </figure>
      );
    default: return <p className="pg-p">{b.text}</p>;
  }
}

// ---------------- static page face (used by the page-turn animation) ----------------

export function StaticPageFace({ page }: { page: Page }) {
  return (
    <div className="page-inner static-face">
      <div className="page-head"><span className="page-chapter">{page.chapter}</span></div>
      <div className="page-content">
        {page.blocks.length === 0 ? (
          <div className="pg-undrafted">
            <h2 className="pg-h">{page.title}</h2>
            <p className="pg-summary">{page.summary}</p>
          </div>
        ) : (
          page.blocks.map((b) => <BlockView key={b.id} b={b} onImageClick={() => { /* static */ }} />)
        )}
      </div>
    </div>
  );
}

// ---------------- cover / TOC ----------------

export function CoverPage({ book, onJump, onRenamePage }: {
  book: Book;
  onJump: (pageId: string) => void;
  onRenamePage: (pageId: string, title: string) => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const pal = PALETTES[book.palette % PALETTES.length];
  const font = SPINE_FONTS[book.font % SPINE_FONTS.length];
  const chapters: { name: string; pages: Page[] }[] = [];
  for (const p of book.pages) {
    const last = chapters[chapters.length - 1];
    if (last && last.name === p.chapter) last.pages.push(p);
    else chapters.push({ name: p.chapter, pages: [p] });
  }
  const openNotes = book.notes.filter((n) => !n.resolved);
  const drafted = book.pages.filter((p) => p.drafted).length;

  return (
    <div className="cover">
      <div className="cover-plate" style={{ background: `linear-gradient(160deg, ${pal.spine} 0%, ${pal.spine2} 100%)`, borderColor: pal.accent }}>
        {book.coverImage && <img className="cover-plate-art" src={book.coverImage} alt="" />}
        {book.coverImage && <div className="cover-plate-scrim" />}
        <div className="cover-frame" style={{ borderColor: pal.accent }}>
          <h1 style={{ fontFamily: font, color: pal.ink }}>{book.title}</h1>
          {book.subtitle && <p className="cover-sub" style={{ color: pal.accent }}>{book.subtitle}</p>}
          {book.author && <p className="cover-author" style={{ color: pal.ink }}>{book.author}</p>}
        </div>
        <div className="cover-progress" style={{ color: pal.ink }}>
          {drafted}/{book.pages.length} pages drafted
          <span className="cover-progressbar"><i style={{ width: `${(drafted / Math.max(1, book.pages.length)) * 100}%`, background: pal.accent }} /></span>
        </div>
      </div>

      <div className="toc">
        <h3 className="toc-title">Table of Contents</h3>
        {chapters.map((ch, ci) => (
          <div className="toc-ch" key={ci}>
            <div className="toc-chname">{ch.name}</div>
            {ch.pages.map((p) => {
              const noteCount = openNotes.filter((n) => n.pageId === p.id).length;
              const idx = book.pages.indexOf(p) + 1;
              const commit = () => {
                if (draft.trim()) onRenamePage(p.id, draft.trim());
                setEditingId(null);
              };
              return (
                <div key={p.id} className="toc-row" role="button" tabIndex={0}
                  onClick={() => { if (editingId !== p.id) onJump(p.id); }}>
                  <span className="toc-num">{idx}</span>
                  {editingId === p.id ? (
                    <input className="toc-edit" value={draft} autoFocus
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditingId(null); }}
                      onBlur={commit} />
                  ) : (
                    <span className={`toc-name ${p.drafted ? '' : 'toc-undrafted'}`}>{p.title}</span>
                  )}
                  <button className="toc-pen" title="Rename page"
                    onClick={(e) => { e.stopPropagation(); setDraft(p.title); setEditingId(p.id); }}>✎</button>
                  <span className="toc-dots" />
                  {noteCount > 0 && <span className="toc-notebadge" title={`${noteCount} open note(s)`}>{noteCount}</span>}
                  <span className="toc-state">{p.drafted ? '✓' : '·'}</span>
                </div>
              );
            })}
          </div>
        ))}
        {openNotes.length > 0 && (
          <div className="toc-notes">
            <h4>⚑ Waiting on you — open notes</h4>
            {openNotes.map((n) => {
              const p = book.pages.find((x) => x.id === n.pageId);
              return (
                <button key={n.id} className="toc-noterow" onClick={() => p && onJump(p.id)}>
                  <span className="toc-notepage">{p?.title ?? '?'}</span>
                  <span className="toc-notetext">{n.text}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------- the page canvas ----------------

interface PageCanvasProps {
  book: Book;
  page: Page;
  tool: Tool;
  setTool: (t: Tool) => void;
  sessionActive: boolean;
  auditing: boolean;
  onStartAudit: () => void;
  onEndAudit: () => void;
  micState: 'off' | 'on' | 'unavailable';
  onAnnotate: (a: Annotation) => void;
  onEraseAnnotation: (id: string) => void;
  onAddNote: (text: string, x: number, y: number) => void;
  onResolveNote: (id: string) => void;
  notes: Note[];
  onImageClick: (b: Block) => void;
  onDraft: () => void;
  drafting: boolean;
  contentRef: React.RefObject<HTMLDivElement | null>;
}

export function PageCanvas(props: PageCanvasProps) {
  const { book, page, tool, setTool, sessionActive, auditing, onStartAudit, onEndAudit, micState, onAnnotate, onEraseAnnotation, onAddNote, onResolveNote, notes, onImageClick, onDraft, drafting, contentRef } = props;
  const wrapRef = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(600);
  const [drawing, setDrawing] = useState<Pt[] | null>(null);
  const [radial, setRadial] = useState<{ x: number; y: number } | null>(null);
  const [notePopup, setNotePopup] = useState<{ x: number; y: number; text: string } | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setTool('cursor'); setRadial(null); setNotePopup(null); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setTool]);

  const rel = (e: React.PointerEvent | React.MouseEvent): Pt => {
    const r = wrapRef.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: e.clientY - r.top };
  };

  function down(e: React.PointerEvent) {
    if (tool === 'cursor' || e.button !== 0) return;
    if (tool === 'note') {
      const p = rel(e);
      setNotePopup({ x: p.x, y: p.y, text: '' });
      return;
    }
    if (tool === 'erase') {
      const p = rel(e);
      const hit = page.annotations.find((a) =>
        a.points.some((q) => Math.abs(q.x * w - p.x * w) < 14 && Math.abs(q.y - p.y) < 14));
      if (hit) onEraseAnnotation(hit.id);
      return;
    }
    (e.target as Element).setPointerCapture?.(e.pointerId);
    setDrawing([rel(e)]);
  }

  function move(e: React.PointerEvent) {
    if (!drawing) return;
    setDrawing((d) => (d ? [...d, rel(e)] : d));
  }

  function up() {
    if (!drawing) return;
    if (drawing.length > 1 && tool !== 'cursor' && tool !== 'note' && tool !== 'erase') {
      onAnnotate({
        id: uid(),
        tool: tool as Annotation['tool'],
        color: tool === 'highlight' ? '#f7d43d' : '#c0392b',
        points: tool === 'underline' || tool === 'circle' ? [drawing[0], drawing[drawing.length - 1], ...(tool === 'circle' ? drawing.filter((_, i) => i % 4 === 0) : [])] : drawing.filter((_, i) => i % 2 === 0 || i === drawing.length - 1),
        createdAt: Date.now(),
      });
    }
    setDrawing(null);
  }

  const live = drawing && tool !== 'note' && tool !== 'erase' && tool !== 'cursor'
    ? { id: 'live', tool: tool as Annotation['tool'], color: '', points: drawing, createdAt: 0 }
    : null;

  const undrafted = !page.drafted && page.blocks.length === 0;

  return (
    <div className={`page-scroll ${tool !== 'cursor' ? 'tooling' : ''}`}>
      <div className="page-inner" ref={wrapRef}
        onContextMenu={(e) => { e.preventDefault(); const p = rel(e); setRadial({ x: p.x * w, y: p.y }); }}>

        <div className="page-head">
          <span className="page-chapter">{page.chapter}</span>
          {!sessionActive ? (
            <button className="audit-btn" disabled={auditing || !page.drafted} onClick={onStartAudit}
              title="Read the page out loud while you mark it up — your voice and ink get compiled into the Scribe">
              {auditing ? '⌛ compiling audit…' : '⊙ Audit this page'}
            </button>
          ) : (
            <button className="audit-btn recording" onClick={onEndAudit}>
              ■ End audit{micState === 'on' ? ' · listening' : micState === 'unavailable' ? ' · mic unavailable (ink still syncs)' : ''}
            </button>
          )}
        </div>
        {sessionActive && (
          <div className="audit-strip">
            <span className="session-dot">●</span> Think out loud while you mark the page — every stroke is timestamped to your voice. Right-click for the tool ring.
          </div>
        )}

        <div className="page-content" ref={contentRef}>
          {undrafted ? (
            <div className="pg-undrafted">
              <h2 className="pg-h">{page.title}</h2>
              <p className="pg-summary">{page.summary}</p>
              <button className="btn btn-gold" onClick={onDraft} disabled={drafting}>
                {drafting ? 'The agent is writing…' : '✒ Draft this page'}
              </button>
              <p className="pg-hint">The agent writes with full knowledge of your plan and every other page.</p>
            </div>
          ) : (
            page.blocks.map((b) => <BlockView key={b.id} b={b} onImageClick={onImageClick} />)
          )}
          {drafting && !undrafted && <div className="pg-drafting">rewriting…</div>}
        </div>

        {/* annotation overlay */}
        <svg
          className={`ann-layer ${tool !== 'cursor' ? 'active' : ''}`}
          onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={up}
        >
          {[...page.annotations, ...(live ? [live] : [])].map((a) => {
            const st = TOOL_STYLE[a.tool];
            return (
              <path key={a.id} d={pathFor(a as Annotation, w)} fill="none"
                stroke={st.stroke} strokeWidth={st.width} strokeLinecap="round" strokeLinejoin="round"
                opacity={st.opacity} style={{ mixBlendMode: (st.blend as React.CSSProperties['mixBlendMode']) ?? 'normal' }} />
            );
          })}
        </svg>

        {/* sticky notes */}
        {notes.map((n) => (
          <div key={n.id} className="sticky" style={{ left: `${(n.x ?? 0.7) * 100}%`, top: n.y ?? 40 }}>
            <div className="sticky-text">{n.text}</div>
            <button className="sticky-done" title="Resolve" onClick={() => onResolveNote(n.id)}>✓</button>
          </div>
        ))}

        {/* note popup */}
        {notePopup && (
          <div className="note-popup" style={{ left: `${notePopup.x * 100}%`, top: notePopup.y }}>
            <textarea autoFocus rows={3} placeholder="Leave a note to future-you…"
              value={notePopup.text}
              onChange={(e) => setNotePopup({ ...notePopup, text: e.target.value })} />
            <div className="note-popup-actions">
              <button className="btn btn-mini btn-gold" onClick={() => {
                if (notePopup.text.trim()) onAddNote(notePopup.text.trim(), notePopup.x, notePopup.y);
                setNotePopup(null); setTool('cursor');
              }}>Pin it</button>
              <button className="btn btn-mini btn-ghost" onClick={() => { setNotePopup(null); setTool('cursor'); }}>Cancel</button>
            </div>
          </div>
        )}

        {/* radial tool menu — stays open until you pick a tool, press Escape, or tap the hub */}
        {radial && (
          <div className="radial" style={{ left: radial.x, top: radial.y }}>
            {TOOLS.map((t, i) => {
              const ang = (i / TOOLS.length) * Math.PI * 2 - Math.PI / 2;
              const r = 74;
              return (
                <button key={t.id}
                  className={`radial-tool ${tool === t.id ? 'on' : ''}`}
                  style={{ left: Math.cos(ang) * r, top: Math.sin(ang) * r }}
                  title={t.label}
                  onClick={() => { setTool(t.id); setRadial(null); }}
                >{t.icon}</button>
              );
            })}
            <button className="radial-hub" title="Close" onClick={() => setRadial(null)} />
          </div>
        )}
      </div>

      {/* floating end-audit control — always in reach while you read and mark */}
      {sessionActive && (
        <button className="audit-fab" onClick={onEndAudit} title="Finish the audit — it compiles into the Scribe">
          ■ End audit{micState === 'on' ? ' · listening' : ''}
        </button>
      )}

      {/* active tool chip (radial ring is the toolset — right-click to open) */}
      {tool !== 'cursor' && (
        <button className="tool-chip" onClick={() => setTool('cursor')} title="Click to put the tool down (Esc)">
          {TOOLS.find((t) => t.id === tool)?.icon} {TOOLS.find((t) => t.id === tool)?.label} ✕
        </button>
      )}
    </div>
  );
}
