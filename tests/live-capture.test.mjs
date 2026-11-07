import {test} from 'node:test';
import assert from 'node:assert/strict';
import {assessCaptureFrame} from '../dist/modules/live-capture.mjs';
import {makeDefaultCalibration,worldToScene} from '../dist/modules/walk-scene.mjs';

function frame(width,height,shift=0){
  const pixels=new Uint8ClampedArray(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const value=((Math.floor(x/2)+Math.floor(y/2)+shift)%2)?210:45,at=(y*width+x)*4;
    pixels.set([value,value,value,255],at);
  }
  return pixels;
}

test('continuous capture rejects dark and repeated frames, accepts a changed view',()=>{
  const first=assessCaptureFrame(frame(48,36),48,36);
  assert.equal(first.accepted,true);
  assert.match(assessCaptureFrame(new Uint8ClampedArray(48*36*4),48,36).reason,/過暗/);
  assert.match(assessCaptureFrame(frame(48,36),48,36,first.gray).reason,/上一張/);
  assert.equal(assessCaptureFrame(frame(48,36,1),48,36,first.gray).accepted,true);
});

test('scene origin follows the earliest localized capture, not camera result order',()=>{
  const pose=(imgIdx,x)=>({imgIdx,R:[1,0,0,0,-1,0,0,0,-1],t:[-x,0,0]});
  const calibration=makeDefaultCalibration([pose(5,5),pose(0,2)]);
  assert.ok(calibration.origin.every((value,index)=>Math.abs(value-[2,0,0][index])<1e-8));
  assert.ok(Object.values(worldToScene([2,0,0],calibration)).every(value=>Math.abs(value)<1e-8));
});
