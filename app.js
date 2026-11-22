'use strict';
const $=id=>document.getElementById(id);
const canvas=$('canvas'),ctx=canvas.getContext('2d',{willReadFrequently:true});
const right=$('canvasRight'),rctx=right.getContext('2d',{willReadFrequently:true});
const sides=[{canvas,ctx,name:'模拟条带-左图',original:null},{canvas:right,ctx:rctx,name:'模拟条带-右图',original:null}];
const names={smudge:'揉边',smooth:'平滑',darken:'加深',lighten:'减淡'};
const descriptions={smudge:'沿笔触柔和推移边缘',smooth:'柔化局部纹理与边缘',darken:'逐步加深笔触覆盖区域',lighten:'参考笔刷周围的亮度，柔和提亮偏暗处'};
let tool='smudge',history=[],future=[],drawing=false,previous=null,comparing=false,edited=false,loading=false,beforeCompare,activePointer;
let exporting = false;
const leftViewport = $('dropzone');
const view = {zoom: 1, x: 0, y: 0, mode: 'brush', drag: null};
const snapshot=()=>sides.map(s=>s.ctx.getImageData(0,0,s.canvas.width,s.canvas.height));
const restore=pair=>pair.forEach((image,i)=>sides[i].ctx.putImageData(image,0,0));
function status(message){$('status').textContent=message;}
function refresh(){
 $('undo').disabled=!history.length||comparing||loading||exporting;
 $('redo').disabled=!future.length||comparing||loading||exporting;
 $('reset').disabled=comparing||loading||exporting;
 updateExport();
}
function remember(){history.push(snapshot());const bytes=sides.reduce((sum,s)=>sum+s.canvas.width*s.canvas.height*4,0);const limit=Math.max(2,Math.min(20,Math.floor(100000000/bytes)));if(history.length>limit)history.shift();future=[];refresh();}
function demo(s,variant){
 const w=s.canvas.width,h=s.canvas.height,img=s.ctx.createImageData(w,h);let seed=73+variant;
 const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  let v=178+variant*8+13*Math.sin(x/320)+7*Math.cos(y/170)+(random()-.5)*18;
  for(let lane=0;lane<5;lane++){
   let dx=(x-(224+lane*208))/48;const horizontal=Math.exp(-Math.pow(dx,8));
   v-=horizontal*(Math.exp(-Math.pow((y-307)/17,2))*[105,91,65,128,53][lane]+Math.exp(-Math.pow((y-510)/15,2))*[136,135,128,145,130][lane])*(.88+.12*Math.sin(x*1.3))*(1-variant*.15);
  }
  const i=(y*w+x)*4;img.data[i]=img.data[i+1]=img.data[i+2]=Math.max(0,v);img.data[i+3]=255;
 }
 const c=s.ctx;c.putImageData(img,0,0);c.strokeStyle='#77777765';c.fillStyle='#73737380';c.lineWidth=1;c.font='14px sans-serif';c.beginPath();c.moveTo(105,75);c.lineTo(105,700);c.stroke();[250,130,95,55,35,25].forEach((v,i)=>{const y=75+i*125;c.fillText(v,16,y+5);c.beginPath();c.moveTo(99,y);c.lineTo(105,y);c.stroke();});for(let i=0;i<5;i++)c.fillText(i+1,221+i*208,750);
 s.original=c.getImageData(0,0,w,h);
 s.source=document.createElement('canvas');
 s.source.width=w;
 s.source.height=h;
 s.source.getContext('2d').drawImage(s.canvas,0,0);
}
function hideCursors(){$('cursor').hidden=true;$('cursorRight').hidden=true;}
function historyAction(redo){if(comparing||drawing||loading||exporting)return;const from=redo?future:history,to=redo?history:future;if(!from.length)return;to.push(snapshot());restore(from.pop());refresh();status(redo?'两图已同步重做。':'两图已同步撤销。');}
$('undo').onclick=()=>historyAction(false);$('redo').onclick=()=>historyAction(true);
document.querySelectorAll('.tool').forEach(button=>button.addEventListener('click',()=>{tool=button.dataset.tool;document.querySelectorAll('.tool').forEach(b=>{b.classList.toggle('active',b===button);b.setAttribute('aria-pressed',String(b===button));});$('toolDescription').textContent=descriptions[tool];$('modeInfo').textContent=names[tool]+'笔刷 · 双图同步';}));
for(const id of ['radius','strength'])$(id).addEventListener('input',()=>{$(id+'Value').innerHTML=$(id).value+' <small>'+(id==='radius'?'px':'%')+'</small>';});
function position(e){const rect=canvas.getBoundingClientRect();return{x:(e.clientX-rect.left)/rect.width*canvas.width,y:(e.clientY-rect.top)/rect.height*canvas.height};}
function cursor(e){
 const p=position(e);
 sides.forEach((s,i)=>{
  const rect=s.canvas.getBoundingClientRect();
  const frame=s.canvas.parentElement.getBoundingClientRect();
  const node=$(i?'cursorRight':'cursor');
  const diameter=2*Number($('radius').value);
  node.hidden=comparing||loading||exporting||view.mode==='pan';
  node.style.left=rect.left-frame.left-1+p.x/canvas.width*rect.width+'px';
  node.style.top=rect.top-frame.top-1+p.y/canvas.height*rect.height+'px';
  node.style.width=diameter/canvas.width*rect.width+'px';
  node.style.height=diameter/canvas.height*rect.height+'px';
 });
 return p;
}

function renderView(){
 const minOffset=1-view.zoom;
 view.x=Math.max(minOffset,Math.min(0,view.x));
 view.y=Math.max(minOffset,Math.min(0,view.y));
 const transform=`translate(${view.x*100}%, ${view.y*100}%) scale(${view.zoom})`;
 for(const side of sides)side.canvas.style.transform=transform;
 const percent=Math.round(view.zoom*100);
 $('zoom').value=percent;
 $('zoomValue').textContent=percent+'%';
 $('resetView').disabled=percent===100;
 hideCursors();
}

function zoomTo(zoom, anchorX=.5, anchorY=.5){
 if(drawing||view.drag)return;
 const next=Math.min(5,Math.max(1,zoom));
 const ratio=next/view.zoom;
 view.x=anchorX-(anchorX-view.x)*ratio;
 view.y=anchorY-(anchorY-view.y)*ratio;
 view.zoom=next;
 renderView();
}

function setViewMode(mode){
 view.mode=mode;
 leftViewport.dataset.mode=mode;
 $('brushMode').setAttribute('aria-pressed',String(mode==='brush'));
 $('panMode').setAttribute('aria-pressed',String(mode==='pan'));
 hideCursors();
 status(mode==='pan'?'在左图滚轮缩放，放大后拖动视野，两图同步。':'在左图拖动笔刷，两图同步编辑。');
}

$('brushMode').onclick=()=>setViewMode('brush');
$('panMode').onclick=()=>setViewMode('pan');
$('zoom').oninput=()=>zoomTo(Number($('zoom').value)/100);
$('resetView').onclick=()=>zoomTo(1);
$('focusBands').onclick=()=>{
 if(drawing||view.drag||loading||exporting)return;
 const match=CropTemplates.estimateBands(canvas,{
  x:(.5-view.x)/view.zoom,
  y:(.5-view.y)/view.zoom,
  width:canvas.width*.8/view.zoom,
  height:canvas.height*.7/view.zoom,
  scale:1
 });
 if(!match){
  status('左图未找到明显条带，可用「联动缩放」和「移动视野」手动定位。');
  return;
 }
 const {left,right,top,bottom}=match.bounds;
 const paddedSpan=Math.max((right-left)*1.28,(bottom-top)*1.4);
 view.zoom=Math.min(5,Math.max(1,Math.floor(20/paddedSpan)/20));
 view.x=.5-(left+right)/2*view.zoom;
 view.y=.5-(top+bottom)/2*view.zoom;
 renderView();
 status('已定位左图的候选条带，两张图已同步到相同倍率和相对位置。');
};
leftViewport.addEventListener('wheel',event=>{
 if(view.mode!=='pan'||event.ctrlKey||event.metaKey||drawing||view.drag)return;
 event.preventDefault();
 const rect=leftViewport.getBoundingClientRect();
 zoomTo(view.zoom-Math.sign(event.deltaY)*.15,(event.clientX-rect.left)/rect.width,(event.clientY-rect.top)/rect.height);
},{passive:false});

function beginPan(e){
 view.drag={id:e.pointerId, screenX:e.clientX, screenY:e.clientY, x:view.x, y:view.y};
 leftViewport.dataset.dragging='true';
 canvas.setPointerCapture(e.pointerId);
}

function movePan(e){
 const drag=view.drag;
 if(e.pointerId!==drag.id)return;
 view.x=drag.x+(e.clientX-drag.screenX)/leftViewport.clientWidth;
 view.y=drag.y+(e.clientY-drag.screenY)/leftViewport.clientHeight;
 renderView();
}

function luminance(data,index){
 return .2126*data[index]+.7152*data[index+1]+.0722*data[index+2];
}

function luminanceAt(image,x,y){
 if(x<0||y<0||x>image.width-1||y>image.height-1)return null;
 const left=Math.floor(x),top=Math.floor(y);
 const right=Math.min(left+1,image.width-1),bottom=Math.min(top+1,image.height-1);
 const at=(column,row)=>luminance(image.data,(row*image.width+column)*4);
 const dx=x-left,dy=y-top;
 const upper=at(left,top)*(1-dx)+at(right,top)*dx;
 const lower=at(left,bottom)*(1-dx)+at(right,bottom)*dx;
 return upper*(1-dy)+lower*dy;
}

function median(values){
 const sorted=[...values].sort((a,b)=>a-b);
 const middle=Math.floor(sorted.length/2);
 return (sorted[middle]+sorted[Math.floor((sorted.length-1)/2)])/2;
}

function dodgeBackground(source,point,rx,ry){
 // Points on either side of the brush estimate the local level and its gradient.
 const pairs=[];
 for(const radius of [1.3,1.65,2]){
  for(const angle of [0,Math.PI/4,Math.PI/2,Math.PI*3/4]){
   const x=Math.cos(angle)*radius,y=Math.sin(angle)*radius;
   const plus=luminanceAt(source,point.x+x*rx,point.y+y*ry);
   const minus=luminanceAt(source,point.x-x*rx,point.y-y*ry);
   if(plus!==null&&minus!==null)pairs.push({x,y,plus,minus,center:(plus+minus)/2});
  }
 }
 if(!pairs.length)return null;
 const center=median(pairs.map(pair=>pair.center));
 const deviation=median(pairs.map(pair=>Math.abs(pair.center-center)));
 const tolerance=Math.max(4,Math.min(16,2*deviation));
 // A small diagonal term keeps the fit stable when the image edge leaves only one axis.
 let xx=.001,yy=.001,xy=0,bx=0,by=0,minimum=center,maximum=center;
 for(const pair of pairs){
  if(Math.abs(pair.center-center)>tolerance)continue;
  const {x,y,plus,minus}=pair;
  const difference=(plus-minus)/2;
  xx+=x*x; yy+=y*y; xy+=x*y;
  bx+=x*difference; by+=y*difference;
  minimum=Math.min(minimum,plus,minus);
  maximum=Math.max(maximum,plus,minus);
 }
 const determinant=xx*yy-xy*xy;
 const slopeX=(yy*bx-xy*by)/determinant;
 const slopeY=(xx*by-xy*bx)/determinant;
 return (x,y)=>Math.max(minimum,Math.min(maximum,center+slopeX*x+slopeY*y));
}

function dodgeDab(side,point,rx,ry,strength,reference){
 const background=dodgeBackground(reference,point,rx,ry);
 if(!background)return;
 const x0=Math.max(0,Math.floor(point.x-rx)),y0=Math.max(0,Math.floor(point.y-ry));
 const x1=Math.min(side.canvas.width,Math.ceil(point.x+rx));
 const y1=Math.min(side.canvas.height,Math.ceil(point.y+ry));
 if(x1<=x0||y1<=y0)return;
 const image=side.ctx.getImageData(x0,y0,x1-x0,y1-y0);
 let changed=false;
 for(let y=0;y<image.height;y++){
  for(let x=0;x<image.width;x++){
   const dx=(x+x0-point.x)/rx,dy=(y+y0-point.y)/ry;
   const distanceSquared=dx*dx+dy*dy;
   if(distanceSquared>=1)continue;
   const index=(y*image.width+x)*4;
   const gap=background(dx,dy)-luminance(image.data,index);
   if(gap<1)continue;
   const lift=Math.min(Math.floor(gap),Math.round(gap*(1-distanceSquared)**2*strength*.42));
   if(!lift)continue;
   for(let channel=0;channel<3;channel++)image.data[index+channel]+=lift;
   changed=true;
  }
 }
 if(changed)side.ctx.putImageData(image,x0,y0);
}

function dab(s,p,delta,rx,ry){
 const strength=Number($('strength').value)/100;
 const x0=Math.max(0,Math.floor(p.x-rx-3)),y0=Math.max(0,Math.floor(p.y-ry-3));
 const x1=Math.min(s.canvas.width,Math.ceil(p.x+rx+3)),y1=Math.min(s.canvas.height,Math.ceil(p.y+ry+3));if(x1<=x0||y1<=y0)return;
 const img=s.ctx.getImageData(x0,y0,x1-x0,y1-y0),src=new Uint8ClampedArray(img.data),w=img.width,h=img.height;
 const sample=(x,y,c)=>src[(Math.max(0,Math.min(h-1,y))*w+Math.max(0,Math.min(w-1,x)))*4+c];
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  const distance=Math.hypot((x+x0-p.x)/rx,(y+y0-p.y)/ry);if(distance>=1)continue;
  const amount=Math.pow(1-distance*distance,2)*strength*.35,index=(y*w+x)*4;
  for(let c=0;c<3;c++){
   const value=src[index+c];let target;
   if(tool==='darken')target=value*.55;
   else if(tool==='smooth'){target=0;for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++)target+=sample(x+dx,y+dy,c);target/=25;}
   else target=sample(Math.round(x-delta.x),Math.round(y-delta.y),c);
   img.data[index+c]=value+(target-value)*amount;
  }
 }
 s.ctx.putImageData(img,x0,y0);
}
function synchronizedDab(point,delta){
 const radius=Number($('radius').value);
 const strength=Number($('strength').value)/100;
 // Reuse the undo snapshot so earlier dabs cannot raise the target within the same stroke.
 const reference=history.at(-1);
 sides.forEach((side,index)=>{
  const sx=side.canvas.width/canvas.width,sy=side.canvas.height/canvas.height;
  const position={x:point.x*sx,y:point.y*sy};
  if(tool==='lighten')dodgeDab(side,position,radius*sx,radius*sy,strength,reference[index]);
  else dab(side,position,{x:delta.x*sx,y:delta.y*sy},radius*sx,radius*sy);
 });
}
canvas.addEventListener('pointerdown',e=>{
 if(e.button!==0||drawing||view.drag)return;
 if(view.mode==='pan'){
  if(view.zoom>1){e.preventDefault();beginPan(e);}
  return;
 }
 if(comparing||loading||exporting)return;
 e.preventDefault();
 const p=cursor(e);
 remember();drawing=true;activePointer=e.pointerId;previous=p;
 canvas.setPointerCapture(e.pointerId);
 synchronizedDab(p,{x:0,y:0});edited=true;refresh();
});
canvas.addEventListener('pointermove',e=>{
 if(view.drag){movePan(e);return;}
 if(drawing&&e.pointerId!==activePointer)return;
 const p=cursor(e);
 if(!drawing)return;
 const dx=p.x-previous.x,dy=p.y-previous.y,distance=Math.hypot(dx,dy);
 const steps=Math.max(1,Math.ceil(distance/Math.max(1,Number($('radius').value)/4)));
 for(let n=1;n<=steps;n++){
  synchronizedDab({x:previous.x+dx*n/steps,y:previous.y+dy*n/steps},{x:dx/steps,y:dy/steps});
 }
 previous=p;
});
function endStroke(e){
 if(view.drag?.id===e.pointerId){view.drag=null;delete leftViewport.dataset.dragging;}
 if(drawing&&e.pointerId===activePointer){
  drawing=false;previous=null;
  status('两图已同步应用'+names[tool]+'，可一键导出。');
  refresh();hideCursors();
 }
}
for(const type of ['pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(type,endStroke);canvas.addEventListener('pointerleave',hideCursors);
$('compare').onclick=()=>{if(drawing||loading||exporting)return;comparing=!comparing;if(comparing){beforeCompare=snapshot();restore(sides.map(s=>s.original));}else restore(beforeCompare);$('compare').setAttribute('aria-pressed',String(comparing));hideCursors();refresh();status(comparing?'正在查看两张原图，再次点击「原图对比」返回。':'已返回双图编辑结果。');};
$('reset').onclick=()=>{if(comparing||drawing||loading||exporting)return;if(!confirm('将两张图片都恢复为导入时的原图？此操作仍可撤销。'))return;remember();restore(sides.map(s=>s.original));status('两张图片均已恢复原图。');};
document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'&&!['INPUT','TEXTAREA'].includes(document.activeElement.tagName)){e.preventDefault();(e.shiftKey?$('redo'):$('undo')).click();}});
async function load(file,index){
 if(!file||loading||drawing||exporting||view.drag)return;if(!['image/png','image/jpeg','image/webp'].includes(file.type)){status('请选择 PNG、JPG 或 WebP 图片。');return;}if(file.size>30*1024*1024){status('图片超过 30 MB，请压缩后重新导入。');return;}
 if(edited&&!confirm('替换此图会清空两图撤销记录，另一张图保留当前编辑结果。是否继续？'))return;
 loading=true;refresh();const url=URL.createObjectURL(file);try{
 const image=new Image();image.src=url;await image.decode();
 const automatic=CropTemplates.autoView(image);
 replaceImage(index,image,file.name,automatic?.view??null);
 $('demoBadge').textContent='双图联动';
 $(index?'imageLabelRight':'imageLabel').textContent='';
 const side=index?'右图':'左图';
 if(automatic){
  status(side+(automatic.found?'已按条带位置套用截图模板。':'未找到明显条带，已按模板保存的位置裁切。')+'可打开裁切界面微调。');
 }else{
  const resized=Math.max(image.naturalWidth,image.naturalHeight)>2400;
  status(side+'已导入。'+(resized?'编辑预览长边已缩放至 2400 px，截图可从原图取景。':''));
 }
 }catch{status('图片读取失败，请尝试其他图片。');}finally{URL.revokeObjectURL(url);loading=false;refresh();}
}

function replaceImage(index,source,label,crop,cropSource=source){
 const image=crop?CropTemplates.render(cropSource,crop):source;
 const width=image.naturalWidth||image.width, height=image.naturalHeight||image.height;
 const scale=Math.min(1,2400/Math.max(width,height));
 if(comparing){restore(beforeCompare);comparing=false;}
 const side=sides[index];
 side.canvas.width=Math.max(1,Math.round(width*scale));
 side.canvas.height=Math.max(1,Math.round(height*scale));
 side.ctx.fillStyle='#fff';
 side.ctx.fillRect(0,0,side.canvas.width,side.canvas.height);
 side.ctx.drawImage(image,0,0,side.canvas.width,side.canvas.height);
 side.original=side.ctx.getImageData(0,0,side.canvas.width,side.canvas.height);
 side.source=source;
 side.cropSource=crop?cropSource:null;
 side.label=label;
 side.name=label.replace(/\.[^.]+$/,'');
 side.crop=crop;
 history=[];future=[];edited=false;beforeCompare=null;
 $('compare').setAttribute('aria-pressed','false');
 $(index?'rightInfo':'fileInfo').textContent=label+' · '+side.canvas.width+' × '+side.canvas.height+' px';
 refresh();
}

function cropInput(side,index){
 const current=comparing
  ? beforeCompare[index]
  : side.ctx.getImageData(0,0,side.canvas.width,side.canvas.height);
 const baseline=side.original.data;
 const changed=current.data.some((value,i)=>value!==baseline[i]);
 if(!changed){
  const source=side.cropSource||side.source;
  return {source,view:side.crop,processed:source!==side.source};
 }
 // Take a stable copy of the edited pixels, including during original comparison.
 const source=document.createElement('canvas');
 source.width=current.width;
 source.height=current.height;
 source.getContext('2d').putImageData(current,0,0);
 return {source,view:null,processed:true};
}

function openCrop(index){
 if(drawing||loading||exporting||view.drag)return;
 const side=sides[index];
 const label=side.label||side.name+'.png';
 const input=cropInput(side,index);
 CropTemplates.open({
  ...input,name:side.name,
  onApply(crop){
   if((history.length||future.length||(!crop&&input.processed))&&!confirm(
    crop?'应用裁切会清空双图撤销记录。是否继续？':'恢复完整图会清除这张图的处理结果。是否继续？'
   ))return false;
   replaceImage(index,side.source,label,crop,input.source);
   zoomTo(1);
   status((index?'右图':'左图')+(crop?'已应用裁切。':'已恢复完整图。'));
   return true;
  }
 });
}

$('cropLeft').onclick=()=>openCrop(0);
$('cropRight').onclick=()=>openCrop(1);
$('measureWB').onclick=()=>{
 if(drawing||loading||exporting||view.drag)return;
 const left=sides[0];
 WBMeasure.open(left.source,left.label||left.name);
};
$('importTop').textContent='＋ 导入左图';$('importTop').onclick=$('importLeft').onclick=()=>$('file').click();$('importRight').onclick=()=>$('fileRight').click();
['file','fileRight'].forEach((id,index)=>{$(id).onchange=e=>{load(e.target.files[0],index);e.target.value='';};});
['dropzone','dropzoneRight'].forEach((id,index)=>{let depth=0;const zone=$(id);zone.addEventListener('dragenter',e=>{e.preventDefault();depth++;zone.classList.add('dragover');});zone.addEventListener('dragover',e=>e.preventDefault());zone.addEventListener('dragleave',()=>{if(--depth<=0)zone.classList.remove('dragover');});zone.addEventListener('drop',e=>{e.preventDefault();depth=0;zone.classList.remove('dragover');load(e.dataTransfer.files[0],index);});});
window.addEventListener('dragover',e=>e.preventDefault());window.addEventListener('drop',e=>e.preventDefault());
function exportSettings(){
 const size=$('exportSize').value;
 return {
  format:$('exportFormat').value,
  longEdge:size==='current'?null:Number(size==='custom'?$('exportCustom').value:size),
  quality:Number($('exportQuality').value)
 };
}

function updateExport(){
 const settings=exportSettings();
 const custom=$('exportSize').value==='custom';
 const valid=!custom||($('exportCustom').value!==''&&$('exportCustom').validity.valid);
 $('exportCustomField').hidden=!custom;
 $('exportQualityField').hidden=settings.format!=='jpg';
 $('export').disabled=!valid||drawing||comparing||loading||exporting;
 $('export').textContent=exporting?'正在打包…':'一键导出两张图（ZIP）';
 if(!valid){
  $('exportDimensions').textContent='请输入 1–4096 之间的整数。';
  return;
 }
 const sizes=sides.map(side=>ImageExport.dimensions(side.canvas,settings.longEdge));
 $('exportDimensions').textContent=sizes.map(({width,height},i)=>(i?'右图 ':'左图 ')+width+' × '+height+' px').join(' · ');
}

async function exportPair(){
 if($('export').disabled)return;
 const settings=exportSettings();
 exporting=true;refresh();status('正在生成两张 300 DPI 图片…');
 try{
  const files=[];
  for(const [i,side] of sides.entries()){
   const safeName=side.name.replace(/[<>:"/\\|?*]/g,'_').slice(0,100)||'image';
   const name=(i?'right-':'left-')+safeName+'.'+settings.format;
   files.push({name,blob:await ImageExport.encode(side.canvas,settings)});
  }
  ImageExport.download(await ImageExport.zip(files),'band-studio-300dpi.zip');
  status('两张 300 DPI 图片已打包下载。');
 }catch(error){
  console.error(error);
  status('导出失败，请降低像素尺寸后重试。');
 }finally{
  exporting=false;refresh();
 }
}

for(const id of ['exportFormat','exportSize','exportCustom'])$(id).addEventListener('input',updateExport);
$('export').onclick=exportPair;
sides.forEach(demo);renderView();refresh();
