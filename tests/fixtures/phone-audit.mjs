// 手机可读性审计：测量文字、44×44 触控区（故事设置流程链接为 44×26）、对比度与布局。
// 只读取计算样式与命中测试，不修改页面状态；测量时滚动过的容器会恢复原位。
// 画面上的文字按固定表格与其画面、遮罩配对，因为阅读画面和遮罩都不参与命中测试。

export const minimumText=12,targetSize=44,minimumContrast=4.5;

// 在浏览器中执行；必须自包含，不能引用模块作用域。
function auditInPage({minimumText,targetSize,checks}){
 const results={text:[],targets:[],contrast:[],layout:{overflow:[],clipped:[],overlaps:[],truncated:[]}};
 const viewport={width:document.documentElement.clientWidth,height:window.innerHeight};
 const path=el=>{const parts=[];for(let node=el;node&&node.nodeType===1&&parts.length<4;node=node.parentElement){const classes=[...node.classList].filter(name=>!/^(?:active|on|read|is-current|large|spin)$/.test(name)).slice(0,2);parts.unshift(node.tagName.toLowerCase()+classes.map(name=>'.'+name).join(''));if(node.tagName==='DIALOG')break;}return parts.join('>');};
 const label=el=>(el.getAttribute('aria-label')||el.textContent||el.getAttribute('title')||'').replace(/\s+/g,' ').trim().slice(0,40);
 const visible=el=>{if(!el.checkVisibility({checkOpacity:true,checkVisibilityCSS:true}))return false;const rect=el.getBoundingClientRect();if(rect.width<=1||rect.height<=1)return false;const style=getComputedStyle(el);return !(style.clip&&style.clip!=='auto'&&rect.width<=2);};
 // 当前最上层：中心命中所在的模态对话框；没有对话框时为整个文档。
 const modals=[...document.querySelectorAll('dialog[open]')].filter(dialog=>dialog.matches(':modal'));
 let root=document.body;
 for(const dialog of modals){const rect=dialog.getBoundingClientRect(),hit=document.elementFromPoint(rect.left+rect.width/2,rect.top+Math.min(rect.height/2,viewport.height/2));if(hit&&dialog.contains(hit))root=dialog;}
 const usable=el=>root.contains(el)&&!el.closest('[inert],[aria-hidden="true"]')&&visible(el);
 // 记录滚动位置，测量结束后恢复，避免改变被测状态。
 const scrollers=[document.scrollingElement,...root.querySelectorAll('*')].filter(el=>el.scrollHeight>el.clientHeight||el.scrollWidth>el.clientWidth).map(el=>[el,el.scrollTop,el.scrollLeft]);

 if(checks.includes('text')){
  const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT),seen=new Set();
  for(let node=walker.nextNode();node;node=walker.nextNode()){
   const el=node.parentElement;if(!node.textContent.trim()||!el||seen.has(el)||el.closest('.yu-book-cover,.yu-stamp,svg,style,script'))continue;seen.add(el);
   if(!usable(el))continue;const range=document.createRange();range.selectNodeContents(node);if(!range.getClientRects().length)continue;
   const size=parseFloat(getComputedStyle(el).fontSize);if(size<minimumText)results.text.push({path:path(el),size,text:node.textContent.trim().slice(0,30)});
  }
  for(const el of root.querySelectorAll('input:not([type=hidden]):not([type=checkbox]):not([type=radio]),select,textarea')){if(!usable(el))continue;const size=parseFloat(getComputedStyle(el).fontSize);if(size<minimumText)results.text.push({path:path(el),size,text:el.value?.slice(0,30)||el.placeholder||''});}
 }

 const interactive='a[href],button,summary,input:not([type=hidden]),select,textarea,[role=button],[role=tab],[role=switch],[role=radio],[tabindex]:not([tabindex="-1"])';
 const controls=[...new Set([...root.querySelectorAll(interactive)].map(el=>el.closest('label')&&el.matches('input')?el.closest('label'):el))].filter(usable);
 if(checks.includes('targets')){
  const offsets=[-21,-10.5,0,10.5,21];
  const cornerCut=(el,rect,x,y)=>{
   if(x<rect.left||x>rect.right||y<rect.top||y>rect.bottom)return false;
   const style=getComputedStyle(el),radius=(value,size)=>value.endsWith('%')?parseFloat(value)/100*size:parseFloat(value)||0;
   for(const [prop,cx,cy,sx,sy] of [['borderTopLeftRadius',rect.left,rect.top,1,1],['borderTopRightRadius',rect.right,rect.top,-1,1],['borderBottomLeftRadius',rect.left,rect.bottom,1,-1],['borderBottomRightRadius',rect.right,rect.bottom,-1,-1]]){
    const [h,v=h]=style[prop].split(' '),rx=Math.min(radius(h,rect.width),rect.width/2),ry=Math.min(radius(v,rect.height),rect.height/2);if(!rx||!ry)continue;
    const ox=cx+sx*rx,oy=cy+sy*ry;
    // 留 1px 容差：圆角边缘的抗锯齿像素可能不算命中。
    if((x-ox)*sx<0&&(y-oy)*sy<0&&((x-ox)/Math.max(rx-1,0.5))**2+((y-oy)/Math.max(ry-1,0.5))**2>1)return true;
   }
   return false;
  };
  for(const el of controls){
   if(el.matches('select,textarea'))continue;
   if(el.matches('summary')&&el.getBoundingClientRect().width>=0.9*(el.parentElement?.getBoundingClientRect().width||0))continue;
   if(el.matches('a')&&[...el.parentElement.childNodes].some(node=>node!==el&&node.nodeType===3&&node.textContent.trim()))continue;
   el.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});
   const rect=el.getBoundingClientRect(),x=rect.left+rect.width/2,y=rect.top+rect.height/2,misses=[];
   // 故事设置流程按紧凑行高采样；横向和其他控件仍完整检查 44px。
   const verticalOffsets=el.matches('.yu-settings-flow .production-timeline:not(.production-timeline--horizontal) .story-flow-link')?[-12,-6,0,6,12]:offsets;
   for(const dy of verticalOffsets)for(const dx of offsets){
    const px=x+dx,py=y+dy;if(px<0||py<0||px>=viewport.width||py>=viewport.height)continue;
    const hit=document.elementFromPoint(px,py);if(hit&&(hit===el||el.contains(hit)))continue;
    // Chromium 命中测试排除圆角之外的角落；只豁免控件自身盒内被圆角裁掉的点。
    if(cornerCut(el,rect,px,py))continue;
    misses.push({dx,dy,hit:hit?path(hit):null});
   }
   if(misses.length)results.targets.push({path:path(el),label:label(el),size:[Math.round(rect.width),Math.round(rect.height)],misses:misses.length,first:misses[0]});
  }
  for(const [el,top,left] of scrollers){el.scrollTop=top;el.scrollLeft=left;}
 }

 if(checks.includes('layout')){
  if(document.scrollingElement.scrollWidth>document.scrollingElement.clientWidth+1)results.layout.overflow.push({path:'document',scrollWidth:document.scrollingElement.scrollWidth,clientWidth:document.scrollingElement.clientWidth});
  if(root!==document.body&&root.scrollWidth>root.clientWidth+1)results.layout.overflow.push({path:path(root),scrollWidth:root.scrollWidth,clientWidth:root.clientWidth});
  const xScroller=el=>{for(let node=el.parentElement;node&&node!==document.body;node=node.parentElement){if(/auto|scroll/.test(getComputedStyle(node).overflowX))return node;}return null;};
  const clipper=el=>{for(let node=el.parentElement;node&&node!==document.body;node=node.parentElement){const style=getComputedStyle(node);if(style.overflowX!=='visible'||style.overflowY!=='visible')return node;}return null;};
  for(const el of controls){
   if(xScroller(el))continue;
   const rect=el.getBoundingClientRect(),box=clipper(el)?.getBoundingClientRect()||{left:0,right:viewport.width};
   if(rect.left<Math.max(0,box.left)-1||rect.right>Math.min(viewport.width,box.right)+1)results.layout.clipped.push({path:path(el),label:label(el),left:Math.round(rect.left),right:Math.round(rect.right)});
  }
  const fixed=el=>{for(let node=el;node&&node!==document.body;node=node.parentElement)if(getComputedStyle(node).position==='fixed')return node;return null;};
  // 控件的触控盒：自身边框盒并上绝对定位的 ::after 扩展区。
  // 绝对定位的偏移从内边距盒量起，需先减去边框。
  const hitBox=el=>{const rect=el.getBoundingClientRect(),after=getComputedStyle(el,'::after');if(after.content==='none'||after.position!=='absolute')return rect;const px=v=>parseFloat(v)||0,own=getComputedStyle(el);
   const box={left:rect.left+px(own.borderLeftWidth)+px(after.left),right:rect.right-px(own.borderRightWidth)-px(after.right),top:rect.top+px(own.borderTopWidth)+px(after.top),bottom:rect.bottom-px(own.borderBottomWidth)-px(after.bottom)};
   const left=Math.min(rect.left,box.left),right=Math.max(rect.right,box.right),top=Math.min(rect.top,box.top),bottom=Math.max(rect.bottom,box.bottom);return {left,right,top,bottom,width:right-left,height:bottom-top};};
  const rects=controls.filter(el=>!xScroller(el)).map(el=>[el,hitBox(el)]);
  for(let i=0;i<rects.length;i++)for(let j=i+1;j<rects.length;j++){
   const [a,ra]=rects[i],[b,rb]=rects[j];if(a.contains(b)||b.contains(a))continue;
   // 固定层（如底部标签栏）下方滚过的内容不算重叠。
   if(fixed(a)!==fixed(b))continue;
   // 小控件叠放在大得多的控件之上（阅读按钮与翻页面、封面上的操作）：由上层控件的触控采样验证。
   const [small,big,rs,rb2]=ra.width*ra.height<=rb.width*rb.height?[a,b,ra,rb]:[b,a,rb,ra];
   if(rb2.width*rb2.height>=4*rs.width*rs.height){small.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});const now=small.getBoundingClientRect(),hit=document.elementFromPoint(now.left+now.width/2,now.top+now.height/2);if(hit&&small.contains(hit))continue;}
   const w=Math.min(ra.right,rb.right)-Math.max(ra.left,rb.left),h=Math.min(ra.bottom,rb.bottom)-Math.max(ra.top,rb.top);
   if(w>1&&h>1)results.layout.overlaps.push({a:path(a),b:path(b),area:Math.round(w*h)});
  }
  for(const [el,top,left] of scrollers){el.scrollTop=top;el.scrollLeft=left;}
  for(const el of root.querySelectorAll('*')){
   if(!usable(el))continue;const style=getComputedStyle(el);
   const ellipsis=style.textOverflow==='ellipsis'&&el.scrollWidth>el.clientWidth+1,clamped=style.webkitLineClamp!=='none'&&el.scrollHeight>el.clientHeight+1;
   if(ellipsis||clamped)results.layout.truncated.push({path:path(el),text:el.textContent.trim().slice(0,30)});
  }
 }

 if(checks.includes('contrast')){
  const parse=value=>{const m=value.match(/rgba?\(([^)]+)\)/);if(!m)return null;const [r,g,b,a=1]=m[1].split(/[ ,/]+/).filter(Boolean).map(Number);return {r,g,b,a};};
  const over=(top,bottom)=>({r:top.r*top.a+bottom.r*(1-top.a),g:top.g*top.a+bottom.g*(1-top.a),b:top.b*top.a+bottom.b*(1-top.a),a:1});
  const luminance=c=>{const f=v=>{v/=255;return v<=0.03928?v/12.92:((v+0.055)/1.055)**2.4;};return 0.2126*f(c.r)+0.7152*f(c.g)+0.0722*f(c.b);};
  const ratio=(fg,bg)=>{const a=luminance(fg),b=luminance(bg);return (Math.max(a,b)+0.05)/(Math.min(a,b)+0.05);};
  const hex=c=>'#'+[c.r,c.g,c.b].map(v=>Math.round(v).toString(16).padStart(2,'0')).join('');
  // 祖先背景色自下而上合成；第一个不透明背景之下的内容不可见。
  const plainBackdrop=el=>{const layers=[];for(let node=el;node;node=node.parentElement){const color=parse(getComputedStyle(node).backgroundColor);if(color&&color.a>0){layers.push(color);if(color.a>=1)break;}}let base={r:255,g:255,b:255,a:1};for(const layer of layers.reverse())base=over(layer,base);return base;};
  // 线性渐变在文字纵向范围内的最低不透明度；非纵向渐变取所有色标最低值。
  const scrimAt=(image,box,top,bottom)=>{
   const body=image.match(/linear-gradient\((.*)\)$/)?.[1];if(!body)return null;
   const direction=body.match(/^\s*(to \w+|[\d.]+deg)\s*,/)?.[1],up=direction==='to top'||direction==='0deg',vertical=up||!direction||direction==='to bottom'||direction==='180deg';
   // 色标位置：px、% 或 calc(100% ± Npx)；向上的渐变从盒子底部量起。
   const offset=value=>{if(value===undefined)return null;const calc=value.match(/calc\(\s*([\d.]+)%\s*([+-])\s*([\d.]+)px\s*\)/);if(calc)return Number(calc[1])/100*box.height+(calc[2]==='-'?-1:1)*Number(calc[3]);return value.endsWith('%')?parseFloat(value)/100*box.height:parseFloat(value);};
   const stops=[...body.matchAll(/(rgba?\([^)]+\))\s*(calc\([^)]*\)|[-\d.]+(?:px|%))?/g)].map(m=>({color:parse(m[1]),at:offset(m[2])}));
   stops.forEach((stop,i)=>{if(stop.at===null)stop.at=(stops.length===1?0:i/(stops.length-1))*box.height;if(i>0)stop.at=Math.max(stop.at,stops[i-1].at);});
   // 浏览器把小于前一个的色标位置钳制到前一个位置；先在渐变方向上钳制，再换算成纵坐标。
   stops.forEach(stop=>{stop.at=up?box.top+box.height-stop.at:box.top+stop.at;});
   if(up)stops.reverse();
   if(!vertical)return stops.reduce((low,stop)=>stop.color.a<low.a?stop.color:low,stops[0].color);
   const sample=y=>{if(y<=stops[0].at)return stops[0].color;for(let i=1;i<stops.length;i++)if(y<=stops[i].at){const a=stops[i-1],b=stops[i],t=(y-a.at)/((b.at-a.at)||1);return {r:a.color.r+(b.color.r-a.color.r)*t,g:a.color.g+(b.color.g-a.color.g)*t,b:a.color.b+(b.color.b-a.color.b)*t,a:a.color.a+(b.color.a-a.color.a)*t};}return stops.at(-1).color;};
   const points=[top,bottom,...stops.map(stop=>stop.at).filter(y=>y>top&&y<bottom)];
   return points.map(sample).reduce((low,color)=>color.a<low.a?color:low);
  };
  const pseudoBox=(el,pseudo)=>{const rect=el.getBoundingClientRect(),style=getComputedStyle(el,pseudo),px=v=>parseFloat(v)||0;return {top:rect.top+px(style.top),height:rect.height-px(style.top)-px(style.bottom),image:style.backgroundImage,content:style.content};};
  const textOf=el=>[...el.childNodes].some(node=>node.nodeType===3&&node.textContent.trim());
  const measured=new Set();
  // 元素及祖先的 opacity 会让文字更淡，计入前景透明度。
  const opacity=el=>{let value=1;for(let node=el;node&&node!==document.body;node=node.parentElement)value*=Number(getComputedStyle(node).opacity);return value;};
  const record=(el,set,backdrop,note)=>{const color=parse(getComputedStyle(el).color),fg={...color,a:color.a*opacity(el)},composited=over(fg,backdrop),value=ratio(composited,backdrop);results.contrast.push({set,path:path(el),text:el.textContent.trim().slice(0,24),color:hex(fg),background:hex(backdrop),ratio:Math.round(value*100)/100,note});};
  // 画面上的文字：固定表格，与当前画面和遮罩配对。
  const artwork=[
   {set:'reader-header',text:'.yu-reader-title strong,.yu-reader-title>div:first-child>span,.yu-reader-title>.yu-style-label>span',art:()=>document.querySelector('.yu-scene.is-current'),scrim:el=>{const top=el.closest('.yu-reader-top');return top&&pseudoBox(top,'::before');}},
   {set:'reader-caption',text:'.yu-scene-caption>p,.yu-scene-number>span',art:()=>document.querySelector('.yu-scene.is-current'),scrim:el=>{const caption=el.closest('.yu-scene-caption');return caption&&pseudoBox(caption,'::before');}},
   {set:'hero',text:'.yu-feature-tag,.yu-feature-copy>small,.yu-feature-copy>strong,.yu-feature-bottom>span',art:el=>el.closest('.yu-feature')?.querySelector('img'),scrim:el=>{const wash=el.closest('.yu-feature')?.querySelector('.yu-feature-wash');if(!wash)return null;const rect=wash.getBoundingClientRect();return {top:rect.top,height:rect.height,image:getComputedStyle(wash).backgroundImage,content:'normal'};}},
   {set:'shelf-badge',text:'.yu-shelf-book-badge',art:el=>el.closest('.yu-shelf-cover-wrap')?.querySelector('.yu-shelf-cover img'),scrim:()=>null},
  ];
  for(const entry of artwork)for(const el of root.querySelectorAll(entry.text)){
   if(!usable(el)||!textOf(el))continue;measured.add(el);
   const rect=el.getBoundingClientRect(),art=entry.art(el),artRect=art&&visible(art)?art.getBoundingClientRect():null;
   const intersects=artRect&&rect.left<artRect.right&&rect.right>artRect.left&&rect.top<artRect.bottom&&rect.bottom>artRect.top;
   const scrim=entry.scrim(el),own=parse(getComputedStyle(el).backgroundColor);
   let backdrop=intersects?{r:255,g:255,b:255,a:1}:plainBackdrop(el.parentElement);
   const scrimColor=scrim&&scrim.image!=='none'?scrimAt(scrim.image,scrim,rect.top,rect.bottom):null;
   if(scrimColor)backdrop=over(scrimColor,backdrop);
   if(own&&own.a>0)backdrop=over(own,backdrop);
   if(intersects&&!scrimColor&&!(own&&own.a>0)){results.contrast.push({set:entry.set,path:path(el),text:el.textContent.trim().slice(0,24),note:'no backing'});continue;}
   record(el,entry.set,backdrop,intersects?'over artwork':'no artwork');
  }
  // 放大后的文字：匹配使用 --yu-meta-size 的规则，以及继承该字号的子元素。
  const rules=[];const collect=list=>{for(const rule of list){if(rule instanceof CSSMediaRule){if(matchMedia(rule.conditionText).matches)collect(rule.cssRules);}else if(rule.cssRules&&!(rule instanceof CSSStyleRule))collect(rule.cssRules);else if(rule instanceof CSSStyleRule&&rule.style.cssText.includes('var(--yu-meta-size)'))rules.push(rule.selectorText);}};
  for(const sheet of document.styleSheets){try{collect(sheet.cssRules);}catch{}}
  const raised=new Set();
  for(const selector of rules){let found=[];try{found=[...root.querySelectorAll(selector)];}catch{}for(const el of found){raised.add(el);const size=getComputedStyle(el).fontSize;for(const child of el.querySelectorAll('*'))if(getComputedStyle(child).fontSize===size)raised.add(child);}}
  for(const el of raised){if(measured.has(el)||!usable(el)||!textOf(el)||parseFloat(getComputedStyle(el).fontSize)!==minimumText)continue;record(el,'raised',plainBackdrop(el),'plain');}
 }
 return results;
}

export async function auditPhone(page,{checks=['text','targets','contrast','layout']}={}){
 return page.evaluate(auditInPage,{minimumText,targetSize,checks});
}

// 汇总失败项：截断文本只允许出现在基线允许列表中。
export function failures(result,{truncationAllowlist=[]}={}){
 return {
  text:result.text,
  targets:result.targets,
  contrast:result.contrast.filter(entry=>entry.note==='no backing'||entry.ratio<minimumContrast),
  overflow:result.layout.overflow,
  clipped:result.layout.clipped,
  overlaps:result.layout.overlaps,
  truncated:result.layout.truncated.filter(entry=>!truncationAllowlist.some(pattern=>entry.path.includes(pattern))),
 };
}
