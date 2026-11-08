import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ScanCoverage,solvedViewDirections} from '../dist/modules/scan-coverage.mjs';

const camera=(imgIdx,forward)=>({imgIdx,R:[1,0,0,0,-1,0,...forward],f:500,w:640,h:480});

test('solved poses mark photographed directions while opposite directions remain missing',()=>{
  const coverage=new ScanCoverage();
  assert.equal(coverage.missingCount,null);
  coverage.setSolvedCameras([camera(1,[0,0,1]),camera(0,[0,0,1])]);
  assert.equal(coverage.hasSolved,true);
  assert.ok(coverage.cell(8,3).solved>=2);
  assert.equal(coverage.cell(0,3).solved,0);
  assert.ok(coverage.missingCount>0);
});

test('sensor-only directions remain estimated until SfM localizes cameras',()=>{
  const coverage=new ScanCoverage();
  coverage.addEstimate(0,0);
  assert.equal(coverage.cell(8,3).estimated,1);
  assert.equal(coverage.cell(8,3).solved,0);
  coverage.setSolvedCameras([camera(0,[0,0,1])]);
  assert.equal(coverage.cell(8,3).solved,1);
  assert.ok(solvedViewDirections([camera(0,[0,0,1])])[0].halfAngle>0);
});

test('invalid poses cannot claim spatial coverage',()=>{
  const coverage=new ScanCoverage();
  coverage.setSolvedCameras([{R:[1,2]}]);
  assert.equal(coverage.hasSolved,false);
  assert.equal(coverage.missingCount,null);
});
