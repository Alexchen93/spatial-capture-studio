import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseGaussianPly} from '../dist/modules/ply-reader.mjs';

const properties=['x','y','z','nx','ny','nz','f_dc_0','f_dc_1','f_dc_2','opacity','scale_0','scale_1','scale_2','rot_0','rot_1','rot_2','rot_3'];
function binaryPly(values){
  const header=`ply\nformat binary_little_endian 1.0\nelement vertex 1\n${properties.map(name=>`property float ${name}`).join('\n')}\nend_header\n`;
  const a=new TextEncoder().encode(header),body=new Uint8Array(values.length*4),view=new DataView(body.buffer);values.forEach((n,i)=>view.setFloat32(i*4,n,true));return new Blob([a,body]);
}

test('parses the binary degree-0 Gaussian layout and converts DC colors',async()=>{
  const ply=binaryPly([1,2,3,0,0,0,0,0.2,-0.2,4,-1,-2,-3,1,0,0,0]);const result=await parseGaussianPly(ply);
  assert.equal(result.n,1);assert.deepEqual([...result.data.slice(0,3)],[1,2,3]);assert.deepEqual([...result.data.slice(3,6)],[-1,-2,-3]);assert.deepEqual([...result.data.slice(6,10)],[1,0,0,0]);assert.equal(result.data[13],4);assert.equal(result.data[10],0);assert.ok(result.data[11]>0);assert.ok(result.data[12]<0);assert.deepEqual(result.bounds,{min:[1,2,3],max:[1,2,3]});
});

test('parses ASCII Gaussian PLY',async()=>{
  const header=`ply\nformat ascii 1.0\nelement vertex 1\n${properties.map(name=>`property float ${name}`).join('\n')}\nend_header\n`;
  const values=[0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0];const result=await parseGaussianPly(new Blob([header,values.join(' '),'\n']));assert.equal(result.n,1);assert.equal(result.data[0],0);assert.equal(result.data[10],0);
});

test('rejects unsupported high-order SH, missing Gaussian fields and oversized files',async()=>{
  const header=`ply\nformat ascii 1.0\nelement vertex 1\n${properties.map(name=>`property float ${name}`).join('\n')}\nproperty float f_rest_0\nend_header\n`;
  await assert.rejects(parseGaussianPly(new Blob([header,'0 '.repeat(18)])),/尚不支援/);
  await assert.rejects(parseGaussianPly(new Blob(['ply\nformat ascii 1.0\nelement vertex 1\nend_header\n0\n'])),/缺少欄位/);
  await assert.rejects(parseGaussianPly(new Blob(['too large']),{maxBytes:1}),/超過 1 bytes/);
  await assert.rejects(parseGaussianPly({size:2,arrayBuffer(){throw new Error('unreachable')}} ,{maxBytes:1}),/超過 1 bytes/);
});

test('rejects non-Gaussian PLY elements rather than misreading their payload',async()=>{
  const header=`ply\nformat ascii 1.0\nelement vertex 1\n${properties.map(name=>`property float ${name}`).join('\n')}\nelement face 1\nproperty list uchar int vertex_indices\nend_header\n`;
  await assert.rejects(parseGaussianPly(new Blob([header])),/vertex 以外資料區段/);
});
