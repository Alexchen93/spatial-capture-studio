import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setupLocalReconstruction,trainingHealthMessage} from '../dist/modules/reconstruction.mjs';
function element(){return {hidden:false,disabled:false,textContent:'',value:0,max:1,removeAttribute(){},click(){}}}
test('training is gated on device support and completes only after a real completion event',async()=>{
  const ids=['reconstructBtn','trainingPanel','trainingStage','trainingProgress','trainingBar','trainingNote','trainingPreview','pauseTraining','finishTraining','cancelTraining','exportTraining','deviceStatus','reconstructDetail','errorInfo','errorDetail','trainingHealth','personalPreviewCaption','previewViews','previewBack','previewNext','previewCount'];const elements=Object.fromEntries(ids.map(id=>[id,element()]));
  const oldDocument=globalThis.document, oldWindow=globalThis.window, oldNavigator=Object.getOwnPropertyDescriptor(globalThis,'navigator');
  globalThis.document={getElementById:id=>elements[id]};globalThis.window={addEventListener(){}};Object.defineProperty(globalThis,'navigator',{value:{gpu:{requestAdapter:async()=>({})}},configurable:true});
  let fake;class Session{constructor(){this.handlers={};this.trainer={camMeta:[{},{}]};this.view={attach(){},lookThrough(i){fake.lastView=i}};fake=this}on(n,fn){this.handlers[n]=fn}async load(f){assert.equal(f.length,8)}async solve(){}async seed(){this.handlers.stage({stage:'seed',done:1,total:1})}start(){this.started=true;this.handlers.stage({stage:'train',done:0,total:4000})}pause(){}dispose(){}async finish(){this.handlers.event({kind:'train-complete',iter:123})}}
  try{const photos=Array.from({length:8},()=>({blob:new Blob(['photo']),type:'image/jpeg'}));const control=setupLocalReconstruction(()=>photos,{loadEngine:async()=>({createSession:()=>new Session()})});await Promise.resolve();await Promise.resolve();control.refresh();assert.equal(elements.reconstructBtn.disabled,false);await elements.reconstructBtn.onclick();assert.equal(fake.started,true);assert.equal(elements.trainingStage.textContent,'重建場景中');assert.equal(elements.trainingProgress.textContent,'0%');assert.equal(elements.previewCount.textContent,'視角 1 / 2');elements.previewNext.onclick();assert.equal(fake.lastView,1);assert.equal(elements.previewCount.textContent,'視角 2 / 2');assert.equal(elements.exportTraining.hidden,true);fake.handlers.metrics({iter:120});assert.equal(elements.trainingProgress.textContent,'3%');assert.match(elements.trainingHealth.textContent,/已確認 120/);await elements.finishTraining.onclick();assert.equal(elements.exportTraining.hidden,false);assert.match(elements.trainingStage.textContent,/提前結束/);}
  finally{globalThis.document=oldDocument;globalThis.window=oldWindow;if(oldNavigator)Object.defineProperty(globalThis,'navigator',oldNavigator);else delete globalThis.navigator}
});
test('unsupported WebGPU never enables reconstruction',async()=>{
 const ids=['reconstructBtn','trainingPanel','trainingStage','trainingProgress','trainingBar','trainingNote','trainingPreview','pauseTraining','finishTraining','cancelTraining','exportTraining','deviceStatus','reconstructDetail','errorInfo','errorDetail','trainingHealth','personalPreviewCaption','previewViews','previewBack','previewNext','previewCount'];const elements=Object.fromEntries(ids.map(id=>[id,element()]));
 const oldDocument=globalThis.document,oldWindow=globalThis.window,oldNavigator=Object.getOwnPropertyDescriptor(globalThis,'navigator');globalThis.document={getElementById:id=>elements[id]};globalThis.window={addEventListener(){}};Object.defineProperty(globalThis,'navigator',{value:{},configurable:true});
 try{const control=setupLocalReconstruction(()=>Array(8).fill({blob:new Blob(['x']),type:'image/jpeg'}));control.refresh();assert.equal(elements.reconstructBtn.disabled,true);assert.match(elements.deviceStatus.textContent,/無法使用 WebGPU/)}finally{globalThis.document=oldDocument;globalThis.window=oldWindow;if(oldNavigator)Object.defineProperty(globalThis,'navigator',oldNavigator);else delete globalThis.navigator}
});
test('shows the actual failing stage and diagnostic instead of reporting success',async()=>{
  const ids=['reconstructBtn','trainingPanel','trainingStage','trainingProgress','trainingBar','trainingNote','trainingPreview','pauseTraining','finishTraining','cancelTraining','exportTraining','deviceStatus','reconstructDetail','errorInfo','errorDetail','trainingHealth','personalPreviewCaption','previewViews','previewBack','previewNext','previewCount'];const elements=Object.fromEntries(ids.map(id=>[id,element()]));
  const oldDocument=globalThis.document,oldWindow=globalThis.window,oldNavigator=Object.getOwnPropertyDescriptor(globalThis,'navigator');globalThis.document={getElementById:id=>elements[id]};globalThis.window={addEventListener(){}};Object.defineProperty(globalThis,'navigator',{value:{gpu:{requestAdapter:async()=>({})}},configurable:true});
  class Session{constructor(){this.handlers={};this.view={}}on(k,fn){this.handlers[k]=fn}async load(){}async solve(){this.handlers.stage({stage:'features',done:1,total:2});throw new Error('test GPU failure')}pause(){}dispose(){}}
  try{const p=Array(8).fill({blob:new Blob(['x']),type:'image/jpeg'});const c=setupLocalReconstruction(()=>p,{loadEngine:async()=>({createSession:()=>new Session()})});await Promise.resolve();await Promise.resolve();c.refresh();await elements.reconstructBtn.onclick();assert.match(elements.reconstructDetail.textContent,/分析影像特徵/);assert.match(elements.errorDetail.textContent,/test GPU failure/);assert.equal(elements.errorInfo.hidden,false);assert.equal(elements.exportTraining.hidden,true);assert.equal(elements.reconstructBtn.disabled,false)}finally{globalThis.document=oldDocument;globalThis.window=oldWindow;if(oldNavigator)Object.defineProperty(globalThis,'navigator',oldNavigator);else delete globalThis.navigator}
});
test('explains missing frames and prevents starting while video is processed',async()=>{
 const ids=['reconstructBtn','trainingPanel','trainingStage','trainingProgress','trainingBar','trainingNote','trainingPreview','pauseTraining','finishTraining','cancelTraining','exportTraining','deviceStatus','reconstructDetail','errorInfo','errorDetail','trainingHealth','personalPreviewCaption','previewViews','previewBack','previewNext','previewCount'];const elements=Object.fromEntries(ids.map(id=>[id,element()]));const oldDocument=globalThis.document,oldWindow=globalThis.window,oldNavigator=Object.getOwnPropertyDescriptor(globalThis,'navigator');globalThis.document={getElementById:id=>elements[id]};globalThis.window={addEventListener(){}};Object.defineProperty(globalThis,'navigator',{value:{gpu:{requestAdapter:async()=>({})}},configurable:true});
 try{const photos=Array(7).fill({blob:new Blob(['x']),type:'image/jpeg'});const c=setupLocalReconstruction(()=>photos);await Promise.resolve();await Promise.resolve();c.refresh();assert.equal(elements.reconstructBtn.disabled,true);assert.match(elements.reconstructDetail.textContent,/還需要 1 張/);photos.push(photos[0]);c.setInputBusy(true);assert.equal(elements.reconstructBtn.disabled,true);assert.match(elements.reconstructDetail.textContent,/擷取完成/);c.setInputBusy(false);assert.equal(elements.reconstructBtn.disabled,false)}finally{globalThis.document=oldDocument;globalThis.window=oldWindow;if(oldNavigator)Object.defineProperty(globalThis,'navigator',oldNavigator);else delete globalThis.navigator}
});

test('long periods without confirmed GPU updates are described as uncertain',()=>{assert.match(trainingHealthMessage(60000,45000),/可能仍在運算，也可能卡住/);assert.match(trainingHealthMessage(60000,45000,true),/可能仍在處理，也可能卡住/);assert.doesNotMatch(trainingHealthMessage(10000,10000),/卡住/)});
test('discarding training requires confirmation and leaves source frames untouched',async()=>{
 const ids=['reconstructBtn','trainingPanel','trainingStage','trainingProgress','trainingBar','trainingNote','trainingPreview','pauseTraining','finishTraining','cancelTraining','exportTraining','deviceStatus','reconstructDetail','errorInfo','errorDetail','trainingHealth','personalPreviewCaption','previewViews','previewBack','previewNext','previewCount'];const elements=Object.fromEntries(ids.map(id=>[id,element()]));
 const oldDocument=globalThis.document,oldWindow=globalThis.window,oldNavigator=Object.getOwnPropertyDescriptor(globalThis,'navigator');let answer=false;globalThis.document={getElementById:id=>elements[id]};globalThis.window={addEventListener(){},confirm:()=>answer};Object.defineProperty(globalThis,'navigator',{value:{gpu:{requestAdapter:async()=>({})}},configurable:true});let current;class Session{constructor(){current=this;this.handlers={};this.view={attach(){},lookThrough(){}}}on(k,fn){this.handlers[k]=fn}async load(){}async solve(){}async seed(){}start(){this.handlers.stage({stage:'train',done:0,total:4000})}pause(){}dispose(){this.disposed=true}}
 try{const photos=Array(8).fill({blob:new Blob(['x']),type:'image/jpeg'});const c=setupLocalReconstruction(()=>photos,{loadEngine:async()=>({createSession:()=>new Session()})});await Promise.resolve();await Promise.resolve();c.refresh();await elements.reconstructBtn.onclick();elements.cancelTraining.onclick();assert.equal(current.disposed,undefined);assert.equal(elements.trainingPanel.hidden,false);answer=true;elements.cancelTraining.onclick();assert.equal(current.disposed,true);assert.equal(elements.trainingPanel.hidden,true);assert.equal(photos.length,8)}finally{globalThis.document=oldDocument;globalThis.window=oldWindow;if(oldNavigator)Object.defineProperty(globalThis,'navigator',oldNavigator);else delete globalThis.navigator}
});
test('low-load run reports submissions and queue returns separately from metrics',async()=>{
 const ids=['reconstructBtn','trainingPanel','trainingStage','trainingProgress','trainingBar','trainingNote','trainingPreview','pauseTraining','finishTraining','cancelTraining','exportTraining','deviceStatus','reconstructDetail','errorInfo','errorDetail','trainingHealth','personalPreviewCaption','previewViews','previewBack','previewNext','previewCount','gpuDiagnostics','gpuDiagnosticText','copyGpuDiagnostics','gpuCopyStatus','lowLoadMode'];const e=Object.fromEntries(ids.map(id=>[id,element()]));e.lowLoadMode.checked=true;
 const oldDocument=globalThis.document,oldWindow=globalThis.window,oldNavigator=Object.getOwnPropertyDescriptor(globalThis,'navigator');globalThis.document={getElementById:id=>e[id],visibilityState:'visible'};globalThis.window={addEventListener(){}};Object.defineProperty(globalThis,'navigator',{value:{userAgent:'test browser',gpu:{requestAdapter:async()=>({})}},configurable:true});let config,current;
 class Session{constructor(){current=this;this.handlers={};this.trainer={iter:0,camMeta:[{}],device:{queue:{onSubmittedWorkDone:()=>Promise.resolve()}},stepOnce(){this.iter++}};this.view={attach(){},lookThrough(){}}}on(k,fn){this.handlers[k]=fn}async load(){}async solve(){}async seed(){}start(){this.handlers.stage({stage:'train',done:0,total:4000});this.trainer.stepOnce()}pause(){}dispose(){}async finish(){this.handlers.event({kind:'train-complete',iter:1})}}
 try{const photos=Array(8).fill({blob:new Blob(['x']),type:'image/jpeg'});const c=setupLocalReconstruction(()=>photos,{loadEngine:async()=>({createSession:opt=>{config=opt;return new Session()}})});await Promise.resolve();await Promise.resolve();c.refresh();await e.reconstructBtn.onclick();await Promise.resolve();assert.equal(config.frames.trainMaxDim,320);assert.equal(config.itersPerFrame,1);assert.match(e.gpuDiagnosticText.textContent,/運算模式: 低負載/);assert.match(e.gpuDiagnosticText.textContent,/已提交訓練迭代: 1/);assert.match(e.gpuDiagnosticText.textContent,/GPU 佇列回報至第: 1 次/);assert.match(e.gpuDiagnosticText.textContent,/訓練數值讀回: 0/);await e.finishTraining.onclick();assert.equal(e.exportTraining.hidden,false)}finally{globalThis.document=oldDocument;globalThis.window=oldWindow;if(oldNavigator)Object.defineProperty(globalThis,'navigator',oldNavigator);else delete globalThis.navigator}
});

test('saves completed PLY and camera poses, then exposes the personal calibration link',async()=>{
 const ids=['reconstructBtn','trainingPanel','trainingStage','trainingProgress','trainingBar','trainingNote','trainingPreview','pauseTraining','finishTraining','cancelTraining','exportTraining','deviceStatus','reconstructDetail','errorInfo','errorDetail','trainingHealth','personalPreviewCaption','previewViews','previewBack','previewNext','previewCount'];
 const nodes=Object.fromEntries(ids.map(id=>[id,element()])),created=[];nodes.trainingPanel.append=(...items)=>created.push(...items);
 const oldDocument=globalThis.document,oldWindow=globalThis.window,oldNavigator=Object.getOwnPropertyDescriptor(globalThis,'navigator');
 globalThis.document={getElementById:id=>nodes[id]||created.find(node=>node.id===id),createElement:tag=>{const node=element();node.tagName=tag;node.href='';node.setAttribute=(key,value)=>{node[key]=value};node.append=(...items)=>{node.children=[...(node.children||[]),...items]};created.push(node);return node}};
 globalThis.window={addEventListener(){}};Object.defineProperty(globalThis,'navigator',{value:{gpu:{requestAdapter:async()=>({})}},configurable:true});
 let saved,current;
 class Session{constructor(){current=this;this.handlers={};this.trainer={camMeta:[{}]};this.recon={cams:[{R:[1,0,0,0,1,0,0,0,1],t:[0,0,0],f:500,w:640,h:480,imgIdx:0}]};this.view={attach(){},lookThrough(){}}}on(key,fn){this.handlers[key]=fn}async load(){}async solve(){}async seed(){}start(){this.handlers.stage({stage:'train',done:0,total:4000})}pause(){}dispose(){}async finish(){this.handlers.event({kind:'train-complete',iter:12})}async exportPlyBlob(){return new Blob(['ply'])}}
 try{
   const photos=Array(8).fill({blob:new Blob(['x']),type:'image/jpeg'});
   const control=setupLocalReconstruction(()=>photos,{loadEngine:async()=>({createSession:()=>new Session()}),onSavePersonalScene:async value=>{saved=value;return{id:'local-scene-1'}}});
   await Promise.resolve();await Promise.resolve();control.refresh();await nodes.reconstructBtn.onclick();await nodes.finishTraining.onclick();
   const save=created.find(node=>node.id==='savePersonalScene'),link=created.find(node=>node.id==='openPersonalWalk');assert.ok(save);assert.ok(link);assert.equal(save.hidden,false);
   await save.onclick();assert.equal(save.disabled,true);assert.equal(saved.ply.size,3);assert.deepEqual(saved.cameras[0].R,[1,0,0,0,1,0,0,0,1]);assert.equal(link.hidden,false);assert.equal(link.href,'personal-walk.html?project=local-scene-1');assert.match(nodes.trainingNote.textContent,/手動校正/);
 }finally{globalThis.document=oldDocument;globalThis.window=oldWindow;if(oldNavigator)Object.defineProperty(globalThis,'navigator',oldNavigator);else delete globalThis.navigator}
});

test('live reconstruction uses only newly captured frames and refreshes after eight more',async()=>{
  const ids=['reconstructBtn','trainingPanel','trainingStage','trainingProgress','trainingBar','trainingNote','trainingPreview','pauseTraining','finishTraining','cancelTraining','exportTraining','deviceStatus','reconstructDetail','errorInfo','errorDetail','trainingHealth','personalPreviewCaption','previewViews','previewBack','previewNext','previewCount','savePersonalScene','openPersonalWalk'];
  const elements=Object.fromEntries(ids.map(id=>[id,element()]));
  const oldDocument=globalThis.document,oldWindow=globalThis.window,oldNavigator=Object.getOwnPropertyDescriptor(globalThis,'navigator');
  globalThis.document={getElementById:id=>elements[id]};globalThis.window={addEventListener(){}};Object.defineProperty(globalThis,'navigator',{value:{gpu:{requestAdapter:async()=>({})}},configurable:true});
  const sessions=[],saved=[],solved=[],steps=[],resets=[],photo=()=>({blob:new Blob(['image']),type:'image/jpeg'}),photos=Array.from({length:4},photo);
  class Session{
    constructor(config){this.config=config;this.handlers={};this.recon={cams:[{R:[1,0,0,0,-1,0,0,0,-1],t:[0,0,0],imgIdx:0}]};this.trainer={camMeta:[{}]};this.view={attach(){},lookThrough(){}};sessions.push(this)}
    on(name,fn){this.handlers[name]=fn}async load(files){this.files=files}async solve(){}async seed(){}start(){this.started=true}pause(){}dispose(){}async exportPlyBlob(){return new Blob(['ply'])}
  }
  const flush=async()=>{for(let i=0;i<8;i++)await new Promise(resolve=>setImmediate(resolve))};
  try{
    const control=setupLocalReconstruction(()=>photos,{loadEngine:async()=>({createSession:config=>new Session(config)}),onSavePersonalScene:async value=>{saved.push(value);return{id:'live-scene'}},onLiveCameras:cameras=>solved.push(cameras),onLiveProgress:(...value)=>steps.push(value),onLiveBeforeReset:()=>resets.push(sessions.length)});
    await flush();control.setLiveMode(true);assert.equal(sessions.length,0);
    photos.push(...Array.from({length:8},photo));control.refresh();await flush();
    assert.equal(sessions.length,1);assert.equal(sessions[0].files.length,8);assert.equal(sessions[0].config.maxIters,300);assert.equal(solved.length,1);assert.equal(solved[0][0].imgIdx,0);assert.deepEqual(resets,[0]);
    sessions[0].handlers.metrics({iter:50});assert.ok(steps.some(([step,done,total])=>step==='train'&&done===50&&total===300));
    photos.push(...Array.from({length:8},photo));control.refresh();assert.equal(sessions.length,1);
    sessions[0].handlers.event({kind:'train-complete',iter:300});await flush();
    assert.equal(saved.length,1);assert.equal(saved[0].live,true);assert.equal(sessions.length,2);assert.equal(sessions[1].files.length,16);assert.deepEqual(resets,[0,1]);
    control.setLiveMode(false);sessions[1].handlers.event({kind:'train-complete',iter:300});await flush();
    assert.equal(saved.length,2);assert.equal(sessions.length,2);
  }finally{globalThis.document=oldDocument;globalThis.window=oldWindow;if(oldNavigator)Object.defineProperty(globalThis,'navigator',oldNavigator);else delete globalThis.navigator}
});

test('insufficient overlapping views keep live capture available and retry after eight new frames',async()=>{
  const ids=['reconstructBtn','trainingPanel','trainingStage','trainingProgress','trainingBar','trainingNote','trainingPreview','pauseTraining','finishTraining','cancelTraining','exportTraining','deviceStatus','reconstructDetail','errorInfo','errorDetail','trainingHealth','personalPreviewCaption','previewViews','previewBack','previewNext','previewCount','savePersonalScene','openPersonalWalk'];
  const elements=Object.fromEntries(ids.map(id=>[id,element()]));
  const oldDocument=globalThis.document,oldWindow=globalThis.window,oldNavigator=Object.getOwnPropertyDescriptor(globalThis,'navigator');
  globalThis.document={getElementById:id=>elements[id]};globalThis.window={addEventListener(){}};
  Object.defineProperty(globalThis,'navigator',{value:{gpu:{requestAdapter:async()=>({})}},configurable:true});
  const photos=[],failures=[],runs=[];
  class Session{
    constructor(){this.handlers={};this.view={};runs.push(this)}
    on(name,handler){this.handlers[name]=handler}
    async load(){}
    async solve(){this.handlers.stage({stage:'pass',done:1,total:3});throw new Error('no image pair with enough matches')}
    pause(){}
    dispose(){}
  }
  const flush=async()=>{for(let i=0;i<8;i++)await new Promise(resolve=>setImmediate(resolve))};
  try{
    const control=setupLocalReconstruction(()=>photos,{loadEngine:async()=>({createSession:()=>new Session()}),onLiveFailure:(message,error,options)=>failures.push({message,error,options})});
    await control.ready;control.setLiveMode(true);
    photos.push(...Array.from({length:8},()=>({blob:new Blob(['image']),type:'image/jpeg'})));
    control.refresh();await flush();
    assert.equal(runs.length,1);assert.equal(failures.length,1);
    assert.equal(failures[0].options.retryable,true);
    assert.match(failures[0].message,/估計相機位置/);
    assert.match(failures[0].error.message,/no image pair/);
    photos.push(...Array.from({length:7},()=>({blob:new Blob(['image']),type:'image/jpeg'})));
    control.refresh();await flush();assert.equal(runs.length,1);
    photos.push({blob:new Blob(['image']),type:'image/jpeg'});
    control.refresh();await flush();assert.equal(runs.length,2);
  }finally{globalThis.document=oldDocument;globalThis.window=oldWindow;if(oldNavigator)Object.defineProperty(globalThis,'navigator',oldNavigator);else delete globalThis.navigator}
});
