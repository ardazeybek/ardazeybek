// Reads the profile's pinned repos, draws a card for each and rewrites the Pinned Projects block in README.md.
// Usage: GH_TOKEN=... node .github/profile/update-pins.mjs   (needs the `playwright` package)
import { readFileSync, writeFileSync, readdirSync, rmSync, mkdtempSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const USER = 'ardazeybek';
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const ASSETS = join(ROOT, 'assets');
const START = '<!--PINS:START-->', END = '<!--PINS:END-->';
const STAR = '<svg width=15 height=15 viewBox="0 0 24 24" fill="#f5b301"><path d="M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z"/></svg>';
const BADGE = { ai: '<span class="badge ai">Built with AI</span>', hw: '<span class="badge hw">Hand-written</span>' };

// Asks the GitHub GraphQL API for the pinned repositories.
async function fetchPins() {
  const query = `{user(login:"${USER}"){pinnedItems(first:6,types:REPOSITORY){nodes{... on Repository{name url description stargazerCount owner{login avatarUrl}}}}}}`;
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: { Authorization: `bearer ${process.env.GH_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const json = await res.json();
  if (!json.data) throw new Error('GraphQL error: ' + JSON.stringify(json.errors || json));
  return json.data.user.pinnedItems.nodes;
}

// 1234 -> "1.2k", 60000 -> "60k".
function stars(n) {
  if (n < 1000) return String(n);
  if (n < 10000) return (Math.round(n / 100) / 10).toString().replace(/\.0$/, '') + 'k';
  return Math.round(n / 1000) + 'k';
}

// Escapes text taken from the API before it goes into HTML.
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// Picks the repo's own logo from logos/, or falls back to the owner's avatar.
function logo(repo, dir) {
  const key = `${repo.owner.login}__${repo.name}`;
  const file = readdirSync(join(HERE, 'logos')).find(f => f.startsWith(key + '.'));
  if (file) { copyFileSync(join(HERE, 'logos', file), join(dir, file)); return `<img src="${file}">`; }
  return `<img src="${repo.owner.avatarUrl}" style="width:54px;height:54px;object-fit:cover">`;
}

// Builds the HTML of one card.
function card(repo, i, dir, overrides) {
  const o = overrides[`${repo.owner.login}/${repo.name}`] || {};
  let desc = o.desc || repo.description || '';
  if (desc.length > 62) desc = desc.slice(0, 60).trimEnd() + '…';
  return `<div class="card pc" id="pin${i}"><div class=pi>${logo(repo, dir)}</div><div><h4>${esc(repo.name)} ${BADGE[o.badge] || ''}</h4>` +
    `<p class=mut>${esc(desc)}</p><div class=st>${STAR} ${stars(repo.stargazerCount)}</div></div></div>`;
}

// Writes the card page (same styles as the other README images) to a temp folder.
function writePage(pins) {
  const dir = mkdtempSync(join(tmpdir(), 'pins-'));
  const overrides = JSON.parse(readFileSync(join(HERE, 'pins.json'), 'utf8'));
  const tpl = readFileSync(join(HERE, 'row2.html'), 'utf8');
  const head = tpl.slice(0, tpl.indexOf('<body>'));
  const cards = pins.map((p, i) => card(p, i + 1, dir, overrides)).join('');
  const html = `${head}<body><style>body{padding:20px 8px;width:1016px}#pins{flex-wrap:wrap;row-gap:30px}</style>` +
    `<div class=grid id=pins>${cards}</div><script>document.body.className=new URLSearchParams(location.search).get("t")||"dark"</script>`;
  writeFileSync(join(dir, 'pins.html'), html);
  return join(dir, 'pins.html');
}

// Screenshots every card in both themes; all crops have the same width so they tile 50/50.
async function render(file, count) {
  for (const f of readdirSync(ASSETS)) if (/^pin-\d+-(dark|light)\.png$/.test(f)) rmSync(join(ASSETS, f));
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
  const page = await browser.newPage({ viewport: { width: 3100, height: 2400 } });
  for (const theme of ['dark', 'light']) {
    await page.goto(`file://${file}?t=${theme}`);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForLoadState('networkidle');
    for (let i = 1; i <= count; i++) {
      const b = await page.evaluate(id => { const r = document.getElementById(id).getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; }, 'pin' + i);
      await page.screenshot({
        path: join(ASSETS, `pin-${i}-${theme}.png`), omitBackground: true, fullPage: true,
        clip: { x: b[0] - 12, y: b[1] - 12, width: b[2] + 24, height: b[3] + 24 },
      });
    }
  }
  await browser.close();
}

// Replaces the block between the PINS markers in README.md.
function writeReadme(pins) {
  const pic = (i, alt) => `<picture><source media="(prefers-color-scheme: light)" srcset="assets/pin-${i}-light.png"><img src="assets/pin-${i}-dark.png" width="50.00%" alt="${esc(alt)}"></picture>`;
  const links = pins.map((p, i) => `<a href="${p.url}">${pic(i + 1, p.name)}</a>` + (i % 2 === 1 && i < pins.length - 1 ? '<br>' : ''));
  const block = `${START}\n<p>${links.join('')}</p>\n${END}`;
  const path = join(ROOT, 'README.md');
  const md = readFileSync(path, 'utf8');
  const a = md.indexOf(START), z = md.indexOf(END);
  if (a < 0 || z < 0) throw new Error('PINS markers not found in README.md');
  writeFileSync(path, md.slice(0, a) + block + md.slice(z + END.length));
}

const pins = await fetchPins();
if (pins.length) {
  await render(writePage(pins), pins.length);
  writeReadme(pins);
}
console.log('pinned: ' + pins.map(p => p.name).join(', '));
