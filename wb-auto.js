'use strict';

const WBAuto=(()=>{
 function median(values){
  const sorted=[...values].sort((a,b)=>a-b);
  const middle=Math.floor(sorted.length/2);
  return (sorted[middle]+sorted[Math.floor((sorted.length-1)/2)])/2;
 }

 function localContrast(gray,width,height,type,window){
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
  const span=window?window.bottom-window.top:width;
  const fractions=window?[.09,.17,.28,.43]:[.006,.013,.024,.037];
  const radii=fractions.map(fraction=>Math.max(2,Math.round(span*fraction)));
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

 function scopedRow(signal,width,window,limit){
  // Work from a horizontal signal profile so a connected blob can span multiple lanes.
  const rowTotals=new Float32Array(window.bottom-window.top);
  let peakY=window.top;
  for(let y=window.top;y<window.bottom;y++){
   let sum=0;
   for(let x=0;x<width;x++)sum+=Math.max(0,signal[y*width+x]-4);
   rowTotals[y-window.top]=sum;
   if(sum>rowTotals[peakY-window.top])peakY=y;
  }
  const rowPeak=rowTotals[peakY-window.top];
  if(rowPeak<width*.35)return [];
  const edge=rowPeak*.19;
  let top=peakY,bottom=peakY+1;
  while(top>window.top&&rowTotals[top-1-window.top]>=edge)top--;
  while(bottom<window.bottom&&rowTotals[bottom-window.top]>=edge)bottom++;

  const profile=new Float32Array(width);
  for(let x=0;x<width;x++){
   for(let y=top;y<bottom;y++)profile[x]+=signal[y*width+x]/(bottom-top);
  }
  const floor=Math.max(4,Math.min(12,Math.max(...profile)*.10));
  const minimumWidth=Math.max(4,Math.round(width*.015));
  const runs=[];
  let start=-1,last=-1;
  for(let x=0;x<=width;x++){
   if(x<width&&profile[x]>=floor){
    if(start===-1)start=x;
    last=x;
   }else if(start!==-1&&(x===width||x-last>2)){
    if(last-start+1>=minimumWidth)runs.push({left:start,right:last+1});
    start=-1;
   }
  }
  if(!runs.length)return [];

  const sizes=runs.map(run=>run.right-run.left).sort((a,b)=>a-b);
  const typical=median(sizes.slice(0,Math.max(1,Math.ceil(sizes.length*.75))));
  const singles=runs.filter(run=>run.right-run.left<typical*1.55);
  const gaps=singles.slice(1).map((run,i)=>{
   const prev=singles[i];
   const gap=(run.left+run.right-prev.left-prev.right)/2;
   return gap/Math.max(1,Math.round(gap/(typical*1.18)));
  }).filter(gap=>gap>=typical*.92&&gap<=typical*1.65);
  const pitch=gaps.length?median(gaps):typical*1.1;
  let splitsLeft=Math.max(0,limit-runs.length);
  const pieces=[];
  for(const run of runs){
   const length=run.right-run.left;
   const count=singles.length>=2&&length>=typical*1.58
    ? Math.min(1+splitsLeft,Math.max(1,Math.round(length/pitch))) : 1;
   splitsLeft-=count-1;
   let left=run.left;
   for(let i=1;i<=count;i++){
    let right=run.right;
    if(i<count){
     const expected=run.left+length*i/count;
     const radius=length/count*.22;
     const from=Math.max(left+minimumWidth,Math.ceil(expected-radius));
     const to=Math.min(run.right-minimumWidth*(count-i),Math.floor(expected+radius));
     right=Math.round(expected);
     let best=Infinity;
     for(let boundary=from;boundary<=to;boundary++){
      const penalty=profile[boundary]+Math.abs(boundary-expected)/radius*floor;
      if(penalty<best){best=penalty;right=boundary;}
     }
    }
    let strength=0;
    for(let x=left;x<right;x++)strength+=profile[x];
    pieces.push({x:(left+right)/2,y:(top+bottom)/2,width:right-left,height:bottom-top,score:strength,inferred:count>1});
    left=right;
   }
  }
  return pieces.sort((a,b)=>b.score-a.score).slice(0,limit).sort((a,b)=>a.x-b.x);
 }

 function detect(gray,width,height,type,limit,window=null){
  if(width<18||height<8)return [];
  const response=localContrast(gray,width,height,type,window);
  if(window)return scopedRow(response,width,window,limit);
  return strongestRow(components(response,width,height),height,limit);
 }

 function originalBoxes(bands,range,sampleWidth,sampleHeight,imageWidth,imageHeight,scoped=false){
  if(!bands.length)return [];
  const sx=range.width/sampleWidth,sy=range.height/sampleHeight;
  const gaps=bands.slice(1).map((band,i)=>band.x-bands[i].x);
  const maxWidth=Math.max(...bands.map(band=>band.width));
  const maxHeight=Math.max(...bands.map(band=>band.height));
  const width=Math.min(imageWidth,Math.max(1,Math.round(sx*Math.min(maxWidth*1.15,gaps.length?Math.min(...gaps)*.91:Infinity))));
  const height=Math.min(imageHeight,Math.max(1,Math.round(sy*maxHeight*1.32)));
  return bands.map((band,i)=>{
   const pad=band.width*.07;
   const edgeLeft=band.x-band.width/2,edgeRight=band.x+band.width/2;
   const previous=bands[i-1],next=bands[i+1];
   const left=scoped?Math.max(edgeLeft-pad,previous?Math.min(edgeLeft,(previous.x+band.x)/2):-Infinity):band.x-width/(2*sx);
   const right=scoped?Math.min(edgeRight+pad,next?Math.max(edgeRight,(next.x+band.x)/2):Infinity):left+width/sx;
   const x=Math.max(0,Math.min(imageWidth-1,Math.round(range.x+left*sx)));
   const w=scoped?Math.max(1,Math.min(imageWidth-x,Math.round(range.x+right*sx)-x)):width;
   return {
   x:Math.min(imageWidth-w,x),
   y:Math.max(0,Math.min(imageHeight-height,Math.round(range.y+band.y*sy-height/2))),
   width:w,height,inferred:!!band.inferred
  };});
 }

 return {detect,originalBoxes};
})();
