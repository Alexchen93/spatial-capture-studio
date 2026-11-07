// Extract frames locally using a browser video decoder. No video or frames are uploaded.
export function samplingTimes(duration, maxFrames=60, rate=2){
  if(!Number.isFinite(duration)||duration<=0)throw new Error('無法讀取影片長度。');
  const count=Math.min(maxFrames,Math.max(1,Math.floor(duration*rate)));
  return Array.from({length:count},(_,i)=>Math.min(duration-0.001,(i+0.5)*duration/count));
}
function waitFor(target,name,signal,timeoutMs=15000){
  return new Promise((resolve,reject)=>{
    if(signal?.aborted){reject(new DOMException('取消','AbortError'));return;}
    let timeout;
    const clean=()=>{clearTimeout(timeout);target.removeEventListener(name,done);target.removeEventListener('error',failed);signal?.removeEventListener('abort',aborted)};
    const done=()=>{clean();resolve()},failed=()=>{clean();reject(new Error('瀏覽器無法讀取此影片，請改用 iPhone 相機錄製的影片。'))},aborted=()=>{clean();reject(new DOMException('取消','AbortError'))};
    target.addEventListener(name,done,{once:true});target.addEventListener('error',failed,{once:true});signal?.addEventListener('abort',aborted,{once:true});timeout=setTimeout(()=>{clean();reject(new Error('影片讀取逾時，請使用較短的影片再試。'))},timeoutMs);
  });
}
function toJpeg(canvas){return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('無法擷取影片畫面。')),'image/jpeg',0.85));}
export async function extractVideoFrames(file,{signal,onProgress=()=>{},maxFrames=60,maxDuration=90}={}){
  if(!file||(!file.type.startsWith('video/')&&!(/\.(mov|mp4|m4v|webm)$/i).test(file.name||'')))throw new Error('請選擇影片檔案。');
  if(file.size>500*1024*1024)throw new Error('影片超過 500 MB，請先縮短影片再試。');
  const url=URL.createObjectURL(file),video=document.createElement('video');
  video.preload='auto';video.muted=true;video.playsInline=true;video.setAttribute('playsinline','');
  try{
    const metadata=waitFor(video,'loadedmetadata',signal);video.src=url;video.load();await metadata;
    if(!Number.isFinite(video.duration)||video.duration<=0)throw new Error('無法讀取影片長度，請換一段影片再試。');
    if(video.duration>maxDuration)throw new Error(`影片超過 ${maxDuration} 秒，請先裁剪成較短的影片。`);
    const times=samplingTimes(video.duration,maxFrames),width=video.videoWidth,height=video.videoHeight;
    if(times.length<8)throw new Error('影片太短，擷取到的畫面不足 8 張；請拍攝至少 4 秒的影片。');
    if(!width||!height)throw new Error('無法讀取影片畫面尺寸。');
    const scale=Math.min(1,960/Math.max(width,height)),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(width*scale));canvas.height=Math.max(1,Math.round(height*scale));
    const ctx=canvas.getContext('2d');if(!ctx)throw new Error('裝置無法處理影片畫面。');
    const frames=[];
    for(let i=0;i<times.length;i++){
      if(signal?.aborted)throw new DOMException('取消','AbortError');
      const sought=waitFor(video,'seeked',signal);video.currentTime=times[i];await sought;
      ctx.drawImage(video,0,0,canvas.width,canvas.height);
      const blob=await toJpeg(canvas);if(signal?.aborted)throw new DOMException('取消','AbortError');
      frames.push(new File([blob],`frame-${String(i+1).padStart(3,'0')}.jpg`,{type:'image/jpeg'}));
      onProgress(i+1,times.length);await new Promise(resolve=>setTimeout(resolve,0));
    }
    if(frames.length<8)throw new Error('影片太短，擷取到的畫面不足 8 張；請拍攝較長的影片。');
    return frames;
  }finally{video.pause();video.removeAttribute('src');video.load();URL.revokeObjectURL(url)}
}
