// Collision in the horizontal plane for the fixed-height, static demo room.
// Obstacles are expanded by the character radius, then the center is swept.
const EPS = 1e-6;
export const CHARACTER_RADIUS = 0.25;
export const OBSTACLES = [
  { minX:-8, maxX:-7.85, minZ:-7, maxZ:9, name:'牆面' },
  { minX:7.85, maxX:8, minZ:-7, maxZ:9, name:'牆面' },
  { minX:-8, maxX:8, minZ:-7, maxZ:-6.85, name:'牆面' },
  { minX:-8, maxX:8, minZ:8.85, maxZ:9, name:'牆面' },
  { minX:-5.8, maxX:-4.4, minZ:-4.7, maxZ:-3.3, name:'展示台' },
  { minX:2.5, maxX:4, minZ:-4.2, maxZ:-2.7, name:'展示台' },
  { minX:-2.5, maxX:2, minZ:-1.2, maxZ:0.3, name:'長椅' }
];
function sweep(x,z,dx,dz,box,radius) {
  const bounds = [[box.minX-radius,box.maxX+radius,x,dx,'x'],[box.minZ-radius,box.maxZ+radius,z,dz,'z']];
  let enter=-Infinity, exit=Infinity, axis='', normal=0;
  for (const [lo,hi,p,d,a] of bounds) {
    if (Math.abs(d)<EPS) { if (p<lo || p>hi) return null; continue; }
    const t1=(lo-p)/d, t2=(hi-p)/d;
    const near=Math.min(t1,t2), far=Math.max(t1,t2);
    if (near>enter) { enter=near; axis=a; normal=d>0?-1:1; }
    exit=Math.min(exit,far);
    if (enter>exit) return null;
  }
  // A negative entry means already within this expanded box, or moving away from it.
  if (enter < -EPS || exit <= EPS || enter > 1) return null;
  return {t:Math.max(0,enter),axis,normal,name:box.name};
}
export function moveWithCollisions(position, delta, obstacles=OBSTACLES, radius=CHARACTER_RADIUS) {
  let x=position.x,z=position.z,dx=delta.x,dz=delta.z,hit=null;
  for(let i=0;i<3 && Math.hypot(dx,dz)>EPS;i++) {
    let first=null;
    for(const box of obstacles){const h=sweep(x,z,dx,dz,box,radius);if(h&&(!first||h.t<first.t))first=h;}
    if(!first){x+=dx;z+=dz;break;}
    const t=Math.max(0,first.t-EPS);x+=dx*t;z+=dz*t;hit=first.name;
    const remain=1-first.t;dx*=remain;dz*=remain;
    if(first.axis==='x') dx=0; else dz=0;
  }
  return {x,z,hit};
}
