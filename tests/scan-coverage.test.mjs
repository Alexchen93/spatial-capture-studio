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
  assert.equal(coverage.guidance.readyToReview,false);
});

test('review suggestion requires overlapping wall views plus floor and ceiling directions',()=>{
  const pose=(imgIdx,yaw,pitch)=>camera(imgIdx,[Math.sin(yaw)*Math.cos(pitch),Math.sin(pitch),Math.cos(yaw)*Math.cos(pitch)]);
  const coverage=new ScanCoverage();
  const walls=Array.from({length:16},(_,index)=>[pose(index*2,index*Math.PI/8,0),pose(index*2+1,index*Math.PI/8,0)]).flat();
  coverage.setSolvedCameras(walls);
  assert.ok(coverage.guidance.overlappingWalls>=12);
  assert.equal(coverage.guidance.readyToReview,false);
  const floorAndCeiling=Array.from({length:4},(_,index)=>[pose(32+index*2,index*Math.PI/2,-Math.PI/4),pose(33+index*2,index*Math.PI/2,Math.PI/4)]).flat();
  coverage.setSolvedCameras([...walls,...floorAndCeiling]);
  assert.equal(coverage.guidance.readyToReview,true);
});
