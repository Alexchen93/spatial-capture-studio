import {moveWithCollisions} from './movement.mjs';
const canvas=document.querySelector('#scene'),ctx=canvas.getContext('2d'),viewport=document.querySelector('#viewport');
let cam={x:0,z:5.5,yaw:0,pitch:0}, keys={}, dragging=false,lastX=0,lastY=0,lastTime=0;
const surfaces=[];
function poly(points,color){surfaces.push({points,color})}
function box(x,y,z,w,h,d,colors){const [top,front,side]=colors;poly([[x,y+h,z],[x+w,y+h,z],[x+w,y+h,z+d],[x,y+h,z+d]],top);poly([[x,y,z+d],[x+w,y,z+d],[x+w,y+h,z+d],[x,y+h,z+d]],front);poly([[x+w,y,z],[x+w,y,z+d],[x+w,y+h,z+d],[x+w,y+h,z]],side);poly([[x,y,z],[x,y,z+d],[x,y+h,z+d],[x,y+h,z]],side)}
// Architectural geometry of the illustrative demo room.
poly([[-8,0,-7],[8,0,-7],[8,0,9],[-8,0,9]],'#9a9f8b');
poly([[-8,5,-7],[8,5,-7],[8,5,9],[-8,5,9]],'#d5d5c4');
poly([[-8,0,-7],[8,0,-7],[8,5,-7],[-8,5,-7]],'#c3c8b7');
poly([[-8,0,-7],[-8,0,9],[-8,5,9],[-8,5,-7]],'#aeb6a7');
poly([[8,0,-7],[8,0,9],[8,5,9],[8,5,-7]],'#b4bbac');
// Back glazing and mullions.
poly([[-6.5,1,-6.98],[-1,1,-6.98],[-1,4.4,-6.98],[-6.5,4.4,-6.98]],'#829d94');
poly([[-6.2,1.2,-6.96],[-1.3,1.2,-6.96],[-1.3,4.2,-6.96],[-6.2,4.2,-6.96]],'#a8c0b4');
poly([[-4,1.2,-6.94],[-3.88,1.2,-6.94],[-3.88,4.2,-6.94],[-4,4.2,-6.94]],'#65786f');
poly([[-6.2,2.55,-6.93],[-1.3,2.55,-6.93],[-1.3,2.65,-6.93],[-6.2,2.65,-6.93]],'#70877b');
// Frames, art, plinths and furniture.
poly([[1,1.35,-6.95],[5.6,1.35,-6.95],[5.6,4.05,-6.95],[1,4.05,-6.95]],'#8c9786');
poly([[1.15,1.5,-6.91],[5.45,1.5,-6.91],[5.45,3.9,-6.91],[1.15,3.9,-6.91]],'#d8d8bf');
poly([[1.5,1.8,-6.89],[3.2,1.8,-6.89],[4.7,3.6,-6.89],[3,3.6,-6.89]],'#aab6a0');
poly([[2.7,1.8,-6.87],[4.9,1.8,-6.87],[4.1,3.3,-6.87]],'#c0bca5');
box(-5.8,0,-4.7,1.4,1.05,1.4,['#e2e1cd','#c0c4b2','#abb3a4']);
box(-5.45,1.05,-4.35,.7,1.1,.7,['#c5ceaf','#9eac91','#829782']);
box(2.5,0,-4.2,1.5,1.15,1.5,['#e0dfca','#c8ccba','#adb6a6']);
box(2.8,1.15,-3.9,.9,.65,.9,['#c6ae8c','#af9272','#967b62']);
box(-2.5,0,-1.2,4.5,.45,1.5,['#d7d6c2','#b2b9a9','#929e91']);
box(-2.3,.45,-1.1,4.1,.32,1.2,['#d9d7c2','#bec5b3','#a3ae9e']);
// Floor seams and a soft patch of light.
poly([[-6,0.01,-6],[-1,0.01,-6],[2,0.01,2],[-4,0.01,2]],'#acb39b');
for(let z=-5;z<9;z+=2)poly([[-8,.012,z],[8,.012,z],[8,.012,z+.015],[-8,.012,z+.015]],'#858f7d');
surfaces.forEach((surface,index)=>{surface.layer=index<5?0:(index<13||index>=37?1:2)});
function cameraPoint(p){let dx=p[0]-cam.x,dz=p[2]-cam.z;return {x:dx*Math.cos(cam.yaw)+dz*Math.sin(cam.yaw),y:p[1]-1.65,z:dx*Math.sin(cam.yaw)-dz*Math.cos(cam.yaw)}}
function clip(points){const n=.12,out=[];for(let i=0;i<points.length;i++){let a=points[i],b=points[(i+1)%points.length],ai=a.z>=n,bi=b.z>=n;if(ai)out.push(a);if(ai!==bi){let t=(n-a.z)/(b.z-a.z);out.push({x:a.x+t*(b.x-a.x),y:a.y+t*(b.y-a.y),z:n})}}return out}
function render(time){let dt=Math.min((time-lastTime)/1000||0,.05);lastTime=time;if(!viewport.getClientRects().length){keys={};requestAnimationFrame(render);return}let fw=(keys.w||keys.arrowup?1:0)-(keys.s||keys.arrowdown?1:0),side=(keys.d?1:0)-(keys.a?1:0);if(keys.arrowleft)cam.yaw-=1.3*dt;if(keys.arrowright)cam.yaw+=1.3*dt;let speed=2.6*dt;let length=Math.hypot(fw,side)||1;let moved=moveWithCollisions(cam,{x:(fw*Math.sin(cam.yaw)+side*Math.cos(cam.yaw))*speed/length,z:(-fw*Math.cos(cam.yaw)+side*Math.sin(cam.yaw))*speed/length});cam.x=moved.x;cam.z=moved.z;let tip=document.querySelector('#collisionTip');tip.textContent=moved.hit ? '遇到'+moved.hit : '';tip.classList.toggle('visible',!!moved.hit);
let dpr=Math.min(devicePixelRatio||1,2),w=canvas.clientWidth,h=canvas.clientHeight;if(canvas.width!==Math.round(w*dpr)||canvas.height!==Math.round(h*dpr)){canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr)}ctx.setTransform(dpr,0,0,dpr,0,0);ctx.fillStyle='#9fae9f';ctx.fillRect(0,0,w,h);let focal=Math.min(w,h)*.88;let list=surfaces.map(s=>{let p=clip(s.points.map(cameraPoint));return {p,color:s.color,layer:s.layer,depth:p.reduce((sum,v)=>sum+v.z,0)/(p.length||1)}}).filter(s=>s.p.length>=3).sort((a,b)=>a.layer-b.layer||b.depth-a.depth);for(const s of list){ctx.beginPath();s.p.forEach((p,i)=>{let x=w/2+p.x/p.z*focal,y=h/2-(p.y/p.z)*focal+cam.pitch*h;(i?ctx.lineTo:ctx.moveTo).call(ctx,x,y)});ctx.closePath();ctx.fillStyle=s.color;ctx.fill()};requestAnimationFrame(render)}requestAnimationFrame(render);

window.addEventListener('keydown',e=>{if(viewport.getClientRects().length&&!['INPUT','TEXTAREA'].includes(document.activeElement.tagName)&&['w','a','s','d','arrowup','arrowdown','arrowleft','arrowright'].includes(e.key.toLowerCase())){keys[e.key.toLowerCase()]=true;if(document.activeElement===viewport)e.preventDefault()}});
window.addEventListener('keyup',e=>keys[e.key.toLowerCase()]=false);window.addEventListener('blur',()=>keys={});document.addEventListener('visibilitychange',()=>{if(document.hidden)keys={}});
viewport.addEventListener('pointerdown',e=>{if(e.target.closest('button'))return;dragging=true;lastX=e.clientX;lastY=e.clientY;viewport.setPointerCapture(e.pointerId);viewport.focus()});
viewport.addEventListener('pointermove',e=>{if(!dragging)return;cam.yaw-=(e.clientX-lastX)*.005;cam.pitch=Math.max(-.35,Math.min(.35,cam.pitch+(e.clientY-lastY)*.0015));lastX=e.clientX;lastY=e.clientY});
viewport.addEventListener('pointerup',()=>dragging=false);viewport.addEventListener('pointercancel',()=>dragging=false);
document.querySelector('#resetView').onclick=()=>{cam={x:0,z:5.5,yaw:0,pitch:0};keys={}};
document.querySelectorAll('[data-move]').forEach(b=>{const map={forward:'w',back:'s',left:'a',right:'d'},k=map[b.dataset.move];b.addEventListener('pointerdown',e=>{e.stopPropagation();keys[k]=true;b.setPointerCapture(e.pointerId)});['pointerup','pointercancel','lostpointercapture'].forEach(ev=>b.addEventListener(ev,()=>keys[k]=false))});
