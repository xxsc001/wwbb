'use strict';

const WBMeasure = (() => {
 const byId=id=>document.getElementById(id);
 const dialog=byId('wbDialog');
 const canvas=byId('wbCanvas');
 const polarity=byId('wbPolarity');
 let source, sourceWidth, sourceHeight, preview, label;
 const colors={band:'#157cef',background:'#00a16a',scope:'#c26b10'};
 const backgroundDirections={ArrowLeft:[-1,0],ArrowUp:[0,-1],ArrowDown:[0,1],ArrowRight:[1,0]};
 let mode='band', regions, stats, results, sequence, drag, autoSummary='';

 function regionFromPoints(a,b){
  return {x:Math.min(a.x,b.x),y:Math.min(a.y,b.y),width:Math.abs(a.x-b.x),height:Math.abs(a.y-b.y)};
 }

 function measureRegion(image,region,withHistogram=false){
  const tile=document.createElement('canvas');
  const tileSize=512;
  tile.width=Math.min(tileSize,region.width);
  tile.height=Math.min(tileSize,region.height);
  const context=tile.getContext('2d',{willReadFrequently:true});
  context.fillStyle='#fff';
  let sum=0;
  const histogram=withHistogram?new Uint32Array(256):null;
  for(let y=0;y<region.height;y+=tileSize){
   for(let x=0;x<region.width;x+=tileSize){
    const w=Math.min(tileSize,region.width-x);
    const h=Math.min(tileSize,region.height-y);
    context.fillRect(0,0,w,h);
    context.drawImage(image,region.x+x,region.y+y,w,h,0,0,w,h);
    const pixels=context.getImageData(0,0,w,h).data;
    for(let i=0;i<pixels.length;i+=4){
     const gray=Math.round((299*pixels[i]+587*pixels[i+1]+114*pixels[i+2])/1000);
     sum+=gray;
     if(histogram)histogram[gray]++;
    }
   }
  }
  const area=region.width*region.height;
  return {area,mean:sum/area,sum,histogram};
 }

 function correctedIntensity(band,background,type){
  if(!band||!background)return null;
  const corrected=band.sum-background.mean*band.area;
  return type==='dark'?-corrected:corrected;
 }

 const format=value=>value===null?'—':Number(value.toFixed(3)).toLocaleString('zh-CN');

 function setMode(next){
  mode=next;
  byId('wbBand').setAttribute('aria-pressed',String(next==='band'));
  byId('wbBackground').setAttribute('aria-pressed',String(next==='background'));
  byId('wbScope').setAttribute('aria-pressed',String(next==='scope'));
  updateStatus();
 }

 function updateStatus(){
  const {band,background}=stats;
  byId('wbSave').disabled=!band;
  byId('wbClearBackground').disabled=!background;
  for(const key of Object.keys(backgroundDirections))byId('wbBg'+key.slice(5)).disabled=!background;
  byId('wbClearScope').disabled=!regions.scope;
  const instructions={
   band:'在图上拖出条带框。',
   background:'在同一图中框选附近没有条带的背景。',
   scope:'拖框圈住目标那一排条带，再点击「自动框选」。'
  };
  const readout=band
   ? `条带 ${regions.band.width} × ${regions.band.height} px · 原始 IntDen ${format(band.sum)} · 扣背景 ${format(correctedIntensity(band,background,polarity.value))}`
   : '尚未选定条带。';
  const backgroundReadout=background
   ? ` 背景平均灰度 ${format(background.mean)}，位置 X ${regions.background.x} / Y ${regions.background.y}。`
   : band?' 未找到合适背景，可手动框选。':'';
  byId('wbStatus').textContent=autoSummary||instructions[mode]+' '+readout+backgroundReadout;
 }

 function paint(){
  const context=canvas.getContext('2d');
  context.drawImage(preview,0,0);
  const sx=canvas.width/sourceWidth,sy=canvas.height/sourceHeight;
  function outline(region,color,number){
   if(!region)return;
   const {x,y,width,height}=region;
   context.strokeStyle=color;
   context.lineWidth=2;
   context.strokeRect(x*sx,y*sy,width*sx,height*sy);
   if(number!==undefined){
    context.font='13px sans-serif';
    context.fillStyle=color;
    context.fillText(number,x*sx+4,y*sy+14);
   }
  }
  outline(regions.scope,colors.scope);
  for(const entry of results){
   if(entry.automatic){
    for(const background of entry.backgroundRegions)outline(background,colors.background);
   }
   outline(entry.bandRegion,'#2d6abe',entry.id);
  }
  outline(regions.band,colors.band);
  outline(regions.background,colors.background);
  if(drag)outline(regionFromPoints(drag.start,drag.end),colors[drag.mode]);
 }

 function updateRows(){
  const body=byId('wbRows');
  body.replaceChildren();
  for(const entry of results){
   const row=document.createElement('tr');
   const id=entry.bandRegion.inferred?entry.id+' 待复核':entry.automatic?entry.id+' 自动':entry.id;
   for(const text of [id,format(entry.band.area),format(entry.band.mean),format(entry.band.sum),format(entry.background?.mean??null),format(entry.corrected)]){
    const cell=document.createElement('td');
    cell.textContent=text;
    row.append(cell);
   }
   const cell=document.createElement('td');
   const remove=document.createElement('button');
   remove.type='button';
   remove.textContent='移除';
   remove.setAttribute('aria-label',`移除测量 ${entry.id}`);
   remove.onclick=()=>{
    results=results.filter(item=>item!==entry);
    updateRows();
    paint();
   };
   cell.append(remove);
   row.append(cell);
   body.append(row);
  }
  byId('wbResults').hidden=!results.length;
  byId('wbCsv').disabled=!results.length;
 }

 function locate(event){
  const bounds=canvas.getBoundingClientRect();
  return {
   x:Math.max(0,Math.min(sourceWidth,Math.round((event.clientX-bounds.left)/bounds.width*sourceWidth))),
   y:Math.max(0,Math.min(sourceHeight,Math.round((event.clientY-bounds.top)/bounds.height*sourceHeight)))
  };
 }

 canvas.addEventListener('pointerdown',event=>{
  if(event.button!==0||drag)return;
  const start=locate(event);
  drag={id:event.pointerId,start,end:start,mode};
  canvas.setPointerCapture(event.pointerId);
 });
 canvas.addEventListener('pointermove',event=>{
  if(drag?.id!==event.pointerId)return;
  drag.end=locate(event);
  paint();
 });
 canvas.addEventListener('pointerup',event=>{
  if(drag?.id!==event.pointerId)return;
  const region=regionFromPoints(drag.start,locate(event));
  const selected=drag.mode;
  drag=null;
  if(region.width&&region.height){
   autoSummary='';
   regions[selected]=region;
   if(selected!=='scope')stats[selected]=measureRegion(source,region);
   if(selected==='band'){
    const excluded=[region,...results.map(entry=>entry.bandRegion)];
    const {backgroundRegions}=nearbyBackground(region,polarity.value,excluded);
    setBackground(backgroundRegions[0]??null);
   }
  }
  paint();
  updateStatus();
 });
 for(const name of ['pointercancel','lostpointercapture']){
  canvas.addEventListener(name,event=>{
   if(drag?.id!==event.pointerId)return;
   drag=null;
   paint();
  });
 }

 for(const [id,next] of [['wbBand','band'],['wbBackground','background'],['wbScope','scope']]){
  byId(id).onclick=()=>{autoSummary='';setMode(next);};
 }
 polarity.onchange=()=>{autoSummary='';updateStatus();};
 byId('wbClearScope').onclick=()=>{
  regions.scope=null;
  autoSummary='';
  paint();
  updateStatus();
 };
 function setBackground(region){
  regions.background=region;
  stats.background=region?measureRegion(source,region):null;
 }

 function moveBackground(direction,step){
  const region=regions?.background;
  if(!region||drag)return;
  const [dx,dy]=direction;
  const x=Math.max(0,Math.min(sourceWidth-region.width,region.x+step*dx));
  const y=Math.max(0,Math.min(sourceHeight-region.height,region.y+step*dy));
  if(region.x===x&&region.y===y)return;
  autoSummary='';
  setBackground({...region,x,y});
  paint();
  updateStatus();
 }

 for(const [key,direction] of Object.entries(backgroundDirections)){
  byId('wbBg'+key.slice(5)).onclick=event=>moveBackground(direction,event?.shiftKey?10:1);
 }
 dialog.addEventListener('keydown',event=>{
  const direction=backgroundDirections[event.key];
  if(!direction||!regions?.background||drag||event.ctrlKey||event.altKey||event.metaKey||
      event.target.closest('input, select, textarea, [contenteditable="true"]'))return;
  event.preventDefault();
  moveBackground(direction,event.shiftKey?10:1);
 });

 byId('wbClearBackground').onclick=()=>{
  autoSummary='';
  setBackground(null);
  paint();
  updateStatus();
 };
 byId('wbSave').onclick=()=>{
  if(!stats.band)return;
  const type=polarity.value;
  results.push({
   id:++sequence,band:stats.band,background:stats.background,bandRegion:regions.band,
   backgroundRegion:regions.background,type,corrected:correctedIntensity(stats.band,stats.background,type)
  });
  regions.band=null;
  stats.band=null;
  autoSummary='';
  setMode('band');
  updateRows();
  paint();
 };

 function detectInRange(search,type,limit,scoped){
  const margin=scoped?Math.max(4,Math.ceil(search.height*.55),Math.ceil(search.width*.075)):0;
  const y=Math.max(0,search.y-margin);
  const bottom=Math.min(sourceHeight,search.y+search.height+margin);
  const range={...search,y,height:bottom-y};
  const scale=Math.min(1,800/range.width,420/range.height);
  const sample=document.createElement('canvas');
  const width=sample.width=Math.max(1,Math.round(range.width*scale));
  const height=sample.height=Math.max(1,Math.round(range.height*scale));
  const context=sample.getContext('2d',{willReadFrequently:true});
  context.fillStyle='#fff';
  context.fillRect(0,0,width,height);
  context.drawImage(source,range.x,range.y,range.width,range.height,0,0,width,height);
  const pixels=context.getImageData(0,0,width,height).data;
  const gray=new Uint8Array(width*height);
  for(let i=0;i<gray.length;i++)gray[i]=Math.round((299*pixels[4*i]+587*pixels[4*i+1]+114*pixels[4*i+2])/1000);
  const window=scoped?{
   top:Math.max(0,Math.floor((search.y-range.y)*height/range.height)),
   bottom:Math.min(height,Math.ceil((search.y+search.height-range.y)*height/range.height))
  }:null;
  const bands=WBAuto.detect(gray,width,height,type,limit,window);
  return WBAuto.originalBoxes(bands,range,width,height,sourceWidth,sourceHeight,scoped);
 }

 function cleanBackground(region,type){
  const sample=measureRegion(source,region,true);
  const levels=sample.histogram;
  let cumulative=0,medianGray=0;
  for(;medianGray<255;medianGray++){
   cumulative+=levels[medianGray];
   if(cumulative>=sample.area/2)break;
  }
  let offTone=0;
  for(let gray=0;gray<256;gray++){
   if(type==='dark'?gray<medianGray-12:gray>medianGray+12)offTone+=levels[gray];
  }
  return offTone<=sample.area*.22?{region,mean:sample.mean,sum:sample.sum,area:sample.area}:null;
 }

 function nearbyBackground(band,type,boxes){
  const gap=Math.max(2,Math.round(band.height*.28));
  const height=Math.max(2,Math.round(band.height*.55));
  const overlap=(a,b)=>a.x<b.x+b.width&&a.x+a.width>b.x&&a.y<b.y+b.height&&a.y+a.height>b.y;
  const samples=[];
  for(const direction of [-1,1]){
   for(const offset of [gap,gap+height]){
    const y=direction<0?band.y-offset-height:band.y+band.height+offset;
    const region={x:band.x,y,width:band.width,height};
    if(y<0||y+height>sourceHeight||boxes.some(box=>overlap(region,box)))continue;
    const result=cleanBackground(region,type);
    if(result){samples.push(result);break;}
   }
  }
  if(samples.length===2&&Math.abs(samples[0].mean-samples[1].mean)>16){
   // A much darker (or brighter, for bright bands) flank may contain a second band.
   samples.sort((a,b)=>type==='dark'?b.mean-a.mean:a.mean-b.mean);
   samples.length=1;
  }
  if(!samples.length)return {background:null,backgroundRegions:[]};
  const totalArea=samples.reduce((sum,sample)=>sum+sample.area,0);
  const totalGray=samples.reduce((sum,sample)=>sum+sample.sum,0);
  return {background:{mean:totalGray/totalArea},backgroundRegions:samples.map(sample=>sample.region)};
 }

 byId('wbAuto').onclick=()=>{
  if(!source||drag)return;
  const range=regions.scope||{x:0,y:0,width:sourceWidth,height:sourceHeight};
  const type=polarity.value;
  const limit=Number(byId('wbCount').value)||6;
  const boxes=detectInRange(range,type,limit,Boolean(regions.scope));
  if(!boxes.length||(!regions.scope&&boxes.length<2)){
   autoSummary='未识别到明显的一排条带。可限定目标范围、检查条带类型，或手动框选。';
   updateStatus();
   return;
  }
  const automatic=boxes.map(bandRegion=>{
   const band=measureRegion(source,bandRegion);
   const {background,backgroundRegions}=nearbyBackground(bandRegion,type,boxes);
   return {
    id:++sequence,band,background,bandRegion,backgroundRegions,
    backgroundRegion:backgroundRegions[0],type,automatic:true,
    corrected:correctedIntensity(band,background,type)
   };
  });
  results=[...results.filter(entry=>!entry.automatic),...automatic];
  const corrected=automatic.filter(entry=>entry.background).length;
  const inferred=boxes.filter(box=>box.inferred).length;
  autoSummary=`自动框选 ${boxes.length} 条，已为 ${corrected} 条校正背景。请核对蓝框和绿框。`;
  if(inferred)autoSummary+=` ${inferred} 个相邻框按条带宽度和泳道间距拆分，已标为待复核。`;
  if(boxes.length<limit)autoSummary+=' 部分条带可能未识别，可用手动框选补测。';
  if(corrected<boxes.length)autoSummary+=' 未选到合适背景的条带仅显示原始 IntDen。';
  updateStatus();
  updateRows();
  paint();
 };

 byId('wbCsv').onclick=()=>{
  const geometry=region=>region?[region.x,region.y,region.width,region.height]:['','','',''];
  const rows=[['ID','Area_px2','Mean_gray','RawIntDen','Background_mean_gray','Corrected_IntDen','Band_type','Band_x_px','Band_y_px','Band_width_px','Band_height_px','Background_x_px','Background_y_px','Background_width_px','Background_height_px','Background2_x_px','Background2_y_px','Background2_width_px','Background2_height_px','Method']];
  for(const entry of results){
   const method=entry.bandRegion.inferred?'automatic_split_review':entry.automatic?'automatic':'manual';
   rows.push([entry.id,entry.band.area,entry.band.mean,entry.band.sum,entry.background?.mean??'',entry.corrected??'',entry.type,...geometry(entry.bandRegion),...geometry(entry.backgroundRegion),...geometry(entry.backgroundRegions?.[1]),method]);
  }
  const csv=rows.map(row=>row.join(',')).join('\r\n')+'\r\n';
  ImageExport.download(new Blob([csv],{type:'text/csv;charset=utf-8'}),'wb-intden.csv');
 };

 byId('wbClose').onclick=()=>dialog.close();
 dialog.addEventListener('close',()=>{drag=null;});

 function open(image,name){
  if(dialog.open)return;
  if(image!==source){
   source=image;
   label=name;
   sourceWidth=source.naturalWidth||source.width;
   sourceHeight=source.naturalHeight||source.height;
   const scale=Math.min(1,860/sourceWidth,450/sourceHeight);
   canvas.width=Math.max(1,Math.round(sourceWidth*scale));
   canvas.height=Math.max(1,Math.round(sourceHeight*scale));
   preview=document.createElement('canvas');
   preview.width=canvas.width;
   preview.height=canvas.height;
   const context=preview.getContext('2d');
   context.fillStyle='#fff';
   context.fillRect(0,0,preview.width,preview.height);
   context.drawImage(source,0,0,preview.width,preview.height);
   regions={band:null,background:null,scope:null};
   stats={band:null,background:null};
   results=[];
   sequence=0;
   autoSummary='';
   polarity.value='dark';
   setMode('band');
  }
  byId('wbSource').textContent=`${label} · 左图原图 · ${sourceWidth} × ${sourceHeight} px`;
  updateRows();
  paint();
  dialog.showModal();
 }

 return {open};
})();
