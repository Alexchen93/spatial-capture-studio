import {observeTrainingQueue,diagnoseTraining} from './gpu-diagnostics.mjs';
import {requestCompatibleAdapter} from './webgpu-adapter.mjs';
import {createFirstPersonController} from './first-person.mjs';
// Experimental local-only reconstruction. Third-party engine is loaded from this site.
const LABELS={decode:'讀取照片',gpu:'啟用 GPU 運算',features:'分析影像特徵',matching:'比對拍攝角度',pass:'估計相機位置',register:'定位相機',ba:'調整相機位置',focal:'校正鏡頭',solved:'相機定位完成',seed:'準備 3D 場景',train:'重建場景中'};
const MAX_ITERS=4000;
function duration(ms){const seconds=Math.max(0,Math.floor(ms/1000));return seconds<60?`${seconds} 秒`:`${Math.floor(seconds/60)} 分 ${seconds%60} 秒`}
// A delayed readback cannot prove failure. This only reports when a confirmed GPU update was last received.
export function trainingHealthMessage(elapsedMs,quietMs,finishing=false){
  if(finishing)return quietMs>=30000?`正在準備下載；已超過 ${duration(quietMs)} 未收到 GPU 回報。可能仍在處理，也可能卡住；可繼續等待或放棄重建。`:`正在準備下載，請保持頁面開啟；這可能需要等待手機完成 GPU 運算。`;
  if(quietMs>=30000)return `已超過 ${duration(quietMs)} 未收到 GPU 進度回報（開始後 ${duration(elapsedMs)}）。可能仍在運算，也可能卡住；你可以繼續等待或提前結束。`;
  return `開始後 ${duration(elapsedMs)}；顯示的進度是已收到的 GPU 回報。`;
}
export function setupLocalReconstruction(getPhotos, {loadEngine=()=>import('../vendor/splat-js/src/session.js?v=adapter-v2'),createWalker=createFirstPersonController}={}){
  const el=id=>document.getElementById(id), start=el('reconstructBtn'), panel=el('trainingPanel'), stage=el('trainingStage'), progress=el('trainingProgress'), bar=el('trainingBar'), note=el('trainingNote'), health=el('trainingHealth'), canvas=el('trainingPreview'), pause=el('pauseTraining'), finish=el('finishTraining'), cancel=el('cancelTraining'), exportBtn=el('exportTraining'), deviceStatus=el('deviceStatus'), detail=el('reconstructDetail');
  let session=null,walker=null,abort=null,phase='idle',supported=false,cancelRequested=false,inputBusy=false,wasInterrupted=false,wasCompleted=false,exported=false,earlyFinish=false,monitor=null,startedAt=0,lastConfirmedAt=0,confirmedIter=0,previewIndex=0,observer=null,lastDiagnostic=null,sourceCount=0,lastEngineLog='',activeProfile='標準',activeStep=typeof location==='undefined'?'capture':(location.hash.slice(1)||'capture');
  const minPhotos=8;
  function syncPersonalScene(){
    const result=el('personalResult'),empty=el('personalEmpty'),home=el('trainingCanvasSlot'),personal=el('personalCanvasSlot');
    if(!result||!empty||!home||!personal)return;
    const ready=phase==='done'&&!!session?.trainer?.camMeta?.length;
    result.hidden=!ready;empty.hidden=ready;
    const destination=activeStep==='walk'&&ready?personal:home;
    if(destination===home)walker?.stop();
    if(canvas.parentNode!==destination){
      destination.appendChild(canvas);
      if(session?.view&&ready){try{session.view.attach(canvas);if(destination===home)session.view.lookThrough(previewIndex)}catch{result.hidden=true;empty.hidden=false;empty.textContent='目前無法顯示模型，GPU 資源可能已被回收。請回到重建頁下載 PLY 或重新開始。';return}}
    }
    if(destination===personal&&el('fpForward'))try{
      if(!walker)walker=createWalker({session,canvas,status:el('fpStatus'),buttons:{reset:el('fpReset'),move:{forward:el('fpForward'),back:el('fpBack'),left:el('fpLeft'),right:el('fpRight')}}});
      walker.start();
    }catch(error){result.hidden=true;empty.hidden=false;empty.textContent=`無法啟用第一人稱視角：${error.message||'相機資料不可用'}`}
    updatePreviewControls();
  }
  function refresh(){const count=getPhotos().length;if(el('lowLoadMode'))el('lowLoadMode').disabled=inputBusy||!['idle','done','error'].includes(phase);start.disabled=!supported||inputBusy||count<minPhotos||!['idle','done','error'].includes(phase);if(supported&&phase==='idle'){detail.textContent=inputBusy?'影片畫面擷取完成後即可開始。':count<minPhotos?`目前 ${count} 張畫面，還需要 ${minPhotos-count} 張才能開始。`:`已準備 ${count} 張畫面；可開始本機重建。`}}
  function setStatus(message,sub){deviceStatus.textContent=message;detail.textContent=sub;}
  async function check(){
    const retry=el('retryGpu');supported=false;refresh();if(retry)retry.disabled=true;
    if(!navigator.gpu){setStatus('此瀏覽器無法使用 WebGPU','仍可錄影與保存素材；目前的本機 3D 重建尚無不依賴 WebGPU 的後備引擎。');if(retry){retry.hidden=false;retry.disabled=false}return;}
    try{await requestCompatibleAdapter(navigator.gpu);supported=true;if(retry)retry.hidden=true;setStatus('本機運算可嘗試','選擇至少 8 張重疊照片後開始；結果品質與裝置能力仍需測試。');refresh()}
    catch{setStatus('無法啟用本機 GPU','仍可錄影與保存素材；目前的本機 3D 重建需要能啟用 WebGPU 的瀏覽器。');if(retry)retry.hidden=false;}
    finally{if(retry)retry.disabled=false}
  }
  function updateStage(name,done,total){stage.textContent=LABELS[name]||'處理中';if(Number.isFinite(done)&&Number.isFinite(total)&&total>0){const shown=Math.max(0,Math.min(done,total));bar.max=total;bar.value=shown;progress.textContent=`${Math.round(100*shown/total)}%`}else{bar.removeAttribute('value');progress.textContent=''}}
  function stopMonitor(){if(monitor!==null)clearInterval(monitor);monitor=null;if(health)health.hidden=true}
  function updateDiagnostics(){
    const output=el('gpuDiagnosticText');if(!output)return;
    const d=observer?.state||lastDiagnostic;
    if(!d){output.textContent='診斷尚未開始。';return}
    const visibility=typeof document.visibilityState==='string'?document.visibilityState:'unknown';
    output.textContent=[
      '版本: gpu-diag-v1',`階段: ${phase}`,`運算模式: ${activeProfile}`,`素材畫面: ${sourceCount}`,`已提交訓練迭代: ${d.submitted}`,`GPU 佇列回報至第: ${d.queueReturned} 次`,`訓練數值讀回: ${confirmedIter} / ${MAX_ITERS}`,`佇列回報等待中: ${d.probePending?'是':'否'}`,`數值讀回等待中: ${d.readbackPending?'是':'否'}`,`GPU 錯誤: ${d.gpuError||'無'}`,`佇列查詢錯誤: ${d.probeError||'無'}`,`數值讀回錯誤: ${d.readbackError||'無'}`,`引擎訊息: ${lastEngineLog||'無'}`,`網頁狀態: ${visibility}`,`瀏覽器: ${navigator.userAgent||'未知'}`
    ].join('\n');
  }
  function updateHealth(){if(!health||!['training','finishing'].includes(phase))return;const now=Date.now(),d=observer?.state;health.hidden=false;health.textContent=`已確認 ${confirmedIter} / ${MAX_ITERS} 次迭代。${trainingHealthMessage(now-startedAt,now-lastConfirmedAt,phase==='finishing')}${d?.supported?` 已提交 ${d.submitted} 次；GPU 佇列回報至第 ${d.queueReturned} 次。${diagnoseTraining(d,confirmedIter)}`:''}`;updateDiagnostics()}
  function beginMonitor(){stopMonitor();startedAt=Date.now();lastConfirmedAt=startedAt;confirmedIter=0;updateHealth();monitor=setInterval(updateHealth,1000)}
  function clearSession(){stopMonitor();walker?.dispose();walker=null;if(observer){lastDiagnostic={...observer.state};observer.dispose();observer=null}try{session?.pause();session?.dispose()}catch{}session=null;abort=null;updateDiagnostics();syncPersonalScene()}
  function fail(message,error){const errorDetail=el('errorDetail');if(errorDetail){errorDetail.textContent=error?`${error.name||'Error'}: ${String(error.message||error).slice(0,300)}`:'';el('errorInfo').hidden=!error}clearSession();phase='error';updateDiagnostics();stage.textContent='本機重建未完成';progress.textContent='';bar.value=0;pause.hidden=true;finish.hidden=true;cancel.hidden=true;exportBtn.hidden=true;note.textContent=message;setStatus('本機重建未完成',message);refresh()}
  async function exportPly(){if(!session||phase!=='done')return;exportBtn.disabled=true;try{note.textContent='正在整理模型，請稍候。';const blob=await session.exportPlyBlob();if(!blob.size)throw new Error('empty');const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='spatial-capture-scene.ply';a.click();exported=true;setTimeout(()=>URL.revokeObjectURL(url),60000);note.textContent='視覺模型已準備下載；此檔案尚不含碰撞模型。'}catch{note.textContent='無法匯出模型；裝置可能已回收 GPU 資源。'}finally{exportBtn.disabled=false}}
  async function startRun(){
    if(start.disabled)return;if(phase==='done'&&session&&!window.confirm('開始新的重建會移除目前頁面中的模型。請先下載 PLY；確定繼續嗎？'))return;clearSession();phase='loading';exported=false;cancelRequested=false;earlyFinish=false;lastDiagnostic=null;lastEngineLog='';sourceCount=getPhotos().length;if(el('gpuDiagnostics'))el('gpuDiagnostics').hidden=true;abort=new AbortController();panel.hidden=false;el('errorInfo').hidden=true;canvas.hidden=true;pause.hidden=true;finish.hidden=true;exportBtn.hidden=true;cancel.hidden=false;cancel.disabled=false;cancel.textContent='取消';if(el('personalPreviewCaption'))el('personalPreviewCaption').hidden=true;if(el('previewViews'))el('previewViews').hidden=true;previewIndex=0;bar.value=0;progress.textContent='';note.textContent='重建在這台裝置進行。請保持頁面開啟，手機可能發熱並耗電。';setStatus('本機重建進行中','正在處理畫面，請保持頁面開啟。');refresh();
    const stillRunning=()=>{if(phase==='error')throw new Error('工作已停止');if(cancelRequested)throw new DOMException('cancelled','AbortError')};
    try{
      updateStage('decode',0,getPhotos().length);
      const {createSession}=await loadEngine();stillRunning();
      const lowLoad=Boolean(el('lowLoadMode')?.checked);activeProfile=lowLoad?'低負載':'標準';
      const files=getPhotos().map((p,i)=>new File([p.blob],`photo-${String(i+1).padStart(3,'0')}.${p.type==='image/png'?'png':p.type==='image/webp'?'webp':'jpg'}`,{type:p.type}));
      session=createSession({maxIters:MAX_ITERS,holdout:-1,initTarget:lowLoad?8000:20000,maxViewW:480,maxViewH:300,lowMem:true,fenceRing:lowLoad?1:2,gpuChunkMs:lowLoad?80:120,...(lowLoad?{itersPerFrame:1}:{}),sfm:{siftFeats:3900,siftFirstOctave:0,refineAspect:false,workers:2,uiYield:true},frames:{trainMaxDim:lowLoad?320:480,featMaxDim:720,targetBudgetBytes:lowLoad?80000000:160000000},trainer:{shDeg:0,maxSplats:lowLoad?32000:80000,capMult:8}});
      const current=session;
      current.on('stage',e=>{if(session!==current||cancelRequested)return;if(e.stage==='train'){if(phase==='training')updateStage('train',confirmedIter,MAX_ITERS)}else updateStage(e.stage,e.done,e.total)});
      current.on('metrics',e=>{if(session===current&&phase==='training'&&Number.isFinite(e.iter)){if(e.iter>confirmedIter){confirmedIter=Math.min(e.iter,MAX_ITERS);lastConfirmedAt=Date.now()}updateStage('train',confirmedIter,MAX_ITERS);updateHealth()}});
      current.on('log',message=>{if(session!==current)return;if(message.startsWith('frame loop:')||message.startsWith('GPU device lost')){lastEngineLog=String(message).slice(0,300);updateDiagnostics()}if(message.startsWith('frame loop:'))fail('本機運算發生錯誤，請展開技術資訊並嘗試較短的影片。',new Error(message))});
      current.on('event',e=>{
        if(session!==current)return;
        if(e.kind==='device-lost'){fail('瀏覽器中斷了 GPU 工作，請保持頁面開啟或改用其他裝置。');return}
        if(e.kind==='train-complete'&&phase!=='done'){
          phase='done';stopMonitor();updateStage('train',e.iter,MAX_ITERS);
          stage.textContent=earlyFinish?'已提前結束，模型可下載':'視覺重建完成';progress.textContent='';pause.hidden=true;finish.hidden=true;cancel.hidden=true;exportBtn.hidden=false;
          note.textContent=earlyFinish?'已提前結束，可按「下載 PLY」保存目前結果；畫質可能尚未完成，且不含碰撞模型。':'可按「下載 PLY」保存視覺模型；結果不含碰撞模型，不能作為防穿牆場景。';
          setStatus(earlyFinish?'已提前結束':'視覺模型已完成','此結果尚未建立碰撞模型或尺度校正。');refresh();syncPersonalScene();
        }
      });
      await current.load(files);stillRunning();phase='solving';updateStage('gpu');await current.solve({signal:abort.signal});stillRunning();phase='seeding';await current.seed();stillRunning();
      observer=observeTrainingQueue(current.trainer,{onChange:()=>{if(session===current){updateDiagnostics();updateHealth()}}});if(el('gpuDiagnostics'))el('gpuDiagnostics').hidden=false;updateDiagnostics();current.view.attach(canvas);current.view.lookThrough(0);canvas.hidden=false;if(el('personalPreviewCaption'))el('personalPreviewCaption').hidden=false;if(el('previewViews')){el('previewViews').hidden=false;updatePreviewControls()}phase='training';pause.hidden=false;pause.textContent='暫停';finish.hidden=false;cancel.hidden=false;cancel.textContent='放棄本次重建';setStatus('本機重建進行中','請保持頁面開啟；完成後可下載 PLY。');beginMonitor();current.start();
    }catch(e){if(phase==='error')return;if(cancelRequested||e.name==='AbortError'){clearSession();phase='idle';panel.hidden=true;setStatus('已取消本機重建','照片仍保存在這個瀏覽器。');refresh()}else{const where=stage.textContent;const adapterUnavailable=e.name==='GPUAdapterUnavailableError'||/no WebGPU adapter|WebGPU not available/i.test(e.message||'');fail(adapterUnavailable?'Safari 未提供可用的 WebGPU 運算裝置，並非照片數量不足。素材仍保存在此瀏覽器，可稍後重試；若持續失敗，請提供下方技術資訊。':`「${where}」階段未完成。請確認畫面重疊、可用記憶體及 Safari 版本。`,e)}}
  }
  function updatePreviewControls(){const count=session?.trainer?.camMeta?.length||1;for(const id of ['previewCount','personalCount'])if(el(id))el(id).textContent=`視角 ${previewIndex+1} / ${count}`;for(const id of ['previewBack','previewNext','personalBack','personalNext'])if(el(id))el(id).disabled=count<2}
  function movePreview(change){const count=session?.trainer?.camMeta?.length||0;if(!count)return;previewIndex=(previewIndex+change+count)%count;try{session.view.lookThrough(previewIndex);updatePreviewControls()}catch{note.textContent='無法切換視角，請保持頁面開啟並稍後再試。'}}
  if(el('previewBack'))el('previewBack').onclick=()=>movePreview(-1);
  if(el('previewNext'))el('previewNext').onclick=()=>movePreview(1);
  window.addEventListener('spatial-step',event=>{activeStep=event.detail;syncPersonalScene()});
  if(el('retryGpu'))el('retryGpu').onclick=check;
  start.onclick=startRun;
  pause.onclick=()=>{if(!session)return;if(phase==='training'){session.pause();phase='paused';pause.textContent='繼續';stage.textContent='已暫停';stopMonitor();note.textContent='已暫停。可以繼續，或提前結束並準備下載目前結果。'}else if(phase==='paused'){phase='training';pause.textContent='暫停';lastConfirmedAt=Date.now();updateHealth();monitor=setInterval(updateHealth,1000);note.textContent='重建在這台裝置進行。請保持頁面開啟，手機可能發熱並耗電。';session.start()}};
  finish.onclick=async()=>{if(!session||!['training','paused'].includes(phase))return;const ending=session;earlyFinish=true;phase='finishing';pause.disabled=true;finish.disabled=true;cancel.hidden=false;cancel.textContent='放棄本次重建';stage.textContent='正在準備下載';bar.removeAttribute('value');progress.textContent='';lastConfirmedAt=Date.now();if(monitor===null)monitor=setInterval(updateHealth,1000);updateHealth();note.textContent='正在等待 GPU 整理目前模型。完成後請按「下載 PLY」。';try{await ending.finish()}catch(e){if(session===ending)fail('無法準備模型，裝置可能已回收 GPU 資源。',e)}finally{pause.disabled=false;finish.disabled=false}};
  cancel.onclick=()=>{
    if(['training','paused','finishing'].includes(phase)){
      if(!window.confirm('放棄後目前尚未下載的 3D 模型會消失，原始擷取畫面仍會保留。確定放棄嗎？'))return;
      cancelRequested=true;clearSession();phase='idle';panel.hidden=true;setStatus('已放棄本次重建','擷取的畫面仍保存在這個瀏覽器。');refresh();return;
    }
    cancelRequested=true;abort?.abort();cancel.disabled=true;note.textContent='正在取消，請稍候。';
  };
  exportBtn.onclick=exportPly;
  if(el('copyGpuDiagnostics'))el('copyGpuDiagnostics').onclick=async()=>{const status=el('gpuCopyStatus');updateDiagnostics();try{if(!navigator.clipboard?.writeText)throw new Error('clipboard unavailable');await navigator.clipboard.writeText(el('gpuDiagnosticText').textContent);if(status)status.textContent='已複製'}catch{if(status)status.textContent='請長按上方文字選取並複製。'}};
  window.addEventListener('beforeunload',event=>{if(['loading','solving','seeding','training','paused','finishing'].includes(phase)||(phase==='done'&&!exported)){event.preventDefault();event.returnValue=''}});
  window.addEventListener('pagehide',()=>{if(['loading','solving','seeding','training','paused','finishing'].includes(phase))wasInterrupted=true;wasCompleted=phase==='done'&&!!session;abort?.abort();clearSession()});
  window.addEventListener('pageshow',()=>{if(wasInterrupted||wasCompleted){const message=wasCompleted?'頁面離開後本機模型已釋放。已下載的 PLY 仍在裝置上，擷取畫面仍保留；目前尚不支援在網站匯入 PLY。':'頁面離開或進入背景時重建中斷，請保持 Safari 開啟並重新開始。';wasInterrupted=false;wasCompleted=false;fail(message)}});
  syncPersonalScene();check();return {refresh,setInputBusy(value){inputBusy=value;refresh()}};
}
