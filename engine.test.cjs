const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const P=require('./pdf-lib.min.js');
const G=require('./geometry.js');
const {PDFProject,undoPredictor,imageDescriptor}=require('./pdf-engine.js');

function descriptor(page){
  const {x,y,width:w,height:h}=page.getCropBox(),rotation=((page.getRotation().angle%360)+360)%360;
  const transform={0:[1,0,0,-1,-x,y+h],90:[0,1,1,0,-y,-x],180:[-1,0,0,1,x+w,-y],270:[0,-1,-1,0,y+h,x+w]}[rotation];
  return {width:rotation%180?h:w,height:rotation%180?w:h,transform};
}
async function source(text='ORIGINAL',rotation=0,cropped=false){
  const document=await P.PDFDocument.create(),page=document.addPage([620,850]);
  page.drawText(text,{x:70,y:730,size:18});
  if(cropped)page.setCropBox(20,30,580,790);page.setRotation(P.degrees(rotation));document.setTitle('Prueba local');
  const bytes=await document.save({useObjectStreams:false});return {bytes,descriptors:[descriptor(page)]};
}
async function projectWithSource(options=[]){const input=await source(...options),project=new PDFProject();await project.addSource(input.bytes,'Prueba.pdf',input.descriptors);project.history=new G.History();return{project,input};}
function streams(document,page){
  const contents=page.node.Contents();
  const refs=contents instanceof P.PDFArray?contents.asArray():contents?[contents]:[];
  return refs.map(ref=>document.context.lookup(ref)).map(stream=>Buffer.from(P.decodePDFRawStream(stream).decode()).toString('latin1')).join('\n');
}

test('viewport inverse works for all rotations and a nonzero CropBox',async()=>{
  for(const rotation of [0,90,180,270]){
    const input=await source('ORIGINAL',rotation,true),view=input.descriptors[0];
    for(const [x,y]of [[0,0],[50,90],[view.width,view.height]]){
      const raw=G.point(G.inverse(view.transform),x,y),visible=G.point(view.transform,...raw);
      assert.ok(Math.abs(visible[0]-x)<1e-8);assert.ok(Math.abs(visible[1]-y)<1e-8);
    }
    const object={x:75,y:150,width:160,height:40},matrix=G.placement(view,object);
    assert.deepEqual(G.point(view.transform,...G.point(matrix,0,0)),[75,190]);
    assert.deepEqual(G.point(view.transform,...G.point(matrix,160,40)),[235,150]);
  }
});

test('unmodified optimized export never grows the original PDF',async()=>{
  const {project,input}=await projectWithSource();const {bytes}=await project.export();
  assert.ok(bytes.length<=input.bytes.length);assert.equal(project.history.dirty,false);
  const document=await P.PDFDocument.load(bytes);assert.equal(document.getPageCount(),1);assert.equal(document.getTitle(),'Prueba local');
});

test('merge, reorder, remove, undo and redo produce the expected page count',async()=>{
  const {project}=await projectWithSource(),second=await source('SECOND');
  await project.addSource(second.bytes,'Segundo.pdf',second.descriptors);
  assert.equal(project.pages.length,2);assert.equal(project.history.dirty,true);
  assert.equal(project.movePage(1,-1),0);assert.match(project.pages[0].label,/Segundo/);
  assert.ok(project.undo());assert.match(project.pages[0].label,/Prueba/);
  assert.ok(project.redo());assert.match(project.pages[0].label,/Segundo/);
  project.deletePage(1);assert.equal(project.pages.length,1);
  const exported=await P.PDFDocument.load((await project.export()).bytes);assert.equal(exported.getPageCount(),1);
  assert.throws(()=>project.deletePage(0),/al menos/);
});

test('new text remains vector text and original content is retained',async()=>{
  const {project,input}=await projectWithSource(),original=input.bytes.slice();
  const object=await project.createText('Alejandro España: 123,45 €\nSegunda línea',23);
  object.x=75;object.y=150;project.addOverlay(0,object);
  const document=await P.PDFDocument.load((await project.export()).bytes),contents=streams(document,document.getPage(0));
  assert.match(contents,/Tj/);assert.match(contents,/ cm/);assert.match(contents,/<4F524947494E414C>/);
  assert.ok((contents.match(/ Tj/g)||[]).length>=3);assert.deepEqual(project.sources.values().next().value.bytes,original);
});

test('export placements retain original page rotation and CropBox',async()=>{
  const out=path.resolve(__dirname,'.test-output');await fs.mkdir(out,{recursive:true});
  for(const angle of [0,90,180,270]){
    const {project}=await projectWithSource(['ORIGINAL',angle,true]);
    const object=await project.createText('Alejandro España',22);object.x=75;object.y=150;project.addOverlay(0,object);
    const result=await project.export(),document=await P.PDFDocument.load(result.bytes),page=document.getPage(0);
    assert.equal(page.getRotation().angle,angle);assert.deepEqual(page.getCropBox(),{x:20,y:30,width:580,height:790});
    await fs.writeFile(path.join(out,`rotation-${angle}.pdf`),result.bytes);
  }
});

test('history tracks saved state across undo and new branches',()=>{
  const h=new G.History();let pages=[{id:'a',overlays:[]}];h.checkpoint(pages);pages.push({id:'b'});h.markSaved();
  h.checkpoint(pages);pages[0].overlays.push({text:'nombre'});assert.equal(h.dirty,true);
  pages=h.undo(pages);assert.equal(h.dirty,false);assert.equal(pages[0].overlays.length,0);
  pages=h.redo(pages);assert.equal(h.dirty,true);assert.equal(pages[0].overlays.length,1);
  pages=h.undo(pages);h.checkpoint(pages);pages.pop();assert.equal(h.redoStack.length,0);assert.equal(h.dirty,true);
});

test('text measurements handle Spanish characters and reject unsupported emoji',async()=>{
  const {project}=await projectWithSource();const object=await project.createText('áéíóú ñ ¿Qué? ¡Sí! €');assert.ok(object.width>20);
  await assert.rejects(project.createText('Una firma 😀'),/carácter no compatible/);
});

test('transparent PNG stays transparent and image insertion preserves its bounds',async()=>{
  const {project}=await projectWithSource();
  const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAD0lEQVR4nGP4z8DQwAAEAAqBAYANgP7nAAAAAElFTkSuQmCC';
  project.addOverlay(0,{id:'image',kind:'image',data:png,x:50,y:200,width:160,height:80});
  const document=await P.PDFDocument.load((await project.export()).bytes),images=document.context.enumerateIndirectObjects().map(([,o])=>o).filter(o=>o instanceof P.PDFRawStream&&String(o.dict.get(P.PDFName.of('Subtype')))==='/Image');
  assert.ok(images.length>0);assert.ok(images.some(o=>o.dict.has(P.PDFName.of('SMask'))));
});

test('lossy compression replaces eligible RGB streams and keeps text vector operations',async()=>{
  const doc=await P.PDFDocument.create(),page=doc.addPage([595,842]);page.drawText('TEXT SURVIVES',{x:50,y:750});
  const pixels=new Uint8Array(64*64*3);for(let i=0;i<pixels.length;i++)pixels[i]=(i*117+((i/13)|0))%256;
  const raw=doc.context.stream(pixels,{Type:'XObject',Subtype:'Image',Width:64,Height:64,ColorSpace:'DeviceRGB',BitsPerComponent:8});
  const ref=doc.context.register(raw);page.node.setXObject(P.PDFName.of('TestImage'),ref);
  const input=await doc.save({useObjectStreams:false}),project=new PDFProject();await project.addSource(input,'imagen.pdf',[descriptor(page)]);
  let called=0;
  const result=await project.export('small',{imageProcessor:async desc=>{called++;assert.equal(desc.kind,'pixels');return{bytes:new Uint8Array([255,216,255,217]),width:32,height:32};}});
  assert.equal(called,1);assert.equal(result.optimized,1);assert.ok(result.bytes.length<input.length);
  const check=await P.PDFDocument.load(result.bytes);assert.match(streams(check,check.getPage(0)),/Tj/);
  const image=check.context.enumerateIndirectObjects().map(([,o])=>o).find(o=>o instanceof P.PDFRawStream&&String(o.dict.get(P.PDFName.of('Subtype')))==='/Image');
  assert.equal(String(image.dict.get(P.PDFName.of('Filter'))),'/DCTDecode');
});

test('image optimizer skips masks, unsupported color spaces and excessive dimensions',async()=>{
  const d=await P.PDFDocument.create();
  const basic={Type:'XObject',Subtype:'Image',Width:100,Height:100,ColorSpace:'DeviceRGB',BitsPerComponent:8};
  assert.equal(imageDescriptor(d.context,d.context.stream(new Uint8Array(20),{...basic,SMask:P.PDFRef.of(99)})),null);
  assert.equal(imageDescriptor(d.context,d.context.stream(new Uint8Array(20),{...basic,ColorSpace:'DeviceCMYK'})),null);
  assert.equal(imageDescriptor(d.context,d.context.stream(new Uint8Array(20),{...basic,Width:100000})),null);
});

test('PNG row predictors and TIFF prediction recover exact RGB bytes',()=>{
  assert.deepEqual([...undoPredictor(Uint8Array.from([0,1,2,3,4,5,6,2,7,7,7,7,7,7]),2,2,3,15)],[1,2,3,4,5,6,8,9,10,11,12,13]);
  assert.deepEqual([...undoPredictor(Uint8Array.from([1,2,3,3,3,3]),2,1,3,2)],[1,2,3,4,5,6]);
  assert.equal(undoPredictor(new Uint8Array(3),10,10,3,15),null);
});

test('invalid sources, invalid export modes and empty exports are rejected',async()=>{
  const project=new PDFProject();await assert.rejects(project.export(),/Abre un PDF/);
  await assert.rejects(project.addSource(new Uint8Array([1,2,3]),'invalid.pdf',[]));assert.equal(project.pages.length,0);
  const {project:valid}=await projectWithSource();await assert.rejects(valid.export('unknown'),/Modo/);
});

test('HTML includes local assets, CSP and no external scripts or analytics',async()=>{
  const root=path.resolve(__dirname),html=await fs.readFile(path.join(root,'index.html'),'utf8');
  assert.match(html,/Content-Security-Policy/);assert.match(html,/connect-src 'none'/);
  for(const match of html.matchAll(/<(?:script|link)[^>]+(?:src|href)="([^"]+)"/g)){
    assert.ok(!/^https?:/.test(match[1]),match[1]);await fs.access(path.join(root,match[1]));
  }
  const app=await fs.readFile(path.join(root,'app.js'),'utf8');assert.ok(!/localStorage|indexedDB|sendBeacon|WebSocket|XMLHttpRequest/.test(app));
  assert.ok(!/fetch\s*\(/.test(app));
});

test('PDF.js independently reads exported text and the rotated page geometry',async()=>{
  // Node only parses documents here; these shims are not used by the web app.
  globalThis.DOMMatrix ||= class DOMMatrix {};
  Uint8Array.prototype.toHex ||= function(){return Buffer.from(this).toString('hex');};
  const {pathToFileURL}=require('node:url');
  const reader=await import(pathToFileURL(path.join(__dirname,'pdf.min.mjs')).href);
  reader.GlobalWorkerOptions.workerSrc=pathToFileURL(path.join(__dirname,'pdf.worker.min.mjs')).href;
  for(const angle of [0,90,180,270]){
    const {project,input}=await projectWithSource(['ORIGINAL',angle,true]);
    const object=await project.createText('Alejandro España: 123,45 €',22);object.x=75;object.y=150;project.addOverlay(0,object);
    const {bytes}=await project.export();
    const loading=reader.getDocument({data:bytes.slice(),useWasm:false,useSystemFonts:true,disableFontFace:true,disableWorkerRendering:true,verbosity:0});
    try{
      const document=await loading.promise,page=await document.getPage(1),viewport=page.getViewport({scale:1});
      assert.deepEqual(viewport.transform,input.descriptors[0].transform);
      const content=await page.getTextContent(),text=content.items.map(item=>item.str).join(' ');
      assert.match(text,/ORIGINAL/);assert.match(text,/Alejandro España: 123,45 €/);
    }catch(error){assert.fail(`PDF.js could not verify the result: ${error.message}`);}
    finally{await loading.destroy();}
  }
});
