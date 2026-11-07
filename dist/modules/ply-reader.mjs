const TYPES={
  char:{size:1,read:(v,o)=>v.getInt8(o)},int8:{size:1,read:(v,o)=>v.getInt8(o)},
  uchar:{size:1,read:(v,o)=>v.getUint8(o)},uint8:{size:1,read:(v,o)=>v.getUint8(o)},
  short:{size:2,read:(v,o,l)=>v.getInt16(o,l)},int16:{size:2,read:(v,o,l)=>v.getInt16(o,l)},
  ushort:{size:2,read:(v,o,l)=>v.getUint16(o,l)},uint16:{size:2,read:(v,o,l)=>v.getUint16(o,l)},
  int:{size:4,read:(v,o,l)=>v.getInt32(o,l)},int32:{size:4,read:(v,o,l)=>v.getInt32(o,l)},
  uint:{size:4,read:(v,o,l)=>v.getUint32(o,l)},uint32:{size:4,read:(v,o,l)=>v.getUint32(o,l)},
  float:{size:4,read:(v,o,l)=>v.getFloat32(o,l)},float32:{size:4,read:(v,o,l)=>v.getFloat32(o,l)},
  double:{size:8,read:(v,o,l)=>v.getFloat64(o,l)},float64:{size:8,read:(v,o,l)=>v.getFloat64(o,l)},
  int64:{size:8,read:(v,o,l)=>Number(v.getBigInt64(o,l))},uint64:{size:8,read:(v,o,l)=>Number(v.getBigUint64(o,l))},
};
const REQUIRED=['x','y','z','f_dc_0','f_dc_1','f_dc_2','opacity','scale_0','scale_1','scale_2','rot_0','rot_1','rot_2','rot_3'];
const C0=0.28209479177387814;
const clamp=(n,min,max)=>Math.min(max,Math.max(min,n));
const logit=x=>Math.log(x/(1-x));

function headerOf(bytes){
  const marker=new TextEncoder().encode('end_header');let at=-1;
  outer:for(let i=0;i<=bytes.length-marker.length;i++){for(let j=0;j<marker.length;j++)if(bytes[i+j]!==marker[j])continue outer;at=i;break}
  if(at<0)throw new Error('找不到 PLY 標頭結尾。');
  let end=at+marker.length;while(end<bytes.length&&bytes[end]!==10&&bytes[end]!==13)end++;
  if(end>=bytes.length)throw new Error('PLY 標頭不完整。');
  const bodyOffset=end+(bytes[end]===13&&bytes[end+1]===10?2:1);
  const text=new TextDecoder().decode(bytes.subarray(0,at)).replace(/\r/g,'');
  let format='',vertexCount=0,readingVertices=false;const properties=[];let vertexSeen=false;
  for(const raw of text.split('\n')){
    const line=raw.trim();if(!line||line==='ply'||line.startsWith('comment')||line.startsWith('obj_info'))continue;
    const p=line.split(/\s+/);
    if(p[0]==='format')format=p[1];
    else if(p[0]==='element'){
      readingVertices=p[1]==='vertex';
      if(readingVertices){if(vertexSeen)throw new Error('PLY 含有重複的 vertex 區段。');vertexSeen=true;vertexCount=Number(p[2])}
      else if(!vertexSeen)throw new Error('PLY 的 vertex 區段前有不支援的元素。');
      else throw new Error('此版本不支援含有 vertex 以外資料區段的 PLY。');
    }else if(p[0]==='property'&&readingVertices){
      if(p[1]==='list')throw new Error('不支援含 list vertex 欄位的 PLY。');
      if(!TYPES[p[1]])throw new Error(`不支援 PLY 欄位型別：${p[1]}`);
      properties.push({type:p[1],name:p[2]});
    }
  }
  if(!['ascii','binary_little_endian','binary_big_endian'].includes(format))throw new Error('不支援此 PLY 編碼格式。');
  if(!Number.isSafeInteger(vertexCount)||vertexCount<1||vertexCount>250000)throw new Error('PLY 點數必須介於 1 到 250,000。');
  const names=new Set(properties.map(p=>p.name));const missing=REQUIRED.filter(name=>!names.has(name));
  if(missing.length)throw new Error(`這不是相容的 3D Gaussian PLY；缺少欄位：${missing.join(', ')}`);
  if([...names].some(name=>/^f_rest_\d+$/.test(name)))throw new Error('此版本尚不支援含高階視角色彩係數（f_rest）的 PLY。請使用本網站匯出的 PLY。');
  return{format,vertexCount,properties,bodyOffset};
}

function gaussian(values,index){
  const at=name=>values[index.get(name)];
  const data=new Float32Array(16);data[0]=at('x');data[1]=at('y');data[2]=at('z');
  for(let i=0;i<3;i++)data[3+i]=at(`scale_${i}`);
  let q=[at('rot_0'),at('rot_1'),at('rot_2'),at('rot_3')],ql=Math.hypot(...q);
  if(!Number.isFinite(ql)||ql<1e-8)q=[1,0,0,0];else q=q.map(v=>v/ql);
  data.set(q,6);
  for(let i=0;i<3;i++)data[10+i]=logit(clamp(.5+at(`f_dc_${i}`)*C0,1e-4,.9999));
  data[13]=at('opacity');
  for(let i=0;i<14;i++)if(!Number.isFinite(data[i]))throw new Error('PLY 含有無效或非有限的模型數值。');
  return data;
}

/** Read a standard degree-0 3D Gaussian PLY into Splat.js's 16-float row layout. */
export async function parseGaussianPly(source,{maxBytes=128*1024*1024}={}){
  const checkSize=size=>{if(size>maxBytes){const limit=maxBytes%(1024*1024)===0?`${maxBytes/(1024*1024)} MB`:`${maxBytes} bytes`;throw new Error(`PLY 檔案超過 ${limit}，請先縮小模型。`)}};
  if(!(source instanceof ArrayBuffer)&&typeof source?.arrayBuffer!=='function')throw new Error('無法讀取 PLY 檔案。');
  if(!(source instanceof ArrayBuffer)&&Number.isFinite(source.size))checkSize(source.size);
  const buffer=source instanceof ArrayBuffer?source:await source.arrayBuffer();checkSize(buffer.byteLength);
  const bytes=new Uint8Array(buffer),header=headerOf(bytes),index=new Map(header.properties.map((p,i)=>[p.name,i]));
  const data=new Float32Array(header.vertexCount*16),values=new Array(header.properties.length);let min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
  if(header.format==='ascii'){
    const body=new TextDecoder().decode(bytes.subarray(header.bodyOffset));let cursor=0;
    for(let row=0;row<header.vertexCount;row++){
      let end=body.indexOf('\n',cursor);if(end<0)end=body.length;const line=body.slice(cursor,end).trim();cursor=end+1;
      if(!line)throw new Error(`PLY 第 ${row+1} 個 vertex 欄位為空。`);
      const tokens=line.split(/\s+/);if(tokens.length<header.properties.length)throw new Error(`PLY 第 ${row+1} 個 vertex 欄位不完整。`);
      for(let i=0;i<header.properties.length;i++)values[i]=Number(tokens[i]);
      const g=gaussian(values,index);data.set(g,row*16);for(let a=0;a<3;a++){min[a]=Math.min(min[a],g[a]);max[a]=Math.max(max[a],g[a])}
    }
  }else{
    const little=header.format==='binary_little_endian',view=new DataView(buffer),stride=header.properties.reduce((n,p)=>n+TYPES[p.type].size,0);
    const required=header.bodyOffset+stride*header.vertexCount;if(required>buffer.byteLength)throw new Error('PLY 二進位資料不完整。');
    for(let row=0;row<header.vertexCount;row++){
      let offset=header.bodyOffset+row*stride;
      for(let i=0;i<header.properties.length;i++){const type=TYPES[header.properties[i].type];values[i]=type.read(view,offset,little);offset+=type.size}
      const g=gaussian(values,index);data.set(g,row*16);for(let a=0;a<3;a++){min[a]=Math.min(min[a],g[a]);max[a]=Math.max(max[a],g[a])}
    }
  }
  return{data,n:header.vertexCount,dc:'sigmoid',bounds:{min,max},radius:Math.max(1e-3,...max.map((v,i)=>Math.abs(v-min[i])*.5))};
}
