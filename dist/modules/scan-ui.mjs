import {ScanCoverage,drawCoverage} from './scan-coverage.mjs';

export function setupScanUi(video,preview){
  const get=id=>document.getElementById(id),stage=get('scanStage'),camera=get('scanCamera'),model=get('scanModel'),canvas=get('scanCoverage'),shell=canvas.parentElement,status=get('scanStatus'),phase=get('scanPhase'),counter=get('scanFrameCount'),enter=get('scanEnter'),finish=get('scanFinish'),modelState=get('scanModelState'),modelProgress=get('scanModelProgress'),previous=get('scanModelPrevious'),readiness=get('scanReadiness');
  const videoHome=video.parentElement,previewHome=preview.parentElement,coverage=new ScanCoverage();
  let sensor=null,firstSensor=null,viewYaw=0,viewPitch=.2,drag=null,active=false,limited=false,modelSaved=false,building=false,renderedPreview=false,lastOrientationDraw=0,manualViewUntil=0;
  const rad=Math.PI/180;
  function render(){if(active)drawCoverage(canvas,coverage,{yaw:viewYaw,pitch:viewPitch})}
  function modelMessage(message,done=null,total=null){
    modelState.textContent=message;
    modelProgress.hidden=done===null;
    if(done!==null){if(total>0){modelProgress.max=total;modelProgress.value=Math.min(done,total)}else modelProgress.removeAttribute('value')}
  }
  function updateReadiness(){
    const guide=coverage.guidance;
    readiness.classList.toggle('is-ready',modelSaved&&!building&&guide.readyToReview);
    finish.hidden=!modelSaved||building||!guide.readyToReview;
    if(limited){readiness.textContent='此裝置僅能儲存照片';return}
    if(!modelSaved){readiness.textContent=Number.parseInt(counter.textContent,10)<8?`首批需 8 張 · 目前 ${counter.textContent}`:'正在建立第一版模型';return}
    if(building){readiness.textContent='正在用新照片更新 3D 模型';return}
    if(guide.readyToReview){readiness.textContent='視角已足夠 · 檢查模型後可結束';return}
    if(guide.localized<16){readiness.textContent=`已建立粗模 · 已定位 ${guide.localized} / 16 個視角`;return}
    if(guide.overlappingWalls<12){readiness.textContent=`環繞重疊視角 ${guide.overlappingWalls} / 12 · 繼續補拍紅色方向`;return}
    if(guide.floorDirections<4){readiness.textContent='請補拍地面方向';return}
    readiness.textContent='請補拍上方方向';
  }
  function onOrientation(event){
    if(!Number.isFinite(event.alpha)||!Number.isFinite(event.beta))return;
    sensor={alpha:event.alpha,beta:event.beta};
    if(!active||!firstSensor||drag||Date.now()<manualViewUntil||Date.now()-lastOrientationDraw<120)return;
    const degrees=((sensor.alpha-firstSensor.alpha+540)%360)-180;
    viewYaw=-degrees*rad;viewPitch=Math.max(-1.2,Math.min(1.2,.2-(sensor.beta-firstSensor.beta)*rad*.5));
    lastOrientationDraw=Date.now();render();
  }
  function listenOrientation(){
    const activate=()=>window.addEventListener('deviceorientation',onOrientation);
    if(typeof DeviceOrientationEvent!=='undefined'&&typeof DeviceOrientationEvent.requestPermission==='function'){
      DeviceOrientationEvent.requestPermission().then(result=>{if(result==='granted'&&active)activate()}).catch(()=>{});
    }else activate();
  }
  function start(){
    active=true;coverage.estimated=[];coverage.solved=[];coverage.estimatedCells.fill(0);coverage.solvedCells.fill(0);
    sensor=null;firstSensor=null;viewYaw=0;viewPitch=.2;limited=false;modelSaved=false;building=false;renderedPreview=false;lastOrientationDraw=0;manualViewUntil=0;shell.classList.remove('is-oriented');
    enter.hidden=true;finish.hidden=true;phase.textContent='視角定位中';status.textContent='準備相機…';counter.textContent='0 張';
    previous.hidden=true;previous.removeAttribute('src');preview.hidden=true;modelMessage('等待第一批照片 · 0 / 8',0,8);updateReadiness();
    document.body.classList.add('scanning');stage.hidden=false;camera.append(video);model.append(preview);
    listenOrientation();render();
  }
  function stop({edit=false}={}){
    active=false;window.removeEventListener('deviceorientation',onOrientation);stage.hidden=true;
    videoHome.append(video);previewHome.append(preview);
    document.body.classList.remove('scanning');document.body.classList.toggle('edit-mode',edit);
    if(edit){location.hash='capture'}else if(location.hash)history.replaceState(null,'',location.pathname+location.search);
  }
  function frame(count){
    counter.textContent=`${count} 張`;
    if(sensor){
      firstSensor??={...sensor};shell.classList.add('is-oriented');
      const degrees=((sensor.alpha-firstSensor.alpha+540)%360)-180;
      coverage.addEstimate(degrees*rad,Math.max(-75,Math.min(75,sensor.beta-firstSensor.beta))*rad);
      render();
    }
    phase.textContent=limited?'僅拍照｜無 3D 重建':coverage.hasSolved?'3D 視角覆蓋':'方向估計中';
    status.textContent=coverage.hasDirections?firstSensor?'轉動手機對準紅色方向補拍':'紅色方向待補拍；黃色方向等待定位':'緩慢移動手機，保持畫面重疊';
    if(!limited&&!modelSaved&&count<8)modelMessage(`等待第一批照片 · ${count} / 8`,count,8);
    updateReadiness();
  }
  function solved(cameras){
    coverage.setSolvedCameras(cameras);
    phase.textContent=coverage.hasSolved?'3D 視角覆蓋':'定位不足';
    status.textContent=coverage.hasSolved?firstSensor?'轉動手機對準紅色方向補拍':'紅色方向待補拍；拖曳球體查看':'尚未取得可定位的視角；繼續拍攝';
    updateReadiness();render();
  }
  function holdPreview(){
    if(!active||!renderedPreview||preview.hidden)return;
    try{previous.src=preview.toDataURL('image/png');previous.hidden=false}catch{previous.hidden=true}
  }
  function progress(step,done=0,total=0){
    if(!active||limited)return;
    if(!building){building=true;updateReadiness()}
    const names={loading:'準備 3D 引擎',decode:'讀取照片',features:'尋找影像特徵',matching:'比對不同角度',pass:'估計拍攝位置',register:'定位拍攝位置',ba:'調整拍攝位置',focal:'校正鏡頭',solved:'相機定位完成',seed:'建立初始 3D 模型',train:'3D 模型由粗到細建立中',saving:'儲存目前的 3D 模型'};
    modelMessage(`${names[step]||'建立 3D 模型中'}${step==='train'&&total?` · ${Math.min(done,total)} / ${total}`:''}`,step==='train'?done:null,step==='train'?total:null);
    if(step==='train'){
      if(done>0){renderedPreview=true;previous.hidden=true;preview.hidden=false}
      else if(!previous.hidden)preview.hidden=true;
    }
  }
  function saved(id){modelSaved=true;building=false;enter.href=`personal-walk.html?project=${encodeURIComponent(id)}`;enter.hidden=false;modelMessage('已建立 3D 粗模 · 繼續拍攝會更新');updateReadiness()}
  function failure(message,{retryable=false}={}){building=false;modelMessage(modelSaved?`${message} · 上一版模型仍可用`:message);readiness.textContent=retryable?'定位不足 · 繼續補拍後會自動重試':modelSaved?'上一版模型已保存 · 可進入第一人稱':'重建未完成 · 照片刷新後清除';readiness.classList.remove('is-ready');finish.hidden=true}
  function limitReached(){phase.textContent='已達拍攝上限';readiness.textContent='已拍滿 60 張 · 請檢查模型';finish.hidden=true}
  function finished(){phase.textContent='拍攝已完成';readiness.textContent='請查看模型細節；可從拍攝起點進入';status.textContent='已停止相機；3D 模型保存在目前瀏覽器';finish.hidden=true}
  function note(message){status.textContent=message}
  canvas.addEventListener('pointerdown',event=>{drag={x:event.clientX,y:event.clientY};canvas.setPointerCapture?.(event.pointerId)});
  canvas.addEventListener('pointermove',event=>{if(!drag)return;viewYaw+=(event.clientX-drag.x)*.012;viewPitch=Math.max(-1.2,Math.min(1.2,viewPitch-(event.clientY-drag.y)*.008));drag={x:event.clientX,y:event.clientY};manualViewUntil=Date.now()+4000;render()});
  for(const name of ['pointerup','pointercancel'])canvas.addEventListener(name,()=>{drag=null});
  window.addEventListener('resize',render);
  if(['#capture','#reconstruct','#walk'].includes(location.hash))document.body.classList.add('edit-mode');
  return{start,stop,frame,solved,saved,note,holdPreview,progress,failure,finished,limitReached,setLimited(value){limited=Boolean(value);if(limited){phase.textContent='僅拍照｜無 3D 重建';modelMessage('此裝置未啟用 WebGPU，無法顯示 3D 模型');updateReadiness()}},get active(){return active}};
}
