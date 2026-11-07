import {openStore,listProjects,getProject,putProject,deleteProject} from './captures.mjs';
import {parseGaussianPly} from './ply-reader.mjs';
import {moveWithCollisions,CHARACTER_RADIUS} from './movement.mjs';
import {boundsObstacles,cameraCenter,cameraPose,findSafeStart,makeDefaultCalibration,pointCloudBounds,validateWalkScene,worldToScene} from './walk-scene.mjs';

const $=id=>document.getElementById(id);
const PAGE_STATUS=$('pageStatus'),PROJECT_PICKER=$('projectPicker'),PLAN_CANVAS=$('planCanvas'),RENDER_CANVAS=$('renderCanvas');
const NUM_FIELDS={
  'unitsPerMeter':['calibration','unitsPerMeter'],'headingDeg':['calibration','headingDeg'],
  'originX':['calibration','origin',0],'originY':['calibration','origin',1],'originZ':['calibration','origin',2],
  'floorHeight':['calibration','floorHeight'],
};
let db=null,projects=[],currentProject=null,model=null,scene=null,selectedObstacle=null,mapState=null,resizeObserver=null;
let gpuReady=false,gpuChecked=false,loading=false,walkSession=null,walking=false,walkFrame=0,lastWalkFrame=0,player={x:0,z:0},yaw=0,pitch=0,drag=null;
const held=new Set();

function message(text,kind='info'){PAGE_STATUS.textContent=text;PAGE_STATUS.dataset.kind=kind}
function projectMessage(text,kind='info'){
  const unsupported=gpuChecked&&!gpuReady;
  message(`${text}${unsupported?' 此瀏覽器未啟用 WebGPU；校正與儲存仍可使用，但無法顯示第一人稱預覽。':''}`,unsupported?'warning':kind);
}
function walkMessage(text=''){$('walkMessage').textContent=text}
function clone(value){return JSON.parse(JSON.stringify(value))}
function createId(){
  const source=globalThis.crypto;
  if(source?.randomUUID)return source.randomUUID();
  if(source?.getRandomValues){const bytes=source.getRandomValues(new Uint8Array(16));bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;return [...bytes].map((value,index)=>`${[4,6,8,10].includes(index)?'-':''}${value.toString(16).padStart(2,'0')}`).join('')}
  return `scene-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
function validCameras(cameras){return(Array.isArray(cameras)?cameras:[]).filter(c=>Array.isArray(c?.R)&&c.R.length===9&&Array.isArray(c?.t)&&c.t.length===3&&[...c.R,...c.t].every(Number.isFinite))}
function finiteInput(id){const text=$(id).value.trim();return text===''?NaN:Number(text)}
function formatNumber(value){return Number.isFinite(value)?String(Number(value.toFixed(3))):''}
function setInput(id,value){$(id).value=formatNumber(value)}

function defaultScene(record,parsed){
  const cameras=validCameras(record.cameras);
  const defaults=makeDefaultCalibration(cameras,parsed.data),savedCalibration=record.scene?.calibration||{};
  const vector=(value,fallback)=>Array.isArray(value)&&value.length===3&&value.every(Number.isFinite)?value:fallback;
  const calibration={...defaults,...clone(savedCalibration),
    origin:vector(savedCalibration.origin,defaults.origin),up:vector(savedCalibration.up,defaults.up),forward:vector(savedCalibration.forward,defaults.forward),
    unitsPerMeter:Number.isFinite(savedCalibration.unitsPerMeter)?savedCalibration.unitsPerMeter:defaults.unitsPerMeter,
    headingDeg:Number.isFinite(savedCalibration.headingDeg)?savedCalibration.headingDeg:defaults.headingDeg,
    floorHeight:Number.isFinite(savedCalibration.floorHeight)?savedCalibration.floorHeight:defaults.floorHeight,
  };
  const computedBounds=pointCloudBounds(parsed.data,calibration);
  const saved=record.scene;
  const savedBounds=saved?.bounds;
  const bounds=savedBounds&&[savedBounds.minX,savedBounds.maxX,savedBounds.minZ,savedBounds.maxZ].every(Number.isFinite)&&savedBounds.minX<savedBounds.maxX&&savedBounds.minZ<savedBounds.maxZ?clone(savedBounds):computedBounds;
  const initial={
    calibration:{...makeDefaultCalibration(cameras,parsed.data),...calibration,origin:Array.isArray(calibration.origin)?calibration.origin:[0,0,0]},
    bounds,
    obstacles:Array.isArray(saved?.obstacles)?clone(saved.obstacles).map((item,index)=>({...item,id:typeof item?.id==='string'&&item.id?item.id:createId(),name:typeof item?.name==='string'&&item.name.trim()?item.name.trim().slice(0,48):`碰撞區 ${index+1}`})):[],
    start:saved?.start&&Number.isFinite(saved.start.x)&&Number.isFinite(saved.start.z)?clone(saved.start):{x:(bounds.minX+bounds.maxX)/2,z:(bounds.minZ+bounds.maxZ)/2},
  };
  validateWalkScene(initial);
  return initial;
}

function updateButtons(){
  const loaded=Boolean(model&&scene&&currentProject);
  $('saveScene').disabled=!loaded||loading;
  $('startWalk').disabled=!loaded||!gpuReady||loading;
  $('fitBounds').disabled=!loaded||loading;
  $('addObstacle').disabled=!loaded||loading||scene?.obstacles?.length>=100;
  $('deleteProject').disabled=!db||!currentProject||!projects.some(item=>item.id===currentProject.id)||loading;
  $('refreshProjects').disabled=loading;
  if(gpuChecked&&!gpuReady&&!loading)$('startWalk').title='此瀏覽器目前無法啟用 WebGPU；校正和儲存仍可使用。';
  else $('startWalk').removeAttribute('title');
}

async function refreshProjects(preferredId=currentProject?.id){
  try{
    if(!db)db=await openStore();
    projects=(await listProjects(db)).sort((a,b)=>(b.updated||b.created||0)-(a.updated||a.created||0));
    PROJECT_PICKER.replaceChildren();
    if(!projects.length){const option=document.createElement('option');option.value='';option.textContent='尚無已儲存場景';PROJECT_PICKER.append(option)}
    for(const project of projects){const option=document.createElement('option');option.value=project.id;option.textContent=`${project.name||'未命名場景'}${project.updated?` · ${new Date(project.updated).toLocaleDateString('zh-TW')}`:''}`;PROJECT_PICKER.append(option)}
    if(preferredId&&projects.some(item=>item.id===preferredId))PROJECT_PICKER.value=preferredId;
    else if(!currentProject)PROJECT_PICKER.value=projects[0]?.id||'';
  }catch(error){message(`無法讀取瀏覽器中的場景清單：${error.message||error}`,'warning')}
  updateButtons();
}

function disposeView(){
  if(walkFrame)cancelAnimationFrame(walkFrame);walkFrame=0;walking=false;held.clear();
  try{walkSession?.pause();walkSession?.dispose()}catch{}
  walkSession=null;
}

async function acceptProject(record,{imported=false}={}){
  if(!record?.ply)throw new Error('找不到此場景保存的 PLY 模型。');
  loading=true;updateButtons();message('正在讀取並解析 Gaussian PLY…');
  try{
    const parsed=await parseGaussianPly(record.ply);
    const candidate=defaultScene(record,parsed);
    disposeView();
    model=parsed;scene=candidate;currentProject=record;selectedObstacle=null;
    $('projectName').value=record.name||'';
    $('modelSummary').textContent=`${parsed.n.toLocaleString('zh-TW')} 個 Gaussian · ${(record.ply.size/1024/1024).toFixed(1)} MB`;
    $('planEmpty').hidden=true;
    renderFields();renderObstacles();renderPlan();
    if(imported){PROJECT_PICKER.value='';projectMessage(`已載入「${record.name}」；校正尚未儲存，按「儲存校正」即可保留在此瀏覽器。`,'warning')}
    else projectMessage(`已載入「${record.name||'未命名場景'}」。請用點雲、已知尺寸和現場測量手動校正。`);
  }finally{loading=false;updateButtons()}
}

function renderFields(){
  if(!scene)return;
  const c=scene.calibration;
  setInput('unitsPerMeter',c.unitsPerMeter);setInput('headingDeg',c.headingDeg||0);
  setInput('originX',c.origin[0]);setInput('originY',c.origin[1]);setInput('originZ',c.origin[2]);setInput('floorHeight',c.floorHeight||0);
  setInput('boundMinX',scene.bounds.minX);setInput('boundMaxX',scene.bounds.maxX);setInput('boundMinZ',scene.bounds.minZ);setInput('boundMaxZ',scene.bounds.maxZ);
  setInput('startX',scene.start.x);setInput('startZ',scene.start.z);
  $('projectName').value=currentProject?.name||'';
}

function obstacleChanged(obstacle,key,value,input){
  const previous=obstacle[key];obstacle[key]=value;
  try{validateWalkScene(scene);input.value=key==='name'?value:formatNumber(value);renderPlan();walkMessage('')}
  catch(error){obstacle[key]=previous;input.value=key==='name'?previous:formatNumber(previous);message(error.message,'warning')}
}

function renderObstacles(){
  const list=$('obstacleList');list.replaceChildren();
  if(!scene?.obstacles?.length){const empty=document.createElement('p');empty.className='obstacle-empty';empty.textContent='還沒有人工碰撞區。拖曳俯視圖中的空白處，或按「新增」。';list.append(empty);return}
  for(const [index,obstacle] of scene.obstacles.entries()){
    const card=document.createElement('article');card.className='obstacle-card';card.setAttribute('aria-selected',String(selectedObstacle===obstacle.id));
    const head=document.createElement('div');head.className='obstacle-card-head';
    const select=document.createElement('button');select.type='button';select.className='obstacle-select';select.textContent=`${index+1}. ${obstacle.name||'碰撞區'}`;select.setAttribute('aria-pressed',String(selectedObstacle===obstacle.id));select.onclick=()=>{selectedObstacle=obstacle.id;renderObstacles();renderPlan()};
    const remove=document.createElement('button');remove.type='button';remove.className='obstacle-remove';remove.textContent='×';remove.setAttribute('aria-label',`刪除${obstacle.name||`碰撞區 ${index+1}`}`);remove.onclick=()=>{scene.obstacles=scene.obstacles.filter(item=>item.id!==obstacle.id);if(selectedObstacle===obstacle.id)selectedObstacle=null;renderObstacles();renderPlan();updateButtons();message('已移除碰撞區；請儲存校正以保留變更。','warning')};
    head.append(select,remove);
    const nameLabel=document.createElement('label');nameLabel.textContent='名稱';const nameInput=document.createElement('input');nameInput.type='text';nameInput.maxLength=48;nameInput.value=obstacle.name||`碰撞區 ${index+1}`;nameInput.setAttribute('aria-label',`碰撞區 ${index+1} 名稱`);nameInput.addEventListener('change',()=>{obstacleChanged(obstacle,'name',nameInput.value.trim()||`碰撞區 ${index+1}`,nameInput);select.textContent=`${index+1}. ${obstacle.name}`;remove.setAttribute('aria-label',`刪除${obstacle.name}`)});nameLabel.append(nameInput);
    const fields=document.createElement('div');fields.className='obstacle-fields';
    for(const [key,label] of [['minX','左 X'],['maxX','右 X'],['minZ','前 Z'],['maxZ','後 Z']]){const fieldLabel=document.createElement('label');fieldLabel.textContent=label;const input=document.createElement('input');input.type='number';input.step='0.1';input.inputMode='decimal';input.value=formatNumber(obstacle[key]);input.setAttribute('aria-label',`${obstacle.name||`碰撞區 ${index+1}`} ${label}`);input.addEventListener('change',()=>{const value=finiteInputValue(input);if(!Number.isFinite(value)){input.value=formatNumber(obstacle[key]);return}obstacleChanged(obstacle,key,value,input)});fieldLabel.append(input);fields.append(fieldLabel)}
    card.append(head,nameLabel,fields);list.append(card);
  }
}

function finiteInputValue(input){const text=input.value.trim();return text===''?NaN:Number(text)}

function setCalibrationField(id){
  const value=finiteInput(id);if(!Number.isFinite(value)){message('請輸入有效數字。','warning');renderFields();return}
  const [group,key,index]=NUM_FIELDS[id];const previous=clone(scene.calibration);
  if(index===undefined)scene.calibration[key]=value;else scene.calibration[key][index]=value;
  try{validateWalkScene(scene);message('校正已變更；請檢查點雲與範圍，並儲存變更。','warning');renderPlan()}
  catch(error){scene.calibration=previous;message(error.message,'warning');renderFields()}
}

function setBoundsFromFields(){
  const next={minX:finiteInput('boundMinX'),maxX:finiteInput('boundMaxX'),minZ:finiteInput('boundMinZ'),maxZ:finiteInput('boundMaxZ')};
  const previous=scene.bounds;scene.bounds=next;
  try{validateWalkScene(scene);renderFields();renderPlan();message('步行範圍已變更；請儲存校正以保留變更。','warning')}
  catch(error){scene.bounds=previous;renderFields();message(error.message,'warning')}
}

function setStartFromFields(){
  const x=finiteInput('startX'),z=finiteInput('startZ');
  if(!Number.isFinite(x)||!Number.isFinite(z)){renderFields();message('起點 X、Z 都必須是有效數字。','warning');return}
  scene.start={x,z};renderPlan();message('步行起點已變更；請儲存校正以保留變更。','warning')
}

function planSize(){
  const rect=PLAN_CANVAS.getBoundingClientRect();if(!rect.width||!rect.height)return null;
  const ratio=Math.min(2,window.devicePixelRatio||1);const width=Math.round(rect.width*ratio),height=Math.round(rect.height*ratio);
  if(PLAN_CANVAS.width!==width||PLAN_CANVAS.height!==height){PLAN_CANVAS.width=width;PLAN_CANVAS.height=height}
  const ctx=PLAN_CANVAS.getContext('2d');ctx.setTransform(ratio,0,0,ratio,0,0);
  return{ctx,w:rect.width,h:rect.height,ratio};
}

function renderPlan(preview=null){
  const size=planSize();if(!size)return;const{ctx,w,h}=size;ctx.clearRect(0,0,w,h);ctx.fillStyle='#101715';ctx.fillRect(0,0,w,h);mapState=null;
  if(!model||!scene){$('planEmpty').hidden=false;return}
  $('planEmpty').hidden=true;
  const bounds=scene.bounds,pad=30,scale=Math.min((w-2*pad)/(bounds.maxX-bounds.minX),(h-2*pad)/(bounds.maxZ-bounds.minZ));
  if(!Number.isFinite(scale)||scale<=0)return;
  mapState={bounds,pad,scale,w,h};
  const xAt=x=>pad+(x-bounds.minX)*scale,yAt=z=>pad+(bounds.maxZ-z)*scale;
  const left=xAt(bounds.minX),right=xAt(bounds.maxX),top=yAt(bounds.maxZ),bottom=yAt(bounds.minZ);
  ctx.fillStyle='#151e19';ctx.fillRect(left,top,right-left,bottom-top);
  ctx.save();ctx.beginPath();ctx.rect(left,top,right-left,bottom-top);ctx.clip();
  ctx.strokeStyle='rgba(160,184,157,.11)';ctx.lineWidth=1;
  const minStep=28/scale,magnitude=10**Math.floor(Math.log10(minStep)),step=[1,2,5,10].map(n=>n*magnitude).find(n=>n>=minStep);
  const firstX=Math.ceil(bounds.minX/step)*step;for(let i=0;i<100;i++){const x=firstX+i*step;if(x>=bounds.maxX)break;const sx=xAt(x);ctx.beginPath();ctx.moveTo(sx,top);ctx.lineTo(sx,bottom);ctx.stroke()}
  const firstZ=Math.ceil(bounds.minZ/step)*step;for(let i=0;i<100;i++){const z=firstZ+i*step;if(z>=bounds.maxZ)break;const sy=yAt(z);ctx.beginPath();ctx.moveTo(left,sy);ctx.lineTo(right,sy);ctx.stroke()}
  const stride=16,count=model.n,sample=Math.max(1,Math.ceil(count/12000));ctx.fillStyle='rgba(202,232,165,.38)';
  for(let i=0;i<count;i+=sample){const at=i*stride,p=worldToScene([model.data[at],model.data[at+1],model.data[at+2]],scene.calibration);if(p.x<bounds.minX||p.x>bounds.maxX||p.z<bounds.minZ||p.z>bounds.maxZ)continue;ctx.beginPath();ctx.arc(xAt(p.x),yAt(p.z),Math.max(.8,Math.min(1.8,scale*.035)),0,Math.PI*2);ctx.fill()}
  for(const camera of validCameras(currentProject?.cameras)){const center=cameraCenter(camera),p=worldToScene(center,scene.calibration);if(p.x<bounds.minX||p.x>bounds.maxX||p.z<bounds.minZ||p.z>bounds.maxZ)continue;ctx.fillStyle='#69c9e2';ctx.beginPath();ctx.arc(xAt(p.x),yAt(p.z),3.2,0,Math.PI*2);ctx.fill()}
  for(const obstacle of scene.obstacles)drawObstacle(ctx,obstacle,xAt,yAt,scale,obstacle.id===selectedObstacle);
  if(preview){const x1=Math.min(preview.start.x,preview.current.x),x2=Math.max(preview.start.x,preview.current.x),z1=Math.min(preview.start.z,preview.current.z),z2=Math.max(preview.start.z,preview.current.z);ctx.fillStyle='rgba(226,160,120,.3)';ctx.strokeStyle='#e2a078';ctx.setLineDash([5,4]);ctx.fillRect(xAt(x1),yAt(z2),(x2-x1)*scale,(z2-z1)*scale);ctx.strokeRect(xAt(x1),yAt(z2),(x2-x1)*scale,(z2-z1)*scale);ctx.setLineDash([])}
  const sx=xAt(scene.start.x),sy=yAt(scene.start.z);ctx.fillStyle='#e8dc85';ctx.strokeStyle='#121914';ctx.lineWidth=2;ctx.beginPath();ctx.arc(sx,sy,7,0,Math.PI*2);ctx.fill();ctx.stroke();
  ctx.restore();ctx.strokeStyle='rgba(210,230,202,.45)';ctx.lineWidth=1;ctx.strokeRect(left,top,right-left,bottom-top);
}

function drawObstacle(ctx,obstacle,xAt,yAt,scale,selected){
  const left=xAt(obstacle.minX),top=yAt(obstacle.maxZ),width=(obstacle.maxX-obstacle.minX)*scale,height=(obstacle.maxZ-obstacle.minZ)*scale;
  ctx.fillStyle=selected?'rgba(236,187,120,.5)':'rgba(226,160,120,.34)';ctx.strokeStyle=selected?'#f1d58a':'#e2a078';ctx.lineWidth=selected?2.5:1.5;ctx.fillRect(left,top,width,height);ctx.strokeRect(left,top,width,height);
}

function planPoint(event){
  if(!mapState)return null;const rect=PLAN_CANVAS.getBoundingClientRect(),px=event.clientX-rect.left,py=event.clientY-rect.top,{bounds,pad,scale}=mapState;
  return{x:Math.min(bounds.maxX,Math.max(bounds.minX,bounds.minX+(px-pad)/scale)),z:Math.min(bounds.maxZ,Math.max(bounds.minZ,bounds.maxZ-(py-pad)/scale))};
}

function findObstacleAt(point){
  for(let i=scene.obstacles.length-1;i>=0;i--){const box=scene.obstacles[i];if(point.x>=box.minX&&point.x<=box.maxX&&point.z>=box.minZ&&point.z<=box.maxZ)return box}
  return null;
}

function finishDraw(point){
  if(scene.obstacles.length>=100){message('人工碰撞區最多只能有 100 個。','warning');return}
  const minX=Math.min(drag.start.x,point.x),maxX=Math.max(drag.start.x,point.x),minZ=Math.min(drag.start.z,point.z),maxZ=Math.max(drag.start.z,point.z);
  if(maxX-minX<.2||maxZ-minZ<.2){message('拖曳距離太短；請至少畫出 0.2 公尺寬、深的碰撞區。','warning');return}
  const item={id:createId(),name:`碰撞區 ${scene.obstacles.length+1}`,minX,maxX,minZ,maxZ};scene.obstacles.push(item);selectedObstacle=item.id;renderObstacles();updateButtons();message('已新增碰撞區；可用數值欄位精修，再儲存校正。','warning')
}

PLAN_CANVAS.addEventListener('pointerdown',event=>{
  if(!scene||walking||!mapState)return;event.preventDefault();const point=planPoint(event);if(!point)return;
  PLAN_CANVAS.setPointerCapture(event.pointerId);const hit=findObstacleAt(point);
  if(hit){selectedObstacle=hit.id;drag={type:'move',start:point,initial:{minX:hit.minX,maxX:hit.maxX,minZ:hit.minZ,maxZ:hit.maxZ},id:hit.id};renderObstacles()}
  else drag={type:'draw',start:point,current:point};
  renderPlan(drag?.type==='draw'?drag:null);
});
PLAN_CANVAS.addEventListener('pointermove',event=>{
  if(!drag)return;const point=planPoint(event);if(!point)return;
  if(drag.type==='draw'){drag.current=point;renderPlan(drag)}
  else{const obstacle=scene.obstacles.find(item=>item.id===drag.id);if(!obstacle)return;const dx=point.x-drag.start.x,dz=point.z-drag.start.z;obstacle.minX=drag.initial.minX+dx;obstacle.maxX=drag.initial.maxX+dx;obstacle.minZ=drag.initial.minZ+dz;obstacle.maxZ=drag.initial.maxZ+dz;renderPlan()}
});
function endPlanPointer(event){
  if(!drag)return;const point=planPoint(event)||drag.current;
  if(drag.type==='draw'&&point)finishDraw(point);
  else if(drag.type==='move'){renderObstacles();message('碰撞區位置已變更；請儲存校正以保留變更。','warning')}
  drag=null;renderPlan();updateButtons();
}
PLAN_CANVAS.addEventListener('pointerup',endPlanPointer);
PLAN_CANVAS.addEventListener('pointercancel',()=>{
  if(drag?.type==='move'){const obstacle=scene?.obstacles.find(item=>item.id===drag.id);if(obstacle)Object.assign(obstacle,drag.initial);renderObstacles()}
  drag=null;renderPlan();updateButtons();
});

function addObstacleAtCenter(){
  if(!scene||scene.obstacles.length>=100)return;const centerX=(scene.bounds.minX+scene.bounds.maxX)/2,centerZ=(scene.bounds.minZ+scene.bounds.maxZ)/2,w=Math.min(1,(scene.bounds.maxX-scene.bounds.minX)/3),d=Math.min(1,(scene.bounds.maxZ-scene.bounds.minZ)/3);
  const item={id:createId(),name:`碰撞區 ${scene.obstacles.length+1}`,minX:centerX-w/2,maxX:centerX+w/2,minZ:centerZ-d/2,maxZ:centerZ+d/2};scene.obstacles.push(item);selectedObstacle=item.id;renderObstacles();renderPlan();updateButtons();message('已新增碰撞區；請設定位置和尺寸，再儲存校正。','warning')
}

function resizeRenderCanvas(){
  if(!walking||!walkSession)return;const rect=RENDER_CANVAS.getBoundingClientRect();if(!rect.width||!rect.height)return;
  const dpr=Math.min(2,window.devicePixelRatio||1,2048/rect.width,1600/rect.height);const width=Math.max(1,Math.round(rect.width*dpr)),height=Math.max(1,Math.round(rect.height*dpr));
  if(RENDER_CANVAS.width!==width||RENDER_CANVAS.height!==height){RENDER_CANVAS.width=width;RENDER_CANVAS.height=height;updateViewCamera()}
}

function updateViewCamera(){
  if(!walkSession||!walking||!RENDER_CANVAS.width||!RENDER_CANVAS.height)return;
  walkSession.view.setCamera(cameraPose(scene.calibration,player,{yaw,pitch,eyeHeight:1.62,width:RENDER_CANVAS.width,height:RENDER_CANVAS.height,fovDeg:76,floorHeight:scene.calibration.floorHeight||0}));
}

function tickWalk(now){
  if(!walking)return;walkFrame=requestAnimationFrame(tickWalk);
  if(now-lastWalkFrame<20)return;const dt=Math.min(.06,(now-(lastWalkFrame||now))/1000);lastWalkFrame=now;
  const forward=(held.has('forward')?1:0)-(held.has('back')?1:0),strafe=(held.has('right')?1:0)-(held.has('left')?1:0);
  if(!forward&&!strafe)return;
  const length=Math.hypot(forward,strafe)||1,speed=1.7*dt/length,dx=(Math.sin(yaw)*forward+Math.cos(yaw)*strafe)*speed,dz=(-Math.cos(yaw)*forward+Math.sin(yaw)*strafe)*speed;
  const result=moveWithCollisions(player,{x:dx,z:dz},[...scene.obstacles,...boundsObstacles(scene.bounds,.2)],CHARACTER_RADIUS);
  const moved=Math.abs(result.x-player.x)>1e-5||Math.abs(result.z-player.z)>1e-5;player={x:result.x,z:result.z};
  if(result.hit)walkMessage(`已由「${result.hit}」碰撞區阻擋；可沿邊緣移動。`);else walkMessage('');
  if(moved)updateViewCamera();
}

async function startWalk(){
  if(loading||!scene||!model||!gpuReady)return;
  try{validateWalkScene(scene);player=findSafeStart(scene,CHARACTER_RADIUS)}
  catch(error){message(error.message,'error');return}
  if(player.x!==scene.start.x||player.z!==scene.start.z){scene.start={...player};renderFields();message('原起點落在障礙物或範圍外，已移至最近可站立位置。儲存前可再調整。','warning')}
  loading=true;updateButtons();message('正在準備本機 WebGPU 步行預覽；請保持頁面開啟。');
  try{
    if(!walkSession){const{createSession}=await import('../vendor/splat-js/src/session.js');walkSession=createSession({lowMem:true,maxViewW:2048,maxViewH:1600,trainer:{shDeg:0,mipComp:false}});await walkSession.seedFrom({data:model.data,n:model.n,dc:'sigmoid',shK:0},{viewOnly:true,sceneRadius:model.radius})}
    $('planStage').hidden=true;$('renderStage').hidden=false;$('returnToPlan').hidden=false;$('stageTitle').textContent='個人場景第一人稱視角';document.body.classList.add('is-walking');
    walking=true;yaw=0;pitch=0;lastWalkFrame=0;await new Promise(resolve=>requestAnimationFrame(resolve));resizeRenderCanvas();
    if(!walkSession.view.canvas)walkSession.view.attach(RENDER_CANVAS);
    updateViewCamera();walkSession.view.renderNow();RENDER_CANVAS.focus({preventScroll:true});walkFrame=requestAnimationFrame(tickWalk);walkMessage('使用 WASD／方向鍵或觸控方向鍵移動；拖曳模型畫面調整視角。');message('個人場景步行中。碰撞僅包含你設定的矩形區與步行範圍邊界。');
  }catch(error){walking=false;$('renderStage').hidden=true;$('planStage').hidden=false;$('returnToPlan').hidden=true;document.body.classList.remove('is-walking');message(`無法啟動步行預覽：${error.message||error}`,'error');try{walkSession?.dispose()}catch{}walkSession=null}
  finally{loading=false;updateButtons()}
}

function stopWalk(){
  if(!walking)return;walking=false;if(walkFrame)cancelAnimationFrame(walkFrame);walkFrame=0;held.clear();scene.start={...player};renderFields();
  $('renderStage').hidden=true;$('planStage').hidden=false;$('returnToPlan').hidden=true;$('stageTitle').textContent='俯視校正平面';document.body.classList.remove('is-walking');renderPlan();walkMessage('目前位置已設為新的步行起點；按「儲存校正」保留變更。');message('已返回校正平面。');
}

async function saveScene(){
  if(!currentProject||!model||!scene)return;loading=true;updateButtons();message('正在將 PLY 和場景校正寫入此瀏覽器…');
  try{
    validateWalkScene(scene);if(!db)db=await openStore();const name=$('projectName').value.trim().slice(0,80)||'未命名場景';
    const updated={...currentProject,name,scene:clone(scene),updated:Date.now(),version:1};await putProject(db,updated);currentProject=updated;await refreshProjects(updated.id);message(`已儲存「${name}」；PLY、尺度、地板、範圍和人工碰撞區都留在此瀏覽器。`)
  }catch(error){message(`儲存失敗：${error.message||error}`,'error')}
  finally{loading=false;updateButtons()}
}

async function removeProject(){
  if(!db||!currentProject||!projects.some(item=>item.id===currentProject.id))return;
  if(!window.confirm(`確定刪除「${currentProject.name||'未命名場景'}」及其本機 PLY 嗎？此操作無法復原。`))return;
  try{await deleteProject(db,currentProject.id);disposeView();model=null;scene=null;currentProject=null;selectedObstacle=null;$('modelSummary').textContent='尚未載入模型';$('planEmpty').hidden=false;$('projectName').value='';renderObstacles();renderPlan();await refreshProjects(null);message('已刪除此瀏覽器中的場景。')}
  catch(error){message(`刪除失敗：${error.message||error}`,'error')}
}

async function importPly(file){
  if(!file)return;const name=file.name.replace(/\.ply$/i,'').slice(0,80)||'匯入場景';
  const record={id:createId(),name,created:Date.now(),updated:Date.now(),ply:file,cameras:[],version:1};
  try{await acceptProject(record,{imported:true});PROJECT_PICKER.value=''}catch(error){message(`PLY 載入失敗：${error.message||error}`,'error')}
}

function clearForNoProject(){
  disposeView();model=null;scene=null;currentProject=null;selectedObstacle=null;$('modelSummary').textContent='尚未載入模型';$('planEmpty').hidden=false;$('projectName').value='';renderObstacles();renderPlan();updateButtons();
}

for(const id of Object.keys(NUM_FIELDS))$(id).addEventListener('change',()=>setCalibrationField(id));
for(const id of ['boundMinX','boundMaxX','boundMinZ','boundMaxZ'])$(id).addEventListener('change',setBoundsFromFields);
for(const id of ['startX','startZ'])$(id).addEventListener('change',setStartFromFields);
$('projectName').addEventListener('change',()=>{if(currentProject)currentProject={...currentProject,name:$('projectName').value.trim().slice(0,80)||'未命名場景'}});
$('fitBounds').addEventListener('click',()=>{if(!scene||!model)return;scene.bounds=pointCloudBounds(model.data,scene.calibration);scene.start={x:(scene.bounds.minX+scene.bounds.maxX)/2,z:(scene.bounds.minZ+scene.bounds.maxZ)/2};renderFields();renderPlan();message('已依目前校正重算範圍與起點；人工碰撞區維持原座標，請檢查並儲存。','warning')});
$('addObstacle').addEventListener('click',addObstacleAtCenter);$('saveScene').addEventListener('click',saveScene);$('startWalk').addEventListener('click',startWalk);$('returnToPlan').addEventListener('click',stopWalk);$('deleteProject').addEventListener('click',removeProject);
$('refreshProjects').addEventListener('click',()=>refreshProjects());
$('plyFile').addEventListener('change',async event=>{await importPly(event.target.files?.[0]);event.target.value=''});
PROJECT_PICKER.addEventListener('change',async()=>{const id=PROJECT_PICKER.value;if(!id)return;try{const record=await getProject(db,id);await acceptProject(record)}catch(error){message(`無法載入場景：${error.message||error}`,'error')}});

for(const button of document.querySelectorAll('[data-move]')){
  const direction=button.dataset.move;
  button.addEventListener('pointerdown',event=>{event.preventDefault();button.setPointerCapture(event.pointerId);held.add(direction);button.classList.add('pressed')});
  const release=()=>{held.delete(direction);button.classList.remove('pressed')};
  button.addEventListener('pointerup',release);button.addEventListener('pointercancel',release);button.addEventListener('lostpointercapture',release);
}

RENDER_CANVAS.addEventListener('pointerdown',event=>{if(!walking)return;event.preventDefault();drag={pointerId:event.pointerId,x:event.clientX,y:event.clientY};RENDER_CANVAS.setPointerCapture(event.pointerId)});
RENDER_CANVAS.addEventListener('pointermove',event=>{if(!walking||!drag||drag.pointerId!==event.pointerId)return;const dx=event.clientX-drag.x,dy=event.clientY-drag.y;drag.x=event.clientX;drag.y=event.clientY;yaw+=dx*.004;pitch=Math.max(-1.15,Math.min(1.15,pitch-dy*.004));updateViewCamera()});
function releaseLook(){drag=null}
RENDER_CANVAS.addEventListener('pointerup',releaseLook);RENDER_CANVAS.addEventListener('pointercancel',releaseLook);

const KEY_DIRECTIONS={KeyW:'forward',ArrowUp:'forward',KeyS:'back',ArrowDown:'back',KeyA:'left',ArrowLeft:'left',KeyD:'right',ArrowRight:'right'};
window.addEventListener('keydown',event=>{if(!walking)return;const active=document.activeElement,editing=active instanceof HTMLInputElement||active instanceof HTMLTextAreaElement||active instanceof HTMLSelectElement;if(editing)return;if(event.key==='Escape'){stopWalk();return}const direction=KEY_DIRECTIONS[event.code];if(direction){event.preventDefault();held.add(direction)}});
window.addEventListener('keyup',event=>{const direction=KEY_DIRECTIONS[event.code];if(direction)held.delete(direction)});
window.addEventListener('blur',()=>held.clear());
window.addEventListener('keydown',event=>{const active=document.activeElement,editing=active instanceof HTMLInputElement||active instanceof HTMLTextAreaElement||active instanceof HTMLSelectElement;if(event.key==='Delete'&&selectedObstacle&&!editing&&!walking){scene.obstacles=scene.obstacles.filter(item=>item.id!==selectedObstacle);selectedObstacle=null;renderObstacles();renderPlan();updateButtons();message('已移除選取的碰撞區；請儲存校正以保留變更。','warning')}});

if(typeof ResizeObserver==='function'){resizeObserver=new ResizeObserver(()=>{renderPlan();resizeRenderCanvas()});resizeObserver.observe(PLAN_CANVAS);resizeObserver.observe(RENDER_CANVAS)}
else window.addEventListener('resize',()=>{renderPlan();resizeRenderCanvas()});
window.addEventListener('pagehide',()=>{disposeView();resizeObserver?.disconnect()});

async function initialize(){
  renderPlan();renderObstacles();
  try{db=await openStore();await refreshProjects(null)}catch(error){message(`無法開啟瀏覽器本機儲存：${error.message||error}。仍可匯入 PLY 進行暫存校正。`,'warning')}
  try{if(navigator.gpu){const adapter=await navigator.gpu.requestAdapter();gpuReady=Boolean(adapter)}gpuChecked=true}
  catch{gpuChecked=true;gpuReady=false}
  updateButtons();
  if(!gpuReady){if(currentProject)projectMessage(`已載入「${currentProject.name||'未命名場景'}」。請用點雲、已知尺寸和現場測量手動校正。`);else message('可載入 PLY、編輯並儲存校正；此瀏覽器未啟用 WebGPU，因此無法顯示第一人稱 GPU 預覽。','warning')}
  const requested=new URLSearchParams(location.search).get('project');
  if(requested){try{const record=await getProject(db,requested);if(record)await acceptProject(record);else message('找不到連結中的場景；請從清單選擇或載入 PLY。','warning')}catch(error){message(`場景載入失敗：${error.message||error}`,'error')}}
  else if(projects.length){try{await acceptProject(projects[0])}catch(error){message(`最近場景載入失敗：${error.message||error}。可重新選擇或載入 PLY。`,'warning')}}
}

initialize();
