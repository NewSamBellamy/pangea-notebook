/**
 * The physical book, rendered as HTML/CSS 3D (no WebGL — see the thread
 * history for a Three.js experiment that was tried and reverted). Used
 * everywhere a book needs to look real: the study desk, the focus view,
 * and (lying flat) the desk-copy slot. AI cover art + a typographic
 * template (title/subtitle/author) are composited via layered divs so the
 * "spine"/"face"/"pages" always stay physically consistent regardless of
 * cover art content. Title sizing auto-fits and civilizes ALL CAPS titles.
 */

import React from 'react';
import type { Book } from '../types';
import { PALETTES, SPINE_FONTS } from '../store';

/**
 * A physical book: AI cover artwork under a consistent typographic template
 * (title plate, rules, author line), with spine and page-block for depth.
 * width drives all proportions; the cover keeps a 3:4 ratio.
 */
export function Book3D({ book, width, lying = false, onClick, className = '' }: {
  book: Book;
  width: number;
  lying?: boolean;
  onClick?: () => void;
  className?: string;
}) {
  const pal = PALETTES[book.palette % PALETTES.length];
  const font = SPINE_FONTS[book.font % SPINE_FONTS.length];
  const h = Math.round(width * 4 / 3);
  const depth = Math.max(14, Math.round(width * 0.09));
  // Long titles shrink to fit the plate; shouty ALL-CAPS titles get civilized.
  const rawTitle = book.title.trim();
  const isAllCaps = rawTitle.length > 12 && rawTitle === rawTitle.toUpperCase() && /[A-Z]/.test(rawTitle);
  const title = isAllCaps
    ? rawTitle.toLowerCase().replace(/(^|[\s—:-])(\p{L})/gu, (m, pre, ch) => pre + ch.toUpperCase())
    : rawTitle;
  const titleSize = Math.round(width * Math.min(0.092, Math.max(0.05, 1.35 / Math.max(8, title.length))));

  return (
    <div
      className={`book3d ${lying ? 'lying' : ''} ${className}`}
      style={{ width, height: h, ['--depth' as string]: `${depth}px` }}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      title={book.title}
    >
      <div className="book3d-pages" />
      <div className="book3d-spine" style={{ background: `linear-gradient(180deg, ${pal.spine}, ${pal.spine2})` }}>
        <span style={{ color: pal.ink, fontFamily: font }}>{title}</span>
      </div>
      <div className="book3d-face" style={{ background: `linear-gradient(160deg, ${pal.spine} 0%, ${pal.spine2} 100%)` }}>
        {book.coverImage && <img className="book3d-art" src={book.coverImage} alt="" draggable={false} />}
        <div className="book3d-scrim" />
        <div className="book3d-frame" style={{ borderColor: pal.accent }} />
        <div className="book3d-plate">
          <span className="book3d-orn" style={{ color: pal.accent }}>❦</span>
          <h2 style={{ fontFamily: font, color: pal.ink, fontSize: titleSize }}>{title}</h2>
          {book.subtitle && width > 150 && <p className="book3d-sub" style={{ color: pal.accent }}>{book.subtitle}</p>}
          {book.author && width > 150 && <p className="book3d-author" style={{ color: pal.ink }}>{book.author}</p>}
        </div>
        <div className="book3d-gloss" />
      </div>
    </div>
  );
}
