import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {buildLayout} from '../../../urmwebpage/frontend/src/layout/sketchv4/pipeline.js';
import {assignOrientation} from '../../../urmwebpage/frontend/src/layout/sketchv4/orientation.js';
import {measureOwnedIntrusions} from '../../../urmwebpage/frontend/src/layout/sketchv4/ownedIntrusions.js';
import {captureEvidence,visual} from './owned-evidence.mjs';

const archive=new URL('../archive-2026-10-29-owned-orientation/',import.meta.url);
const fixtures=JSON.parse(fs.readFileSync(new URL('fixtures.json',archive),'utf8'));
const reference=JSON.parse(fs.readFileSync(new URL('approved.json',archive),'utf8'));
const fixture=alias=>fixtures.find(f=>f.aliases.includes(alias));

// Small geometric contracts exercise attribution independently of compiler naming.
function intrusionView({phase='departure',source=['i-0-no'],target=['i-0-yes'],node=['i-0-yes'],fromFocus=false,branch=null,tangent=false}){
  const sourceId=fromFocus?'i-0':'i-1',targetId='i-2',obstacleId='i-3';
  const points=phase==='departure'?[[-100,0],[100,0],[100,100],[120,100]]
    :phase==='arrival'?[[-100,-100],[-100,0],[100,0]]
      :phase==='body'?[[-100,-100],[-100,0],[100,0],[100,100]]:[[-100,0],[100,0]];
  const edge={id:'probe-edge',from:sourceId,to:targetId,branch};
  const paths=new Map([[sourceId,source],[targetId,target],[obstacleId,node]]);
  const boxes=new Map([[obstacleId,{left:-10,right:10,top:tangent?0:-10,bottom:10}]]);
  return {cfg:{edgeById:new Map([[edge.id,edge]])},roles:{realForkSet:new Set(['i-0'])},ownership:{branchPath:id=>paths.get(id)??[]},boxes,routed:{routes:[{edgeId:edge.id,source:sourceId,target:targetId,points}]}};
}

for(const c of [
  {name:'NO-to-YES departure owns intrusion into YES',phase:'departure',expected:1},
  {name:'departure does not charge same-arm node',phase:'departure',node:['i-0-no'],expected:0},
  {name:'departure to outside still owns its source arm',phase:'departure',target:[],expected:1},
  {name:'OUTSIDE-to-NO arrival owns intrusion into YES',phase:'arrival',source:[],target:['i-0-no'],expected:1},
  {name:'OUTSIDE-to-NO arrival excludes same-arm node',phase:'arrival',source:[],target:['i-0-no'],node:['i-0-no'],expected:0},
  {name:'opposite-side arrival is deliberately withheld',phase:'arrival',node:['i-0-no'],expected:0},
  {name:'same-side arrival retains target ownership',phase:'arrival',target:['i-0-no'],expected:1},
  {name:'body requires same-side endpoint consensus',phase:'body',target:['i-0-no'],expected:1},
  {name:'body spanning opposite arms remains unowned',phase:'body',expected:0},
  {name:'direct endpoint disagreement is unresolved',phase:'direct',expected:0},
  {name:'direct same-side consensus owns opposite-arm penetration',phase:'direct',target:['i-0-no'],expected:1},
  {name:'semantic departure token is appended at the focus',phase:'departure',source:[],target:['i-0-yes'],node:['i-0-no'],fromFocus:true,branch:'yes',expected:1},
  {name:'ambiguous source membership is excluded',source:['i-0-no','i-0-yes'],expected:0},
  {name:'node boundary contact is not an interior intrusion',tangent:true,expected:0},
]){
  test(c.name,()=>{
    const result=measureOwnedIntrusions(intrusionView(c),'i-0');
    assert.equal(result.count,c.expected);
    if(c.expected){assert.equal(result.events[0].phase,c.phase);assert.equal(result.events[0].directlyAttributable,true)}
  });
}

function select(primary,owned,{pins}={}){
  const calls=[0,0];
  const result=assignOrientation({realForks:['i-0'],bottomUp:['i-0'],pins,evaluate:(map,focus)=>{
    const bit=map.get('i-0').no==='right'?1:0;
    return {total:primary[bit],...(focus?{evaluateOwnedIntrusions:()=>{calls[bit]++;return owned[bit]}}:{})};
  }});
  return {selected:result.orientationMap.get('i-0'),calls,row:result.rows[0]};
}
for(const c of [
  {name:'better default primary score skips both secondary scores',p:[0,1],i:[9,0],selected:'left',calls:[0,0]},
  {name:'better flipped primary score wins despite secondary cost',p:[2,1],i:[0,9],selected:'right',calls:[0,0]},
  {name:'zero default-owned count skips flipped measurement',p:[0,0],i:[0,3],selected:'left',calls:[1,0]},
  {name:'strict secondary improvement flips only on a primary tie',p:[1,1],i:[3,1],selected:'right',calls:[1,1]},
  {name:'nonzero complete tie retains default',p:[0,0],i:[2,2],selected:'left',calls:[1,1]},
  {name:'worse flipped secondary score retains default',p:[0,0],i:[1,3],selected:'left',calls:[1,1]},
])test(c.name,()=>{const r=select(c.p,c.i);assert.equal(r.selected.no,c.selected);assert.deepEqual(r.calls,c.calls)});

test('hard pins remain authoritative and skip secondary scoring',()=>{
  const r=select([0,1],[0,1],{pins:new Map([['i-0',{no:'right',yes:'left'}]])});
  assert.equal(r.selected.no,'right');assert.deepEqual(r.calls,[0,0]);
});
test('historical primary-only harness oracles retain their semantics',()=>{
  const r=assignOrientation({realForks:['i-0'],bottomUp:['i-0'],evaluate:()=>({total:0})});
  assert.equal(r.orientationMap.get('i-0').no,'left');
});

test('approved 54-program corpus preserves exact geometry, SVG and decisions',async t=>{
  assert.equal(fixtures.length,54);assert.equal(reference.programs.length,54);
  for(const f of fixtures)await t.test(f.name,()=>{
    const layout=buildLayout(f.program,{programName:f.name,visual});
    const actual=captureEvidence(layout,f.program,measureOwnedIntrusions).approved;
    const expected=reference.programs.find(r=>r.name===f.name).evidence;
    assert.deepEqual(actual,expected);
  });
});

for(const alias of ['selector:minimization','metrics:minimization(add)'])test(`real descendant arms exchange sides: ${alias}`,()=>{
  const f=fixture(alias),layout=buildLayout(f.program,{programName:f.name,visual});
  const expected=reference.triggers.find(t=>f.aliases.includes(t.programName)||t.programName===f.name);
  assert.ok(expected);const id=expected.conditionalId;
  assert.deepEqual(layout.orientationMap.get(id),{no:'right',yes:'left'});
  const x=layout.boxes.get(id).cx,out=layout.cfg.outgoingByIndex.get(layout.cfg.nodeById.get(id).instructionIndex);
  for(const branch of ['yes','no']){
    const edge=out[branch];assert.ok(edge);
    const descendants=[...layout.boxes.keys()].filter(node=>layout.ownership.branchPath(node).includes(edge.id));
    assert.ok(descendants.length>=2);
    assert.ok(descendants.every(node=>branch==='yes'?layout.boxes.get(node).cx<x:layout.boxes.get(node).cx>x));
  }
  assert.equal(captureEvidence(layout,f.program,measureOwnedIntrusions).metrics.rawIntrusions,0);
});
test('divides preserves its approved orientation and avoids the raw-intrusion regression',()=>{
  const f=fixture('canonical:characteristic:divides');const layout=buildLayout(f.program,{programName:f.name,visual});
  assert.deepEqual(layout.orientationMap.get('i-25'),{no:'left',yes:'right'});
  assert.equal(layout.defects.total,0);
  assert.equal(captureEvidence(layout,f.program,measureOwnedIntrusions).approved.geometryHash,reference.programs.find(r=>r.name===f.name).evidence.geometryHash);
});
for(const [alias,focus,edge,node,phase,count] of [
  ['step8b:no-yes-departure','i-0','i-7-jump','i-5','departure',1],
  ['step8b:outside-no-arrival','i-1','i-6-jump','i-4','arrival',1],
  ['step8b:outside-no-same-arm','i-1','i-9-jump','i-5','arrival',0],
  ['step8b:no-yes-arrival','i-0','i-4-jump','i-1','arrival',0],
])test(`real structural witness: ${alias}`,()=>{
  const f=fixture(alias),layout=buildLayout(f.program,{visual,orientationSource:'allDefault'});
  const result=measureOwnedIntrusions(layout,focus);
  const events=result.events.filter(e=>e.edgeId===edge&&e.nodeId===node&&e.phase===phase);
  assert.equal(events.length,count);
});
