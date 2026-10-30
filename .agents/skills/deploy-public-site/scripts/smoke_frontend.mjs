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
  await visit('/');
  if (options.legacy) {
    const compute = page.locator('a[href="/compute"], button').filter({hasText: /^Compute/}).first();
    await compute.click();
    await page.locator('select').first().waitFor();
  } else {
    assert(await page.getByRole('button', {name: 'Simulator', exact: true}).count(), 'Landing Simulator link');
    await visit('/compute');
    await page.getByRole('heading', {name: 'Simulator', exact: true}).waitFor();
    assert.equal(await page.getByText('Define a function, evaluate it, and inspect the resulting program and trace.', {exact: true}).count(), 0);
    await page.getByRole('navigation', {name: 'Primary', exact: true})
      .getByRole('link', {name: 'Simulator', exact: true}).waitFor();
  }
  async function run(kind, inputs, expected) {
    await page.locator('select').first().selectOption(kind);
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
  await run('add', [2, 3], 5);
  await run('bounded_sub', [5, 2], 3);
  if (!options.legacy) {
    for (let k = 3; k <= 6; k += 1) await run(`second_smallest_${k}`,
      Array.from({length: k}, (_, index) => k - index), 2);
    await visit('/flow-diagram');
    for (let k = 3; k <= 6; k += 1) {
      const pending = page.waitForResponse(response => /\/compile-function$/.test(new URL(response.url()).pathname)
        && response.request().method() === 'POST'
        && response.request().postDataJSON()?.kind === `second_smallest_${k}`);
      await page.locator('select').first().selectOption(`second_smallest_${k}`);
      const response = await pending;
      assert.equal(response.status(), 200);
      assert.equal((await response.json()).program.length, k * k + 2 * k + 4);
      await page.locator('svg.beta-flow-svg').waitFor();
      await page.waitForFunction(expectedNodes => {
        const svg = document.querySelector('svg.beta-flow-svg');
        return svg && svg.querySelectorAll('g.beta-flow-node').length === expectedNodes
          && svg.querySelectorAll('path, polyline').length > 0;
      }, k * k + 2 * k + 6);
      checks.push(`second_smallest_${k}: compilation and flow SVG`);
    }
    if (options.output) {
      await fs.mkdir(options.output, {recursive: true});
      await page.screenshot({path: path.join(options.output, 'flow-second-smallest-6.png'), fullPage: true});
    }
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
