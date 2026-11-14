// node scripts/official-v5-equivalence.mjs [absolute-reference-frontend]
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {createServer} from 'vite';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {buildLayout} from '../src/layout/sketchv5/pipeline.js';
import {adaptSketchV4Route} from '../src/layout/sketchv4/displayGeometry.js';
import {replayConstructionHistory} from '../src/layout/sketchv4/constructionHistory.js';
import {validateConnection,validateExtension} from '../src/layout/sketchv5/validation.js';
const root=fileURLToPath(new URL('../',import.meta.url));
const evidence=path.resolve(root,'../..','docs/releases/2026-11-14-official-sketchv5');
const identity=JSON.parse(await fs.readFile(path.join(evidence,'source-identity.json')));
const reference=process.argv[2];
for(const [rel,row] of Object.entries(identity.closure)) for(const base of [root,...(reference?[reference]:[])])
 assert.equal(createHash('sha256').update(await fs.readFile(path.join(base,rel))).digest('hex'),row.sha256,rel);
const referenceBuild=reference?(await import(pathToFileURL(path.join(reference,'src/layout/sketchv5/pipeline.js')))).buildLayout:buildLayout;
const fixtures=JSON.parse(await fs.readFile(new URL('./official-v5-fixtures.json',import.meta.url)));
const server=await createServer({root,server:{middlewareMode:true,hmr:false},appType:'custom'});
const results=[];
const data = value => JSON.parse(JSON.stringify(value,(_,v)=>v instanceof Map?{map:[...v]}:v instanceof Set?{set:[...v]}:v));
try {
 const {computePrimaryLayoutPlan,FlowSvgDisplay}=await server.ssrLoadModule('/src/components/BetaFlowDiagram.jsx');
 for(const {id,program,status} of fixtures) {
  const expected=referenceBuild(program,{recordConstruction:true}),actual=buildLayout(program,{recordConstruction:true});
  assert.deepEqual(data(actual),data(expected),id+': complete data result including normalized CFG/ports/events (function identities excluded)');
  if(status) assert.equal(actual.status,status,id+': archived status');
  globalThis.__flowLayoutEngine='sketchV3';
  const plan=computePrimaryLayoutPlan(program,id,{recordConstruction:true,layoutEngine:'sketchV4'});
  delete globalThis.__flowLayoutEngine;
  assert.equal(plan.layoutMode,'sketchV5');
  for(const [display,native] of [['constructionStatus','status'],['constructionFailure','failure'],['constructionCoverage','coverage'],['constructionIssues','issues'],['constructionHistory','constructionHistory'],['renderBounds','renderBounds'],['placementBounds','placementBounds']]) assert.deepEqual(plan[display],expected[native],id+': '+display);
  const displayId=value=>value===expected.terminalId?'halt':value;
  assert.deepEqual(plan.edges,expected.routes.map(route=>adaptSketchV4Route(route,displayId)),id+': exact routes and attachments');
  assert.equal(plan.nodes.length,expected.placements.size,id+': placed node coverage');
  for(const [internal,p] of expected.placements) {const n=plan.nodeMap.get(displayId(internal));assert.ok(n,id+': '+internal);assert.equal(n.x,p.cx);assert.equal(n.y,p.cy);if(internal===expected.terminalId)assert.equal(n.kind,'action');}
  for(const [i,event] of expected.constructionHistory.entries()) {
   const before=replayConstructionHistory(expected.constructionHistory,i);
   if(event.type==='extension-committed') assert.equal(validateExtension(before,event).legal,true,id+': extension validator');
   if(event.type==='edge-routed') assert.equal(validateConnection(before,event).legal,true,id+': connection validator');
  }
  const svg=renderToStaticMarkup(React.createElement(FlowSvgDisplay,{layoutPlan:plan}));
  assert.equal((svg.match(/class="beta-flow-node"/g)??[]).length,plan.nodes.length);
  assert.equal((svg.match(/<polyline /g)??[]).length,plan.edges.length);
  assert.ok(svg.includes('data-constructor="sketchV5"'));assert.ok(!/NaN|Infinity/.test(svg));
  results.push({id,status:actual.status,nodes:actual.placements.size,edges:actual.routes.length,events:actual.constructionHistory.length});
 }
 await fs.writeFile(path.join(evidence,'equivalence-results.json'),JSON.stringify({reference:reference??'hash-verified packaged baseline',closureFiles:12,checks:'exact full results, CFG, coverage, orientations, events, ports, production nodes/routes/bounds, replay hard validators, SVG rendering',results},null,2)+'\n');
 console.log(JSON.stringify({passed:results.length,statuses:results.reduce((a,r)=>({...a,[r.status]:(a[r.status]??0)+1}),{})}));
} finally {await server.close();}
