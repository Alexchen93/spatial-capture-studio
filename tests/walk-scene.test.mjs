import {test} from 'node:test';
import assert from 'node:assert/strict';
import {moveWithCollisions} from '../dist/modules/movement.mjs';
import {boundsObstacles,cameraCenter,cameraPose,makeDefaultCalibration,sceneToWorld,validateWalkScene,worldToScene} from '../dist/modules/walk-scene.mjs';

const near=(a,b,tol=1e-5)=>assert.ok(Math.abs(a-b)<tol,`${a} != ${b}`);
const camera={R:[1,0,0,0,-1,0,0,0,-1],t:[0,1,5]};

test('calibration derives a horizontal basis and camera origin from solved poses',()=>{
  const c=makeDefaultCalibration([camera]);assert.deepEqual(cameraCenter(camera),[-0,1,5]);assert.deepEqual(c.up,[0,1,0]);assert.deepEqual(c.forward,[0,0,-1]);const p=worldToScene([1,1,3],c);near(p.x,1);near(p.z,2);near(p.height,0);assert.deepEqual(sceneToWorld(p,c),[1,1,3]);
});

test('a free-view camera pose uses OpenCV world-to-camera rows and meters-to-model units',()=>{
  const c={origin:[0,0,0],up:[0,1,0],forward:[0,0,-1],unitsPerMeter:2,headingDeg:0,floorHeight:0};const pose=cameraPose(c,{x:1,z:2},{width:800,height:400,eyeHeight:0});
  pose.R.forEach((v,i)=>near(v,[1,0,0,0,-1,0,0,0,-1][i]));pose.t.forEach((v,i)=>near(v,[-2,0,-4][i]));assert.equal(pose.w,800);assert.equal(pose.h,400);assert.ok(pose.f>0);
});

test('model point projection and heading correction stay orthonormal',()=>{
  const c={origin:[0,0,0],up:[0,1,0],forward:[0,0,-1],unitsPerMeter:2,headingDeg:90};const p=worldToScene([0,0,-2],c);near(p.x,-1);near(p.z,0);const axes=cameraPose(c,{x:0,z:0},{eyeHeight:0});near(Math.hypot(...axes.R.slice(0,3)),1);near(axes.R.slice(0,3).reduce((n,v,i)=>n+v*axes.R[6+i],0),0);
});

test('derived scene boundary stops movement but permits sliding along it',()=>{
  const walls=boundsObstacles({minX:-2,maxX:2,minZ:-3,maxZ:3},8);let p=moveWithCollisions({x:0,z:0},{x:0,z:-10},walls,.25);near(p.z,-2.75);assert.equal(p.hit,'步行範圍邊界');p=moveWithCollisions({x:0,z:0},{x:10,z:0},walls,.25);near(p.x,1.75,1e-4);
});

test('scene validation rejects invalid scale, bounds, and colliders',()=>{
  const good={calibration:{origin:[0,0,0],unitsPerMeter:1},bounds:{minX:-2,maxX:2,minZ:-3,maxZ:3},obstacles:[]};assert.equal(validateWalkScene(good),true);assert.throws(()=>validateWalkScene({...good,calibration:{...good.calibration,unitsPerMeter:0}}),/尺度/);assert.throws(()=>validateWalkScene({...good,calibration:{...good.calibration,up:[0,Infinity,0]}}),/方向向量/);assert.throws(()=>validateWalkScene({...good,calibration:{...good.calibration,headingDeg:NaN}}),/方向修正/);assert.throws(()=>validateWalkScene({...good,bounds:{minX:1,maxX:1,minZ:-1,maxZ:1}}),/範圍/);assert.throws(()=>validateWalkScene({...good,obstacles:[{minX:1,maxX:0,minZ:-1,maxZ:1}]}),/碰撞區/);
});
