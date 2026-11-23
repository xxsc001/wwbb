'use strict';

const BandWidth=(()=>{
 const gray=(r,g,b)=>(299*r+587*g+114*b)/1000;

 function median(values){
  const sorted=values.sort((a,b)=>a-b);
  const middle=Math.floor(sorted.length/2);
  return (sorted[middle]+sorted[Math.floor((sorted.length-1)/2)])/2;
 }

 function backgroundColor(data,width,column,first,last){
  if(last<first)return null;
  const channels=[[],[],[]];
  for(let y=first;y<=last;y++){
   const offset=(y*width+column)*4;
   for(let c=0;c<3;c++)channels[c].push(data[offset+c]);
  }
  return channels.map(median);
 }

 function smoothstep(value){
  const t=Math.max(0,Math.min(1,value));
  return t*t*(3-2*t);
 }

 function apply(image,top,bottom,pixels,strength,mode){
  const {width,height,data}=image;
  const readRows=Math.max(3,Math.min(8,Math.ceil((bottom-top)*.24)));
  const run=new Float32Array(bottom-top);
  const blend=Math.max(0,Math.min(1,strength));
  let changed=0;

  for(let x=0;x<width;x++){
   const above=backgroundColor(data,width,x,Math.max(0,top-readRows),top-1);
   const below=backgroundColor(data,width,x,bottom,Math.min(height-1,bottom+readRows-1));
   if(!above&&!below)continue;
   const upper=above||below,lower=below||above;
   const upperGray=gray(...upper),lowerGray=gray(...lower);
   const proportion=y=>Math.max(0,Math.min(1,(y-top+.5)/(bottom-top)));
   const backgroundGray=y=>upperGray+(lowerGray-upperGray)*proportion(y);
   let peak=0;
   for(let y=top;y<bottom;y++){
    const index=(y*width+x)*4;
    const contrast=Math.max(0,backgroundGray(y)-gray(data[index],data[index+1],data[index+2]));
    run[y-top]=contrast;
    peak=Math.max(peak,contrast);
   }
   if(peak<10)continue;

   const threshold=Math.max(5,peak*.14);
   let first=bottom,last=top-1,weight=0,weightedY=0;
   for(let y=top;y<bottom;y++){
    const contrast=run[y-top]-threshold;
    if(contrast<=0)continue;
    first=Math.min(first,y);
    last=y;
    weight+=contrast;
    weightedY+=contrast*y;
   }
   if(last<=first)continue;
   const center=weightedY/weight;
   const before=Math.max(.75,center-first+.5),after=Math.max(.75,last-center+.5);
   const from=mode==='narrow'?first:Math.max(0,Math.floor(first-pixels));
   const to=mode==='narrow'?last:Math.min(height-1,Math.ceil(last+pixels));
   for(let y=from;y<=to;y++){
    const distance=Math.abs(y-center);
    const span=y<center?before:after;
    const index=(y*width+x)*4;
    const present=gray(data[index],data[index+1],data[index+2]);
    if(mode==='narrow'){
     if(run[y-top]<=threshold)continue;
     const protectedCore=Math.max(.6,span*.40);
     const targetEdge=Math.max(protectedCore,span-pixels);
     const feather=Math.max(.65,Math.min(2.8,pixels*.52));
     const start=Math.max(protectedCore,targetEdge-feather*.45);
     const alpha=blend*smoothstep((distance-start)/feather);
     if(alpha<.005)continue;
     const mix=proportion(y);
     let pixelChanged=false;
     for(let c=0;c<3;c++){
      const target=upper[c]+(lower[c]-upper[c])*mix;
      const value=Math.round(data[index+c]+(target-data[index+c])*alpha);
      pixelChanged ||= data[index+c]!==value;
      data[index+c]=value;
     }
     if(pixelChanged)changed++;
    }else{
     const sourceY=center+(y-center)*span/(span+pixels);
     const sample=Math.floor(sourceY)-top;
     const offset=sourceY-Math.floor(sourceY);
     const contrast=(run[sample]??0)*(1-offset)+(run[sample+1]??0)*offset;
     const contour=Math.max(0,contrast-threshold);
     const lift=(contour*(1+.30*blend)-Math.max(0,backgroundGray(y)-present))*blend;
     const darken=Math.round(Math.max(0,lift));
     if(!darken||!present)continue;
     for(let c=0;c<3;c++)data[index+c]=Math.max(0,data[index+c]-darken);
     changed++;
    }
   }
  }
  return changed;
 }

 function prepare(side,box,pixels,strength,mode){
  const x=box.x;
  if(box.width<1||box.height<2)return null;
  const bleed=Math.ceil(pixels)+8;
  const y=Math.max(0,box.y-bleed);
  const bottom=Math.min(side.canvas.height,box.y+box.height+bleed);
  const image=side.ctx.getImageData(x,y,box.width,bottom-y);
  const topInImage=box.y-y;
  const changed=apply(image,topInImage,topInImage+box.height,pixels,strength,mode);
  return changed?{image,x,y}:null;
 }

 return {apply,prepare};
})();
