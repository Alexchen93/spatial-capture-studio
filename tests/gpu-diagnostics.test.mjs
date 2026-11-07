import {test} from 'node:test';
import assert from 'node:assert/strict';
import {observeTrainingQueue,diagnoseTraining} from '../dist/modules/gpu-diagnostics.mjs';
test('distinguishes submitted work from an acknowledged queue marker',async()=>{
  let complete;const queue={onSubmittedWorkDone:()=>new Promise(resolve=>complete=resolve)};
  const trainer={iter:0,device:{queue},stepOnce(){this.iter++;return 'ok'}};
  const diagnostics=observeTrainingQueue(trainer);assert.match(diagnoseTraining(diagnostics.state,0),/尚未觀察/);
  assert.equal(trainer.stepOnce(),'ok');trainer.stepOnce();assert.equal(diagnostics.state.submitted,2);assert.equal(diagnostics.state.queueReturned,0);assert.match(diagnoseTraining(diagnostics.state,0),/尚未收到/);
  complete();await Promise.resolve();assert.equal(diagnostics.state.queueReturned,1);assert.match(diagnoseTraining(diagnostics.state,0),/曾回覆/);diagnostics.dispose();trainer.stepOnce();assert.equal(diagnostics.state.submitted,2);
});
test('records GPU errors without swallowing the original error',()=>{
  let listener;const device={queue:{onSubmittedWorkDone:()=>Promise.resolve()},addEventListener(_name,cb){listener=cb},removeEventListener(){}};
  const trainer={iter:0,device,stepOnce(){throw new Error('shader failed')}};const obs=observeTrainingQueue(trainer);listener({error:{name:'GPUValidationError',message:'invalid shader'}});assert.match(obs.state.gpuError,/invalid shader/);assert.match(diagnoseTraining(obs.state,0),/錯誤/);assert.throws(()=>trainer.stepOnce(),/shader failed/);obs.dispose();
});
test('late GPU callbacks after disposal cannot change a previous session',async()=>{
  let complete;const trainer={iter:0,device:{queue:{onSubmittedWorkDone:()=>new Promise(resolve=>complete=resolve)}},stepOnce(){this.iter++}};
  const obs=observeTrainingQueue(trainer);trainer.stepOnce();obs.dispose();complete();await Promise.resolve();assert.equal(obs.state.queueReturned,0);
});
test('tracks pending readback independently from the queue fence',async()=>{
 let read;const trainer={iter:0,device:{queue:{onSubmittedWorkDone:()=>Promise.resolve()}},stepOnce(){this.iter++},readLoss(){return new Promise(resolve=>read=resolve)}};
 const obs=observeTrainingQueue(trainer);trainer.stepOnce();await Promise.resolve();const result=trainer.readLoss();assert.equal(obs.state.readbackPending,true);assert.match(diagnoseTraining(obs.state,0),/等待訓練數值讀回/);read(2);assert.equal(await result,2);assert.equal(obs.state.readbackPending,false);obs.dispose();
});
test('diagnostics do not break a trainer that cannot be instrumented',()=>{
 const trainer=Object.freeze({iter:0,device:{queue:{onSubmittedWorkDone:()=>Promise.resolve()}},stepOnce(){return 'kept'}});const obs=observeTrainingQueue(trainer);assert.equal(obs.state.supported,false);assert.equal(trainer.stepOnce(),'kept');assert.doesNotThrow(()=>obs.dispose());
});
test('readback rejection is diagnosed and still reaches the caller',async()=>{
 const trainer={iter:0,device:{queue:{onSubmittedWorkDone:()=>Promise.resolve()}},stepOnce(){this.iter++},readLoss(){return Promise.reject(new Error('map failure'))}};const obs=observeTrainingQueue(trainer);await assert.rejects(trainer.readLoss(),/map failure/);assert.equal(obs.state.readbackPending,false);assert.match(diagnoseTraining(obs.state,0),/讀回失敗/);obs.dispose();
});
