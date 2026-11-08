const TAU=Math.PI*2;
const AZIMUTH_CELLS=16;
const ELEVATION_CELLS=6;
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const norm=value=>{const length=Math.hypot(...value)||1;return value.map(part=>part/length)};

function direction(yaw,pitch){return[Math.sin(yaw)*Math.cos(pitch),Math.sin(pitch),Math.cos(yaw)*Math.cos(pitch)]}
function cellDirection(azimuth,elevation){return direction((azimuth+.5)*TAU/AZIMUTH_CELLS-Math.PI,(elevation+.5)*Math.PI/ELEVATION_CELLS-Math.PI/2)}
function coverageFor(samples){
  const cells=new Uint8Array(AZIMUTH_CELLS*ELEVATION_CELLS);
  for(const sample of samples){
    const directionVector=direction(sample.yaw,sample.pitch);
    const halfAngle=clamp(sample.halfAngle??.58,.25,1.1);
    const minimum=Math.cos(halfAngle);
    for(let elevation=0;elevation<ELEVATION_CELLS;elevation++)for(let azimuth=0;azimuth<AZIMUTH_CELLS;azimuth++){
      const index=elevation*AZIMUTH_CELLS+azimuth;
      if(dot(directionVector,cellDirection(azimuth,elevation))>=minimum)cells[index]=Math.min(255,cells[index]+1);
    }
  }
  return cells;
}

export function solvedViewDirections(cameras){
  const valid=(Array.isArray(cameras)?cameras:[]).filter(camera=>camera?.R?.length===9&&camera.R.every(Number.isFinite));
  if(!valid.length)return[];
  const first=[...valid].sort((a,b)=>(Number.isFinite(a.imgIdx)?a.imgIdx:Infinity)-(Number.isFinite(b.imgIdx)?b.imgIdx:Infinity))[0];
  const forward=norm(first.R.slice(6,9)),up=norm(first.R.slice(3,6).map(value=>-value));
  const right=norm([forward[1]*up[2]-forward[2]*up[1],forward[2]*up[0]-forward[0]*up[2],forward[0]*up[1]-forward[1]*up[0]]);
  return valid.map(camera=>{
    const aim=norm(camera.R.slice(6,9));
    const yaw=Math.atan2(dot(aim,right),dot(aim,forward));
    const pitch=Math.asin(clamp(dot(aim,up),-1,1));
    const halfAngle=Number.isFinite(camera.f)&&camera.f>0&&Number.isFinite(camera.w)?clamp(Math.atan(camera.w/(2*camera.f)),.3,.9):.58;
    return{yaw,pitch,halfAngle};
  });
}

export class ScanCoverage{
  constructor(){this.estimated=[];this.solved=[];this.estimatedCells=coverageFor([]);this.solvedCells=coverageFor([])}
  addEstimate(yaw,pitch){
    if(!Number.isFinite(yaw)||!Number.isFinite(pitch))return;
    this.estimated.push({yaw,pitch:clamp(pitch,-Math.PI/2,Math.PI/2),halfAngle:.58});
    this.estimatedCells=coverageFor(this.estimated);
  }
  setSolvedCameras(cameras){this.solved=solvedViewDirections(cameras);this.solvedCells=coverageFor(this.solved)}
  cell(azimuth,elevation){const index=elevation*AZIMUTH_CELLS+azimuth;return{solved:this.solvedCells[index],estimated:this.estimatedCells[index]}}
  get hasDirections(){return this.solved.length>0||this.estimated.length>0}
  get hasSolved(){return this.solved.length>0}
  get missingCount(){return this.hasDirections?Array.from({length:AZIMUTH_CELLS*ELEVATION_CELLS},(_,index)=>this.solvedCells[index]||this.estimatedCells[index]).filter(value=>!value).length:null}
  get guidance(){
    let overlappingWalls=0,floorDirections=0,ceilingDirections=0;
    for(let azimuth=0;azimuth<AZIMUTH_CELLS;azimuth++){
      if(Math.max(this.cell(azimuth,2).solved,this.cell(azimuth,3).solved)>=2)overlappingWalls++;
      if(this.cell(azimuth,1).solved)floorDirections++;
      if(this.cell(azimuth,4).solved)ceilingDirections++;
    }
    return{localized:this.solved.length,overlappingWalls,floorDirections,ceilingDirections,
      readyToReview:this.solved.length>=16&&overlappingWalls>=12&&floorDirections>=4&&ceilingDirections>=4};
  }
}

export function drawCoverage(canvas,coverage,{yaw=0,pitch=.2}={}){
  const rect=canvas.getBoundingClientRect(),ratio=Math.min(2,window.devicePixelRatio||1);
  const width=Math.max(1,Math.round(rect.width*ratio)),height=Math.max(1,Math.round(rect.height*ratio));
  if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height}
  const context=canvas.getContext('2d');context.clearRect(0,0,width,height);
  const centerX=width/2,centerY=height/2,radius=Math.min(width,height)*.40;
  const rotate=point=>{
    const cy=Math.cos(yaw),sy=Math.sin(yaw),cp=Math.cos(pitch),sp=Math.sin(pitch);
    const x=point[0]*cy+point[2]*sy,z=point[2]*cy-point[0]*sy;
    return[x,point[1]*cp-z*sp,point[1]*sp+z*cp];
  };
  const project=point=>{const transformed=rotate(point),perspective=2.5/(2.5-transformed[2]*.35);return{x:centerX+transformed[0]*radius*perspective,y:centerY-transformed[1]*radius*perspective,z:transformed[2]}};
  const patches=[];
  for(let elevation=0;elevation<ELEVATION_CELLS;elevation++)for(let azimuth=0;azimuth<AZIMUTH_CELLS;azimuth++){
    const points=[];
    for(const [a,e] of [[azimuth,elevation],[azimuth+1,elevation],[azimuth+1,elevation+1],[azimuth,elevation+1]])points.push(project(direction(a*TAU/AZIMUTH_CELLS-Math.PI,e*Math.PI/ELEVATION_CELLS-Math.PI/2)));
    const center=project(cellDirection(azimuth,elevation));
    if(center.z<-.12)continue;
    patches.push({points,depth:center.z,...coverage.cell(azimuth,elevation)});
  }
  patches.sort((a,b)=>a.depth-b.depth);
  for(const patch of patches){
    context.beginPath();context.moveTo(patch.points[0].x,patch.points[0].y);
    for(const point of patch.points.slice(1))context.lineTo(point.x,point.y);
    context.closePath();
    context.fillStyle=patch.solved>=2?'rgba(117,236,181,.43)':patch.solved===1?'rgba(181,237,151,.34)':patch.estimated?'rgba(245,201,104,.34)':coverage.hasDirections?'rgba(255,94,104,.38)':'rgba(131,161,178,.12)';
    context.strokeStyle=coverage.hasDirections?'rgba(211,238,227,.36)':'rgba(184,206,214,.25)';
    context.lineWidth=ratio;context.fill();context.stroke();
  }
  context.beginPath();context.ellipse(centerX,centerY,radius*1.04,radius*1.04,0,0,TAU);
  context.strokeStyle='rgba(181,222,219,.50)';context.lineWidth=ratio*1.5;context.stroke();
}
