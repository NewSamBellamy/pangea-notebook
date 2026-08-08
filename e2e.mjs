import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFileSync } from 'fs';

const html = readFileSync('dist/index.html');
const server = createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(html);
}).listen(4173);

const ok = (name, cond) => { console.log(`${cond ? 'PASS' : 'FAIL'} — ${name}`); if (!cond) process.exitCode = 1; };

const browser = await chromium.launch({ args: ['--use-gl=angle', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', (e) => console.log(`PAGEERROR: ${e.message}`));

// pick a tool from the radial ring at (x, y) within .page-inner
async function pickTool(x, y, title) {
  await page.locator('.page-inner').click({ button: 'right', position: { x, y } });
  await page.waitForTimeout(250);
  await page.locator(`.radial-tool[title="${title}"]`).click();
  await page.waitForTimeout(200);
}

await page.goto('http://localhost:4173');
await page.waitForTimeout(800);
if (await page.locator('#demo-pass').count()) {
  await page.locator('#demo-pass').fill('PangeaDemo2026');
  await page.locator('.app-gate-card button[type="submit"]').click();
  await page.waitForTimeout(700);
}

// 1. The study
ok('study renders with desk book', await page.locator('.desk-book').count() === 1);
ok('study scene present', await page.locator('.stage-bg').count() === 1);

// 2. Desk book opens its preview first; the creator explicitly opens the book from there.
await page.locator('.desk-book').click();
await page.waitForTimeout(350);
ok('desk book opens a preview', await page.locator('.focus-panel').count() === 1);
await page.locator('.focus-actions .btn-gold', { hasText: 'Open the book' }).click();
await page.waitForTimeout(700);
ok('cover shows title', await page.locator('.cover-frame h1', { hasText: 'The Argo Protocol' }).count() === 1);
ok('TOC shows 16 rows', await page.locator('.toc-row').count() === 16);

// 3. New tabs present
const tabsText = await page.locator('.chat-tabs').textContent();
ok('six tabs (Scribe/Research/Create/Notes/Logs/Assets)', ['Scribe', 'Research', 'Create', 'Notes', 'Logs', 'Assets'].every((t) => tabsText.includes(t)));

// 4. Open page 1, edge toolbar must be gone
await page.locator('.toc-row', { hasText: 'The Premise' }).click();
await page.waitForTimeout(800);
ok('page 1 heading', await page.locator('.pg-h', { hasText: 'The Premise' }).count() === 1);
ok('edge toolbar removed', await page.locator('.edge-tools').count() === 0);
ok('audit button at top of page', await page.locator('.audit-btn').count() === 1);

// 5. Scribe proposes first; the canvas stays unchanged until the creator approves.
await page.locator('.chat-input textarea').fill('add a beat where the parrot learns to code');
await page.locator('.chat-send').click();
await page.waitForTimeout(2200);
ok('scribe shows an approval gate', await page.locator('.proposal-card').count() === 1);
ok('scribe does not mutate before approval', !(await page.locator('.pg-p').allTextContents()).some((t) => t.includes('parrot')));
await page.locator('.proposal-card .btn-gold').click();
await page.waitForTimeout(700);
ok('approved scribe proposal updates the canvas', (await page.locator('.pg-p').allTextContents()).some((t) => t.includes('parrot')));

// 6. Radial-driven annotation + scrolling with tool active
await pickTool(350, 400, 'Red pen');
ok('tool chip shows active tool', await page.locator('.tool-chip').count() === 1);
const box = await page.locator('.page-inner').boundingBox();
await page.mouse.move(box.x + 200, box.y + 300);
await page.mouse.down();
await page.mouse.move(box.x + 420, box.y + 330, { steps: 12 });
await page.mouse.up();
await page.waitForTimeout(300);
ok('pen annotation drawn', await page.locator('.ann-layer path').count() >= 1);
const scrollBefore = await page.locator('.page-scroll').first().evaluate((el) => el.scrollTop);
await page.mouse.move(box.x + 300, box.y + 400);
await page.mouse.wheel(0, 400);
await page.waitForTimeout(300);
const scrollAfter = await page.locator('.page-scroll').first().evaluate((el) => el.scrollTop);
ok('wheel scroll works with tool active', scrollAfter > scrollBefore);
await page.mouse.wheel(0, -600);
await page.waitForTimeout(300);

// 7. Sticky note via radial
await pickTool(500, 380, 'Leave a note');
await page.locator('.ann-layer').click({ position: { x: 500, y: 400 } });
await page.waitForTimeout(300);
await page.locator('.note-popup textarea').fill('tighten this opening');
await page.locator('.note-popup .btn-gold').click();
await page.waitForTimeout(400);
ok('sticky note pinned', await page.locator('.sticky').count() >= 1);

// 8. Page audit -> compiled into Scribe input -> send -> applied
await page.locator('.audit-btn').click();
await page.waitForTimeout(400);
ok('audit strip shows', await page.locator('.audit-strip').count() === 1);
ok('bottom end-audit button present', await page.locator('.audit-end-bottom').count() === 1);
await pickTool(350, 460, 'Highlighter');
await page.mouse.move(box.x + 220, box.y + 500);
await page.mouse.down();
await page.mouse.move(box.x + 500, box.y + 505, { steps: 10 });
await page.mouse.up();
await page.waitForTimeout(300);
await page.locator('.audit-end-bottom').click({ force: true });
await page.waitForTimeout(1200);
ok('audit compiled banner', await page.locator('.audit-pending').count() === 1);
ok('session ink clears into the audit packet', await page.locator('.ann-layer path').count() === 1);
const prefill = await page.locator('.chat-input textarea').inputValue();
ok('scribe input prefilled with audit', prefill.includes('audit') || prefill.includes('Audit'));
await page.locator('.chat-input textarea').fill(prefill + ' Also make the opening punchier.');
await page.locator('.chat-send').click();
await page.waitForTimeout(2400);
ok('audit requires approval', await page.locator('.proposal-card').count() === 1);
await page.locator('.proposal-card .btn-gold').click();
await page.waitForTimeout(800);
ok('approved audit shows applied badge', await page.locator('.bubble-badge.audit').count() >= 1);

// 9. Image studio still works (tool reset after audit)
ok('tool auto-reset after audit', (await page.locator('.ann-layer.active').count()) === 0);
await page.locator('.pg-fig img').first().click();
await page.waitForTimeout(500);
ok('image studio opens on image click', await page.locator('.imgstudio-canvas').count() === 1);
const c = await page.locator('.imgstudio-canvas').boundingBox();
await page.mouse.move(c.x + 100, c.y + 100);
await page.mouse.down();
await page.mouse.move(c.x + 220, c.y + 160, { steps: 8 });
await page.mouse.up();
await page.locator('.imgstudio-input').fill('make the sails bigger');
const oldSrc = await page.locator('.pg-fig img').first().getAttribute('src');
await page.locator('.imgstudio .btn-gold').click();
await page.waitForTimeout(2200);
ok('image regenerated', (await page.locator('.pg-fig img').first().getAttribute('src')) !== oldSrc);

// 10. Research tab (demo)
await page.locator('.chat-tabs button', { hasText: 'Research' }).click();
await page.locator('.chat-input textarea').fill('what are the best AI video tools right now?');
await page.locator('.chat-send').click();
await page.waitForTimeout(1800);
ok('research desk responds', (await page.locator('.bubble.model').last().textContent()).length > 20);
const canvasBeforeDeepResearch = await page.locator('.page-content').innerText();
await page.locator('.ropt', { hasText: 'Deep research' }).click();
await page.locator('.chat-input textarea').fill('research whether pirate founders make a compelling startup premise');
await page.locator('.chat-send').click();
await page.waitForTimeout(1800);
ok('research remains non-destructive', (await page.locator('.page-content').innerText()) === canvasBeforeDeepResearch);
await page.locator('.chat-tabs button', { hasText: 'Assets' }).click();
await page.waitForTimeout(250);
await page.locator('.report-row').first().click();
await page.waitForTimeout(250);
await page.locator('.report-doc .btn-outline', { hasText: 'Clip to Scribe' }).click();
await page.waitForTimeout(250);
ok('research can be clipped to Scribe', await page.locator('.scribe-clip').count() === 1);

// 10b. Create tab (atelier) — generate an image asset in demo mode
await page.locator('.chat-tabs button', { hasText: 'Create' }).click();
await page.waitForTimeout(300);
ok('create form renders', await page.locator('.create-form').count() === 1);
await page.locator('.create-form textarea').fill('the Argo docked at a fog-wrapped pier at dawn');
await page.locator('.create-actions .btn-gold').click();
await page.waitForTimeout(2000);
ok('created image appears', await page.locator('.asset-thumb.created').count() >= 1);
const imgsBefore = await page.locator('.pg-fig img').count();
await page.locator('.asset-thumb.created').first().click();
await page.waitForTimeout(400);
ok('lightbox opens for created image', await page.locator('.lightbox').count() === 1);
await page.locator('.lightbox .btn-gold').click();
await page.waitForTimeout(500);
ok('created image placed on page', (await page.locator('.pg-fig img').count()) === imgsBefore + 1);
// writing mode opens the reader
await page.locator('.cseg button', { hasText: 'Writing' }).click();
await page.locator('.create-form textarea').fill('a two-line toast for the crew');
await page.locator('.create-actions .btn-gold').click();
await page.waitForSelector('.report-doc', { timeout: 15000 });
ok('created writing opens in reader', await page.locator('.report-content').count() === 1);
await page.locator('.report-doc .btn-gold').click();
await page.waitForTimeout(300);

// 11. Logs tab has entries
await page.locator('.chat-tabs button', { hasText: 'Logs' }).click();
await page.waitForTimeout(300);
const logCount = await page.locator('.logrow').count();
ok(`logs recorded (${logCount})`, logCount >= 3);

// 12. Assets tab shows page images
await page.locator('.chat-tabs button', { hasText: 'Assets' }).click();
await page.waitForTimeout(300);
ok('assets show page images', await page.locator('.asset-thumb').count() >= 1);

// 13. Flip: sheet lives at spread level (right side)
await page.locator('.bv-nav button').nth(1).click();
await page.waitForTimeout(150);
ok('flip sheet at spread level', await page.locator('.spread > .flip-sheet').count() === 1);
await page.waitForTimeout(800);

// 14. Book level: brain dump lives in Notes
await page.locator('.bv-title').click();
await page.waitForTimeout(600);
await page.locator('.chat-tabs button', { hasText: 'Notes' }).click();
await page.locator('.dump-toggle').click();
await page.locator('.dump-input').fill('the black hole should hum a sea shanty\nlook into Suno for the score\nVane needs a scar he cannot explain');
await page.locator('.dump-box .btn-gold').click();
await page.waitForTimeout(2000);
ok('dump preview rows', await page.locator('.dump-row').count() === 3);
await page.locator('.dump-box .btn-gold', { hasText: 'Pin all' }).click();
await page.waitForTimeout(500);
ok('notes sorted into book', await page.locator('.noterow').count() >= 4);

// 15. New book: quill launcher + title/brief gate + binder carousel
await page.locator('.btn-ghost', { hasText: 'Library' }).click();
await page.waitForTimeout(500);
await page.locator('.quill-launch').click();
await page.waitForTimeout(550);
ok('X close button on new book', await page.locator('.nb-close').count() === 1);
await page.locator('.nb-prompt').fill('Short idea.');
ok('outline requires a title', await page.locator('.nb-actions .btn-gold').isDisabled());
await page.locator('.nb-vibe').fill('Signalkeeper');
ok('short brief can create an outline once titled', !(await page.locator('.nb-actions .btn-gold').isDisabled()));
await page.locator('.nb-prompt').fill('A graphic novel about a lighthouse keeper on a forgotten northern coast who collects lost radio signals from parallel worlds, archiving each one in a logbook until one signal starts answering back and asking about her.');
await page.locator('.swatch').nth(3).click();
await page.locator('.nb-actions .btn-gold').click();
await page.waitForSelector('.binder-book', { timeout: 5000 });
ok('binder book animation shows', true);
await page.waitForSelector('.bind-carousel', { timeout: 10000 });
ok('question carousel appears while binding', await page.locator('.bind-q').count() === 1);
await page.locator('.bind-carousel textarea').fill('Lighthouse keepers and lonely archivists — it should feel like a warm ghost story.');
await page.waitForSelector('.bind-actions .btn-gold', { timeout: 30000 });
await page.locator('.bind-actions .btn-gold', { hasText: 'Open your book' }).click();
await page.waitForSelector('.focus-panel', { timeout: 10000 });
ok('focus reveal after binding', await page.locator('.focus-book .book3d').count() === 1);
await page.locator('.focus-actions .btn-gold', { hasText: 'Open the book' }).click();
await page.waitForTimeout(700);
ok('new book has TOC', await page.locator('.toc-row').count() >= 10);

// 16. Carousel answer merged into book context
await page.waitForTimeout(300);
const bookChatText = await page.locator('.chat-scroll').textContent();
ok('carousel answer merged into book chat', bookChatText.includes('ghost story') || bookChatText.includes('binding'));

// 17. Persistence + dash-to-desk
await page.reload();
await page.waitForTimeout(1500);
ok('desk + full shelf after reload', (await page.locator('.desk-book').count()) === 1 && (await page.locator('.shelf-row .spine:not(.filler)').count()) === 2 && (await page.locator('.spine.filler').count()) > 20);
await page.locator('.shelf-row .spine:not(.filler)').first().click();
await page.waitForSelector('.focus-panel', { timeout: 5000 });
const focusedTitle = (await page.locator('.focus-title').textContent()).replace('✎', '').trim();
await page.locator('.focus-book .book3d').dispatchEvent('click');
await page.waitForTimeout(1000);
const deskTitle = (await page.locator('.desk-book .book3d-plate h2').textContent()).trim();
ok('dash-to-desk swaps desk book', deskTitle.toLowerCase() === focusedTitle.toLowerCase());

await browser.close();
server.close();
console.log('DONE');
