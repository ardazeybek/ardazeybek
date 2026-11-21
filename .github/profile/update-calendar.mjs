// Fetches this year's contribution calendar and re-renders assets/about-{dark,light}.png.
// Usage: GH_TOKEN=... node .github/profile/update-calendar.mjs   (needs the `playwright` package)
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const USER = 'ardazeybek';
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const LEVEL = { NONE: 0, FIRST_QUARTILE: 1, SECOND_QUARTILE: 2, THIRD_QUARTILE: 3, FOURTH_QUARTILE: 4 };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Asks the GitHub GraphQL API for the calendar of the given year.
async function fetchCalendar(year) {
  const query = `{user(login:"${USER}"){contributionsCollection(from:"${year}-01-01T00:00:00Z",to:"${year}-12-31T23:59:59Z"){contributionCalendar{totalContributions weeks{contributionDays{date contributionLevel}}}}}}`;
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: { Authorization: `bearer ${process.env.GH_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const json = await res.json();
  if (!json.data) throw new Error('GraphQL error: ' + JSON.stringify(json.errors || json));
  return json.data.user.contributionsCollection.contributionCalendar;
}

// Turns the calendar into month labels and grid cells for the template.
function buildGrid(cal, today) {
  let cells = '', months = '';
  cal.weeks.forEach((week, wi) => {
    for (const day of week.contributionDays) {
      const d = new Date(day.date + 'T00:00:00Z');
      const future = day.date > today ? ' f' : '';
      cells += `<i class="l${LEVEL[day.contributionLevel]}${future}" style="grid-column:${wi + 1};grid-row:${d.getUTCDay() + 1}"></i>`;
      if (d.getUTCDate() === 1) months += `<span style="grid-column:${wi + 1}">${MONTHS[d.getUTCMonth()]}</span>`;
    }
  });
  return { cells, months };
}

// Fills the HTML template and writes it to a temp file.
function writePage(cal, year, today) {
  const { cells, months } = buildGrid(cal, today);
  const html = readFileSync(join(HERE, 'row2.html'), 'utf8')
    .replace('<!--MONTHS-->', months)
    .replace('<!--CELLS-->', cells)
    .replace('<!--TOTAL-->', cal.totalContributions.toLocaleString('en-US'))
    .replace('<!--YEAR-->', String(year));
  const file = join(mkdtempSync(join(tmpdir(), 'cal-')), 'row2.html');
  writeFileSync(file, html);
  return file;
}

// Screenshots the row in both themes with the same crop as the other README images.
async function render(file) {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
  const page = await browser.newPage({ viewport: { width: 3100, height: 1400 } });
  for (const theme of ['dark', 'light']) {
    await page.goto(`file://${file}?t=${theme}`);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(800);
    const box = await page.evaluate(() => {
      const b = document.getElementById('row2').getBoundingClientRect();
      return { top: b.top, bottom: b.bottom };
    });
    await page.screenshot({
      path: join(ROOT, 'assets', `about-${theme}.png`),
      omitBackground: true,
      clip: { x: 0, y: box.top - 12, width: 3000, height: box.bottom - box.top + 24 },
    });
  }
  await browser.close();
}

const now = new Date();
const year = now.getUTCFullYear();
const cal = await fetchCalendar(year);
await render(writePage(cal, year, now.toISOString().slice(0, 10)));
console.log(`${cal.totalContributions} contributions in ${year}`);
