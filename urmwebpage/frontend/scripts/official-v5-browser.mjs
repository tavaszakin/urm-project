// Browser QA: node scripts/official-v5-browser.mjs BASE PHASE [before]
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
import {buildLayout} from '../src/layout/sketchv5/pipeline.js';
import {adaptSketchV4Route} from '../src/layout/sketchv4/displayGeometry.js';
const [base,phase,before]=process.argv.slice(2);
const output=fileURLToPath(new URL('../../../docs/releases/2026-11-14-official-sketchv5/',import.meta.url));
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
const checks=[],errors=[],apiOrigins=new Set();
try {
 const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(60000);
 page.on('pageerror',e=>errors.push(e.message));
 page.on('response',r=>{if(/\/(compile-function|run-function)$/.test(new URL(r.url()).pathname))apiOrigins.add(new URL(r.url()).origin)});
 const mode=()=>page.locator('.runner-toolbar label').filter({has:page.getByText('Mode',{exact:true})}).locator('select');
 assert.equal((await page.goto(base+'/flow-diagram?flowLayout=sketchv3')).status(),200);
 assert.equal(await mode().getByRole('option',{name:'gcd',exact:true}).count(),1);
 const options=await mode().locator('option').evaluateAll(os=>os.map(o=>o.value));
 for(const kind of before?['subtractive_gcd','modulo_3']:options) {
  await mode().selectOption(kind);
  const compiled=page.waitForResponse(r=>new URL(r.url()).pathname==='/compile-function'&&r.request().method()==='POST'&&r.request().postDataJSON()?.kind===kind);
  await page.getByRole('button',{name:'Generate program',exact:true}).click();
  const response=await compiled;assert.equal(response.status(),200,kind);const body=await response.json();
  await page.waitForFunction(k=>window.__betaFlowLastLayoutPlan?.analysis?.debugIdentity?.selectedExampleName===k||document.querySelector('.beta-flow-card')?.getAttribute('data-selected-kind')===k,kind);
  await page.locator('svg.beta-flow-svg').waitFor();
  // Wait for the freshly compiled plan, including the selected function identity.
  await page.waitForTimeout(100);
  const plan=await page.evaluate(()=>{const p=window.__betaFlowLastLayoutPlan;return {mode:p.layoutMode,status:p.constructionStatus,nodes:p.nodes.map(n=>({id:n.id,x:n.x,y:n.y,kind:n.kind})),edges:p.edges,bounds:p.renderBounds,offsetX:p.offsetX,offsetY:p.offsetY,coverage:p.constructionCoverage}});
  if(!before) {
   const expected=buildLayout(body.program),displayId=id=>id===expected.terminalId?'halt':id;
   assert.equal(plan.mode,'sketchV5',kind);assert.equal(plan.status,expected.status,kind);
   assert.deepEqual(plan.coverage,expected.coverage,kind);assert.deepEqual(plan.bounds,expected.renderBounds,kind);
   assert.deepEqual(plan.edges,expected.routes.map(r=>adaptSketchV4Route(r,displayId)),kind+': exact routes');
   assert.equal(plan.nodes.length,expected.placements.size,kind);
   for(const [id,p] of expected.placements) {const n=plan.nodes.find(n=>n.id===displayId(id));assert.ok(n,kind+': '+id);assert.equal(n.x,p.cx);assert.equal(n.y,p.cy);}
   assert.equal(await page.locator('svg.beta-flow-svg .beta-flow-node').count(),expected.placements.size);
   assert.equal(await page.locator('svg.beta-flow-svg polyline').count(),expected.routes.length);
   const painted=await page.locator('svg.beta-flow-svg polyline').evaluateAll(es=>es.map(e=>e.getAttribute('points')));
   assert.deepEqual(painted,expected.routes.map(r=>r.points.map(([x,y])=>`${x+plan.offsetX},${y+plan.offsetY}`).join(' ')),kind+': exact SVG route coordinates');
   const fit=page.getByRole('radio',{name:'Fit all',exact:true}),scroll=page.getByRole('radio',{name:'Readable size (scroll)',exact:true});
   await fit.check();assert.equal(await page.locator('.beta-flow-svg-shell').getAttribute('data-view-mode'),'fit');
   await scroll.check();assert.equal(await page.locator('.beta-flow-svg-shell').getAttribute('data-view-mode'),'scroll');
   await fit.check();
   if(expected.status!=='complete')await page.getByRole('status').filter({hasText:'committed prefix'}).waitFor();
  }
  if(['subtractive_gcd','modulo_3','exponentiation','successor','bounded_sub'].includes(kind))await page.screenshot({path:output+phase+'-'+kind+'.png',fullPage:true});
  checks.push({kind,mode:plan.mode,status:plan.status??null,nodes:plan.nodes.length,edges:plan.edges.length,program:body.program});
 }
 await page.goto(base+'/compute');await mode().selectOption('modulo_3');
 const math=page.getByRole('region',{name:'Mathematical definition'});await math.locator('.katex').first().waitFor();
 assert.match(await math.innerText(),/f\s*\(\s*x\s*\)\s*=\s*x\s*mod\s*3/);
 await mode().selectOption('subtractive_gcd');assert.equal(await mode().getByRole('option',{name:'gcd',exact:true}).count(),1);
 const run=page.waitForResponse(r=>new URL(r.url()).pathname==='/run-function'&&r.request().method()==='POST');
 await page.getByRole('button',{name:'Generate program',exact:true}).click();const runBody=await(await run).json();assert.equal(runBody.output_value,4);
 const slider=page.locator('.runner-playback-slider');await slider.waitFor();await page.getByRole('button',{name:'Next',exact:true}).click();assert.equal(await slider.inputValue(),'1');
 assert.deepEqual(errors,[]);assert.deepEqual([...apiOrigins],['https://urm-backend.onrender.com']);
 const result={base,phase,options,checks,apiOrigins:[...apiOrigins],errors,controls:'fit, scroll, selection, compute execution and Next passed',registry:'gcd and Modulo 3 notation verified'};
 await fs.writeFile(output+phase+'-browser.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({phase,programs:checks.length,errors}));
} finally {await browser.close();}
