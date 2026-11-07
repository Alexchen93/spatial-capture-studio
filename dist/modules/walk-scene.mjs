const EPS=1e-8;
const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const sub=(a,b)=>a.map((v,i)=>v-b[i]);
const add=(a,b)=>a.map((v,i)=>v+b[i]);
const scale=(a,s)=>a.map(v=>v*s);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const normalize=v=>{const n=Math.hypot(...v);return n>EPS?v.map(x=>x/n):null};

export function cameraCenter(camera){const{R,t}=camera;return[-(R[0]*t[0]+R[3]*t[1]+R[6]*t[2]),-(R[1]*t[0]+R[4]*t[1]+R[7]*t[2]),-(R[2]*t[0]+R[5]*t[1]+R[8]*t[2])]}
function fallbackForward(up){const candidates=[[0,0,-1],[0,0,1],[1,0,0]];for(const candidate of candidates){const projected=sub(candidate,scale(up,dot(candidate,up)));const n=normalize(projected);if(n)return n}return[0,0,-1]}
function projectPoint(point,origin,up){const r=sub(point,origin);return dot(r,up)}

export function makeDefaultCalibration(cameras=[],modelData=null){
  const first=[...cameras].sort((a,b)=>(Number.isFinite(a.imgIdx)?a.imgIdx:Infinity)-(Number.isFinite(b.imgIdx)?b.imgIdx:Infinity))[0];
  const origin=first&&cameraCenter(first).every(Number.isFinite)?cameraCenter(first):[0,0,0];
  const cameraUps=cameras.map(c=>normalize([-c.R[3],-c.R[4],-c.R[5]])).filter(Boolean);
  let up=normalize(cameraUps.length?cameraUps.reduce((s,v)=>add(s,v),[0,0,0]):[0,1,0])||[0,1,0];
  let forward=null;
  for(const camera of [first,...cameras].filter(Boolean)){const dir=normalize([camera.R[6],camera.R[7],camera.R[8]]);if(!dir)continue;forward=normalize(sub(dir,scale(up,dot(dir,up))));if(forward)break}
  forward??=fallbackForward(up);let right=normalize(cross(forward,up))||[1,0,0];forward=normalize(cross(up,right))||fallbackForward(up);
  const calibration={origin,up,forward,unitsPerMeter:1,headingDeg:0,floorHeight:0};
  if(modelData?.length>=16){const heights=[];const stride=modelData.length%16===0?16:1;const step=Math.max(1,Math.ceil((modelData.length/stride)/30000));for(let i=0;i<modelData.length/stride;i+=step){const at=i*stride;const p=[modelData[at],modelData[at+1],modelData[at+2]];if(p.every(Number.isFinite))heights.push(projectPoint(p,origin,up))}heights.sort((a,b)=>a-b);if(heights.length)calibration.floorHeight=heights[Math.floor((heights.length-1)*.05)]}
  return calibration;
}

export function sceneBasis(calibration={}){
  let up=normalize((calibration.up||[0,1,0]).map(Number))||[0,1,0];let forward=(calibration.forward||[0,0,-1]).map(Number);
  forward=normalize(sub(forward,scale(up,dot(forward,up))))||fallbackForward(up);
  let right=normalize(cross(forward,up))||[1,0,0];forward=normalize(cross(up,right))||fallbackForward(up);
  const heading=(Number(calibration.headingDeg)||0)*Math.PI/180,c=Math.cos(heading),s=Math.sin(heading),baseRight=right,baseForward=forward;
  right=add(scale(baseRight,c),scale(baseForward,-s));forward=add(scale(baseForward,c),scale(baseRight,s));
  return{right,up,forward};
}

export function worldToScene(point,calibration={}){
  const{right,up,forward}=sceneBasis(calibration),origin=(calibration.origin||[0,0,0]).map(Number),units=Number(calibration.unitsPerMeter)||1,relative=sub(point,origin);
  return{x:dot(relative,right)/units,z:dot(relative,forward)/units,height:dot(relative,up)/units};
}

export function sceneToWorld(position,calibration={},height=0){
  const{right,up,forward}=sceneBasis(calibration),origin=(calibration.origin||[0,0,0]).map(Number),units=Number(calibration.unitsPerMeter)||1;
  return add(origin,scale(add(add(scale(right,position.x),scale(forward,position.z)),scale(up,height)),units));
}

export function cameraPose(calibration,position,{yaw=0,pitch=0,eyeHeight=1.65,width=640,height=360,fovDeg=78,floorHeight=calibration.floorHeight||0}={}){
  const{right,up,forward}=sceneBasis(calibration),cos=Math.cos(yaw),sin=Math.sin(yaw),cosPitch=Math.cos(pitch),sinPitch=Math.sin(pitch);
  const cameraRight=add(scale(right,cos),scale(forward,-sin));const horizontalForward=add(scale(forward,cos),scale(right,sin));
  const direction=add(scale(horizontalForward,cosPitch),scale(up,sinPitch));const cameraUp=normalize(cross(cameraRight,direction))||up;const down=scale(cameraUp,-1);
  const R=[...cameraRight,...down,...direction],world=sceneToWorld(position,calibration,floorHeight+eyeHeight),t=[-dot(R.slice(0,3),world),-dot(R.slice(3,6),world),-dot(R.slice(6,9),world)];
  const w=Math.max(1,Math.floor(width)),h=Math.max(1,Math.floor(height)),f=w/(2*Math.tan((fovDeg*Math.PI/180)/2));
  return{R,t,f,fy:f,cx:w/2,cy:h/2,w,h};
}

export function pointCloudBounds(data,calibration={},margin=.5){
  if(!data?.length)return{minX:-3,maxX:3,minZ:-3,maxZ:3};const stride=data.length%16===0?16:3,step=Math.max(1,Math.ceil((data.length/stride)/30000));let minX=Infinity,maxX=-Infinity,minZ=Infinity,maxZ=-Infinity;
  for(let i=0;i<data.length/stride;i+=step){const p=worldToScene([data[i*stride],data[i*stride+1],data[i*stride+2]],calibration);minX=Math.min(minX,p.x);maxX=Math.max(maxX,p.x);minZ=Math.min(minZ,p.z);maxZ=Math.max(maxZ,p.z)}
  if(!Number.isFinite(minX))return{minX:-3,maxX:3,minZ:-3,maxZ:3};const pad=Math.max(margin,(maxX-minX)*.06,(maxZ-minZ)*.06);if(maxX-minX<.5){minX-=.5;maxX+=.5}if(maxZ-minZ<.5){minZ-=.5;maxZ+=.5}return{minX:minX-pad,maxX:maxX+pad,minZ:minZ-pad,maxZ:maxZ+pad};
}

export function boundsObstacles(bounds,thickness){
  const{minX,maxX,minZ,maxZ}=bounds;if(![minX,maxX,minZ,maxZ].every(Number.isFinite)||minX>=maxX||minZ>=maxZ)throw new Error('步行範圍無效。');
  const t=Math.max(1e-4,Number(thickness)||Math.max(maxX-minX,maxZ-minZ));return[
    {minX:minX-t,maxX:minX,minZ:minZ-t,maxZ:maxZ+t,name:'步行範圍邊界'},
    {minX:maxX,maxX:maxX+t,minZ:minZ-t,maxZ:maxZ+t,name:'步行範圍邊界'},
    {minX:minX,maxX:maxX,minZ:minZ-t,maxZ:minZ,name:'步行範圍邊界'},
    {minX:minX,maxX:maxX,minZ:maxZ,maxZ:maxZ+t,name:'步行範圍邊界'},
  ];
}

export function findSafeStart(scene,radius=.25){
  const{bounds,start,obstacles=[]}=scene;
  const safe=position=>position.x>=bounds.minX+radius&&position.x<=bounds.maxX-radius&&position.z>=bounds.minZ+radius&&position.z<=bounds.maxZ-radius&&
    !obstacles.some(box=>position.x>=box.minX-radius&&position.x<=box.maxX+radius&&position.z>=box.minZ-radius&&position.z<=box.maxZ+radius);
  if(safe(start))return{...start};
  const minX=bounds.minX+radius,maxX=bounds.maxX-radius,minZ=bounds.minZ+radius,maxZ=bounds.maxZ-radius;
  if(minX>maxX||minZ>maxZ)throw new Error('步行範圍太窄，沒有可站立的位置。');
  const xSteps=Math.min(100,Math.max(1,Math.ceil((maxX-minX)/.4)));
  const zSteps=Math.min(100,Math.max(1,Math.ceil((maxZ-minZ)/.4)));
  let nearest=null,best=Infinity;
  for(let zi=0;zi<=zSteps;zi++)for(let xi=0;xi<=xSteps;xi++){
    const position={x:minX+(maxX-minX)*xi/xSteps,z:minZ+(maxZ-minZ)*zi/zSteps};
    if(!safe(position))continue;
    const distance=(position.x-start.x)**2+(position.z-start.z)**2;
    if(distance<best){nearest=position;best=distance}
  }
  if(!nearest)throw new Error('範圍內沒有可站立的位置；請移動或縮小碰撞區。');
  return nearest;
}

export function validateWalkScene(scene){
  const c=scene?.calibration||{};if(!Array.isArray(c.origin)||c.origin.length!==3||!c.origin.every(Number.isFinite))throw new Error('座標原點必須是三個有限數值。');
  const units=Number(c.unitsPerMeter);if(!Number.isFinite(units)||units<.001||units>10000)throw new Error('模型尺度需介於 0.001 到 10,000 模型單位／公尺。');
  for(const key of ['up','forward'])if(c[key]!==undefined&&(!Array.isArray(c[key])||c[key].length!==3||!c[key].every(Number.isFinite)))throw new Error('場景方向向量必須包含三個有限數值。');
  if(c.headingDeg!==undefined&&!Number.isFinite(c.headingDeg))throw new Error('方向修正必須是有限數值。');
  if(c.floorHeight!==undefined&&!Number.isFinite(c.floorHeight))throw new Error('地板高度偏移必須是有限數值。');
  const{minX,maxX,minZ,maxZ}=scene.bounds||{};boundsObstacles({minX:Number(minX),maxX:Number(maxX),minZ:Number(minZ),maxZ:Number(maxZ)},1);
  if(!Number.isFinite(maxX-minX)||!Number.isFinite(maxZ-minZ))throw new Error('步行範圍過大。');
  if((scene.obstacles||[]).length>100)throw new Error('人工碰撞區最多只能有 100 個。');
  for(const item of scene.obstacles||[]){if(![item.minX,item.maxX,item.minZ,item.maxZ].every(Number.isFinite)||item.minX>=item.maxX||item.minZ>=item.maxZ)throw new Error('每個碰撞區都必須有有效的寬度與深度。')}
  return true;
}
