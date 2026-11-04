// Browser check for the real studio, on an ephemeral port (never 4300).
import net from 'node:net';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright-core';
import { readFile } from 'node:fs/promises';

const freePort = () => new Promise((resolve) => {
  const probe = net.createServer();
  probe.listen(0, '127.0.0.1', () => {
    const port = probe.address().port;
    probe.close(() => resolve(port === 4300 ? freePort() : port));
  });
});

const port = await freePort();
const server = spawn(process.execPath, ['server.mjs'], {
  cwd: process.cwd(),
  env: { ...process.env, PORT: String(port), HOST: '127.0.0.1' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
server.stdout.on('data', (chunk) => { serverLog += chunk; });
server.stderr.on('data', (chunk) => { serverLog += chunk; });

let browser;
let failed = false;
const fail = (message) => { failed = true; console.error(`FAIL ${message}`); };
const ok = (message) => console.log(`ok   ${message}`);

try {
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (response.ok) break;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  browser = await chromium.launch({ args: ['--disable-gpu'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 950 }, acceptDownloads: true });
  const errors = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });

  const status = () => page.locator('#moment-status').textContent();
  const waitDone = () => page.waitForFunction(
    () => document.querySelector('#moment-status')?.textContent === 'Done',
    null,
    { timeout: 15000 },
  );
  const eyeX = () => page.evaluate(() => {
    const path = [...document.querySelectorAll('#preview svg mask path')].find((node) => node.getAttribute('transform'));
    const matrix = path?.getAttribute('transform')?.match(/matrix\(([^)]+)\)/);
    return matrix ? Number(matrix[1].split(',')[4]) : NaN;
  });
  const bellBox = () => page.locator('#bell').boundingBox();
  const stageBox = () => page.locator('#stage').boundingBox();

  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });
  await page.waitForSelector('#preview svg');
  await page.waitForTimeout(300);
  if (await page.locator('#preview svg').count() !== 1) fail('expected exactly one live SVG');
  const bodyText = await page.locator('body').innerText();
  if (/sequence/i.test(bodyText)) fail('the studio shows the word "sequence"');
  ok('one live blub and no "sequence" in the studio copy');

  // Every preset completes.
  for (const name of ['newNotification', 'success', 'error', 'greeting', 'thinkingDone']) {
    await page.locator(`[data-moment="${name}"]`).click();
    await page.waitForTimeout(120);
    if (name === 'newNotification') {
      const json = await page.locator('#moment-json').inputValue();
      if (!json.includes('"look": "#bell"')) fail('newNotification did not fill the JSON box with the bell look');
      if ((await page.locator('#follow-toggle').getAttribute('aria-pressed')) !== 'true') fail('follow toggle lost its state after a moment');
    }
    if (name === 'thinkingDone') {
      await page.waitForFunction(
        () => /Beat \d of 3/.test(document.querySelector('#moment-status')?.textContent ?? ''),
        null,
        { timeout: 3000 },
      );
    }
    await waitDone();
    ok(`preset ${name} completed`);
  }

  // Eyes look at the bell; moving the bell changes the direction.
  await page.locator('[data-moment="newNotification"]').click();
  await page.waitForTimeout(800);
  const eyeRight = await eyeX();
  await waitDone();
  const oldBell = await bellBox();
  const stage = await stageBox();
  await page.mouse.move(oldBell.x + oldBell.width / 2, oldBell.y + oldBell.height / 2);
  await page.mouse.down();
  await page.mouse.move(stage.x + 150, stage.y + 300, { steps: 6 });
  await page.mouse.up();
  const movedBell = await bellBox();
  await page.locator('[data-moment="newNotification"]').click();
  await page.waitForTimeout(800);
  const eyeLeft = await eyeX();
  await waitDone();
  if (!(Number.isFinite(eyeRight) && Number.isFinite(eyeLeft) && eyeLeft < eyeRight - 10)) {
    fail(`eyes did not follow the dragged bell (${eyeRight} -> ${eyeLeft})`);
  }
  if (!(movedBell.x !== oldBell.x && movedBell.x >= stage.x && movedBell.y >= stage.y)) fail('bell did not drag inside the stage');
  if (!(await page.evaluate(() => Boolean(localStorage.getItem('blubbles.bell'))))) fail('bell position not stored');
  ok(`eyes toward bell: ${eyeRight.toFixed(1)} -> ${eyeLeft.toFixed(1)}, bell stored`);

  // Mid-moment stage screenshot at 1280.
  await page.locator('[data-moment="newNotification"]').click();
  await page.waitForTimeout(700);
  await page.locator('#stage').screenshot({ path: '/tmp/moments-1280.png' });
  await waitDone();
  ok('saved /tmp/moments-1280.png');

  // Inline errors.
  await page.locator('#moment-json').fill('{');
  await page.locator('#moment-play').click();
  const badJSON = await page.locator('#moment-error').textContent();
  if (!/Bad JSON/.test(badJSON ?? '')) fail('bad JSON did not show inline');
  await page.locator('#moment-json').fill('[{"facez":"happy"}]');
  await page.locator('#moment-play').click();
  const badKey = await page.locator('#moment-error').textContent();
  if (!/Unknown beat key/.test(badKey ?? '')) fail('validator message did not show inline');
  await page.locator('#moment-json').fill('[{"face":"happy","look":"#nope"}]');
  await page.locator('#moment-play').click();
  const missing = await page.locator('#moment-error').textContent();
  if (!/Look target not found/.test(missing ?? '')) fail('#nope did not warn inline');
  await waitDone();
  ok('bad JSON, bad key and missing look are inline');

  // Ctrl/Cmd+Enter runs the JSON.
  await page.locator('#moment-json').fill('[{"face":"happy"}]');
  await page.locator('#moment-json').press('Control+Enter');
  await waitDone();
  ok('Ctrl+Enter runs the JSON moment');

  // A face pick during a moment survives.
  await page.locator('#tab-face').click();
  await page.locator('[data-moment="success"]').click();
  await page.waitForTimeout(200);
  await page.locator('[data-face="excited"]').click();
  await page.waitForTimeout(1200);
  if (!(await page.locator('#caption').textContent()).includes('Excited')) fail('face pick during a moment was restored away');
  if ((await status()) !== 'Stopped') fail(`face pick should stop the moment, got ${await status()}`);
  ok('face pick during a moment survives');

  // Pause, then press a moment: it resumes and completes.
  if ((await page.locator('#play-toggle').textContent()) !== 'Pause') await page.locator('#play-toggle').click();
  await page.locator('#play-toggle').click();
  if ((await page.locator('#play-toggle').textContent()) !== 'Play') fail('pause did not toggle');
  await page.locator('[data-moment="success"]').click();
  await waitDone();
  if ((await page.locator('#play-toggle').textContent()) !== 'Pause') fail('pressing a moment while paused did not resume');
  ok('pause + moment resumes and completes');

  // Stop works.
  await page.locator('[data-moment="newNotification"]').click();
  await page.waitForTimeout(200);
  await page.locator('#moment-stop').click();
  if ((await status()) !== 'Stopped') fail(`stop status was ${await status()}`);
  if (!(await page.locator('#moment-stop').isDisabled())) fail('stop stayed enabled after stopping');
  ok('stop settles as Stopped and disables');

  // A Moves press interrupts.
  await page.locator('[data-moment="newNotification"]').click();
  await page.waitForTimeout(200);
  await page.locator('[data-move="wink"]').click();
  await page.waitForTimeout(120);
  if ((await status()) !== 'Interrupted') fail(`move did not interrupt, got ${await status()}`);
  ok('Moves press reports Interrupted');

  // Stills still download.
  const svgDownload = page.waitForEvent('download');
  await page.locator('#download-svg').click();
  const svgFile = await svgDownload;
  if (!svgFile.suggestedFilename().endsWith('.svg')) fail('SVG export did not download');
  const pngDownload = page.waitForEvent('download');
  await page.locator('#download-png').click();
  const pngFile = await pngDownload;
  if (!pngFile.suggestedFilename().endsWith('.png')) fail('PNG export did not download');
  ok('SVG and PNG stills still download');

  // A still while Thinking must not show the idle pose.
  await page.locator('[data-move="thinking"]').click();
  await page.waitForTimeout(450);
  await page.locator('#play-toggle').click();
  const thinkingDownload = page.waitForEvent('download');
  await page.locator('#download-svg').click();
  const thinkingSVG = await readFile(await (await thinkingDownload).path(), 'utf8');
  await page.locator('[data-move="idle"]').click();
  const idleDownload = page.waitForEvent('download');
  await page.locator('#download-svg').click();
  const idleSVG = await readFile(await (await idleDownload).path(), 'utf8');
  if (thinkingSVG === idleSVG) fail('Thinking still is identical to the idle still');
  await page.locator('#play-toggle').click();
  ok('Thinking still differs from the idle still at the same time');

  // Bell keyboard movement and persistence.
  await page.locator('#bell').focus();
  const beforeKey = await bellBox();
  await page.keyboard.press('ArrowLeft');
  const afterKey = await bellBox();
  if (!(afterKey.x < beforeKey.x)) fail('arrow key did not move the bell');
  const storedBell = await page.evaluate(() => localStorage.getItem('blubbles.bell'));
  if (!storedBell) fail('bell keyboard move was not stored');
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('#preview svg');
  const reloadedBell = await bellBox();
  if (Math.abs(reloadedBell.x - afterKey.x) > 2) fail('bell position was not restored after reload');
  ok('bell moves with arrow keys and persists');

  // 390 px screenshot, inside-stage and no horizontal overflow.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(350);
  await page.locator('[data-moment="newNotification"]').click();
  await page.waitForTimeout(700);
  await page.locator('#stage').screenshot({ path: '/tmp/moments-390.png' });
  await waitDone();
  const mobileStage = await stageBox();
  const mobileBell = await bellBox();
  const inside = mobileBell.x >= mobileStage.x - 1 && mobileBell.y >= mobileStage.y - 1
    && mobileBell.x + mobileBell.width <= mobileStage.x + mobileStage.width + 1
    && mobileBell.y + mobileBell.height <= mobileStage.y + mobileStage.height + 1;
  if (!inside) fail('bell left the stage at 390 px');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  if (overflow > 1) fail(`horizontal overflow at 390 px: ${overflow}px`);
  ok('saved /tmp/moments-390.png, bell inside, no horizontal overflow');

  // Reduced motion still plays a pressed moment.
  const reduced = await browser.newPage({ viewport: { width: 900, height: 800 }, reducedMotion: 'reduce' });
  await reduced.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });
  await reduced.waitForSelector('#preview svg');
  await reduced.locator('[data-moment="success"]').click();
  await reduced.waitForFunction(
    () => document.querySelector('#moment-status')?.textContent === 'Done',
    null,
    { timeout: 15000 },
  );
  await reduced.close();
  ok('reduced-motion moment still plays');

  const wearPage = await browser.newPage({ viewport: { width: 1280, height: 950 } });
  wearPage.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  await wearPage.goto(`http://127.0.0.1:${port}/`);
  await wearPage.waitForSelector('#preview svg');
  await wearPage.locator('#tab-wear').click();
  const parts = () => wearPage.locator('#preview svg g path[d][opacity]').count();
  const bare = await parts();
  await wearPage.locator('[data-wear="hat"]').click();
  await wearPage.locator('[data-wear="tie"]').click();
  await wearPage.waitForTimeout(1000);
  if ((await parts()) <= bare) fail('wearing a hat and tie added nothing to the stage');
  await wearPage.locator('[data-wear="bowtie"]').click();
  await wearPage.locator('[data-wear="mustache"]').click();
  await wearPage.locator('[data-tone-slot="head"] [data-tone="#c8324a"]').click();
  await wearPage.locator('[data-tone-slot="neck"] [data-tone="#1f6b4a"]').click();
  await wearPage.waitForTimeout(400);
  const wearQuery = () => wearPage.evaluate(() => Object.fromEntries(new URLSearchParams(location.search)));
  let q = await wearQuery();
  if (q.wear !== 'hat,bowtie,mustache' || q.tones !== 'hat:c8324a,bowtie:1f6b4a') fail(`each wear keeps its colour: ${JSON.stringify(q)}`);
  // A shared colour covers the hat and bow tie, but never the mustache.
  await wearPage.locator('[data-tone-slot="lip"] [data-tone="#6b4226"]').click();
  await wearPage.locator('#wear-unify-input').check();
  await wearPage.locator('[data-tone-slot="all"] [data-tone="#e0a526"]').click();
  await wearPage.waitForTimeout(400);
  q = await wearQuery();
  if (q.tone !== 'e0a526' || q.tones !== 'mustache:6b4226') fail(`shared colour leaves the mustache alone: ${JSON.stringify(q)}`);
  if ((await wearPage.locator('[data-tone-slot]').count()) !== 2) fail('shared colour should show one row plus the mustache');
  await wearPage.waitForTimeout(600);
  await wearPage.screenshot({ path: '/tmp/wear-unified.png' });
  await wearPage.locator('#wear-unify-input').uncheck();
  await wearPage.waitForTimeout(300);
  q = await wearQuery();
  if (q.tones !== 'hat:e0a526,bowtie:e0a526,mustache:6b4226') fail(`leaving shared keeps the colours: ${JSON.stringify(q)}`);
  await wearPage.waitForTimeout(600);
  await wearPage.screenshot({ path: '/tmp/wear-1280.png' });
  const wearSpill = await wearPage.evaluate(() => {
    const grid = document.querySelector('#wear-grid').getBoundingClientRect();
    return [...document.querySelectorAll('[data-wear]')].some((card) => card.getBoundingClientRect().right > grid.right + 0.5);
  });
  if (wearSpill) fail('a wear card spills out of the grid');
  await wearPage.setViewportSize({ width: 390, height: 844 });
  await wearPage.waitForTimeout(300);
  await wearPage.screenshot({ path: '/tmp/wear-390.png', fullPage: true });
  const wearOverflow = await wearPage.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  if (wearOverflow) fail('wear tab overflows at 390 px');
  await wearPage.reload();
  await wearPage.waitForSelector('#preview svg');
  await wearPage.close();
  ok('wear tab dresses the stage, saves to the URL and fits a phone');

  if (errors.length) fail(`browser errors: ${errors.join(' | ')}`);
  if (failed) {
    console.error(serverLog.slice(0, 2000));
    process.exitCode = 1;
  } else {
    console.log('\nstudio check passed');
  }
} catch (error) {
  console.error(error);
  console.error(serverLog.slice(0, 2000));
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  server.kill();
}
