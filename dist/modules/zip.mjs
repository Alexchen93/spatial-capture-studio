// Minimal uncompressed ZIP writer. Numbered file names avoid unsafe or ambiguous paths.
const table = new Uint32Array(256);
for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=(c&1)?(0xedb88320^(c>>>1)):(c>>>1);table[n]=c>>>0;}
export function crc32(bytes){let c=0xffffffff;for(const b of bytes)c=table[(c^b)&255]^(c>>>8);return (c^0xffffffff)>>>0;}
function header(size){const bytes=new Uint8Array(size);return [bytes,new DataView(bytes.buffer)];}
export async function createZip(entries){
  const local=[],central=[];let offset=0;
  for(const {name,blob} of entries){const filename=new TextEncoder().encode(name);const data=new Uint8Array(await blob.arrayBuffer());const crc=crc32(data);
    const [lh,l]=header(30);l.setUint32(0,0x04034b50,true);l.setUint16(4,20,true);l.setUint16(6,0x800,true);l.setUint32(14,crc,true);l.setUint32(18,data.length,true);l.setUint32(22,data.length,true);l.setUint16(26,filename.length,true);
    local.push(lh,filename,data);const [ch,c]=header(46);c.setUint32(0,0x02014b50,true);c.setUint16(4,20,true);c.setUint16(6,20,true);c.setUint16(8,0x800,true);c.setUint32(16,crc,true);c.setUint32(20,data.length,true);c.setUint32(24,data.length,true);c.setUint16(28,filename.length,true);c.setUint32(42,offset,true);central.push(ch,filename);offset+=lh.length+filename.length+data.length;
  }
  const centralSize=central.reduce((n,b)=>n+b.length,0),[end,e]=header(22);e.setUint32(0,0x06054b50,true);e.setUint16(8,entries.length,true);e.setUint16(10,entries.length,true);e.setUint32(12,centralSize,true);e.setUint32(16,offset,true);return new Blob([...local,...central,end],{type:'application/zip'});
}
