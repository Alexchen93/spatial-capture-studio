import {ScanCoverage,drawCoverage} from './scan-coverage.mjs';

export function setupScanUi(video,preview){
  const get=id=>document.getElementById(id),stage=get('scanStage'),camera=get('scanCamera'),model=get('scanModel'),canvas=get('scanCoverage'),shell=canvas.parentElement,status=get('scanStatus'),phase=get('scanPhase'),counter=get('scanFrameCount'),enter=get('scanEnter');
  const videoHome=video.parentElement,previewHome=preview.parentElement,coverage=new ScanCoverage();
  let sensor=null,firstSensor=null,viewYaw=0,viewPitch=.2,drag=null,active=false,limited=false,lastOrientationDraw=0,manualViewUntil=0;
  const rad=Math.PI/180;
  function render(){if(active)drawCoverage(canvas,coverage,{yaw:viewYaw,pitch:viewPitch})}
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
    sensor=null;firstSensor=null;viewYaw=0;viewPitch=.2;limited=false;lastOrientationDraw=0;manualViewUntil=0;shell.classList.remove('is-oriented');
    enter.hidden=true;phase.textContent='視角定位中';status.textContent='準備相機…';counter.textContent='0 張';
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
  }
  function solved(cameras){
    coverage.setSolvedCameras(cameras);
    phase.textContent=coverage.hasSolved?'3D 視角覆蓋':'定位不足';
    status.textContent=coverage.hasSolved?firstSensor?'轉動手機對準紅色方向補拍':'紅色方向待補拍；拖曳球體查看':'尚未取得可定位的視角；繼續拍攝';
    render();
  }
  function saved(id){enter.href=`personal-walk.html?project=${encodeURIComponent(id)}`;enter.hidden=false}
  function note(message){status.textContent=message}
  canvas.addEventListener('pointerdown',event=>{drag={x:event.clientX,y:event.clientY};canvas.setPointerCapture?.(event.pointerId)});
  canvas.addEventListener('pointermove',event=>{if(!drag)return;viewYaw+=(event.clientX-drag.x)*.012;viewPitch=Math.max(-1.2,Math.min(1.2,viewPitch-(event.clientY-drag.y)*.008));drag={x:event.clientX,y:event.clientY};manualViewUntil=Date.now()+4000;render()});
  for(const name of ['pointerup','pointercancel'])canvas.addEventListener(name,()=>{drag=null});
  window.addEventListener('resize',render);
  if(['#capture','#reconstruct','#walk'].includes(location.hash))document.body.classList.add('edit-mode');
  return{start,stop,frame,solved,saved,note,setLimited(value){limited=Boolean(value);if(limited)phase.textContent='僅拍照｜無 3D 重建'},get active(){return active}};
}
