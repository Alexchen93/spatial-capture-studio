export function assessCaptureFrame(data,width,height,previous=null){
  if(!data||width<3||height<3)return{accepted:false,reason:'相機畫面尚未準備好'};
  const gray=new Uint8Array(width*height);let sum=0,edges=0;
  for(let i=0;i<gray.length;i++){
    const at=i*4,value=Math.round(.2126*data[at]+.7152*data[at+1]+.0722*data[at+2]);gray[i]=value;sum+=value;
    if(i%width&&i>=width)edges+=Math.abs(value-gray[i-1])+Math.abs(value-gray[i-width]);
  }
  const brightness=sum/gray.length,detail=edges/(2*(width-1)*(height-1));
  if(brightness<24||brightness>235)return{accepted:false,reason:'光線過暗或過亮，請調整拍攝角度'};
  if(detail<5)return{accepted:false,reason:'畫面細節不足，請放慢移動並對準有紋理的區域'};
  if(previous?.length===gray.length){let difference=0;for(let i=0;i<gray.length;i++)difference+=Math.abs(gray[i]-previous[i]);if(difference/gray.length<4)return{accepted:false,reason:'角度與上一張太接近，請緩慢移動'};}
  return{accepted:true,gray};
}
