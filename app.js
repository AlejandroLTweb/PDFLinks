/* PDFLink browser interface. Documents and signatures live only in memory. */
document.addEventListener('DOMContentLoaded',async()=>{
  'use strict';
  const $=id=>document.getElementById(id),G=window.PDFLinkGeometry,P=window.PDFLib;
  let project=new window.PDFLinkPDF.PDFProject(),pdfjs=null;
  const proxies=new Map();
  let current=0,selectedId=null,scale=1,fitMode=true,busy=false,replaceNext=false;
  let draggedPage=null;
  let renderTask=null,renderEpoch=0,thumbEpoch=0,toastTimer=null,dragDepth=0;
  const buttons=['open-btn','merge-btn','welcome-open-btn','add-text-btn','add-image-btn','signature-btn','export-btn'];
  const hasPages=()=>project.pages.length>0;
  const page=()=>project.pages[current];
  const selected=()=>page()?.overlays.find(o=>o.id===selectedId);
  const size=bytes=>bytes<1048576?`${(bytes/1024).toFixed(1)} KB`:`${(bytes/1048576).toFixed(2)} MB`;
  const fontCSS=object=>({Helvetica:'Arial, Helvetica, sans-serif',Times:'"Times New Roman", Times, serif',Courier:'"Courier New", monospace'}[object.font||'Helvetica']);
  const nextFrame=()=>new Promise(resolve=>requestAnimationFrame(resolve));

  function toast(message,error=false,duration=6500){
    clearTimeout(toastTimer);$('toast').textContent=message;$('toast').classList.toggle('error',error);$('toast').hidden=false;
    toastTimer=setTimeout(()=>$('toast').hidden=true,duration);$('status-message').textContent=message;
  }
  function progress(value,message){$('busy-progress').value=value;$('busy-message').textContent=message;}
  async function working(title,callback){
    if(busy)return;
    busy=true;$('busy-title').textContent=title;progress(0,'Procesando…');$('busy-dialog').showModal();update();
    try{return await callback();}catch(error){toast(humanError(error),true,12000);return false;}
    finally{busy=false;$('busy-dialog').close();update();}
  }
  function humanError(error){
    const text=String(error?.message||error);
    if(/encrypted|password/i.test(text))return 'Este PDF está protegido. Utiliza una copia autorizada sin contraseña.';
    if(/Invalid PDF|No PDF header|Failed to parse|Invalid object/i.test(text))return 'El archivo no parece un PDF válido o está dañado.';
    return text;
  }
  function confirmAction(title,description,accept='Continuar'){
    return new Promise(resolve=>{
      const dialog=$('confirm-dialog');$('confirm-title').textContent=title;$('confirm-description').textContent=description;$('confirm-accept').textContent=accept;
      let done=false;
      const finish=value=>{if(done)return;done=true;dialog.close();dialog.removeEventListener('cancel',cancel);resolve(value);};
      const cancel=event=>{event.preventDefault();finish(false);};
      $('confirm-cancel').onclick=()=>finish(false);$('confirm-accept').onclick=()=>finish(true);
      dialog.addEventListener('cancel',cancel);dialog.showModal();
    });
  }
  function update(){
    const has=hasPages();
    $('welcome').hidden=has;$('document-stage').hidden=!has;
    for(const id of ['add-text-btn','add-image-btn','signature-btn','export-btn','delete-page-btn','page-number'])$(id).disabled=!has||busy;
    for(const id of ['open-btn','merge-btn','welcome-open-btn'])$(id).disabled=busy||!pdfjs;
    $('undo-btn').disabled=busy||!project.history.undoStack.length;
    $('redo-btn').disabled=busy||!project.history.redoStack.length;
    $('move-up-btn').disabled=busy||!has||current===0;
    $('move-down-btn').disabled=busy||!has||current===project.pages.length-1;
    $('page-total').textContent=project.pages.length;$('page-counter').textContent=`/ ${project.pages.length}`;
    $('page-number').max=Math.max(1,project.pages.length);$('page-number').value=current+1;
    $('document-name').textContent=`${project.title}.pdf`;
    $('document-status').textContent=project.history.dirty?'Cambios sin exportar':'Listo';
    document.title=has?`${project.history.dirty?'* ':''}${project.title} · PDFLink`:'PDFLink · Editor PDF';
    $('zoom-label').textContent=`${Math.round(scale*100)} %`;
  }
  async function resetProject(){
    renderEpoch++;thumbEpoch++;renderTask?.cancel();
    for(const proxy of proxies.values())await proxy.destroy();proxies.clear();
    project=new window.PDFLinkPDF.PDFProject();current=0;selectedId=null;fitMode=true;
  }
  async function ingest(bytes,name){
    const loadingTask=pdfjs.getDocument({data:bytes.slice(),isEvalSupported:false,enableXfa:false,
      useSystemFonts:true,useWorkerFetch:false,isOffscreenCanvasSupported:false,disableWorkerRendering:true,stopAtErrors:true,
      enableHWA:false,enableWebGPU:false,useWasm:false,
      standardFontDataUrl:new URL('standard_fonts/',document.baseURI).href,
      cMapUrl:new URL('cmaps/',document.baseURI).href,cMapPacked:true,
      wasmUrl:new URL('wasm/',document.baseURI).href,verbosity:0});
    let retained=false;
    try{
      const proxy=await loadingTask.promise;
      const permissions=await proxy.getPermissions();
      if(permissions && !permissions.includes(pdfjs.PermissionFlag.MODIFY_CONTENTS))
        throw new Error('Este PDF restringe la edición. Utiliza una copia autorizada sin restricciones.');
      const descriptors=[];
      for(let n=1;n<=proxy.numPages;n++){
        const pdfPage=await proxy.getPage(n),viewport=pdfPage.getViewport({scale:1});
        descriptors.push({width:viewport.width,height:viewport.height,transform:viewport.transform});
      }
      const id=await project.addSource(bytes,name,descriptors);
      proxies.set(id,{getPage:n=>proxy.getPage(n),destroy:()=>loadingTask.destroy()});retained=true;
    }finally{if(!retained)await loadingTask.destroy();}
  }
  async function openFiles(files,replace=false){
    if(busy||!pdfjs)return;
    const pdfs=[...files].filter(file=>/\.pdf$/i.test(file.name)||file.type==='application/pdf');
    if(!pdfs.length){toast('Selecciona uno o varios archivos PDF.',true);return;}
    if(replace&&project.history.dirty && !await confirmAction('¿Abrir otro documento?','Hay cambios sin exportar. Si continúas, se descartarán.','Descartar y abrir'))return;
    // Validate each new document before replacing the current session.
    await working('Abriendo tus documentos',async()=>{
      const staged=new window.PDFLinkPDF.PDFProject(),stagedProxies=new Map();
      let added=0;const errors=[];
      const previous=project,previousProxies=new Map(proxies);
      if(replace){project=staged;proxies.clear();}
      for(let n=0;n<pdfs.length;n++){
        const file=pdfs[n];progress(10+Math.round(75*n/pdfs.length),`Abriendo ${file.name}…`);
        try{
          if(file.size>150*1024*1024)throw new Error('El archivo supera los 150 MB. Divide o reduce el PDF antes de abrirlo.');
          await ingest(new Uint8Array(await file.arrayBuffer()),file.name);added++;
        }catch(error){errors.push(`${file.name}: ${humanError(error)}`);}
      }
      if(replace){
        if(added){for(const proxy of previousProxies.values())await proxy.destroy();current=0;selectedId=null;fitMode=true;
          if(added===1){project.history=new G.History();project.history.markSaved();}}
        else{for(const proxy of proxies.values())await proxy.destroy();project=previous;proxies.clear();for(const [key,value]of previousProxies)proxies.set(key,value);}
      }
      if(errors.length)toast(errors.join('\n'),true,14000);
      else toast(added===1?'PDF abierto. Puedes empezar a editar.':`${added} documentos unidos. Puedes ordenar sus páginas.`);
    });
    update();await rebuildPages();
  }
  function pickPDF(replace){if(busy)return;replaceNext=replace;$('pdf-input').value='';$('pdf-input').click();}
  $('open-btn').onclick=()=>pickPDF(true);$('welcome-open-btn').onclick=()=>pickPDF(true);$('merge-btn').onclick=()=>pickPDF(false);
  $('pdf-input').onchange=event=>openFiles(event.target.files,replaceNext);

  async function rebuildPages(){
    const epoch=++thumbEpoch;$('page-list').replaceChildren();
    if(!hasPages()){$('page-list').textContent='Tus páginas aparecerán aquí.';update();return;}
    current=G.clamp(current,0,project.pages.length-1);
    const queue=[];
    project.pages.forEach((model,index)=>{
      const button=document.createElement('button');button.className='page-thumb';button.type='button';button.title=model.label;
      button.setAttribute('aria-label',`Página ${index+1}, ${model.label}`);button.setAttribute('aria-current',index===current?'page':'false');
      const canvas=document.createElement('canvas');canvas.width=100;canvas.height=Math.round(100*model.height/model.width);
      const count=document.createElement('span');count.textContent=index+1;button.append(canvas,count);
      button.draggable=true;
      button.ondragstart=event=>{if(busy){event.preventDefault();return;}draggedPage=model.id;event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('text/x-pdflink-page',model.id);button.classList.add('dragging');};
      button.ondragover=event=>{if(!draggedPage)return;event.preventDefault();event.stopPropagation();button.classList.add('drop-target');event.dataTransfer.dropEffect='move';};
      button.ondragleave=()=>button.classList.remove('drop-target');
      button.ondragend=()=>{draggedPage=null;document.querySelectorAll('.page-thumb').forEach(el=>el.classList.remove('drop-target','dragging'));};
      button.ondrop=event=>{if(!draggedPage)return;event.preventDefault();event.stopPropagation();const active=page()?.id;project.reorderPage(draggedPage,model.id);draggedPage=null;current=project.pages.findIndex(p=>p.id===active);rebuildPages();fillProperties();};
      button.onclick=()=>goToPage(index);$('page-list').append(button);queue.push({model,canvas});
    });
    update();await renderPage();
    for(const {model,canvas}of queue){
      if(epoch!==thumbEpoch)break;
      try{const source=proxies.get(model.sourceId),pdfPage=await source.getPage(model.sourceIndex+1),viewport=pdfPage.getViewport({scale:100/model.width});
        canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
        await pdfPage.render({canvasContext:canvas.getContext('2d'),viewport,background:'white'}).promise;
        if(epoch!==thumbEpoch)break;
      }catch{/* The full page view reports rendering errors. */}
      await nextFrame();
    }
  }
  function computedScale(){
    if(!fitMode||!hasPages())return scale;
    const area=$('page-scroll');return Math.min(1.5,Math.max(.08,Math.min((area.clientWidth-62)/page().width,(area.clientHeight-48)/page().height)));
  }
  async function renderPage(){
    if(!hasPages())return;
    const epoch=++renderEpoch;renderTask?.cancel();scale=computedScale();
    const model=page(),wrapper=$('page-wrapper'),layer=$('overlay-layer');
    wrapper.style.width=`${model.width*scale}px`;wrapper.style.height=`${model.height*scale}px`;
    layer.style.width=`${model.width}px`;layer.style.height=`${model.height}px`;layer.style.transform=`scale(${scale})`;
    renderOverlays();fillProperties();update();
    try{
      const pdfPage=await proxies.get(model.sourceId).getPage(model.sourceIndex+1);
      if(epoch!==renderEpoch)return;
      const ratio=Math.min(window.devicePixelRatio||1,2,3000/Math.max(model.width*scale,model.height*scale));
      const viewport=pdfPage.getViewport({scale:scale*ratio});
      const canvas=$('pdf-canvas');canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
      renderTask=pdfPage.render({canvasContext:canvas.getContext('2d'),viewport,background:'white'});
      await renderTask.promise;
    }catch(error){if(error.name!=='RenderingCancelledException')toast(`No se puede mostrar esta página: ${humanError(error)}`,true);}
  }
  function goToPage(index){
    if(busy||!Number.isInteger(index)||index<0||index>=project.pages.length)return;
    current=index;selectedId=null;
    [...$('page-list').children].forEach((element,i)=>element.setAttribute('aria-current',i===index?'page':'false'));
    document.body.classList.remove('pages-open');renderPage();fillProperties();
  }
  $('page-number').onchange=event=>goToPage(Number(event.target.value)-1);
  $('fit-btn').onclick=()=>{fitMode=true;renderPage();};
  function zoom(factor){if(!hasPages()||busy)return;fitMode=false;scale=G.clamp(scale*factor,.1,4);renderPage();}
  $('zoom-in-btn').onclick=()=>zoom(1.2);$('zoom-out-btn').onclick=()=>zoom(1/1.2);
  $('page-scroll').addEventListener('wheel',event=>{if(event.ctrlKey){event.preventDefault();zoom(event.deltaY<0?1.1:1/1.1);}},{passive:false});
  let resizeTimer;new ResizeObserver(()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>{if(fitMode&&hasPages())renderPage();},120);}).observe($('editor'));

  function objectStyle(element,object){
    Object.assign(element.style,{left:`${object.x}px`,top:`${object.y}px`,width:`${object.width}px`,height:`${object.height}px`});
    if(object.kind==='text')Object.assign(element.style,{fontFamily:fontCSS(object),fontSize:`${object.size}px`,fontWeight:object.bold?'700':'400',color:object.color});
  }
  function renderOverlays(){
    const layer=$('overlay-layer');layer.replaceChildren();
    if(!hasPages())return;
    for(const object of page().overlays){
      const element=document.createElement('div');element.className=`overlay ${object.kind}${object.id===selectedId?' selected':''}`;
      element.tabIndex=0;element.dataset.objectId=object.id;element.setAttribute('role','button');
      element.setAttribute('aria-label',object.kind==='text'?`Texto: ${object.text}`:'Imagen añadida');
      if(object.kind==='text')element.append(document.createTextNode(object.text));
      else{const image=document.createElement('img');image.src=object.data;image.alt='';image.draggable=false;element.append(image);}
      if(object.id===selectedId){const handle=document.createElement('div');handle.className='resize-handle';handle.dataset.resize='true';handle.setAttribute('aria-hidden','true');element.append(handle);}
      objectStyle(element,object);element.onpointerdown=event=>startDrag(event,object,element);
      element.ondblclick=()=>{if(object.kind==='text'){$('text-content').focus();$('text-content').select();}};
      element.onfocus=()=>{if(selectedId!==object.id){selectedId=object.id;renderOverlays();fillProperties();}};
      layer.append(element);
    }
  }
  function selectObject(id){propertyGroup=null;propertyRequest++;selectedId=id;renderOverlays();fillProperties();}
  function fillProperties(){
    renderLayers();
    const object=selected();$('selection-empty').hidden=!!object;$('properties-form').hidden=!object;
    if(!object)return;
    $('text-properties').hidden=object.kind!=='text';$('image-properties').hidden=object.kind!=='image';
    $('text-content').value=object.text||'';$('font-family').value=object.font||'Helvetica';$('font-size').value=+(object.size||20).toFixed(1);
    $('font-bold').checked=!!object.bold;$('text-color').value=object.color||'#172b42';
    $('pos-x').value=+object.x.toFixed(1);$('pos-y').value=+object.y.toFixed(1);
    $('obj-width').value=+object.width.toFixed(1);$('obj-height').value=+object.height.toFixed(1);
  }
  function startDrag(event,object,element){
    if(busy||event.button!==0)return;event.preventDefault();event.stopPropagation();
    const resizing=event.target.dataset.resize==='true',initial=G.clone(object),startX=event.clientX,startY=event.clientY;
    const sameSelection=selectedId===object.id;selectedId=object.id;
    if(!sameSelection){for(const child of $('overlay-layer').children)child.classList.toggle('selected',child===element);fillProperties();}
    let changed=false;element.setPointerCapture(event.pointerId);
    const move=moveEvent=>{
      const dx=(moveEvent.clientX-startX)/scale,dy=(moveEvent.clientY-startY)/scale;
      if(!changed&&Math.hypot(dx,dy)<1)return;
      if(!changed){project.checkpoint();changed=true;}
      if(resizing){
        let factor=Math.max(.05,(initial.width+dx)/initial.width,(initial.height+dy)/initial.height);
        factor=Math.min(factor,(page().width-initial.x)/initial.width,(page().height-initial.y)/initial.height);
        if(object.kind==='text')factor=G.clamp(factor,4/initial.size,240/initial.size);
        object.width=initial.width*factor;object.height=initial.height*factor;
        if(object.kind==='text')object.size=initial.size*factor;
      }else{object.x=G.clamp(initial.x+dx,0,page().width-object.width);object.y=G.clamp(initial.y+dy,0,page().height-object.height);}
      objectStyle(element,object);
    };
    const end=()=>{element.removeEventListener('pointermove',move);element.removeEventListener('pointerup',end);element.removeEventListener('pointercancel',end);renderOverlays();fillProperties();if(changed)update();};
    element.addEventListener('pointermove',move);element.addEventListener('pointerup',end);element.addEventListener('pointercancel',end);
  }
  $('page-scroll').addEventListener('pointerdown',event=>{if(!event.target.closest('.overlay'))selectObject(null);});
  let propertyRequest=0,propertyGroup=null;
  const applyProperties=async event=>{
    event.preventDefault();if(busy||!selected())return;
    const original=selected(),candidate=G.clone(original),objectId=original.id,pageId=page().id,request=++propertyRequest;
    try{
      if(original.kind==='text'){
        candidate.text=$('text-content').value;
        if(!candidate.text.trim())throw new Error('Escribe un texto o elimina el elemento.');
        candidate.size=G.clamp(Number($('font-size').value)||20,4,240);candidate.font=$('font-family').value;candidate.bold=$('font-bold').checked;candidate.color=$('text-color').value;
        Object.assign(candidate,await project.measure(candidate));
      }else{
        candidate.width=Math.max(2,Number($('obj-width').value)||2);candidate.height=Math.max(2,Number($('obj-height').value)||2);
        if($('lock-ratio').checked){if(Math.abs(candidate.width-original.width)>.15)candidate.height=candidate.width*original.height/original.width;
          else candidate.width=candidate.height*original.width/original.height;}
      }
      if(candidate.width>page().width||candidate.height>page().height)throw new Error('El elemento no cabe en la página. Reduce su tamaño.');
      candidate.x=G.clamp(Number($('pos-x').value)||0,0,page().width-candidate.width);candidate.y=G.clamp(Number($('pos-y').value)||0,0,page().height-candidate.height);
      if(request!==propertyRequest||selectedId!==objectId||page()?.id!==pageId)return;
      if(JSON.stringify(candidate)!==JSON.stringify(original)){if(!propertyGroup||propertyGroup!==objectId){project.checkpoint();propertyGroup=objectId;}const index=page().overlays.findIndex(object=>object.id===objectId);if(index<0)return;page().overlays[index]=candidate;renderOverlays();renderLayers();update();}
    }catch(error){toast(humanError(error),true);}
  };
  $('properties-form').onsubmit=event=>event.preventDefault();
  for(const control of $('properties-form').querySelectorAll('input,select,textarea')){
    control.addEventListener('input',applyProperties);control.addEventListener('change',applyProperties);
    control.addEventListener('blur',()=>{propertyGroup=null;});
  }
  function deleteObject(){if(!selected()||busy)return;project.checkpoint();page().overlays=page().overlays.filter(o=>o.id!==selectedId);selectObject(null);update();}
  $('delete-object-btn').onclick=deleteObject;
  function showProps(){document.body.classList.toggle('props-open');$('props-btn').setAttribute('aria-expanded',document.body.classList.contains('props-open'));}
  $('props-btn').onclick=showProps;$('close-props-btn').onclick=()=>{document.body.classList.remove('props-open');$('props-btn').setAttribute('aria-expanded','false');};
  $('pages-toggle-btn').onclick=()=>{document.body.classList.toggle('pages-open');$('pages-toggle-btn').setAttribute('aria-expanded',document.body.classList.contains('pages-open'));};

  function added(object){project.addOverlay(current,object);selectObject(object.id);update();if(innerWidth<=1150){document.body.classList.add('props-open');$('props-btn').setAttribute('aria-expanded','true');}}
  $('add-text-btn').onclick=()=>{if(busy||!hasPages())return;$('new-text').value='';$('text-dialog').showModal();$('new-text').focus();};
  $('new-text-form').onsubmit=async event=>{
    event.preventDefault();const text=$('new-text').value;if(!text.trim())return;
    try{const object=await project.createText(text);$('text-dialog').close();added(object);}catch(error){toast(humanError(error),true);}
  };
  $('add-image-btn').onclick=()=>{if(busy||!hasPages())return;$('image-input').value='';$('image-input').click();};
  $('image-input').onchange=async event=>{
    const file=event.target.files[0];if(!file)return;
    await working('Preparando tu imagen',async()=>{
      if(file.size>30*1024*1024)throw new Error('La imagen supera los 30 MB. Reduce su tamaño antes de añadirla.');
      let bitmap;
      try{bitmap=await createImageBitmap(file,{imageOrientation:'from-image'});
        if(bitmap.width*bitmap.height>36_000_000)throw new Error('La imagen supera los 36 megapíxeles. Reduce su resolución.');
        const factor=Math.min(1,4000/Math.max(bitmap.width,bitmap.height)),canvas=document.createElement('canvas');
        canvas.width=Math.max(1,Math.round(bitmap.width*factor));canvas.height=Math.max(1,Math.round(bitmap.height*factor));
        canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);
        const width=Math.min(220,page().width*.5);
        added({id:G.uid(),kind:'image',data:canvas.toDataURL('image/png'),x:50,y:70,width,height:width*canvas.height/canvas.width});canvas.width=canvas.height=1;
      }finally{bitmap?.close();}
    });
  };
  let signatureEmpty=true,signatureDrawing=false;
  const signature=$('signature-canvas'),sigContext=signature.getContext('2d');
  function clearSignature(){sigContext.clearRect(0,0,signature.width,signature.height);signatureEmpty=true;}
  const sigPoint=event=>{const rect=signature.getBoundingClientRect();return[(event.clientX-rect.left)*signature.width/rect.width,(event.clientY-rect.top)*signature.height/rect.height];};
  signature.onpointerdown=event=>{if(event.button!==0)return;signatureDrawing=true;signature.setPointerCapture(event.pointerId);const[x,y]=sigPoint(event);sigContext.strokeStyle='#172b42';sigContext.fillStyle='#172b42';sigContext.lineWidth=5.5;sigContext.lineCap='round';sigContext.lineJoin='round';sigContext.beginPath();sigContext.arc(x,y,2.75,0,Math.PI*2);sigContext.fill();sigContext.beginPath();sigContext.moveTo(x,y);signatureEmpty=false;};
  signature.onpointermove=event=>{if(!signatureDrawing)return;const[x,y]=sigPoint(event);sigContext.lineTo(x,y);sigContext.stroke();sigContext.beginPath();sigContext.moveTo(x,y);};
  signature.onpointerup=signature.onpointercancel=()=>signatureDrawing=false;
  $('signature-btn').onclick=()=>{clearSignature();$('signature-dialog').showModal();};$('clear-signature-btn').onclick=clearSignature;
  $('use-signature-btn').onclick=()=>{
    if(signatureEmpty){toast('Dibuja una firma antes de añadirla.',true);return;}
    const pixels=sigContext.getImageData(0,0,signature.width,signature.height).data;let minX=signature.width,minY=signature.height,maxX=0,maxY=0;
    for(let y=0;y<signature.height;y++)for(let x=0;x<signature.width;x++)if(pixels[(y*signature.width+x)*4+3]){minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);}
    minX=Math.max(0,minX-8);minY=Math.max(0,minY-8);maxX=Math.min(signature.width-1,maxX+8);maxY=Math.min(signature.height-1,maxY+8);
    const canvas=document.createElement('canvas');canvas.width=maxX-minX+1;canvas.height=maxY-minY+1;
    canvas.getContext('2d').drawImage(signature,minX,minY,canvas.width,canvas.height,0,0,canvas.width,canvas.height);
    const width=Math.min(190,page().width*.5);added({id:G.uid(),kind:'image',role:'signature',data:canvas.toDataURL('image/png'),x:50,y:70,width,height:width*canvas.height/canvas.width});
    $('signature-dialog').close();clearSignature();canvas.width=canvas.height=1;
  };
  $('signature-dialog').addEventListener('close',clearSignature);
  $('move-up-btn').onclick=()=>{if(!busy){current=project.movePage(current,-1);selectedId=null;rebuildPages();}};
  $('move-down-btn').onclick=()=>{if(!busy){current=project.movePage(current,1);selectedId=null;rebuildPages();}};
  $('delete-page-btn').onclick=async()=>{if(busy||!hasPages())return;if(project.pages.length===1){toast('El documento debe conservar al menos una página.',true);return;}
    if(await confirmAction('¿Eliminar esta página?',`Se eliminará la página ${current+1}. Puedes deshacer esta acción.`,'Eliminar página')){project.deletePage(current);current=Math.min(current,project.pages.length-1);selectedId=null;await rebuildPages();fillProperties();}};
  function undo(){if(busy)return;if(project.undo()){selectedId=null;rebuildPages();fillProperties();}}
  function redo(){if(busy)return;if(project.redo()){selectedId=null;rebuildPages();fillProperties();}}
  $('undo-btn').onclick=undo;$('redo-btn').onclick=redo;

  function showExport(){if(busy||!hasPages())return;$('export-name').value=`${project.title}_PDFLink.pdf`;$('export-dialog').showModal();}
  $('export-btn').onclick=showExport;
  $('export-form').onsubmit=async event=>{
    event.preventDefault();const form=event.currentTarget,mode=new FormData(form).get('compression');
    let filename=$('export-name').value.trim().replace(/[\\/:*?"<>|\x00-\x1f]/g,'_');if(!filename)filename='Documento_PDFLink.pdf';if(!/\.pdf$/i.test(filename))filename+='.pdf';
    $('export-dialog').close();
    await working('Exportando tu PDF',async()=>{
      const result=await project.export(mode,{progress});
      const blob=new Blob([result.bytes],{type:'application/pdf'}),url=URL.createObjectURL(blob),anchor=document.createElement('a');
      anchor.href=url;anchor.download=filename;document.body.append(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
      project.history.markSaved();
      const reduction=100*(1-result.bytes.length/project.inputSize);
      toast(`PDF preparado: ${size(result.bytes.length)}${reduction>0?` · ${reduction.toFixed(1)} % menos que los archivos de entrada`:''}. Revisa la descarga de tu navegador.`,false,10000);
    });
  };
  $('help-btn').onclick=()=>$('help-dialog').showModal();
  for(const control of document.querySelectorAll('[data-close]'))control.onclick=()=>control.closest('dialog').close();
  $('busy-dialog').addEventListener('cancel',event=>event.preventDefault());
  for(const dialog of document.querySelectorAll('dialog:not(#busy-dialog)'))dialog.addEventListener('click',event=>{if(event.target===dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close();}});

  document.addEventListener('keydown',event=>{
    const editing=/INPUT|TEXTAREA|SELECT/.test(event.target.tagName)||event.target.isContentEditable;
    const dialogOpen=!!document.querySelector('dialog[open]');
    if(busy)return;
    if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='s'){event.preventDefault();if(!dialogOpen)showExport();return;}
    if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='o'){event.preventDefault();if(!dialogOpen)pickPDF(true);return;}
    if(editing||dialogOpen)return;
    if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='z'){event.preventDefault();event.shiftKey?redo():undo();}
    if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='y'){event.preventDefault();redo();}
    if(event.key==='Delete'||event.key==='Backspace'){if(selected()){event.preventDefault();deleteObject();}}
    if(event.key==='Escape'){selectObject(null);document.body.classList.remove('props-open','pages-open');}
    const directions={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]};
    if(directions[event.key]&&selected()){event.preventDefault();project.checkpoint();const object=selected(),[x,y]=directions[event.key],step=event.shiftKey?10:1;object.x=G.clamp(object.x+x*step,0,page().width-object.width);object.y=G.clamp(object.y+y*step,0,page().height-object.height);renderOverlays();fillProperties();update();}
  });
  addEventListener('beforeunload',event=>{if(project.history.dirty){event.preventDefault();event.returnValue='';}});
  document.addEventListener('dragenter',event=>{if(draggedPage||!event.dataTransfer?.types.includes('Files'))return;event.preventDefault();dragDepth++;$('drop-zone').hidden=false;});
  document.addEventListener('dragover',event=>{if(!draggedPage&&event.dataTransfer?.types.includes('Files')){event.preventDefault();event.dataTransfer.dropEffect='copy';}});
  document.addEventListener('dragleave',event=>{event.preventDefault();dragDepth=Math.max(0,dragDepth-1);if(!dragDepth)$('drop-zone').hidden=true;});
  document.addEventListener('drop',event=>{if(draggedPage)return;event.preventDefault();dragDepth=0;$('drop-zone').hidden=true;if(!busy)openFiles(event.dataTransfer.files,false);});



  function renderLayers(){
    const container=$('layers-list');container.replaceChildren();const objects=page()?.overlays||[];
    $('layer-count').textContent=objects.length;
    if(!objects.length){const empty=document.createElement('p');empty.className='field-note';empty.textContent='Esta página todavía no tiene elementos añadidos.';container.append(empty);return;}
    for(const [index,object]of [...objects.entries()].reverse()){
      const row=document.createElement('button');row.type='button';row.className='layer-row';row.setAttribute('aria-pressed',object.id===selectedId?'true':'false');
      const icon=document.createElement('span');icon.className='layer-icon';icon.textContent=object.kind==='text'?'T':object.role==='signature'?'✎':'▧';
      const text=document.createElement('span');text.className='layer-name';text.textContent=object.kind==='text'?(object.text.trim().replace(/\s+/g,' ').slice(0,40)||'Texto vacío'):object.role==='signature'?`Firma ${index+1}`:`Imagen ${index+1}`;
      row.title=text.textContent;row.append(icon,text);row.onclick=()=>selectObject(object.id);container.append(row);
    }
  }
  $('theme-btn').onclick=()=>{const dark=document.documentElement.dataset.theme!=='dark';document.documentElement.dataset.theme=dark?'dark':'light';$('theme-btn').textContent=dark?'Modo claro':'Modo oscuro';$('theme-btn').setAttribute('aria-pressed',String(dark));};

  update();fillProperties();
  try{
    pdfjs=await window.PDFLinkLocalPDFReady;
    if(!pdfjs?.getDocument)throw new Error('El motor PDF local no está disponible.');
    update();
  }catch(error){toast('No se ha podido iniciar PDFLink. Extrae la carpeta completa del ZIP y abre index.html con Chrome o Edge actualizado.',true,60000);}
});
