const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const add=(a,b)=>a.map((x,i)=>x+b[i]);
const sub=(a,b)=>a.map((x,i)=>x-b[i]);
const mul=(a,n)=>a.map(x=>x*n);
const norm=a=>{const n=Math.hypot(...a);return n>1e-8?mul(a,1/n):null};
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const center=({R,t})=>[-(R[0]*t[0]+R[3]*t[1]+R[6]*t[2]),-(R[1]*t[0]+R[4]*t[1]+R[7]*t[2]),-(R[2]*t[0]+R[5]*t[1]+R[8]*t[2])];
const validCamera=c=>c?.R?.length===9&&c?.t?.length===3&&[...c.R,...c.t,c.f,c.w,c.h].every(Number.isFinite)&&c.f>0&&c.w>0&&c.h>0;

// Reconstructed camera poses have arbitrary units and no gravity or surfaces.
// Keep travel near the observed capture path; this is NOT collision geometry.
export function createNavigation(cameras){
  const cams=cameras.filter(validCamera).slice().sort((a,b)=>(a.imgIdx??0)-(b.imgIdx??0));
  if(!cams.length)throw new Error('沒有可用的相機位置');
  const c=cams[0],origin=center(c),right=norm(Array.from(c.R.slice(0,3))),down=norm(Array.from(c.R.slice(3,6))),forward=norm(Array.from(c.R.slice(6,9)));
  if(!right||!down||!forward)throw new Error('相機方向無效');
  const path=cams.map(cam=>{const delta=sub(center(cam),origin);return {x:dot(delta,right),y:dot(delta,forward),index:cam.imgIdx}});
  const distances=[];for(let i=1;i<path.length;i++){const a=path[i-1],b=path[i];const d=Math.hypot(b.x-a.x,b.y-a.y);if(d>1e-6)distances.push(d)}
  const extent=path.reduce((m,p)=>Math.max(m,Math.hypot(p.x,p.y)),0);distances.sort((a,b)=>a-b);
  const median=distances.length?distances[Math.floor(distances.length/2)]:0;
  const radius=extent>1e-6?Math.min(extent*.12,Math.max(extent*.035,median*1.5)):0;
  const segments=[];
  for(let i=1;i<path.length;i++){
    const a=path[i-1],b=path[i],len=Math.hypot(b.x-a.x,b.y-a.y);
    const consecutive=a.index==null||b.index==null||b.index-a.index<=1;
    if(consecutive&&len<=Math.max(median*4,extent*.2,1e-6))segments.push([a,b]);
  }
  // Isolated registered cameras are not connected across missing frames.
  for(const p of path)segments.push([p,p]);
  return {cam:c,origin,right,down,forward,path,segments,radius,speed:Math.max(extent*.18,median*2),position:{x:0,y:0},yaw:0,pitch:0};
}

export function limitToCapturePath(nav,target){
  if(!nav.radius)return {...nav.position,blocked:true};
  let best=null,bestDist=Infinity;
  for(const [a,b] of nav.segments){const dx=b.x-a.x,dy=b.y-a.y,len2=dx*dx+dy*dy,t=len2?clamp(((target.x-a.x)*dx+(target.y-a.y)*dy)/len2,0,1):0;const q={x:a.x+t*dx,y:a.y+t*dy};const d=Math.hypot(target.x-q.x,target.y-q.y);if(d<bestDist){best=q;bestDist=d}}
  if(bestDist<=nav.radius)return {...target,blocked:false};
  if(!best)return {...nav.position,blocked:true};
  const scale=nav.radius/bestDist;
  return {x:best.x+(target.x-best.x)*scale,y:best.y+(target.y-best.y)*scale,blocked:true};
}

export function stepNavigation(nav,forwardInput,sideInput,seconds){
  const n=Math.hypot(forwardInput,sideInput);if(!n||!nav.radius)return false;
  const f=forwardInput/n,s=sideInput/n,co=Math.cos(nav.yaw),si=Math.sin(nav.yaw),distance=nav.speed*clamp(seconds,0,.05);
  const target={x:nav.position.x+(s*co+f*si)*distance,y:nav.position.y+(-s*si+f*co)*distance};
  const bounded=limitToCapturePath(nav,target);nav.position={x:bounded.x,y:bounded.y};return bounded.blocked;
}

export function navigationCamera(nav,width,height){
  const {cam,right,down,forward,yaw,pitch,origin,position}=nav,cy=Math.cos(yaw),sy=Math.sin(yaw),cp=Math.cos(pitch),sp=Math.sin(pitch);
  const r=sub(mul(right,cy),mul(forward,sy));
  const f0=add(mul(forward,cy),mul(right,sy));
  const f=add(mul(f0,cp),mul(down,sp)),d=sub(mul(down,cp),mul(f0,sp));
  const pos=add(origin,add(mul(right,position.x),mul(forward,position.y)));
  const scale=Math.max(width/cam.w,height/cam.h);
  return {R:[...r,...d,...f],t:[-dot(r,pos),-dot(d,pos),-dot(f,pos)],f:cam.f*scale,fy:(cam.fy??cam.f)*scale,cx:(cam.cx??cam.w/2)*scale+(width-cam.w*scale)/2,cy:(cam.cy??cam.h/2)*scale+(height-cam.h*scale)/2,w:width,h:height};
}

export function createFirstPersonController({session,canvas,buttons,status}){
  const nav=createNavigation(session.trainer.camMeta);let active=false,frame=0,last=0,lastRender=0,dirty=true,drag=null,held=new Set();
  const listeners=[];const on=(target,event,fn,opts)=>{target.addEventListener(event,fn,opts);listeners.push(()=>target.removeEventListener(event,fn,opts))};
  const showStatus=message=>{if(status)status.textContent=message};
  function draw(){session.view.setCamera(navigationCamera(nav,canvas.width,canvas.height));dirty=false}
  function tick(now){
    if(!active)return;const dt=last?Math.min((now-last)/1000,.05):0;last=now;
    const f=Number(held.has('forward'))-Number(held.has('back')),s=Number(held.has('right'))-Number(held.has('left'));
    if(f||s){const blocked=stepNavigation(nav,f,s,dt);dirty=true;showStatus(blocked?'已到拍攝範圍邊界':'沿拍攝範圍移動中')}
    if(dirty&&now-lastRender>=66){draw();lastRender=now}
    frame=requestAnimationFrame(tick);
  }
  for(const [direction,button] of Object.entries(buttons.move)){
    on(button,'pointerdown',e=>{e.preventDefault();e.stopPropagation();held.add(direction);button.setPointerCapture?.(e.pointerId)});
    for(const type of ['pointerup','pointercancel','lostpointercapture'])on(button,type,()=>held.delete(direction));
  }
  on(canvas,'pointerdown',e=>{if(!active)return;drag={id:e.pointerId,x:e.clientX,y:e.clientY};canvas.setPointerCapture?.(e.pointerId);e.preventDefault()});
  on(canvas,'pointermove',e=>{if(!active||drag?.id!==e.pointerId)return;nav.yaw+=(e.clientX-drag.x)*.005;nav.pitch=clamp(nav.pitch+(e.clientY-drag.y)*.005,-1.3,1.3);drag.x=e.clientX;drag.y=e.clientY;dirty=true;e.preventDefault()});
  for(const type of ['pointerup','pointercancel','lostpointercapture'])on(canvas,type,()=>{drag=null});
  const map={w:'forward',s:'back',a:'left',d:'right',arrowup:'forward',arrowdown:'back',arrowleft:'left',arrowright:'right'};
  on(window,'keydown',e=>{if(!active||['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName))return;const k=map[e.key.toLowerCase()];if(k){held.add(k);e.preventDefault()}});
  on(window,'keyup',e=>{const k=map[e.key.toLowerCase()];if(k)held.delete(k)});
  on(window,'blur',()=>held.clear());on(document,'visibilitychange',()=>{if(document.hidden)held.clear()});
  on(buttons.reset,'click',()=>{nav.position={x:0,y:0};nav.yaw=0;nav.pitch=0;dirty=true;showStatus('已回到起點')});
  return {
    start(){if(active)return;active=true;last=0;dirty=true;showStatus(nav.radius?'拖曳畫面轉頭；按住方向鍵移動':'拍攝位置變化不足，無法估算移動範圍；仍可轉動視角');frame=requestAnimationFrame(tick)},
    stop(){active=false;held.clear();drag=null;if(frame)cancelAnimationFrame(frame);frame=0;last=0},
    dispose(){this.stop();for(const off of listeners)off()},
  };
}
