// Observe training submissions and WebGPU queue completion separately.
// This does not upload diagnostics or alter the engine's training calculations.
export function observeTrainingQueue(trainer,{onChange=()=>{},now=()=>Date.now(),probeIntervalMs=2000}={}){
  const state={supported:false,submitted:0,queueReturned:0,probePending:false,probeError:'',gpuError:'',lastSubmitAt:0,lastReturnAt:0,readbackPending:false,readbackStartedAt:0,readbackCompletedAt:0,readbackError:''};
  const queue=trainer?.device?.queue,original=trainer?.stepOnce,originalReadLoss=trainer?.readLoss,device=trainer?.device;
  if(typeof original!=='function'||typeof queue?.onSubmittedWorkDone!=='function')return {state,dispose(){}};
  let active=true,lastProbeAt=-Infinity;
  const notify=()=>{try{onChange(state)}catch{/* Diagnostics must never stop training. */}};
  const onGpuError=event=>{if(!active)return;const e=event?.error;state.gpuError=`${e?.name||'GPUError'}: ${String(e?.message||'WebGPU 回報錯誤').slice(0,300)}`;notify()};
  try{device.addEventListener?.('uncapturederror',onGpuError)}catch{/* Optional diagnostic listener. */}
  function trackedStep(...args){
    let result;
    try{result=Reflect.apply(original,this,args)}catch(error){state.gpuError=`${error?.name||'Error'}: ${String(error?.message||error).slice(0,300)}`;notify();throw error}
    if(!active)return result;
    const n=Number.isFinite(this.iter)?this.iter:state.submitted+1;
    state.submitted=Math.max(state.submitted,n);state.lastSubmitAt=now();
    if(!state.probePending&&state.lastSubmitAt-lastProbeAt>=probeIntervalMs){
      state.probePending=true;lastProbeAt=state.lastSubmitAt;const marker=n;
      try{Promise.resolve(queue.onSubmittedWorkDone()).then(()=>{if(!active)return;state.queueReturned=Math.max(state.queueReturned,marker);state.lastReturnAt=now();state.probePending=false;notify()},error=>{if(!active)return;state.probePending=false;state.probeError=`${error?.name||'Error'}: ${String(error?.message||error).slice(0,300)}`;notify()})}catch(error){state.probePending=false;state.probeError=`${error?.name||'Error'}: ${String(error?.message||error).slice(0,300)}`;notify()}
    }
    return result;
  }
  let trackedReadLoss=null;
  if(typeof originalReadLoss==='function'){
    trackedReadLoss=function(...args){
      if(active){state.readbackPending=true;state.readbackStartedAt=now();notify()}
      let result;try{result=Reflect.apply(originalReadLoss,this,args)}catch(error){if(active){state.readbackPending=false;state.readbackError=String(error?.message||error).slice(0,300);notify()}throw error}
      return Promise.resolve(result).then(value=>{if(active){state.readbackPending=false;state.readbackCompletedAt=now();notify()}return value},error=>{if(active){state.readbackPending=false;state.readbackError=String(error?.message||error).slice(0,300);notify()}throw error});
    };
    try{trainer.readLoss=trackedReadLoss;if(trainer.readLoss!==trackedReadLoss)trackedReadLoss=null}catch{trackedReadLoss=null}
  }
  try{trainer.stepOnce=trackedStep;state.supported=trainer.stepOnce===trackedStep}catch{state.supported=false}
  function dispose(){active=false;try{if(trainer.stepOnce===trackedStep)trainer.stepOnce=original}catch{}try{if(trackedReadLoss&&trainer.readLoss===trackedReadLoss)trainer.readLoss=originalReadLoss}catch{}try{device.removeEventListener?.('uncapturederror',onGpuError)}catch{}}
  if(!state.supported)dispose();
  return {state,dispose};
}
export function diagnoseTraining(state,confirmed){
  if(!state?.supported)return '目前無法讀取 WebGPU 佇列診斷資訊。';
  if(state.gpuError)return '瀏覽器回報 WebGPU 錯誤，請展開診斷資訊。';
  if(state.readbackError)return '訓練數值讀回失敗，請展開診斷資訊。';
  if(state.probeError)return 'WebGPU 佇列查詢發生錯誤，請展開診斷資訊。';
  if(state.submitted===0)return '尚未觀察到訓練工作提交，可能仍在等待排程。';
  if(state.queueReturned===0)return '已提交訓練工作，但尚未收到 GPU 佇列完成訊號；可能仍在執行或等待回應。';
  if(state.readbackPending&&state.queueReturned>0)return 'GPU 佇列曾回覆，目前正在等待訓練數值讀回；不能據此判定模型品質。';
  if(confirmed===0)return 'GPU 佇列曾回覆，但訓練數值尚未讀回；不能據此判定模型品質。';
  return '已收到 GPU 佇列及訓練數值回報；若進度久未變動，可能仍在等待後續工作。';
}
