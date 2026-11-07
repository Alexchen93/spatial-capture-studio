import {test} from 'node:test';
import assert from 'node:assert/strict';
import {requestCompatibleAdapter} from '../dist/modules/webgpu-adapter.mjs';
import {createGpu} from '../dist/vendor/splat-js/src/gpu/context.js?v=adapter-v2';

test('uses the default adapter first and honors an explicit preference', async()=>{
  const calls=[];const adapter={};const gpu={requestAdapter:async opts=>{calls.push(opts);return adapter}};
  assert.equal(await requestCompatibleAdapter(gpu),adapter);assert.deepEqual(calls,[undefined]);
  calls.length=0;assert.equal(await requestCompatibleAdapter(gpu,'low-power'),adapter);assert.deepEqual(calls,[{powerPreference:'low-power'}]);
});

test('tries other hints if the default adapter is missing or the request rejects', async()=>{
  const calls=[];const adapter={};const gpu={requestAdapter:async opts=>{calls.push(opts);if(!opts)throw new Error('temporary');return opts.powerPreference==='low-power'?adapter:null}};
  assert.equal(await requestCompatibleAdapter(gpu),adapter);
  assert.deepEqual(calls,[undefined,{powerPreference:'high-performance'},{powerPreference:'low-power'}]);
});

test('reports all unavailable options without pretending GPU is ready', async()=>{
  const gpu={requestAdapter:async()=>null};
  await assert.rejects(requestCompatibleAdapter(gpu),error=>error.name==='GPUAdapterUnavailableError'&&/default: unavailable/.test(error.message)&&/low-power: unavailable/.test(error.message));
});

test('the reconstruction GPU context obtains the default adapter and device', async()=>{
  const prior=Object.getOwnPropertyDescriptor(globalThis,'navigator');let requested;let destroyed=false;
  const device={destroy(){destroyed=true}};
  const adapter={features:new Set(),limits:{maxStorageBufferBindingSize:128,maxBufferSize:256},requestDevice:async opts=>{requested=opts;return device}};
  Object.defineProperty(globalThis,'navigator',{value:{gpu:{requestAdapter:async opts=>opts?null:adapter}},configurable:true});
  try{const context=await createGpu();assert.equal(context.adapter,adapter);assert.equal(context.device,device);assert.deepEqual(requested.requiredFeatures,[]);context.dispose();assert.equal(destroyed,true)}
  finally{if(prior)Object.defineProperty(globalThis,'navigator',prior);else delete globalThis.navigator}
});
