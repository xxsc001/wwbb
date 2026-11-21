'use strict';
const $=id=>document.getElementById(id);
const canvas=$('canvas'),ctx=canvas.getContext('2d',{willReadFrequently:true});
const right=$('canvasRight'),rctx=right.getContext('2d',{willReadFrequently:true});
const sides=[{canvas,ctx,name:'模拟条带-左图',original:null},{canvas:right,ctx:rctx,name:'模拟条带-右图',original:null}];
const names={smudge:'揉边',smooth:'平滑',darken:'加深',lighten:'减淡'};
const descriptions={smudge:'沿笔触柔和推移边缘',smooth:'柔化局部纹理与边缘',darken:'逐步加深笔触覆盖区域',lighten:'逐步提亮笔触覆盖区域'};
let tool='smudge',history=[],future=[],drawing=false,previous=null,comparing=false,edited=false,loading=false,beforeCompare,activePointer;
const snapshot=()=>sides.map(s=>s.ctx.getImageData(0,0,s.canvas.width,s.canvas.height));
const restore=pair=>pair.forEach((image,i)=>sides[i].ctx.putImageData(image,0,0));
function status(message){$('status').textContent=message;}
function refresh(){ $('undo').disabled=!history.length||comparing||loading; $('redo').disabled=!future.length||comparing||loading; }
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
}
function hideCursors(){$('cursor').hidden=true;$('cursorRight').hidden=true;}
function historyAction(redo){if(comparing||drawing||loading)return;const from=redo?future:history,to=redo?history:future;if(!from.length)return;to.push(snapshot());restore(from.pop());refresh();status(redo?'两图已同步重做。':'两图已同步撤销。');}
$('undo').onclick=()=>historyAction(false);$('redo').onclick=()=>historyAction(true);
document.querySelectorAll('.tool').forEach(button=>button.addEventListener('click',()=>{tool=button.dataset.tool;document.querySelectorAll('.tool').forEach(b=>{b.classList.toggle('active',b===button);b.setAttribute('aria-pressed',String(b===button));});$('toolDescription').textContent=descriptions[tool];$('modeInfo').textContent=names[tool]+'笔刷 · 双图同步';}));
for(const id of ['radius','strength'])$(id).addEventListener('input',()=>{$(id+'Value').innerHTML=$(id).value+' <small>'+(id==='radius'?'px':'%')+'</small>';});
function position(e){const rect=canvas.getBoundingClientRect();return{x:(e.clientX-rect.left)/rect.width*canvas.width,y:(e.clientY-rect.top)/rect.height*canvas.height};}
function cursor(e){const p=position(e);sides.forEach((s,i)=>{const rect=s.canvas.getBoundingClientRect(),node=$(i?'cursorRight':'cursor');node.hidden=comparing||loading;node.style.left=p.x/canvas.width*rect.width+'px';node.style.top=p.y/canvas.height*rect.height+'px';node.style.width=2*Number($('radius').value)/canvas.width*rect.width+'px';node.style.height=2*Number($('radius').value)/canvas.height*rect.height+'px';});return p;}
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
   else if(tool==='lighten')target=value+(255-value)*.45;
   else if(tool==='smooth'){target=0;for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++)target+=sample(x+dx,y+dy,c);target/=25;}
   else target=sample(Math.round(x-delta.x),Math.round(y-delta.y),c);
   img.data[index+c]=value+(target-value)*amount;
  }
 }
 s.ctx.putImageData(img,x0,y0);
}
function synchronizedDab(p,delta){const radius=Number($('radius').value);sides.forEach(s=>{const sx=s.canvas.width/canvas.width,sy=s.canvas.height/canvas.height;dab(s,{x:p.x*sx,y:p.y*sy},{x:delta.x*sx,y:delta.y*sy},radius*sx,radius*sy);});}
canvas.addEventListener('pointerdown',e=>{if(comparing||loading||e.button!==0||drawing)return;e.preventDefault();const p=cursor(e);remember();drawing=true;activePointer=e.pointerId;previous=p;canvas.setPointerCapture(e.pointerId);synchronizedDab(p,{x:0,y:0});edited=true;});
canvas.addEventListener('pointermove',e=>{if(drawing&&e.pointerId!==activePointer)return;const p=cursor(e);if(!drawing)return;const dx=p.x-previous.x,dy=p.y-previous.y,distance=Math.hypot(dx,dy),steps=Math.max(1,Math.ceil(distance/Math.max(1,Number($('radius').value)/4)));for(let n=1;n<=steps;n++)synchronizedDab({x:previous.x+dx*n/steps,y:previous.y+dy*n/steps},{x:dx/steps,y:dy/steps});previous=p;});
function endStroke(e){if(drawing&&e.pointerId===activePointer){drawing=false;previous=null;status('两图已同步应用'+names[tool]+'，可分别导出结果。');refresh();hideCursors();}}
for(const type of ['pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(type,endStroke);canvas.addEventListener('pointerleave',hideCursors);
$('compare').onclick=()=>{if(drawing||loading)return;comparing=!comparing;if(comparing){beforeCompare=snapshot();restore(sides.map(s=>s.original));}else restore(beforeCompare);$('compare').setAttribute('aria-pressed',String(comparing));for(const id of ['export','exportLeft','reset'])$(id).disabled=comparing;hideCursors();refresh();status(comparing?'正在查看两张原图，再次点击「原图对比」返回。':'已返回双图编辑结果。');};
$('reset').onclick=()=>{if(comparing||drawing||loading)return;if(!confirm('将两张图片都恢复为导入时的原图？此操作仍可撤销。'))return;remember();restore(sides.map(s=>s.original));status('两张图片均已恢复原图。');};
document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'&&!['INPUT','TEXTAREA'].includes(document.activeElement.tagName)){e.preventDefault();(e.shiftKey?$('redo'):$('undo')).click();}});
async function load(file,index){
 if(!file||loading||drawing)return;if(!['image/png','image/jpeg','image/webp'].includes(file.type)){status('请选择 PNG、JPG 或 WebP 图片。');return;}if(file.size>30*1024*1024){status('图片超过 30 MB，请压缩后重新导入。');return;}
 if(edited&&!confirm('替换此图会清空两图撤销记录，另一张图保留当前编辑结果。是否继续？'))return;
 loading=true;refresh();const url=URL.createObjectURL(file);try{
 const image=new Image();image.src=url;await image.decode();
 if(comparing){restore(beforeCompare);comparing=false;}
 const s=sides[index],scale=Math.min(1,2400/Math.max(image.width,image.height));s.canvas.width=Math.max(1,Math.round(image.width*scale));s.canvas.height=Math.max(1,Math.round(image.height*scale));s.ctx.fillStyle='#fff';s.ctx.fillRect(0,0,s.canvas.width,s.canvas.height);s.ctx.drawImage(image,0,0,s.canvas.width,s.canvas.height);s.original=s.ctx.getImageData(0,0,s.canvas.width,s.canvas.height);s.name=file.name.replace(/\.[^.]+$/,'');
 history=[];future=[];edited=false;beforeCompare=null;$('compare').setAttribute('aria-pressed','false');for(const id of ['export','exportLeft','reset'])$(id).disabled=false;$('demoBadge').textContent='双图联动';$(index?'imageLabelRight':'imageLabel').textContent='';$(index?'rightInfo':'fileInfo').textContent=file.name+' · '+s.canvas.width+' × '+s.canvas.height+' px';status((index?'右图':'左图')+'已导入。'+(scale<1?'长边已缩放至 2400 px。':'')+'请在左图操作，同步处理右图。');
 }catch{status('图片读取失败，请尝试其他图片。');}finally{URL.revokeObjectURL(url);loading=false;refresh();}
}
$('importTop').textContent='＋ 导入左图';$('importTop').onclick=$('importLeft').onclick=()=>$('file').click();$('importRight').onclick=()=>$('fileRight').click();
['file','fileRight'].forEach((id,index)=>{$(id).onchange=e=>{load(e.target.files[0],index);e.target.value='';};});
['dropzone','dropzoneRight'].forEach((id,index)=>{let depth=0;const zone=$(id);zone.addEventListener('dragenter',e=>{e.preventDefault();depth++;zone.classList.add('dragover');});zone.addEventListener('dragover',e=>e.preventDefault());zone.addEventListener('dragleave',()=>{if(--depth<=0)zone.classList.remove('dragover');});zone.addEventListener('drop',e=>{e.preventDefault();depth=0;zone.classList.remove('dragover');load(e.dataTransfer.files[0],index);});});
window.addEventListener('dragover',e=>e.preventDefault());window.addEventListener('drop',e=>e.preventDefault());
function exportImage(index){if(drawing||comparing||loading)return;const s=sides[index];s.canvas.toBlob(blob=>{if(!blob){status('导出失败，请重试。');return;}const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=s.name+'-edited.png';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);status((index?'右图':'左图')+' PNG 已导出。');},'image/png');}
$('export').onclick=()=>exportImage(1);$('exportLeft').onclick=()=>exportImage(0);
sides.forEach(demo);refresh();
