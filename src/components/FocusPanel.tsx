/**
 * Book metadata + actions + cover studio, shown when a shelf book is
 * "pulled" into focus view (see Library.tsx). Extracted as its own
 * component so it's reusable wherever a book needs this panel.
 * Includes the danger-zone delete (double-click-to-confirm).
 */

import React, { useState } from 'react';
import { useStore, PALETTES, SPINE_FONTS } from '../store';
import * as ai from '../ai';
import { addLog } from '../actions';
import type { Book } from '../types';

const fmtDate = (t?: number) => (t ? new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—');
const fmtAgo = (t?: number) => {
  if (!t) return 'never';
  const m = Math.floor((Date.now() - t) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return fmtDate(t);
};
const fmtTokens = (n?: number) => {
  if (!n) return '0';
  if (n < 1000) return String(n);
  if (n < 1000000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1000000).toFixed(2)}M`;
};

/** Book metadata + actions + cover studio — shared by the 2D focus view and the 3D library. */
export function FocusPanel({ book, onClose, closeLabel = 'Back to the study', extraActions }: {
  book: Book;
  onClose: () => void;
  closeLabel?: string;
  extraActions?: React.ReactNode;
}) {
  const { settings, mutateBook, openBook, removeBook, showToast } = useStore();
  const [respinning, setRespinning] = useState(false);
  const [direction, setDirection] = useState('');
  const [editTitle, setEditTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(book.title);
  const [armDelete, setArmDelete] = useState(false);
  const drafted = book.pages.filter((p) => p.drafted).length;
  const openNotes = book.notes.filter((n) => !n.resolved).length;

  async function respin(custom?: string) {
    if (respinning) return;
    setRespinning(true);
    try {
      const pal = PALETTES[book.palette % PALETTES.length];
      const art = custom?.trim()
        || book.coverPrompt
        || `${book.plan.prompt.slice(0, 240)} — evocative cover key art for "${book.title}"`;
      const img = await ai.cover(settings, `${art}. Color mood anchored in ${pal.name.toLowerCase()} tones (${pal.spine}).`, book.palette);
      mutateBook(book.id, (b) => { b.coverImage = img; if (custom?.trim()) b.coverPrompt = custom.trim(); });
      addLog((fn) => mutateBook(book.id, fn), 'cover', custom?.trim() ? `Cover rebound: “${custom.trim().slice(0, 60)}”` : 'Cover re-spun');
      showToast(ai.isLive(settings) ? 'New cover bound' : 'New cover bound (demo art — add a key for AI covers)');
      setDirection('');
    } catch (e) {
      showToast(`Cover failed: ${(e as Error).message}`);
    } finally {
      setRespinning(false);
    }
  }

  return (
    <div className="focus-panel">
      {editTitle ? (
        <div className="focus-titleedit">
          <input value={titleDraft} autoFocus onChange={(e) => setTitleDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { mutateBook(book.id, (b) => { b.title = titleDraft.trim() || b.title; }); setEditTitle(false); } }} />
          <button className="btn btn-mini btn-gold" onClick={() => { mutateBook(book.id, (b) => { b.title = titleDraft.trim() || b.title; }); setEditTitle(false); }}>Save</button>
        </div>
      ) : (
        <h2 className="focus-title" onClick={() => { setTitleDraft(book.title); setEditTitle(true); }} title="Click to rename">
          {book.title} <span className="focus-editpen">✎</span>
        </h2>
      )}
      {book.subtitle && <p className="focus-sub">{book.subtitle}</p>}

      <div className="focus-meta">
        <div><span>Begun</span><b>{fmtDate(book.createdAt)}</b></div>
        <div><span>Last worked</span><b>{fmtAgo(book.lastOpenedAt ?? book.updatedAt)}</b></div>
        <div><span>Pages drafted</span><b>{drafted} / {book.pages.length}</b></div>
        <div><span>Open notes</span><b>{openNotes}</b></div>
        <div><span>Tokens spent</span><b>{fmtTokens(book.tokensSpent)}</b></div>
      </div>

      <div className="focus-actions">
        <button className="btn btn-gold" onClick={() => openBook(book.id)}>Open the book →</button>
        {extraActions}
        <button className="btn btn-ghost" onClick={onClose}>{closeLabel}</button>
      </div>

      <div className="focus-studio">
        <h4>Cover studio {!ai.isLive(settings) && <em className="studio-demonote">demo mode — AI covers need a key</em>}</h4>
        <div className="swatches">
          {PALETTES.map((p, i) => (
            <button key={i} className={`swatch ${book.palette === i ? 'on' : ''}`}
              style={{ background: `linear-gradient(135deg, ${p.spine}, ${p.spine2})`, boxShadow: book.palette === i ? `0 0 0 2px ${p.accent}` : undefined }}
              onClick={() => mutateBook(book.id, (b) => { b.palette = i; })} title={p.name} />
          ))}
          <span className="studio-gap" />
          {SPINE_FONTS.map((f, i) => (
            <button key={f} className={`fontopt small ${book.font === i ? 'on' : ''}`} style={{ fontFamily: f }}
              onClick={() => mutateBook(book.id, (b) => { b.font = i; })}>Aa</button>
          ))}
        </div>
        <textarea rows={2} placeholder="Art direction (optional) — e.g. 'the Argo silhouetted inside the black hole, gold on midnight'"
          value={direction} onChange={(e) => setDirection(e.target.value)} />
        <div className="focus-actions">
          <button className="btn btn-outline" disabled={respinning} onClick={() => void respin(direction)}>
            {respinning ? 'Binding a new cover…' : direction.trim() ? '✦ Bind this direction' : '↻ Re-spin the cover'}
          </button>
        </div>
      </div>

      <div className="focus-danger">
        <button className={`btn btn-mini ${armDelete ? 'btn-danger' : 'btn-ghost'}`}
          onBlur={() => setArmDelete(false)}
          onClick={() => {
            if (!armDelete) { setArmDelete(true); return; }
            removeBook(book.id);
            showToast(`“${book.title}” removed from the library`);
            onClose();
          }}>
          {armDelete ? '⚠ Click again to delete this book forever' : '🗑 Delete this book'}
        </button>
      </div>
    </div>
  );
}
