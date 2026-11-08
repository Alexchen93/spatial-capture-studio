import './viewer.mjs';
import { setupLocalReconstruction } from './reconstruction.mjs';
import {openStore,listPhotos,putPhoto,deletePhoto,clearPhotos,getProject,putProject} from './captures.mjs';
import {createZip} from './zip.mjs';
import {extractVideoFrames} from './video-frames.mjs';
import {assessCaptureFrame} from './live-capture.mjs';
import {setupScanUi} from './scan-ui.mjs';
const $=s=>document.querySelector(s),photosEl=$('#photos'),count=$('#photoCount'),clear=$('#clearPhotos'),download=$('#downloadPhotos'),note=$('#storageNote'),video=$('#video'),panel=$('#cameraPanel');
let db=null,photos=[],stream=null,urls=[],toastTimer,busy=false,videoAbort=null,liveTimer=null,liveBusy=false,liveFrames=0,lastLiveGray=null,liveProjectId=null,liveScanId=0,storageReady=Promise.resolve();
function toast(message){const el=$('#toast');el.textContent=message;el.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('show'),4000)}
const scanUi=setupScanUi(video,$('#trainingPreview'));
const reconstruction=setupLocalReconstruction(()=>photos,{
  onLiveFailure:message=>{stopLive();scanUi.note('重建中斷；已拍攝畫面仍保留');scanUi.failure('3D 建立失敗 · 請進入編輯模式查看錯誤');$('#liveTrainingSlot').hidden=false;$('#liveStatus').textContent=`重建已停止：${message}。已拍攝畫面仍保留，請到「本機重建」查看錯誤。`},
  onLiveCameras:(cameras,epoch)=>{if(epoch===liveScanId)scanUi.solved(cameras)},
  onLiveProgress:(step,done,total,epoch)=>{if(epoch===liveScanId)scanUi.progress(step,done,total)},
  onLiveBeforeReset:()=>scanUi.holdPreview(),
  onSavePersonalScene:async({ply,cameras,live,liveEpoch})=>{
    if(!db)db=await openStore();
    const activeLive=live&&liveEpoch===liveScanId,now=Date.now(),id=activeLive?(liveProjectId||crypto.randomUUID()):crypto.randomUUID();
    const previous=activeLive&&liveProjectId?await getProject(db,liveProjectId):null;
    const project={id,name:previous?.name||`個人場景 ${new Date(now).toLocaleDateString('zh-TW')}`,created:previous?.created||now,updated:now,ply,cameras,version:1};
    await putProject(db,project);
    if(activeLive){liveProjectId=id;scanUi.saved(id);$('#liveTrainingSlot').hidden=false;$('#liveSceneLink').href=`personal-walk.html?project=${encodeURIComponent(id)}`;$('#liveSceneLink').hidden=false;$('#liveStatus').textContent=`已建立 ${cameras.length} 個相機定位的粗略場景；繼續拍攝會分批更新。可從第一個拍攝位置進入第一人稱。`}
    return{id};
  },
});
function draw(){reconstruction.refresh();urls.forEach(URL.revokeObjectURL);urls=[];count.textContent=photos.length;clear.hidden=!photos.length;clear.disabled=Boolean(liveTimer);for(const id of ['#recordVideo','#selectVideo','#files','#snap'])$(id).disabled=Boolean(liveTimer);download.disabled=!photos.length;photosEl.replaceChildren();if(!photos.length){photosEl.innerHTML='<div class="photo-empty"><span>▧</span><p>尚未加入畫面<br><small>錄影擷取，或補充 JPG、PNG、WebP</small></p></div>';return}for(const [i,item] of photos.entries()){const div=document.createElement('div');div.className='photo-item';const img=document.createElement('img');let url=URL.createObjectURL(item.blob);urls.push(url);img.src=url;img.alt=`照片 ${i+1}`;const button=document.createElement('button');button.type='button';button.textContent='×';button.disabled=Boolean(liveTimer);button.setAttribute('aria-label',`移除照片 ${i+1}`);button.onclick=async()=>{try{if(db)await deletePhoto(db,item.id);photos=photos.filter(p=>p.id!==item.id);draw()}catch{toast('無法刪除照片，請重試。')}};div.append(img,button);photosEl.append(div)}}
async function addFiles(files,{signal,silent=false}={}){
  await storageReady;
  if(busy)return;busy=true;let added=0,invalid=0;const written=[],timestamp=Date.now();
  const checkCancelled=()=>{if(signal?.aborted)throw new DOMException('取消','AbortError')};
  try{
    for(const file of files){
      checkCancelled();
      if(photos.length>=100||!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>10*1024*1024||photos.reduce((n,p)=>n+p.blob.size,0)+file.size>120*1024*1024){invalid++;continue}
      try{
        const bitmap=await createImageBitmap(file);bitmap.close();checkCancelled();
        const item={id:crypto.randomUUID(),blob:file,type:file.type,created:timestamp+added/1000};
        if(db)await putPhoto(db,item);written.push(item);photos.push(item);added++;
      }catch(error){if(signal?.aborted||error?.name==='AbortError')throw new DOMException('取消','AbortError');invalid++}
    }
    checkCancelled();draw();if(!silent)toast(`已加入 ${added} 張照片${invalid?`；${invalid} 張無法加入（請確認格式、大小或儲存空間）`:''}。`);return added;
  }catch(error){
    if(error?.name==='AbortError'){
      const removed=new Set(),failed=[];
      for(const item of written){try{if(db)await deletePhoto(db,item.id);removed.add(item.id)}catch{failed.push(item.id)}}
      photos=photos.filter(item=>!removed.has(item.id));draw();
      if(failed.length)throw new Error('已取消影片，但部分畫面無法從瀏覽器儲存空間清除；請在素材清單中檢查。');
    }
    throw error;
  }finally{busy=false}
}
storageReady=(async()=>{try{db=await openStore();photos=await listPhotos(db);photos.sort((a,b)=>a.created-b.created);draw()}catch{note.textContent='瀏覽器無法儲存，照片只保留至關閉頁面';toast('無法使用瀏覽器儲存空間，本次照片僅暫存於頁面。')}})();
$('#files').onchange=async e=>{await addFiles([...e.target.files]);e.target.value=''};
async function importVideo(file){
  if(!file||videoAbort)return;
  const box=$('#videoProgress'),bar=$('#videoBar'),label=$('#videoCount'),message=$('#captureMessage');message.hidden=true;videoAbort=new AbortController();reconstruction.setInputBusy(true);box.hidden=false;bar.value=0;label.textContent='讀取影片中…';$('#cancelVideo').disabled=false;
  try{const frames=await extractVideoFrames(file,{signal:videoAbort.signal,onProgress:(done,total)=>{bar.max=total;bar.value=done;label.textContent=`已擷取 ${done} / ${total} 張畫面`}});label.textContent='正在保存畫面…';await addFiles(frames,{signal:videoAbort.signal});}
  catch(error){if(error.name==='AbortError')toast('已取消影片擷取。');else{message.textContent=error.message||'無法擷取影片畫面，請換一段影片再試。';message.hidden=false;toast('影片擷取未完成，請查看提示。')}}
  finally{videoAbort=null;box.hidden=true;reconstruction.setInputBusy(false)}
}
for(const id of ['#recordVideo','#selectVideo'])$(id).onchange=async e=>{const file=e.target.files[0];e.target.value='';await importVideo(file)};
$('#cancelVideo').onclick=()=>{if(videoAbort){videoAbort.abort();$('#cancelVideo').disabled=true;$('#videoCount').textContent='正在取消…'}};
clear.onclick=async()=>{try{await storageReady;if(db)await clearPhotos(db);photos=[];draw();toast('已清除本機照片。')}catch{toast('無法清除照片，請重試。')}};
download.onclick=async()=>{if(!photos.length)return;download.disabled=true;download.textContent='準備中…';try{const ext={'image/jpeg':'jpg','image/png':'png','image/webp':'webp'},entries=photos.map((p,i)=>({name:`photo-${String(i+1).padStart(3,'0')}.${ext[p.type]||'jpg'}`,blob:p.blob}));const zip=await createZip(entries),url=URL.createObjectURL(zip),a=document.createElement('a');a.href=url;a.download='spatial-capture-photos.zip';a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);toast('素材已準備下載。')}catch{toast('無法匯出素材，請確認裝置可用空間。')}finally{download.disabled=!photos.length;download.textContent='下載素材 ↓'}};
async function openCamera(){
  if(stream){panel.hidden=false;return true}
  if(!navigator.mediaDevices?.getUserMedia){toast('此瀏覽器無法使用相機，請選擇照片。');return false}
  try{stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'}},audio:false});video.srcObject=stream;panel.hidden=false;await video.play().catch(()=>{});return true}
  catch{toast('無法開啟相機，請檢查瀏覽器權限或選擇照片。');return false}
}
const trainingPanel=$('#trainingPanel'),trainingHome=trainingPanel.parentElement,liveSlot=$('#liveTrainingSlot'),liveStatus=$('#liveStatus');
function stopLive({limit=false}={}){
  if(!liveTimer)return;
  clearInterval(liveTimer);liveTimer=null;reconstruction.setLiveMode(false);$('#stopLive').hidden=true;
  trainingHome.append(trainingPanel);liveSlot.hidden=false;
  liveStatus.textContent=limit?'已達 60 張拍攝上限；請檢查目前模型，未完成的運算仍會繼續。':liveProjectId?'已停止拍攝。可從拍攝起點進入第一人稱；若重建仍在進行，請至「本機重建」查看結果。':liveFrames<8?'已停止拍攝；本次不足 8 張可用畫面，尚未建立粗模。':'已停止拍攝；若重建仍在進行，請至「本機重建」查看結果。';
  scanUi.note(limit?'已達 60 張上限；請檢查模型':liveProjectId?'拍攝已停止；可進入第一人稱':'拍攝已停止');
  if(limit)scanUi.limitReached();
  draw();
}
async function captureLiveFrame(){
  if(!liveTimer||liveBusy||busy||!video.videoWidth)return;
  if(liveFrames>=60||photos.length>=100){stopLive({limit:true});return}
  liveBusy=true;
  try{
    const sample=document.createElement('canvas');sample.width=48;sample.height=36;
    const sampleContext=sample.getContext('2d',{willReadFrequently:true});sampleContext.drawImage(video,0,0,48,36);
    const quality=assessCaptureFrame(sampleContext.getImageData(0,0,48,36).data,48,36,lastLiveGray);
    if(!quality.accepted){liveStatus.textContent=`已拍 ${liveFrames} 張 · ${quality.reason}`;scanUi.note(quality.reason);return}
    const canvas=document.createElement('canvas'),scale=Math.min(1,960/video.videoWidth);canvas.width=Math.round(video.videoWidth*scale);canvas.height=Math.round(video.videoHeight*scale);canvas.getContext('2d').drawImage(video,0,0,canvas.width,canvas.height);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.85));
    if(!blob||!liveTimer)return;
    const added=await addFiles([new File([blob],`live-${Date.now()}.jpg`,{type:'image/jpeg'})],{silent:true});
    if(added){lastLiveGray=quality.gray;liveFrames++;scanUi.frame(liveFrames);liveStatus.textContent=`已拍 ${liveFrames} 張 · 拍攝可繼續；滿 8 張會建立粗模，之後每新增 8 張更新一次。`}
    else{liveStatus.textContent='畫面無法儲存，請檢查瀏覽器空間。';stopLive()}
  }catch(error){liveStatus.textContent=`連續拍攝中斷：${error.message||error}`;stopLive()}
  finally{liveBusy=false}
}
$('#cameraBtn').onclick=openCamera;
async function beginScan(){
  if(liveTimer){panel.hidden=false;return}
  reconstruction.stopLiveRun();
  const fromEditor=document.body.classList.contains('edit-mode');scanUi.start();
  if(!await openCamera()){scanUi.stop({edit:fromEditor});return}
  await reconstruction.ready;
  liveFrames=0;lastLiveGray=null;liveProjectId=null;$('#liveSceneLink').hidden=true;liveSlot.hidden=false;$('#stopLive').hidden=false;liveStatus.textContent='正在拍攝；從目前位置開始，緩慢移動並保持畫面重疊。';
  liveScanId=reconstruction.setLiveMode(true);
  if(!reconstruction.isSupported){scanUi.setLimited(true);scanUi.note('此裝置無法重建 3D；目前僅保存掃描照片')}
  liveTimer=setInterval(captureLiveFrame,1800);draw();captureLiveFrame();
}
$('#liveCaptureBtn').onclick=beginScan;$('#beginScan').onclick=beginScan;
$('#beginScan').disabled=false;$('#beginScan').innerHTML='<span aria-hidden="true">◎</span> 開始掃描';
$('#scanExit').onclick=()=>{stopCamera();scanUi.stop()};
$('#scanEdit').onclick=()=>{stopCamera();scanUi.stop({edit:true})};
$('#scanFinish').onclick=()=>{stopCamera();scanUi.finished()};
$('#scanEnter').onclick=()=>{stopCamera();reconstruction.stopLiveRun()};
$('#stopLive').onclick=stopLive;
function stopCamera(){stopLive();stream?.getTracks().forEach(t=>t.stop());stream=null;video.srcObject=null;panel.hidden=true}$('#closeCamera').onclick=stopCamera;$('#snap').onclick=()=>{if(!video.videoWidth){toast('相機準備中，請稍候。');return}let c=document.createElement('canvas');c.width=video.videoWidth;c.height=video.videoHeight;c.getContext('2d').drawImage(video,0,0);c.toBlob(blob=>{if(blob)addFiles([new File([blob],'capture.jpg',{type:'image/jpeg'})]);else toast('拍攝失敗，請重試。')},'image/jpeg',.9)};window.addEventListener('pagehide',()=>{videoAbort?.abort();stopCamera()});
