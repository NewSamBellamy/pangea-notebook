/**
 * The Study — the app's home screen. A fixed-aspect photoreal backdrop
 * (src/assets/studyImage.ts — a base64 data URL, see that file for why)
 * with the empty center bookcase bays filled by:
 * - every real Book as a clickable spine (ShelfSpine, oldest-first), and
 * - procedural warm "filler" spines (FillerSpine) so the case always
 *   reads as a full, lived-in library regardless of how many books exist.
 * Clicking a shelf spine opens FocusView (a zoomed 3D book + FocusPanel).
 * The most-recently-opened book always sits on the desk as a "continue
 * where you left off" shortcut; the leather journal on the desk starts a
 * new book. Also renders the Pangea wordmark/atlas logo and the live/demo
 * mode badge.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useStore, PALETTES, SPINE_FONTS } from '../store';
import * as ai from '../ai';
import type { Book } from '../types';
import { Book3D } from './Book3D';
import { FocusPanel } from './FocusPanel';
import { studyImageDataUrl as studyBg } from '../assets/studyImage';

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

// Empty-shelf regions of the backdrop image, in % of the stage.
const SHELF_X = 29.8; // left edge of shelf interior
const SHELF_W = 39.4; // width of shelf interior
const SHELF_BOTTOMS = [76.6, 58.1, 39.8]; // distance from stage bottom to each shelf floor
const PER_SHELF = 13;

function ShelfSpine({ book, stageH, onFocus }: { book: Book; stageH: number; onFocus: () => void }) {
  const pal = PALETTES[book.palette % PALETTES.length];
  const font = SPINE_FONTS[book.font % SPINE_FONTS.length];
  const v1 = (book.title.length * 11) % 30;
  const v2 = (book.id.charCodeAt(0) + (book.id.charCodeAt(1) || 7)) % 10;
  const h = stageH * 0.125 + (v1 / 30) * stageH * 0.026;
  const w = Math.max(22, stageH * 0.024 + v2 * 1.1);
  const openNotes = book.notes.filter((n) => !n.resolved).length;
  return (
    <button
      className="spine"
      style={{ height: h, width: w, background: `linear-gradient(90deg, ${pal.spine2} 0%, ${pal.spine} 18%, ${pal.spine} 82%, ${pal.spine2} 100%)` }}
      onClick={onFocus}
      title={book.title}
    >
      <span className="spine-band" style={{ background: pal.accent }} />
      <span className="spine-title" style={{ color: pal.ink, fontFamily: font, fontSize: Math.max(9, stageH * 0.0128) }}>{book.title}</span>
      <span className="spine-band spine-band-bottom" style={{ background: pal.accent }} />
      {openNotes > 0 && <span className="spine-notes">{openNotes}</span>}
    </button>
  );
}

/** Background volumes so the case reads full, like its painted neighbors — warm old leather, not yours. */
const FILLER_TONES = [
  ['#6b4a2c', '#4a3018'], ['#7a5535', '#523618'], ['#5f3428', '#3f2016'],
  ['#4f4a2a', '#35311a'], ['#75543a', '#4e3520'], ['#59392b', '#3b2318'],
  ['#836244', '#573f26'], ['#4a3b2f', '#33271d'], ['#6e4030', '#48261a'],
  ['#5c4d33', '#3e321f'], ['#8a6845', '#5c4328'], ['#443626', '#2f2417'],
];
function FillerSpine({ seed, stageH }: { seed: number; stageH: number }) {
  const tone = FILLER_TONES[seed % FILLER_TONES.length];
  const h = stageH * (0.098 + ((seed * 37) % 31) / 1000 * 2.2);
  const w = Math.max(15, stageH * 0.016 + ((seed * 53) % 13));
  const lean = ((seed * 29) % 9) === 0 ? (((seed * 13) % 2) ? 4 : -4) : 0;
  return (
    <span className="spine filler" aria-hidden
      style={{
        height: h, width: w,
        background: `linear-gradient(90deg, ${tone[1]} 0%, ${tone[0]} 20%, ${tone[0]} 80%, ${tone[1]} 100%)`,
        transform: lean ? `rotate(${lean}deg)` : undefined,
      }}>
      <span className="spine-band dim" />
      <span className="spine-band dim spine-band-bottom" />
    </span>
  );
}
const FILLER_PER_SHELF = 24;

function FocusView({ book, onClose }: { book: Book; onClose: () => void }) {
  const { mutateBook, showToast } = useStore();
  const [dashing, setDashing] = useState(false);

  function sendToDesk() {
    if (dashing) return;
    setDashing(true);
    setTimeout(() => {
      mutateBook(book.id, (b) => { b.lastOpenedAt = Date.now(); });
      showToast(`“${book.title}” is on your desk`);
      onClose();
    }, 620);
  }

  return (
    <div className="focus-scrim" onClick={onClose}>
      <div className="focus-stage" onClick={(e) => e.stopPropagation()}>
        <div className={`focus-book ${dashing ? 'dash' : ''}`}>
          <Book3D book={book} width={318} onClick={sendToDesk} />
          <p className="focus-hint">{dashing ? '' : 'click the book to place it on your desk'}</p>
        </div>
        <FocusPanel book={book} onClose={onClose} />
      </div>
    </div>
  );
}

export function Library({ onSettings }: { onSettings: () => void }) {
  const { books, openBook, setView, ready, focusBookId, setFocusBook, settings } = useStore();
  const stageRef = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState({ w: 1600, h: 893 });
  const [shelfPage, setShelfPage] = useState(0);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setStage({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setStage({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const deskBook = useMemo(() => {
    if (books.length === 0) return null;
    return [...books].sort((a, b) => (b.lastOpenedAt ?? b.updatedAt) - (a.lastOpenedAt ?? a.updatedAt))[0];
  }, [books]);

  // every book lives on the shelf — the desk copy is just the one you're reading
  const shelfBooks = [...books].sort((a, b) => a.createdAt - b.createdAt);
  const perWall = PER_SHELF * 3;
  const pageCount = Math.max(1, Math.ceil(shelfBooks.length / perWall));
  const pageSafe = Math.min(shelfPage, pageCount - 1);
  const wall = shelfBooks.slice(pageSafe * perWall, (pageSafe + 1) * perWall);
  const rows: Book[][] = [[], [], []];
  wall.forEach((b, i) => rows[Math.floor(i / PER_SHELF)]?.push(b));

  const focused = books.find((b) => b.id === focusBookId) ?? null;
  const live = ai.isLive(settings);

  return (
    <div className="study">
      <header className="study-bar">
        <div className="study-brand">
          <svg className="pangea-mark" viewBox="0 0 64 64" width="34" height="34" aria-hidden>
            <defs><radialGradient id="pgg" cx="38%" cy="32%" r="80%"><stop offset="0%" stopColor="#2e6e5e" /><stop offset="100%" stopColor="#143830" /></radialGradient></defs>
            <circle cx="32" cy="32" r="30" fill="url(#pgg)" stroke="#e8c574" strokeWidth="2.5" />
            <ellipse cx="32" cy="32" rx="14" ry="30" fill="none" stroke="#e8c574" strokeWidth="1.2" opacity=".55" />
            <ellipse cx="32" cy="32" rx="26" ry="30" fill="none" stroke="#e8c574" strokeWidth="1" opacity=".35" />
            <path d="M4 32h56M8 18h48M8 46h48" stroke="#e8c574" strokeWidth="1.1" opacity=".45" />
            <path d="M20 24q6-7 13-4t9 8q-2 8-10 9t-13-4q-2-5 1-9z" fill="#e8c574" opacity=".92" />
          </svg>
          <span>Pangea</span>
          <em className="brand-tag">where every world begins</em>
        </div>
        <div className="lib-actions">
          <button className={`mode-badge ${live ? 'live' : 'demo'}`} onClick={onSettings}
            title={live ? `Gemini connected (${settings.textModel})` : 'Running in demo mode — click to add your Gemini key'}>
            {live ? '● Live — Gemini' : '◌ Demo mode — add key'}
          </button>
          <button className="btn btn-ghost" onClick={onSettings}>⚙ Settings</button>
        </div>
      </header>

      {!ready && <div className="lib-loading">Lighting the lamps…</div>}

      <div className="stage-wrap">
        <div className="stage" ref={stageRef}>
          <img className="stage-bg" src={studyBg} alt="" draggable={false} />

          {/* shelf rows in the empty bookcase section */}
          {rows.map((row, i) => (
            <div className="shelf-row" key={i}
              style={{ left: `${SHELF_X}%`, width: `${SHELF_W}%`, bottom: `${SHELF_BOTTOMS[i]}%` }}>
              {row.map((b) => <ShelfSpine key={b.id} book={b} stageH={stage.h} onFocus={() => setFocusBook(b.id)} />)}
              {Array.from({ length: Math.max(0, FILLER_PER_SHELF - row.length * 2) }, (_, j) => (
                <FillerSpine key={`f${i}-${j}`} seed={i * 31 + j * 7 + 3} stageH={stage.h} />
              ))}
            </div>
          ))}

          {/* shelf paging */}
          {pageCount > 1 && (
            <>
              <button className="shelf-arrow left" style={{ bottom: `${SHELF_BOTTOMS[1] + 2}%`, left: `${SHELF_X - 3.6}%` }}
                disabled={pageSafe === 0} onClick={() => setShelfPage((p) => Math.max(0, p - 1))}>‹</button>
              <button className="shelf-arrow right" style={{ bottom: `${SHELF_BOTTOMS[1] + 2}%`, left: `${SHELF_X + SHELF_W + 1.2}%` }}
                disabled={pageSafe >= pageCount - 1} onClick={() => setShelfPage((p) => Math.min(pageCount - 1, p + 1))}>›</button>
            </>
          )}

          {/* the book on the desk */}
          {deskBook && (
            <div className="desk-book" style={{ left: '45.8%', bottom: '26%' }}
              onClick={() => openBook(deskBook.id)} title={`Open “${deskBook.title}”`}>
              <Book3D book={deskBook} width={Math.max(96, stage.w * 0.082)} lying />
              <span className="desk-book-label" style={{ fontSize: Math.max(12, stage.h * 0.019) }}>{deskBook.title} — open me</span>
            </div>
          )}

          {/* new book journal on the desk */}
          <button className="journal" style={{ left: '61.5%', bottom: '25%', width: Math.max(58, stage.w * 0.046), height: Math.max(40, stage.w * 0.032) }}
            onClick={() => setView('newBook')} title="Begin a new book">
            <span className="journal-cover">+</span>
            <span className="journal-label">new book</span>
          </button>
        </div>
      </div>

      <footer className="lib-foot study-foot">
        <span>Local-first · your books never leave this device · bring your own Gemini key</span>
      </footer>

      {focused && <FocusView book={focused} onClose={() => setFocusBook(null)} />}
    </div>
  );
}
