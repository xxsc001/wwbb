'use strict';

const WBAuto=(()=>{
 function median(values){
  const sorted=[...values].sort((a,b)=>a-b);
  const middle=Math.floor(sorted.length/2);
  return (sorted[middle]+sorted[Math.floor((sorted.length-1)/2)])/2;
 }

 function localContrast(gray,width,height,type){
  const smooth=new Float32Array(gray.length);
  const signal=new Float32Array(gray.length);
  const half=Math.max(1,Math.min(3,Math.round(width/190)));
  for(let y=0;y<height;y++){
   let sum=0;
   const row=y*width;
   for(let x=0;x<width;x++){
    sum+=gray[row+x];
    if(x>2*half)sum-=gray[row+x-2*half-1];
    if(x>=2*half)smooth[row+x-half]=sum/(2*half+1);
   }
  }
  const radii=[.006,.013,.024,.037].map(fraction=>Math.max(2,Math.round(width*fraction)));
  const direction=type==='dark'?1:-1;
  for(const radius of new Set(radii)){
   for(let y=radius;y<height-radius;y++){
    for(let x=half;x<width-half;x++){
     const i=y*width+x;
     const baselineAbove=direction*(smooth[i-radius*width]-smooth[i]);
     const baselineBelow=direction*(smooth[i+radius*width]-smooth[i]);
     signal[i]=Math.max(signal[i],Math.min(baselineAbove,baselineBelow));
    }
   }
  }
  return signal;
 }

 function components(signal,width,height){
  const histogram=new Uint32Array(256);
  for(const value of signal)histogram[Math.round(value)]++;
  let tail=0,peak=255;
  for(;peak>0;peak--){
   tail+=histogram[peak];
   if(tail>=signal.length*.003)break;
  }
  const minimumContrast=Math.max(5,Math.min(16,peak*.22));
  const used=new Uint8Array(signal.length);
  const candidates=[];
  for(let start=0;start<signal.length;start++){
   if(used[start]||signal[start]<minimumContrast)continue;
   const queue=[start];
   used[start]=1;
   let left=width,right=0,top=height,bottom=0,strength=0;
   for(let i=0;i<queue.length;i++){
    const index=queue[i];
    const x=index%width,y=Math.floor(index/width);
    left=Math.min(left,x);right=Math.max(right,x);
    top=Math.min(top,y);bottom=Math.max(bottom,y);
    strength+=signal[index];
    for(const next of [index-width,index+width,x>0?index-1:-1,x<width-1?index+1:-1]){
     if(next>=0&&next<signal.length&&!used[next]&&signal[next]>=minimumContrast){
      used[next]=1;
      queue.push(next);
     }
    }
   }
   const w=right-left+1,h=bottom-top+1;
   if(w<Math.max(4,width*.012)||w>width*.38||w<h*1.4||queue.length<Math.max(5,w*h*.23))continue;
   const score=Math.sqrt(queue.length)*Math.sqrt(strength/queue.length);
   candidates.push({x:(left+right+1)/2,y:(top+bottom+1)/2,width:w,height:h,score});
  }
  return candidates;
 }

 function strongestRow(candidates,height,limit){
  let best=[],bestScore=-Infinity;
  for(const anchor of candidates){
   const members=candidates.filter(candidate=>
    Math.abs(candidate.y-anchor.y)<=Math.max(3,height*.033,(candidate.height+anchor.height)*.5)&&
    candidate.width>=anchor.width*.36&&candidate.width<=anchor.width*2.8
   ).sort((a,b)=>b.score-a.score);
   const distinct=[];
   for(const candidate of members){
    const overlaps=distinct.some(existing=>Math.abs(existing.x-candidate.x)<(existing.width+candidate.width)*.42);
    if(!overlaps)distinct.push(candidate);
   }
   distinct.sort((a,b)=>a.x-b.x);
   const length=Math.min(limit,distinct.length);
   for(let start=0;start+length<=distinct.length;start++){
    const row=distinct.slice(start,start+length);
    const gaps=row.slice(1).map((candidate,i)=>candidate.x-row[i].x);
    const gap=median(gaps);
    const irregularity=gaps.length>1
     ? gaps.reduce((sum,value)=>sum+Math.min(1,Math.abs(value-gap)/gap),0)/gaps.length : 0;
    const strength=row.reduce((sum,candidate)=>sum+Math.log1p(candidate.score),0);
    const score=row.length*10+strength*.1-irregularity*7;
    if(score>bestScore){best=row;bestScore=score;}
   }
  }
  return best;
 }

 function detect(gray,width,height,type,limit){
  if(width<18||height<8)return [];
  const response=localContrast(gray,width,height,type);
  return strongestRow(components(response,width,height),height,limit);
 }

 function originalBoxes(bands,range,sampleWidth,sampleHeight,imageWidth,imageHeight){
  if(!bands.length)return [];
  const sx=range.width/sampleWidth,sy=range.height/sampleHeight;
  const gaps=bands.slice(1).map((band,i)=>band.x-bands[i].x);
  const maxWidth=Math.max(...bands.map(band=>band.width));
  const maxHeight=Math.max(...bands.map(band=>band.height));
  const width=Math.min(imageWidth,Math.max(1,Math.round(sx*Math.min(maxWidth*1.15,gaps.length?Math.min(...gaps)*.91:Infinity))));
  const height=Math.min(imageHeight,Math.max(1,Math.round(sy*maxHeight*1.32)));
  return bands.map(band=>({
   x:Math.max(0,Math.min(imageWidth-width,Math.round(range.x+band.x*sx-width/2))),
   y:Math.max(0,Math.min(imageHeight-height,Math.round(range.y+band.y*sy-height/2))),
   width,height
  }));
 }

 return {detect,originalBoxes};
})();
