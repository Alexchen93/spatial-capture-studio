import './viewer.mjs';
import { setupLocalReconstruction } from './reconstruction.mjs';
import {openStore,listPhotos,putPhoto,deletePhoto,clearPhotos,putProject} from './captures.mjs';
import {createZip} from './zip.mjs';
import {extractVideoFrames} from './video-frames.mjs';
const $=s=>document.querySelector(s),photosEl=$('#photos'),count=$('#photoCount'),clear=$('#clearPhotos'),download=$('#downloadPhotos'),note=$('#storageNote'),video=$('#video'),panel=$('#cameraPanel');
let db=null,photos=[],stream=null,urls=[],toastTimer,busy=false,videoAbort=null;
function toast(message){const el=$('#toast');el.textContent=message;el.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('show'),4000)}
const reconstruction=setupLocalReconstruction(()=>photos,{
  onSavePersonalScene:async({ply,cameras})=>{
    if(!db)db=await openStore();
    const now=Date.now(),id=crypto.randomUUID();
    const project={id,name:`個人場景 ${new Date(now).toLocaleDateString('zh-TW')}`,created:now,updated:now,ply,cameras,version:1};
    await putProject(db,project);
    return{id};
  },
});
function draw(){reconstruction.refresh();urls.forEach(URL.revokeObjectURL);urls=[];count.textContent=photos.length;clear.hidden=!photos.length;download.disabled=!photos.length;photosEl.replaceChildren();if(!photos.length){photosEl.innerHTML='<div class="photo-empty"><span>▧</span><p>尚未加入畫面<br><small>錄影擷取，或補充 JPG、PNG、WebP</small></p></div>';return}for(const [i,item] of photos.entries()){const div=document.createElement('div');div.className='photo-item';const img=document.createElement('img');let url=URL.createObjectURL(item.blob);urls.push(url);img.src=url;img.alt=`照片 ${i+1}`;const button=document.createElement('button');button.type='button';button.textContent='×';button.setAttribute('aria-label',`移除照片 ${i+1}`);button.onclick=async()=>{try{if(db)await deletePhoto(db,item.id);photos=photos.filter(p=>p.id!==item.id);draw()}catch{toast('無法刪除照片，請重試。')}};div.append(img,button);photosEl.append(div)}}
async function addFiles(files,{signal}={}){
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
    checkCancelled();draw();toast(`已加入 ${added} 張照片${invalid?`；${invalid} 張無法加入（請確認格式、大小或儲存空間）`:''}。`);
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
try{db=await openStore();photos=await listPhotos(db);photos.sort((a,b)=>a.created-b.created);draw()}catch{note.textContent='瀏覽器無法儲存，照片只保留至關閉頁面';toast('無法使用瀏覽器儲存空間，本次照片僅暫存於頁面。')}
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
clear.onclick=async()=>{try{if(db)await clearPhotos(db);photos=[];draw();toast('已清除本機照片。')}catch{toast('無法清除照片，請重試。')}};
download.onclick=async()=>{if(!photos.length)return;download.disabled=true;download.textContent='準備中…';try{const ext={'image/jpeg':'jpg','image/png':'png','image/webp':'webp'},entries=photos.map((p,i)=>({name:`photo-${String(i+1).padStart(3,'0')}.${ext[p.type]||'jpg'}`,blob:p.blob}));const zip=await createZip(entries),url=URL.createObjectURL(zip),a=document.createElement('a');a.href=url;a.download='spatial-capture-photos.zip';a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);toast('素材已準備下載。')}catch{toast('無法匯出素材，請確認裝置可用空間。')}finally{download.disabled=!photos.length;download.textContent='下載素材 ↓'}};
$('#cameraBtn').onclick=async()=>{if(stream){panel.hidden=false;return}if(!navigator.mediaDevices?.getUserMedia){toast('此瀏覽器無法使用相機，請選擇照片。');return}try{stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'}},audio:false});video.srcObject=stream;panel.hidden=false}catch{toast('無法開啟相機，請檢查瀏覽器權限或選擇照片。')}};
function stopCamera(){stream?.getTracks().forEach(t=>t.stop());stream=null;video.srcObject=null;panel.hidden=true}$('#closeCamera').onclick=stopCamera;$('#snap').onclick=()=>{if(!video.videoWidth){toast('相機準備中，請稍候。');return}let c=document.createElement('canvas');c.width=video.videoWidth;c.height=video.videoHeight;c.getContext('2d').drawImage(video,0,0);c.toBlob(blob=>{if(blob)addFiles([new File([blob],'capture.jpg',{type:'image/jpeg'})]);else toast('拍攝失敗，請重試。')},'image/jpeg',.9)};window.addEventListener('pagehide',()=>{videoAbort?.abort();stopCamera()});
