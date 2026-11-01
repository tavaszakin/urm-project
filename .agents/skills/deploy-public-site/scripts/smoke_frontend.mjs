#!/usr/bin/env node
// Browser-only smoke tests. Never changes provider settings or deployments.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const options = {};
for (let index = 2; index < process.argv.length; index += 1) {
  const flag = process.argv[index];
  if (flag === '--legacy') options.legacy = true;
  else if (['--url', '--api-override', '--playwright-module', '--browser', '--output', '--vercel-bypass-env'].includes(flag)) {
    const value = process.argv[++index];
    assert(value && !value.startsWith('--'), `${flag} requires a value`);
    options[flag.slice(2)] = value;
  } else throw new Error(`Unknown argument: ${flag}`);
}
assert(options.url, 'Usage: smoke_frontend.mjs --url <frontend> [--api-override <api>] [--legacy]');
const base = new URL(options.url);
assert(['http:', 'https:'].includes(base.protocol));
const bypass = options['vercel-bypass-env'] ? process.env[options['vercel-bypass-env']] : undefined;
if (options['vercel-bypass-env']) {
  assert(bypass, 'Staging bypass credential must be supplied in the named environment variable');
  assert(base.protocol === 'https:' && base.hostname.endsWith('.vercel.app'), 'Bypass is restricted to the target Vercel origin');
}
const playwright = await import(options['playwright-module']
  ? pathToFileURL(path.resolve(options['playwright-module'])).href : 'playwright');
const browser = await playwright.chromium.launch({headless: true,
  ...(options.browser ? {executablePath: options.browser} : {})});
const checks = [];
const apiOrigins = new Set();
const errors = [];
let intercepted = 0;
try {
  const page = await browser.newPage({viewport: {width: 1440, height: 1000}});
  page.setDefaultTimeout(30000);
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => {
    if (/\/(run-function|compile-function)$/.test(new URL(response.url()).pathname)) {
      apiOrigins.add(new URL(response.url()).origin);
    }
  });
  if (options['api-override'] || bypass) {
    const override = options['api-override'] ? new URL(options['api-override']) : null;
    if (override) assert(['http:', 'https:'].includes(override.protocol));
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (override && /^(\/api)?\/(run-function|compile-function|function-kinds)$/.test(url.pathname)) {
        intercepted += 1;
        const response = await route.fetch({url: override.origin + override.pathname.replace(/\/$/, '')
          + url.pathname.replace(/^\/api/, '') + url.search});
        return route.fulfill({response});
      }
      // Never send the project credential to Render, a CDN or another origin.
      if (bypass && url.origin === base.origin) {
        return route.continue({headers: {...route.request().headers(), 'x-vercel-protection-bypass': bypass}});
      }
      return route.continue();
    });
  }
  async function visit(route) {
    const response = await page.goto(new URL(route, base).href);
    assert.equal(response.status(), 200, `${route}: direct navigation`);
    const reload = await page.reload();
    assert.equal(reload.status(), 200, `${route}: refresh`);
    checks.push(`${route}: navigation and refresh`);
  }
  const privateKinds = [3, 4, 5, 6].map(k => `second_smallest_${k}`);
  const expectedPublicKinds = ['zero', 'successor', 'predecessor', 'constant', 'projection',
    'add', 'multiplication', 'exponentiation', 'factorial', 'geometric_sum', 'divisor_count',
    'bounded_sub', 'characteristic', 'compose', 'primrec', 'minimization'];
  const mode = () => page.locator('.runner-toolbar label')
    .filter({has: page.getByText('Mode', {exact: true})}).locator('select');
  async function restrictedMenus() {
    const entries = await page.locator('.runner-toolbar option').evaluateAll(options =>
      options.map(option => ({value: option.value, label: option.textContent})));
    assert(entries.length, 'Panel options are present');
    assert(entries.every(entry => !privateKinds.includes(entry.value)
      && !/median|second[- _]?smallest/i.test(entry.label)), 'Private family is absent from every menu');
  }
  async function select(kind) {
    await mode().selectOption(kind);
    await restrictedMenus();
  }
  async function run(kind, inputs, expected) {
    await select(kind);
    const fields = page.locator('.runner-variable-input');
    assert.equal(await fields.count(), inputs.length, `${kind}: input arity`);
    for (const [index, value] of inputs.entries()) await fields.nth(index).fill(String(value));
    const pending = page.waitForResponse(response => /\/run-function$/.test(new URL(response.url()).pathname)
      && response.request().method() === 'POST');
    await page.getByRole('button', {name: 'Run', exact: true}).click();
    const response = await pending;
    assert.equal(response.status(), 200, `${kind}: HTTP result`);
    const body = await response.json();
    assert.equal(body.output_value, expected, `${kind}: output`);
    assert.equal(body.halted, true, `${kind}: halt`);
    assert(body.program.length && body.trace.length, `${kind}: program and trace`);
    checks.push(`${kind}: execution output ${expected}, program and trace`);
  }
  async function screenshot(name) {
    if (!options.output) return;
    await fs.mkdir(options.output, {recursive: true});
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({path: path.join(options.output, name + '.png'), fullPage: true});
  }
  await visit('/');
  const homeDestination = page.getByRole(options.legacy ? 'button' : 'link', {name: 'Simulator', exact: true});
  assert.equal(await homeDestination.count(), 1, 'Landing Simulator destination');
  if (!options.legacy) {
    assert.equal(await page.locator('.home-overview ol > li').count(), 2);
    assert.equal(await page.getByRole('navigation', {name: 'Primary', exact: true}).count(), 0);
    const home = await page.locator('.home-page').evaluate(e => {const s = getComputedStyle(e);
      return {x:e.getBoundingClientRect().x, size:s.fontSize, margin:s.margin};});
    assert.equal(home.x, 8); assert.equal(home.size, '16px'); assert.equal(home.margin, '8px');
    await screenshot('home-desktop');
  }
  await homeDestination.click(); await mode().waitFor();
  await visit('/compute');
  await page.getByRole('heading', {name: 'Simulator', exact: true}).waitFor();
  assert.equal(await page.getByText('Define a function, evaluate it, and inspect the resulting program and trace.', {exact: true}).count(), 0);
  assert.deepEqual(await mode().locator('option').evaluateAll(es => es.map(e => e.value)), expectedPublicKinds);
  await restrictedMenus();
  await run('add', [2, 3], 5);
  const slider = page.locator('.runner-playback-slider');
  await slider.waitFor(); await slider.focus(); await slider.press('Home');
  await page.getByRole('button', {name: 'Next', exact: true}).click();
  assert.equal(await slider.inputValue(), '1');
  await page.getByRole('button', {name: 'Prev', exact: true}).click();
  assert.equal(await slider.inputValue(), '0');
  await page.getByRole('button', {name: 'Play', exact: true}).click();
  await page.getByRole('button', {name: 'Pause', exact: true}).waitFor();
  await page.waitForFunction(() => Number(document.querySelector('.runner-playback-slider').value) > 0);
  await slider.focus(); await slider.press('End');
  await page.waitForFunction(() => {const s=document.querySelector('.runner-playback-slider');return s.value===s.max;});
  await page.locator('.machine-workspace').waitFor();
  checks.push('Simulator playback, next/previous stepping, seeking and rendered workspace');
  await run('bounded_sub', [5, 2], 3);
  for (const kind of ['compose', 'primrec', 'minimization', 'characteristic', 'projection']) await select(kind);
  await select('successor');
  if (!options.legacy) await screenshot('simulator-desktop');
  await visit('/flow-diagram');
  assert.deepEqual(await mode().locator('option').evaluateAll(es => es.map(e => e.value)), expectedPublicKinds);
  for (const kind of ['successor', 'add', 'divisor_count', 'compose', 'primrec', 'minimization']) {
    const pending = page.waitForResponse(response => /\/compile-function$/.test(new URL(response.url()).pathname)
      && response.request().method() === 'POST' && response.request().postDataJSON()?.kind === kind);
    await select(kind); const response = await pending; assert.equal(response.status(), 200);
    const program = (await response.json()).program; assert(program.length);
    await page.waitForFunction(expected => {
      const svg = document.querySelector('svg.beta-flow-svg');
      return svg && svg.querySelectorAll('g.beta-flow-node').length === expected
        && svg.querySelectorAll('path, polyline').length > 0;
    }, program.length + 2);
    const bounds = await page.locator('.beta-flow-svg-shell').getAttribute('data-diagram-bounds');
    assert(/^\d+x\d+$/.test(bounds));
    if (!options.legacy) assert.equal(await page.getByText('Show layout comparison', {exact: false}).count(), 0);
    for (const [name, view] of [['Fit all', 'fit'], ['Readable scroll', 'scroll']]) {
      await page.getByRole('button', {name, exact: true}).click();
      await page.waitForFunction(view => document.querySelector('.beta-flow-svg-shell').dataset.viewMode === view, view);
    }
    checks.push(`${kind}: compile, SketchV4 SVG with ${program.length + 2} nodes, fit and scroll`);
  }
  await run('successor', [4], 5);
  if (!options.legacy) {
    await screenshot('flow-desktop');
    // Query strings are not a function-selection API. Verify they cannot bypass menu exclusions.
    for (const route of ['/compute', '/flow-diagram']) {
      for (const kind of privateKinds) {
        await page.goto(new URL(`${route}?kind=${kind}&function=${kind}&functionKind=${kind}`, base).href);
        await mode().waitFor(); assert.equal(await mode().inputValue(), 'successor'); await restrictedMenus();
      }
    }
    await page.goto(new URL('/flow-diagram?flowLayout=sketchv3&geometryDebug=1&betaFlowAudit=1&geometryCollect=1&flowDebugPorts=1', base).href);
    await page.locator('svg.beta-flow-svg').waitFor();
    assert.equal(await page.evaluate(() => window.__betaFlowLastLayoutPlan?.layoutMode), 'sketchV4');
    assert.equal(await page.evaluate(() => typeof window.__collectBetaFlowGeometryReports), 'undefined');
    assert.equal(await page.locator('.beta-flow-comparison-grid').count(), 0);
    checks.push('Private-family query attempts ignored; debug/collector/legacy-engine entry points unavailable');
    for (const width of [1440, 390]) {
      await page.setViewportSize({width, height: 1000});
      for (const route of ['/', '/compute', '/flow-diagram']) {
        await visit(route);
        if (route === '/') {
          assert.equal(await page.locator('.home-overview ol > li').count(), 2);
        } else {
          await mode().waitFor(); await restrictedMenus();
          const links=await page.getByRole('navigation', {name:'Primary',exact:true}).locator('a').evaluateAll(es => es.map(e=>e.getAttribute('href')));
          assert.deepEqual(links, ['/', '/compute', '/flow-diagram']);
          const text = await page.locator('.function-card-label,.runner-mode-label').evaluateAll(es => es.map(e => {
            const s = getComputedStyle(e); return {text:e.textContent.trim(), color:s.color, transform:s.textTransform, tracking:s.letterSpacing};}));
          assert.deepEqual(text.map(e=>e.text), ['Definition','Current call','Mode']);
          assert(text.every(e=>e.color==='rgb(0, 0, 0)' && e.transform==='capitalize' && e.tracking==='normal'));
          assert.equal(await page.locator('.runner-toolbar input[type=number]').first().evaluate(e=>getComputedStyle(e).color), 'rgb(0, 0, 0)');
          if (route === '/flow-diagram') await page.locator('svg.beta-flow-svg').waitFor();
        }
        await page.locator('.site-theme-toggle').click();
        await page.waitForFunction(()=>document.documentElement.dataset.theme==='night');
        if(route!=='/') assert.equal(await mode().evaluate(e=>getComputedStyle(e).color), 'rgb(255, 255, 255)');
        await page.locator('.site-theme-toggle').click();
        await page.waitForFunction(()=>document.documentElement.dataset.theme==='light');
        await page.waitForTimeout(250);
        if (width===390) await screenshot(route==='/'?'home-mobile':route==='/compute'?'simulator-mobile':'flow-mobile');
      }
    }
    checks.push('Desktop/mobile document layout, native list, public links, black panel text, title-case labels and theme switching');
    for (const route of ['/smn', '/beta/flow-diagram', '/playground', '/learn', '/encoding',
      '/finite-structures-beta', '/program-equivalence', '/.flow-layout-probes/history.html',
      '/.flow-layout-probes/current_viewer.mjs', '/experiments/sketchv4/viewer.html']) {
      const response=await page.goto(new URL(route,base).href);
      assert([200,404].includes(response.status()), `${route}: blocked or homepage fallback`);
      if(response.status()===200) {
        await page.getByRole('heading',{name:'URM stuff',exact:true}).waitFor();
        assert.equal(await page.locator('.runner-toolbar').count(),0);
        assert.equal(new URL(page.url()).pathname,'/');
      }
    }
    checks.push('Unpublished development routes/viewers do not load; production exports only index.html and assets');

  }
  assert.equal(errors.length, 0, `Browser errors: ${errors.join('; ')}`);
  if (options['api-override']) assert(intercepted > 0, 'API override was exercised');
  const report = {frontend: base.href, legacy: Boolean(options.legacy),
    staging_authentication: bypass ? 'vercel-bypass' : null,
    api_override: options['api-override'] ?? null, intercepted_requests: intercepted,
    observed_api_origins: [...apiOrigins], checks, browser_errors: errors};
  if (options.output) {
    await fs.mkdir(options.output, {recursive: true});
    await fs.writeFile(path.join(options.output, options.legacy ? 'legacy-smoke.json' : 'frontend-smoke.json'),
      JSON.stringify(report, null, 2) + '\n');
  }
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
