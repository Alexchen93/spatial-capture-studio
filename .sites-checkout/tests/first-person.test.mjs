import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createNavigation,createFirstPersonController,limitToCapturePath,navigationCamera,stepNavigation} from '../dist/modules/first-person.mjs';
const camera=(z,index)=>({R:[1,0,0,0,1,0,0,0,1],t:[0,0,-z],f:200,w:300,h:480,imgIdx:index});
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);

test('the camera moves continuously through the reconstructed scene, not between still frames',()=>{
 const nav=createNavigation([camera(2,2),camera(0,0),camera(1,1)]);const a=navigationCamera(nav,480,300);
 stepNavigation(nav,1,0,.05);const b=navigationCamera(nav,480,300);stepNavigation(nav,1,0,.05);const c=navigationCamera(nav,480,300);
 assert.ok(b.t[2]<a.t[2]&&c.t[2]<b.t[2]);assert.ok(-c.t[2]<1);assert.equal(b.w,480);assert.equal(b.h,300);
});
test('movement remains in the capture corridor and does not bridge missing capture frames',()=>{
 const nav=createNavigation([camera(0,0),camera(1,1),camera(10,10),camera(11,11)]);
 for(let i=0;i<1000;i++)stepNavigation(nav,1,0,.05);
 assert.ok(nav.position.y<=1+nav.radius+1e-8,`${nav.position.y}`);
 const p=limitToCapturePath(nav,{x:100,y:0});assert.ok(p.blocked);
});
test('looking changes camera orientation while keeping the same world position',()=>{
 const nav=createNavigation([camera(0,0),camera(1,1)]);nav.position={x:.1,y:.2};const before=navigationCamera(nav,480,300);nav.yaw=.7;nav.pitch=.2;const after=navigationCamera(nav,480,300);
 assert.notDeepEqual(after.R,before.R);const R=after.R,t=after.t,pos=[.1,0,.2];
 for(let i=0;i<3;i++)close(R[i*3]*pos[0]+R[i*3+1]*pos[1]+R[i*3+2]*pos[2]+t[i],0);
 for(let i=0;i<3;i++)close(Math.hypot(...R.slice(i*3,i*3+3)),1);
});
test('stationary or invalid poses do not invent a walkable area',()=>{
 const nav=createNavigation([camera(0,0),camera(0,1)]);assert.equal(nav.radius,0);stepNavigation(nav,1,0,.05);assert.deepEqual(nav.position,{x:0,y:0});assert.throws(()=>createNavigation([{}]),/相機位置/);
});
test('holding a mobile control continuously renders the session camera and releases cleanly',()=>{
 class Target{constructor(){this.map={}}addEventListener(k,fn){(this.map[k]??=[]).push(fn)}removeEventListener(k,fn){this.map[k]=(this.map[k]||[]).filter(v=>v!==fn)}emit(k,event={}){for(const fn of this.map[k]||[])fn({preventDefault(){},stopPropagation(){},...event})}setPointerCapture(){}}
 const oldWindow=globalThis.window,oldDocument=globalThis.document,oldRaf=globalThis.requestAnimationFrame,oldCancel=globalThis.cancelAnimationFrame;
 const win=new Target(),doc=new Target(),canvas=new Target(),buttons={reset:new Target(),move:{forward:new Target(),back:new Target(),left:new Target(),right:new Target()}},status={};let callback,id=0;const rendered=[];
 canvas.width=480;canvas.height=300;doc.activeElement=null;globalThis.window=win;globalThis.document=doc;globalThis.requestAnimationFrame=fn=>{callback=fn;return ++id};globalThis.cancelAnimationFrame=()=>{callback=null};
 try{
  const ses={trainer:{camMeta:[camera(0,0),camera(1,1)]},view:{setCamera:c=>rendered.push(c)}};const controller=createFirstPersonController({session:ses,canvas,buttons,status});controller.start();
  callback(100);buttons.move.forward.emit('pointerdown',{pointerId:1});for(let t=200;t<=700;t+=100)callback(t);
  assert.ok(rendered.length>2);assert.ok(rendered.at(-1).t[2]<rendered[0].t[2]);const heldPosition=rendered.at(-1).t[2];buttons.move.forward.emit('pointerup');for(let t=800;t<=1000;t+=100)callback(t);assert.equal(rendered.at(-1).t[2],heldPosition);
  canvas.emit('pointerdown',{pointerId:2,clientX:0,clientY:0});canvas.emit('pointermove',{pointerId:2,clientX:40,clientY:0});callback(1100);assert.notDeepEqual(rendered.at(-1).R,rendered[0].R);
  controller.dispose();assert.equal(callback,null);assert.equal((buttons.move.forward.map.pointerdown||[]).length,0);
 }finally{globalThis.window=oldWindow;globalThis.document=oldDocument;globalThis.requestAnimationFrame=oldRaf;globalThis.cancelAnimationFrame=oldCancel}
});
