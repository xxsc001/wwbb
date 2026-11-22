'use strict';

const WBMeasure = (() => {
 const byId=id=>document.getElementById(id);
 const dialog=byId('wbDialog');
 const canvas=byId('wbCanvas');
 const polarity=byId('wbPolarity');
 let source, sourceWidth, sourceHeight, preview, label;
 let mode='band', regions, stats, results, sequence, drag;

 function regionFromPoints(a,b){
  return {x:Math.min(a.x,b.x),y:Math.min(a.y,b.y),width:Math.abs(a.x-b.x),height:Math.abs(a.y-b.y)};
 }

 function measureRegion(image,region){
  const tile=document.createElement('canvas');
  const tileSize=512;
  tile.width=Math.min(tileSize,region.width);
  tile.height=Math.min(tileSize,region.height);
  const context=tile.getContext('2d',{willReadFrequently:true});
  context.fillStyle='#fff';
  let sum=0;
  for(let y=0;y<region.height;y+=tileSize){
   for(let x=0;x<region.width;x+=tileSize){
    const w=Math.min(tileSize,region.width-x);
    const h=Math.min(tileSize,region.height-y);
    context.fillRect(0,0,w,h);
    context.drawImage(image,region.x+x,region.y+y,w,h,0,0,w,h);
    const pixels=context.getImageData(0,0,w,h).data;
    for(let i=0;i<pixels.length;i+=4){
     sum+=Math.round((299*pixels[i]+587*pixels[i+1]+114*pixels[i+2])/1000);
    }
   }
  }
  const area=region.width*region.height;
  return {area,mean:sum/area,sum};
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
  updateStatus();
 }

 function updateStatus(){
  const {band,background}=stats;
  byId('wbSave').disabled=!band;
  byId('wbClearBackground').disabled=!background;
  const instruction=mode==='band'?'在图上拖出条带框。':'在同一图中框选附近没有条带的背景。';
  const readout=band
   ? `条带 ${regions.band.width} × ${regions.band.height} px · 原始 IntDen ${format(band.sum)} · 扣背景 ${format(correctedIntensity(band,background,polarity.value))}`
   : '尚未选定条带。';
  const backgroundReadout=background?` 背景平均灰度 ${format(background.mean)}。`:'';
  byId('wbStatus').textContent=instruction+' '+readout+backgroundReadout;
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
  for(const entry of results)outline(entry.bandRegion,'#2d6abe',entry.id);
  outline(regions.band,'#157cef');
  outline(regions.background,'#00a16a');
  if(drag)outline(regionFromPoints(drag.start,drag.end),drag.mode==='band'?'#157cef':'#00a16a');
 }

 function updateRows(){
  const body=byId('wbRows');
  body.replaceChildren();
  for(const entry of results){
   const row=document.createElement('tr');
   for(const text of [entry.id,format(entry.band.area),format(entry.band.mean),format(entry.band.sum),format(entry.background?.mean??null),format(entry.corrected)]){
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
   regions[selected]=region;
   stats[selected]=measureRegion(source,region);
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

 byId('wbBand').onclick=()=>setMode('band');
 byId('wbBackground').onclick=()=>setMode('background');
 polarity.onchange=updateStatus;
 byId('wbClearBackground').onclick=()=>{
  regions.background=null;
  stats.background=null;
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
  setMode('band');
  updateRows();
  paint();
 };
 byId('wbCsv').onclick=()=>{
  const geometry=region=>region?[region.x,region.y,region.width,region.height]:['','','',''];
  const rows=[['ID','Area_px2','Mean_gray','RawIntDen','Background_mean_gray','Corrected_IntDen','Band_type','Band_x_px','Band_y_px','Band_width_px','Band_height_px','Background_x_px','Background_y_px','Background_width_px','Background_height_px']];
  for(const entry of results){
   rows.push([entry.id,entry.band.area,entry.band.mean,entry.band.sum,entry.background?.mean??'',entry.corrected??'',entry.type,...geometry(entry.bandRegion),...geometry(entry.backgroundRegion)]);
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
   regions={band:null,background:null};
   stats={band:null,background:null};
   results=[];
   sequence=0;
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
