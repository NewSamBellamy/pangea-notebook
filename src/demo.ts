/**
 * Offline "demo brain" — everything the app needs to feel alive with ZERO
 * network access and NO API key. Used automatically by src/ai.ts whenever
 * `isLive(settings)` is false, and to seed the very first book a new user
 * sees (`makeDemoBook` → "The Argo Protocol").
 *
 * Two halves:
 * 1. Procedural "engraved plate" art (`makePlate`, `placeholderImage`,
 *    `makeCoverArt`) — hand-built SVG illustrations (ship/black-hole/
 *    city/skull/map/crew motifs) so pages and covers never show a broken
 *    image or an obvious placeholder box, even with no Gemini key.
 * 2. Scripted responses (`demoOutline`, `demoDraftPage`, `demoChat`,
 *    `demoBrainDump`, `demoAudit`, `demoResearch`, `demoInterview`) that
 *    mimic the shape of the real Gemini replies closely enough that the UI
 *    code paths (canvas updates, action parsing, logs, assets) all still
 *    exercise correctly offline. These are intentionally simple — the
 *    point is a believable demo, not a second AI.
 */

import type {
  AgentAction, Block, Book, BrainDumpAssignment, ChatResult, OutlineResult, Page, TranscriptSeg, Annotation,
} from './types';
import { uid } from './types';

// =====================================================================
// Procedural "engraved plate" illustrations — beautiful offline images
// =====================================================================

type PlateKind = 'ship' | 'blackhole' | 'city' | 'skull' | 'map' | 'crew';

const PLATE_PALETTES = [
  { bg1: '#0b1524', bg2: '#1d3a5f', ink: '#e8d5a3', glow: '#f0b35c' },
  { bg1: '#160f26', bg2: '#3d2a63', ink: '#e0d0f0', glow: '#b78aff' },
  { bg1: '#0c1f1a', bg2: '#1e4a3a', ink: '#d9e8c8', glow: '#8fd0a0' },
  { bg1: '#241010', bg2: '#5f1d2a', ink: '#f0d8c8', glow: '#ff9a6c' },
];

function stars(seed: number, n: number): string {
  let s = '';
  let x = seed * 9973;
  const rnd = () => {
    x = (x * 16807) % 2147483647;
    return (x % 1000) / 1000;
  };
  for (let i = 0; i < n; i++) {
    s += `<circle cx="${(rnd() * 760 + 20).toFixed(0)}" cy="${(rnd() * 300 + 20).toFixed(0)}" r="${(rnd() * 1.4 + 0.4).toFixed(1)}" fill="white" opacity="${(rnd() * 0.6 + 0.2).toFixed(2)}"/>`;
  }
  return s;
}

const MOTIFS: Record<PlateKind, (p: typeof PLATE_PALETTES[0]) => string> = {
  ship: (p) => `
    <g stroke="${p.ink}" fill="none" stroke-width="3">
      <path d="M180 380 Q400 440 620 380 L590 340 L210 340 Z" fill="${p.ink}" opacity="0.9"/>
      <line x1="400" y1="340" x2="400" y2="130"/>
      <line x1="310" y1="340" x2="310" y2="190"/>
      <line x1="490" y1="340" x2="490" y2="190"/>
      <path d="M400 135 Q330 175 400 230 Q470 175 400 135 Z" fill="${p.ink}" opacity="0.75"/>
      <path d="M310 195 Q265 225 310 260 Q355 225 310 195 Z" fill="${p.ink}" opacity="0.6"/>
      <path d="M490 195 Q445 225 490 260 Q535 225 490 195 Z" fill="${p.ink}" opacity="0.6"/>
      <path d="M400 128 L400 100 L448 114 Z" fill="${p.glow}"/>
    </g>
    <path d="M60 400 Q140 380 220 400 T380 400 T540 400 T700 400 T780 398" stroke="${p.ink}" fill="none" stroke-width="2.5" opacity="0.7"/>
    <path d="M40 425 Q130 408 220 425 T400 425 T580 425 T760 425" stroke="${p.ink}" fill="none" stroke-width="2" opacity="0.4"/>`,
  blackhole: (p) => `
    <g fill="none">
      <ellipse cx="400" cy="250" rx="230" ry="70" stroke="${p.glow}" stroke-width="5" opacity="0.9"/>
      <ellipse cx="400" cy="250" rx="175" ry="50" stroke="${p.ink}" stroke-width="3" opacity="0.7"/>
      <ellipse cx="400" cy="250" rx="120" ry="32" stroke="${p.glow}" stroke-width="2.5" opacity="0.8"/>
      <circle cx="400" cy="250" r="58" fill="#000"/>
      <circle cx="400" cy="250" r="60" stroke="${p.glow}" stroke-width="4"/>
      <path d="M120 150 Q260 190 340 225" stroke="${p.ink}" stroke-width="2" opacity="0.5"/>
      <path d="M680 360 Q540 315 462 278" stroke="${p.ink}" stroke-width="2" opacity="0.5"/>
      <g stroke="${p.ink}" fill="${p.ink}" stroke-width="1.5" opacity="0.85" transform="translate(185,140) scale(0.35) rotate(-14)">
        <path d="M0 200 Q120 235 240 200 L220 175 L20 175 Z"/>
        <line x1="120" y1="175" x2="120" y2="60" stroke-width="6"/>
        <path d="M120 62 Q75 95 120 135 Q165 95 120 62 Z"/>
      </g>
    </g>`,
  city: (p) => `
    <g fill="${p.ink}">
      <rect x="120" y="240" width="46" height="180" opacity="0.85"/>
      <rect x="180" y="190" width="58" height="230" opacity="0.95"/>
      <path d="M262 420 L262 250 L288 160 L314 250 L314 420 Z"/>
      <rect x="330" y="215" width="50" height="205" opacity="0.9"/>
      <rect x="394" y="170" width="64" height="250"/>
      <rect x="472" y="230" width="44" height="190" opacity="0.85"/>
      <path d="M530 420 L530 260 L560 200 L590 260 L590 420 Z" opacity="0.9"/>
      <rect x="604" y="280" width="52" height="140" opacity="0.8"/>
    </g>
    <g stroke="${p.glow}" stroke-width="2" opacity="0.9">
      ${[0, 1, 2, 3, 4, 5].map((i) => `<line x1="${200 + i * 44}" y1="${205 + (i % 3) * 30}" x2="${200 + i * 44}" y2="${215 + (i % 3) * 30}"/>`).join('')}
    </g>
    <path d="M60 130 Q200 60 400 95 Q600 128 740 80" stroke="${p.glow}" stroke-width="3" fill="none" opacity="0.6" stroke-dasharray="2 10"/>`,
  skull: (p) => `
    <g stroke="${p.ink}" fill="none" stroke-width="4">
      <path d="M400 130 Q310 130 300 225 Q297 275 330 300 L330 340 Q330 360 350 360 L450 360 Q470 360 470 340 L470 300 Q503 275 500 225 Q490 130 400 130 Z" fill="${p.ink}" opacity="0.15"/>
      <circle cx="362" cy="235" r="26" fill="${p.bg1}" stroke="${p.ink}"/>
      <circle cx="438" cy="235" r="26" fill="${p.bg1}" stroke="${p.ink}"/>
      <path d="M400 265 L385 300 L415 300 Z" fill="${p.ink}"/>
      <line x1="285" y1="395" x2="515" y2="330" stroke-width="9" stroke-linecap="round"/>
      <line x1="285" y1="330" x2="515" y2="395" stroke-width="9" stroke-linecap="round"/>
    </g>
    <path d="M330 105 Q400 75 470 105" stroke="${p.glow}" stroke-width="3" fill="none" opacity="0.8"/>`,
  map: (p) => `
    <g stroke="${p.ink}" fill="none" stroke-width="2.5">
      <path d="M150 180 Q230 120 330 165 Q420 200 500 150 Q590 105 650 170 Q690 220 640 280 Q600 330 640 380" opacity="0.8" stroke-dasharray="8 8"/>
      <circle cx="150" cy="180" r="9" fill="${p.glow}" stroke="none"/>
      <circle cx="640" cy="380" r="9" fill="${p.glow}" stroke="none"/>
      <path d="M120 300 Q160 270 210 295 Q250 315 235 350 Q210 385 160 365 Q115 345 120 300 Z" opacity="0.6"/>
      <path d="M480 280 Q530 255 575 285 Q600 305 585 335 Q555 365 505 345 Q470 320 480 280 Z" opacity="0.6"/>
      <g transform="translate(400,250)">
        <circle r="34"/>
        <line x1="0" y1="-46" x2="0" y2="46"/>
        <line x1="-46" y1="0" x2="46" y2="0"/>
        <path d="M0 -34 L8 0 L0 34 L-8 0 Z" fill="${p.glow}" stroke="none"/>
      </g>
    </g>`,
  crew: (p) => `
    <g fill="${p.ink}">
      ${[-160, -80, 0, 80, 160].map((dx, i) => `
        <g transform="translate(${400 + dx},${292 - (i === 2 ? 26 : 0)})">
          <circle cy="-64" r="${i === 2 ? 26 : 21}" opacity="0.95"/>
          <path d="M-30 70 Q-30 -34 0 -34 Q30 -34 30 70 Z" opacity="0.85"/>
        </g>`).join('')}
    </g>
    <path d="M240 118 L560 118" stroke="${p.glow}" stroke-width="3" stroke-dasharray="3 9" opacity="0.8"/>`,
};

export function makePlate(kind: PlateKind, caption: string, paletteIdx = 0, seed = 7): string {
  const p = PLATE_PALETTES[paletteIdx % PLATE_PALETTES.length];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500" viewBox="0 0 800 500">
    <defs>
      <radialGradient id="g" cx="50%" cy="38%" r="80%">
        <stop offset="0%" stop-color="${p.bg2}"/><stop offset="100%" stop-color="${p.bg1}"/>
      </radialGradient>
    </defs>
    <rect width="800" height="500" fill="url(#g)"/>
    ${stars(seed, 46)}
    ${MOTIFS[kind](p)}
    <rect x="14" y="14" width="772" height="472" fill="none" stroke="${p.ink}" stroke-width="1.5" opacity="0.5"/>
    <rect x="22" y="22" width="756" height="456" fill="none" stroke="${p.ink}" stroke-width="0.75" opacity="0.35"/>
    <text x="400" y="462" text-anchor="middle" font-family="Georgia, serif" font-style="italic" font-size="19" fill="${p.ink}" opacity="0.9">${caption.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</text>
  </svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** Portrait (3:4) textless cover artwork — offline stand-in for AI cover generation. */
export function makeCoverArt(hint: string, paletteIdx = 0, seedExtra = 0): string {
  const p = PLATE_PALETTES[paletteIdx % PLATE_PALETTES.length];
  const kind = pickKind(hint);
  const seed = hint.length * 17 + 3 + seedExtra;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1067" viewBox="0 0 800 1067">
    <defs>
      <radialGradient id="cg" cx="50%" cy="30%" r="95%">
        <stop offset="0%" stop-color="${p.bg2}"/><stop offset="100%" stop-color="${p.bg1}"/>
      </radialGradient>
      <linearGradient id="cv" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${p.glow}" stop-opacity="0.14"/><stop offset="55%" stop-color="${p.bg1}" stop-opacity="0"/>
      </linearGradient>
    </defs>
    <rect width="800" height="1067" fill="url(#cg)"/>
    <rect width="800" height="1067" fill="url(#cv)"/>
    ${stars(seed, 70)}
    <circle cx="400" cy="300" r="150" fill="none" stroke="${p.glow}" stroke-width="1.5" opacity="0.5"/>
    <circle cx="400" cy="300" r="190" fill="none" stroke="${p.ink}" stroke-width="0.8" opacity="0.3"/>
    <g transform="translate(0,190) scale(1,1.05)">${MOTIFS[kind](p)}</g>
    <path d="M60 940 Q200 905 400 925 Q600 945 740 910" stroke="${p.ink}" fill="none" stroke-width="2" opacity="0.4"/>
  </svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function pickKind(hint: string): PlateKind {
  const h = hint.toLowerCase();
  if (/hole|portal|vortex|time|space|wormhole/.test(h)) return 'blackhole';
  if (/city|francisco|office|skyline|street|company|startup|bridge/.test(h)) return 'city';
  if (/skull|death|dead|flag|jolly|bone/.test(h)) return 'skull';
  if (/map|route|journey|chart|course|plan/.test(h)) return 'map';
  if (/crew|character|cast|team|founder|portrait/.test(h)) return 'crew';
  return 'ship';
}

export function placeholderImage(prompt: string, caption: string, paletteIdx = 0): string {
  return makePlate(pickKind(prompt), caption || 'Plate', paletteIdx, prompt.length * 31 + 7);
}

// =====================================================================
// Seeded demo book — "The Argo Protocol"
// =====================================================================

const P = (text: string): Block => ({ id: uid(), type: 'paragraph', text });
const H = (text: string): Block => ({ id: uid(), type: 'heading', text });
const Q = (text: string): Block => ({ id: uid(), type: 'quote', text });
const L = (items: string[]): Block => ({ id: uid(), type: 'list', items });
const IMG = (kind: PlateKind, caption: string, prompt: string, pal = 0): Block => ({
  id: uid(), type: 'image', imagePrompt: prompt, caption, imageData: makePlate(kind, caption, pal, prompt.length),
});

interface SeedPage {
  chapter: string;
  title: string;
  summary: string;
  blocks?: Block[];
}

const SEED_PAGES: SeedPage[] = [
  {
    chapter: 'Part I — The Vision',
    title: 'The Premise',
    summary: 'The one-page soul of the film: dead pirates, a second chance, and a startup at the end of time.',
    blocks: [
      H('The Premise'),
      P('They died the way pirates are supposed to die — loudly, at sea, owing everybody money. And then the sea gave them a second chance. The crew of the Argo wakes on their own ship, sails intact, sins intact, and a horizon that refuses to stay in one century.'),
      Q('One Piece meets Silicon Valley: a found family of magnificent idiots who conquered the ocean, now trying to conquer the term sheet.'),
      P('When the Argo runs the throat of a black hole — half portal, half judgment — it surfaces in San Francisco Bay, present day. The crew does what pirates have always done with a new world: they claim it. Except the treasure here isn’t gold. It’s equity. They incorporate. They ship software the way they used to ship contraband: fast, reckless, and impossible to ignore.'),
      IMG('ship', 'The Argo, one heartbeat after the second chance', 'A ghostly pirate ship with golden light in its sails on a dark sea under strange stars, engraved storybook style'),
      P('The film is 100% AI-made — every frame, every voice, every note of score. The book you are holding is its single source of truth: world, characters, look, pipeline, and plan, kept alive as the project evolves.'),
    ],
  },
  {
    chapter: 'Part I — The Vision',
    title: 'Themes & Tone',
    summary: 'What the film is actually about beneath the jokes: reinvention, loyalty, and what a second life is for.',
    blocks: [
      H('Themes & Tone'),
      P('The comedy is the hull; the theme is the cargo. This is a story about reinvention — about whether men who were monsters in one economy can be decent in another, and whether ambition is a curse you carry across centuries or a tool you finally learn to hold correctly.'),
      L([
        'Second chances are earned twice — once when given, once when used.',
        'A crew is a company is a family: loyalty is the only currency that survives time travel.',
        'The frontier never closes; it just changes clothes.',
      ]),
      P('Tone target: the warmth and absurd escalation of One Piece, sanded with the deadpan procedural satire of Silicon Valley. Sincerity always wins the final beat of a scene. We are never laughing at the crew’s dream — only at everything standing between them and it.'),
      IMG('map', 'Tone chart — sincerity bearing true north', 'An antique nautical chart whose compass rose points between comedy and heart', 2),
    ],
  },
  {
    chapter: 'Part II — World & Cast',
    title: 'The Crew of the Argo',
    summary: 'The five core characters: captain, quartermaster, navigator, gunner, cook — and who they become in SF.',
    blocks: [
      H('The Crew of the Argo'),
      IMG('crew', 'Five sinners, one cap table', 'Five pirate silhouettes standing in a line like founders on a pitch stage, engraved style', 1),
      P('CAPTAIN ELIAS VANE — died believing legends outlive ledgers. In San Francisco he becomes the CEO: magnetic, allergic to small plans, negotiates a seed round like a boarding action. His arc: learning that a captain who cannot apologize sinks twice.'),
      P('QUARTERMASTER OKORO — the ship’s conscience and its spreadsheet. Becomes COO/CFO; the only one who reads the contracts, which is how they keep the company. Deadpan king of the film.'),
      P('NAVIGATOR SUNI — read stars, now reads systems; the black hole spoke to her and she’s not saying what it said. CTO. Her subplot carries the mystery engine of the finale.'),
      P('GUNNER BRIGGS & COOK MARISOL — growth and culture, respectively. Briggs A/B tests like he used to sight cannons. Marisol’s test kitchen becomes the office everyone actually works in. Together they are the beating heart of the "crew as family" theme.'),
    ],
  },
  {
    chapter: 'Part II — World & Cast',
    title: 'The Black Hole Passage',
    summary: 'Rules of the portal: what it costs, what it changes, and the mystery it leaves ticking.',
    blocks: [
      H('The Black Hole Passage'),
      P('The passage is not free. Each crew member surfaces missing one thing — a scar, a memory, a name — and carrying one thing they didn’t have before. The film never over-explains this; the audit of what was taken and given IS the character work of Act Two.'),
      IMG('blackhole', 'The throat of the portal — the Argo threading judgment', 'A tiny pirate ship silhouetted against a vast glowing black hole accretion disk, awe and terror, engraved cosmic style', 1),
      Q('The sea forgives nothing. The sky forgives once.'),
      L([
        'Rule 1: The portal opens only for the truly finished — you must have died complete.',
        'Rule 2: Time flows forward on the far side; there is no going back to warn anyone.',
        'Rule 3: Something followed them through. (Reveal held for Act Three.)',
      ]),
    ],
  },
  {
    chapter: 'Part III — The Story',
    title: 'Act Structure',
    summary: 'The three-act spine with mid-point reversal and the finale’s double climax (demo raise + storm).',
    blocks: [
      H('Act Structure'),
      P('ACT ONE (0–25): Death at sea, the waking, the passage, the arrival. Ends on the image of the Argo anchored under the Golden Gate while the crew reads a billboard: "MOVE FAST. BREAK THINGS." Vane grins: "Finally. Natives who speak pirate."'),
      P('ACT TWO (25–75): Incorporation as conquest. They found ARGO — a logistics platform, because moving cargo is the one thing they truly know. Rise, hubris, betrayal by their lead investor (a man Vane recognizes from a previous century — the thing that followed them through). Mid-point reversal: the company IS the new Argo, and Vane is captaining it straight into a reef.'),
      P('ACT THREE (75–100): The double climax — a make-or-break demo day intercut with a literal storm over the Bay as the portal reopens. The crew chooses: sail back to the legend, or stay and finish what they started. They stay. The Argo sails home empty, flag flying, as the term sheet signs.'),
      IMG('city', 'Act Three — the storm over demo day', 'San Francisco skyline under a supernatural storm, golden lightning, a pirate ship in the bay, cinematic engraved style', 3),
    ],
  },
  { chapter: 'Part III — The Story', title: 'Scene Index — Act One', summary: 'Every Act One scene as a card: location, beat, image cue, and the joke or wound it must land.' },
  { chapter: 'Part III — The Story', title: 'Scene Index — Acts Two & Three', summary: 'Continuing scene cards with escalation tracking and callbacks ledger.' },
  { chapter: 'Part IV — The Look', title: 'Visual Identity', summary: 'The style bible: engraved-storybook meets neon-fog SF; palette, lensing, and era-blend rules.' },
  { chapter: 'Part IV — The Look', title: 'Character Design Sheets', summary: 'Canonical reference prompts per character so every AI generation stays on-model.' },
  { chapter: 'Part IV — The Look', title: 'Key Frames & Shot Design', summary: 'The 12 images the whole film is sold on; composition notes and generation prompts.' },
  { chapter: 'Part IV — The Look', title: 'Sound & Score', summary: 'Sea shanties arranged for synthesizers; voice casting rules for AI performance.' },
  { chapter: 'Part V — The Build', title: 'AI Production Pipeline', summary: 'Model choices per department (image, video, voice, score), handoffs, and quality gates.' },
  { chapter: 'Part V — The Build', title: 'Consistency System', summary: 'How characters, sets, and props stay identical across hundreds of generations.' },
  { chapter: 'Part V — The Build', title: 'Production Schedule', summary: 'Milestones from animatic to final cut, with weekly deliverables.' },
  { chapter: 'Part V — The Build', title: 'Risks & Open Questions', summary: 'Everything unresolved, ranked by how badly it can sink the ship.' },
  { chapter: 'Part V — The Build', title: 'The Pitch', summary: 'The one-page pitch: logline, poster frame, comparables, and the ask.' },
];

export function makeDemoBook(): Book {
  const pages: Page[] = SEED_PAGES.map((s) => ({
    id: uid(),
    chapter: s.chapter,
    title: s.title,
    summary: s.summary,
    blocks: s.blocks ?? [],
    annotations: [],
    drafted: !!s.blocks,
  }));
  const now = Date.now();
  const book: Book = {
    id: 'demo-argo',
    title: 'The Argo Protocol',
    subtitle: 'Dead pirates. Second chances. Series A.',
    author: 'Demo voyage',
    palette: 0,
    font: 0,
    createdAt: now,
    updatedAt: now,
    lastOpenedAt: now,
    tokensSpent: 0,
    coverPrompt: 'A ghostly pirate ship sailing out of a glowing black hole toward a distant golden city skyline, engraved storybook style',
    coverImage: makeCoverArt('ship black hole city pirates', 0),
    plan: {
      prompt:
        'A film made 100% with AI about pirates who die and get a second chance. They board the Argo and sail through time — through a black hole portal into today’s world — land in San Francisco, and start a software company.',
      vibe: 'One Piece × Silicon Valley',
    },
    pages,
    notes: [],
    bookChat: [],
    pageChats: {},
    demo: true,
  };
  const p4 = pages[3];
  book.notes.push({
    id: uid(), pageId: p4.id, resolved: false, createdAt: now,
    text: 'Decide what Vane lost in the passage — it should pay off in the demo-day scene.',
  });
  const p8 = pages[7];
  book.notes.push({
    id: uid(), pageId: p8.id, resolved: false, createdAt: now,
    text: 'Test the neon-fog palette against the engraved style — might clash. Need side-by-side.',
  });
  return book;
}

// =====================================================================
// Offline "demo brain" — used when no API key is configured
// =====================================================================

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function demoOutline(planPrompt: string): Promise<OutlineResult> {
  await delay(1400);
  const short = planPrompt.split(/[.!?]/)[0].trim().slice(0, 80);
  return {
    title: short.length > 40 ? 'The New Project' : short || 'The New Project',
    subtitle: 'A living project book',
    coverArt: planPrompt.slice(0, 140),
    pages: [
      { chapter: 'Part I — The Vision', title: 'The Premise', summary: `The one-page soul of the project: ${short}.`, imageIdeas: ['hero image of the core idea'] },
      { chapter: 'Part I — The Vision', title: 'Themes & Tone', summary: 'What it is really about, and the emotional register it must hit.', imageIdeas: ['tone moodboard'] },
      { chapter: 'Part II — World & Cast', title: 'Characters / Key Players', summary: 'Who drives this story or project, and what each one wants.', imageIdeas: ['cast lineup'] },
      { chapter: 'Part II — World & Cast', title: 'The World & Its Rules', summary: 'The setting, constraints, and the rules that create drama.', imageIdeas: ['world establishing shot'] },
      { chapter: 'Part III — The Story', title: 'Structure', summary: 'The spine: acts, milestones, reversals.', imageIdeas: ['structure diagram'] },
      { chapter: 'Part III — The Story', title: 'Scene / Section Index', summary: 'Every unit of the work as a card with its job to do.', imageIdeas: [] },
      { chapter: 'Part IV — The Look', title: 'Visual Identity', summary: 'Style bible: palette, composition, references.', imageIdeas: ['style plate'] },
      { chapter: 'Part IV — The Look', title: 'Key Frames', summary: 'The images the whole project is sold on.', imageIdeas: ['key frame set'] },
      { chapter: 'Part V — The Build', title: 'Production Pipeline', summary: 'Tools, handoffs, and quality gates.', imageIdeas: [] },
      { chapter: 'Part V — The Build', title: 'Schedule & Milestones', summary: 'From first draft to done, week by week.', imageIdeas: [] },
      { chapter: 'Part V — The Build', title: 'Risks & Open Questions', summary: 'Everything unresolved, ranked by danger.', imageIdeas: [] },
      { chapter: 'Part V — The Build', title: 'The Pitch', summary: 'One page that sells it: logline, poster, ask.', imageIdeas: ['poster frame'] },
    ],
  };
}

export async function demoDraftPage(page: Page, paletteIdx: number): Promise<Block[]> {
  await delay(1200);
  return [
    H(page.title),
    P(`${page.summary} This draft was written in demo mode — plug in a Gemini API key in Settings and the agent will write this page for real, with full knowledge of the whole book.`),
    Q('Demo ink: every block here is editable through conversation — ask the agent to rewrite, expand, or restructure.'),
    IMG(pickKind(page.title + page.summary), page.title, page.summary, paletteIdx),
    P('Try the red pen: right-click anywhere on this page to open the tool ring, mark something up, then start a Read Session and talk through your edits out loud.'),
  ];
}

export async function demoChat(userText: string, page: Page | null): Promise<ChatResult> {
  await delay(900);
  const wantsChange = /\b(add|change|rewrite|make|update|remove|cut|replace|insert|write|expand|shorten|fix)\b/i.test(userText);
  if (wantsChange && page) {
    const newBlocks: Block[] = [...page.blocks, P(`✎ ${userText.trim().replace(/^./, (c) => c.toUpperCase())} — drafted into the canvas by the demo agent. With a real API key, this becomes a fully written, context-aware revision.`)];
    const actions: AgentAction[] = [{ action: 'update_page', pageId: page.id, blocks: newBlocks }];
    return { text: 'Done — I’ve drafted that onto the canvas (demo mode: with a Gemini key I’d weave it in properly, matching the page’s voice and restructuring where needed).', actions };
  }
  return {
    text: page
      ? `Good thread to pull. On "${page.title}", the strongest move is to make every element earn its place against the book’s spine — the premise and themes in Part I. Ask me to make a change ("add...", "rewrite...") and I’ll draft it straight onto the canvas. (Demo mode — add a Gemini key in Settings for the real editor-in-residence.)`
      : 'I’m listening at the book level — overarching ideas, structure changes, or notes to drop on specific pages. In demo mode I can apply simple changes; with a Gemini key I can revise any page in the book from here.',
    actions: [],
  };
}

export async function demoBrainDump(book: Book, dump: string): Promise<BrainDumpAssignment[]> {
  await delay(1100);
  const lines = dump.split(/\n+/).map((l) => l.trim()).filter((l) => l.length > 3);
  return lines.map((line, i) => {
    const lower = line.toLowerCase();
    let target = book.pages[i % book.pages.length];
    for (const p of book.pages) {
      const keys = (p.title + ' ' + p.summary).toLowerCase().split(/\W+/).filter((w) => w.length > 4);
      if (keys.some((k) => lower.includes(k))) { target = p; break; }
    }
    return { pageId: target.id, pageTitle: target.title, noteText: line };
  });
}

export async function demoResearch(userText: string, deep: boolean): Promise<{ text: string; sources: { title: string; uri: string }[] }> {
  await delay(1000);
  return {
    text: deep
      ? `Deep research (demo): with a Gemini key this runs a full Google-grounded investigation of "${userText.slice(0, 80)}" on the pro model and files a structured report into your Assets tab. In demo mode, imagine three crisp sections and a "what this means for your project" close.`
      : `Research desk (demo): with a Gemini key I'd hit Google Search live for "${userText.slice(0, 80)}" and come back with current facts, comparisons, and sources. This room is for thinking — the Scribe tab is where the page actually changes.`,
    sources: [],
  };
}

export async function demoAudit(page: Page, annotations: Annotation[], transcript: TranscriptSeg[], extraNote?: string): Promise<ChatResult> {
  await delay(1300);
  const said = (transcript.map((t) => t.text).join(' ').trim() + ' ' + (extraNote ?? '')).trim();
  const summary = `Read session captured: ${annotations.length} annotation${annotations.length === 1 ? '' : 's'}${said ? `, voice synced ("${said.slice(0, 90)}${said.length > 90 ? '…' : ''}")` : ''}. In demo mode I log the audit; with a Gemini key I’d revise the page from your ink + voice and show you the rewrite.`;
  const blocks: Block[] = [...page.blocks, Q(`Audit note — ${new Date().toLocaleTimeString()}: ${said || annotations.map((a) => a.tool).join(', ') || 'read-through complete'}`)];
  return { text: summary, actions: [{ action: 'update_page', pageId: page.id, blocks }] };
}

export async function demoInterview(prompt: string): Promise<string[]> {
  await delay(700);
  return [
    'Who is this for, and what should they feel when it’s over?',
    'What are your two or three reference works, and what exactly are you taking from each?',
    'What’s the single image or moment the whole project is sold on?',
    'What constraints are fixed (budget, tools, runtime, deadline) and which are flexible?',
    'What does "done" look like — and what’s the smallest version that would still make you proud?',
  ];
}
