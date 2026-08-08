// LIVE end-to-end verification against the real Gemini API.
// Usage: GEMINI_KEY=... node e2e-live.mjs
import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFileSync } from 'fs';

const KEY = process.env.GEMINI_KEY;
if (!KEY) { console.error('GEMINI_KEY missing'); process.exit(1); }

const html = readFileSync('dist/index.html');
const server = createServer((q, r) => { r.writeHead(200, { 'Content-Type': 'text/html' }); r.end(html); }).listen(4180);

const ok = (name, cond) => { console.log(`${cond ? 'PASS' : 'FAIL'} — ${name}`); if (!cond) process.exitCode = 1; };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', (e) => console.log(`PAGEERROR: ${e.message}`));

await page.goto('http://localhost:4180');
await page.waitForTimeout(1200);

// 1. Enter API key in Settings
await page.locator('.btn-ghost', { hasText: 'Settings' }).click();
await page.locator('.settings input[type="password"]').fill(KEY);
await page.locator('.settings input[placeholder="e.g. R. Vane"]').fill('Live Test');
await page.locator('.settings .btn-gold').click();
await page.waitForTimeout(500);
ok('key saved (live toast)', await page.locator('.toast', { hasText: 'live' }).count() === 1);

// 2. Interview mode returns real questions
await page.locator('.journal').click();
const IDEA = 'A film made 100% with AI about pirates who die and get a second chance. They board the Argo and sail through a black hole into today’s San Francisco and start a software company.';
await page.locator('.nb-prompt').fill(IDEA);
await page.locator('.nb-vibe').fill('One Piece × Silicon Valley');
await page.locator('.btn-outline', { hasText: 'Interview mode' }).click();
await page.waitForSelector('.nb-q', { timeout: 60000 });
const qCount = await page.locator('.nb-q').count();
ok(`interview questions from live model (${qCount})`, qCount >= 3);
await page.locator('.nb-q textarea').first().fill('Festival audiences and AI-filmmaking early adopters; they should leave grinning and a little moved.');

// 3. Bind the book — live outline + live AI cover, revealed in focus view
await page.locator('.btn-gold', { hasText: 'Bind the book' }).click();
await page.waitForSelector('.focus-panel', { timeout: 240000 });
const title = (await page.locator('.focus-title').textContent()).replace('✎', '').trim();
const coverSrc = await page.locator('.focus-book .book3d-art').getAttribute('src').catch(() => null);
ok(`live AI cover generated (${(coverSrc || 'none').slice(5, 15)}…)`, !!coverSrc && !coverSrc.startsWith('data:image/svg'));
await page.screenshot({ path: 'shots/live-01-cover.png' });
await page.locator('.focus-actions .btn-gold', { hasText: 'Open the book' }).click();
await page.waitForSelector('.cover-frame h1', { timeout: 15000 });
const tocCount = await page.locator('.toc-row').count();
ok(`live outline bound: "${title}" with ${tocCount} pages`, tocCount >= 12 && tocCount <= 20 && title.length > 2);

// 4. Draft page 1 live (real prose + real generated image)
await page.locator('.toc-row').first().click();
await page.waitForTimeout(800);
await page.screenshot({ path: 'shots/live-debug-toc.png' });
await page.locator('.pg-undrafted .btn-gold').click();
await page.waitForSelector('.pg-p', { timeout: 180000 });
await page.waitForTimeout(1000);
const paras = await page.locator('.pg-p').count();
const imgs = await page.locator('.pg-fig img').count();
let realImg = false;
for (let i = 0; i < imgs; i++) {
  const src = await page.locator('.pg-fig img').nth(i).getAttribute('src');
  if (src && !src.startsWith('data:image/svg')) realImg = true;
}
ok(`page drafted live (${paras} paragraphs, ${imgs} images, real image: ${realImg})`, paras >= 2 && imgs >= 1 && realImg);
await page.screenshot({ path: 'shots/live-02-drafted.png' });

// 5. Page chat applies a live canvas edit
const beforeBlocks = await page.locator('.page-content > *').count();
await page.locator('.chat-input textarea').fill('Add a short pull-quote to this page: something the captain says about second chances. Put it on the canvas.');
await page.locator('.chat-send').click();
await page.waitForSelector('.bubble-badge', { timeout: 120000 });
await page.waitForTimeout(1500);
const afterBlocks = await page.locator('.page-content > *').count();
const quotes = await page.locator('.pg-q').count();
ok(`live canvas edit applied (blocks ${beforeBlocks}→${afterBlocks}, quotes: ${quotes})`, quotes >= 1);
await page.screenshot({ path: 'shots/live-03-chat-edit.png' });

// 6. Page audit: annotate -> compile to Scribe -> send -> live audit applies
await page.locator('.audit-btn').click();
await page.waitForTimeout(500);
await page.locator('.page-inner').click({ button: 'right', position: { x: 350, y: 320 } });
await page.waitForTimeout(300);
await page.locator('.radial-tool[title="Red pen"]').click();
const box = await page.locator('.page-inner').boundingBox();
await page.mouse.move(box.x + 180, box.y + 280);
await page.mouse.down();
await page.mouse.move(box.x + 430, box.y + 310, { steps: 10 });
await page.mouse.up();
await page.waitForTimeout(400);
await page.locator('.audit-btn.recording').click();
await page.waitForSelector('.audit-pending', { timeout: 30000 });
const prefill = await page.locator('.chat-input textarea').inputValue();
ok('audit compiled into scribe input', prefill.length > 10);
await page.locator('.chat-input textarea').fill(prefill + ' Make the marked section punchier and more cinematic.');
await page.locator('.chat-send').click();
await page.waitForSelector('.bubble-badge.audit', { timeout: 180000 });
ok('live audit applied from scribe', true);
await page.screenshot({ path: 'shots/live-04-audit.png' });

// 7. Image regen: mark up + live edit
await page.locator('.pg-fig img').first().click();
await page.waitForSelector('.imgstudio-canvas', { timeout: 10000 });
const c = await page.locator('.imgstudio-canvas').boundingBox();
await page.mouse.move(c.x + c.width * 0.3, c.y + c.height * 0.3);
await page.mouse.down();
await page.mouse.move(c.x + c.width * 0.6, c.y + c.height * 0.5, { steps: 8 });
await page.mouse.up();
await page.locator('.imgstudio-input').fill('make the sky a dramatic sunset with golden light');
const oldSrc = await page.locator('.pg-fig img').first().getAttribute('src');
await page.locator('.imgstudio .btn-gold').click();
await page.waitForFunction(
  (old) => { const el = document.querySelector('.pg-fig img'); return el && el.getAttribute('src') !== old; },
  oldSrc, { timeout: 180000 },
);
const newSrc = await page.locator('.pg-fig img').first().getAttribute('src');
ok(`live image regenerated (${(newSrc || '').slice(5, 15)}…)`, newSrc !== oldSrc && !newSrc.startsWith('data:image/svg'));
await page.screenshot({ path: 'shots/live-05-image-regen.png' });

// 7b. Live research with Google Search grounding
await page.locator('.chat-tabs button', { hasText: 'Research' }).click();
await page.locator('.chat-input textarea').fill('What are the leading AI video generation tools as of this month? Keep it brief.');
await page.locator('.chat-send').click();
await page.waitForSelector('.chat-scroll .bubble.model:not(.thinking)', { timeout: 120000 });
await page.waitForTimeout(500);
const rText = await page.locator('.chat-scroll .bubble.model:not(.thinking)').last().textContent();
const srcCount = await page.locator('.bubble-sources a').count();
ok(`live research answered (${rText.length} chars, ${srcCount} sources)`, rText.length > 60);
await page.screenshot({ path: 'shots/live-07-research.png' });
await page.locator('.chat-tabs button', { hasText: 'Scribe' }).click();

// 8. Book-level chat: leave a note on another page
await page.locator('.bv-title').click();
await page.waitForTimeout(600);
await page.locator('.chat-input textarea').fill('Leave a note on the most production-related page reminding me to compare AI video tools before locking the pipeline.');
await page.locator('.chat-send').click();
await page.waitForSelector('.bubble.model', { timeout: 120000 });
await page.waitForTimeout(1500);
const noteBadges = await page.locator('.toc-notebadge').count();
ok(`book-level chat responded (note badges on TOC: ${noteBadges})`, await page.locator('.bubble.model').count() >= 1);

// 9. Brain dump live sort (lives in book-level Notes now)
await page.locator('.chat-tabs button', { hasText: 'Notes' }).click();
await page.locator('.dump-toggle').click();
await page.locator('.dump-input').fill('the black hole should hum an old sea shanty\ntry Suno or Lyria for the score\nthe captain needs a scar he cannot explain\nSF office should be a converted pier warehouse');
await page.locator('.dump-box .btn-gold').click();
await page.waitForSelector('.dump-row', { timeout: 120000 });
const dumpRows = await page.locator('.dump-row').count();
ok(`brain dump sorted live (${dumpRows} assignments)`, dumpRows >= 3);
await page.locator('.dump-box .btn-gold', { hasText: 'Pin all' }).click();
await page.waitForTimeout(600);
await page.screenshot({ path: 'shots/live-06-braindump.png' });

// 9b. Logs recorded
await page.locator('.chat-tabs button', { hasText: 'Logs' }).click();
await page.waitForTimeout(400);
const liveLogs = await page.locator('.logrow').count();
ok(`logs recorded (${liveLogs})`, liveLogs >= 3);

// 10. Persistence
await page.reload();
await page.waitForTimeout(1500);
const deskCount = await page.locator('.desk-book').count();
const shelfCount = await page.locator('.shelf-row .spine').count();
ok(`books persisted after reload (desk ${deskCount} + shelf ${shelfCount})`, deskCount === 1 && shelfCount >= 1);

await browser.close();
server.close();
console.log('LIVE RUN COMPLETE');
