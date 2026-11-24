/* PDFLink — PDF export and image optimization, entirely in memory. */
(function(root,factory) {
  if (typeof module==='object' && module.exports)
    module.exports=factory(require('./pdf-lib.min.js'),require('./geometry.js'));
  else root.PDFLinkPDF=factory(root.PDFLib,root.PDFLinkGeometry);
})(typeof globalThis!=='undefined'?globalThis:this,function(P,G) {
  'use strict';
  const name=value=>P.PDFName.of(value);
  const number=(context,dict,key,fallback=0)=>{
    const value=context.lookup(dict.get(name(key)));
    return value instanceof P.PDFNumber?value.asNumber():fallback;
  };
  const lookup=(context,dict,key)=>context.lookup(dict.get(name(key)));
  const hexRGB=hex=>[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255);
  const fontName=o=>({Helvetica:[P.StandardFonts.Helvetica,P.StandardFonts.HelveticaBold],
    Times:[P.StandardFonts.TimesRoman,P.StandardFonts.TimesRomanBold],
    Courier:[P.StandardFonts.Courier,P.StandardFonts.CourierBold]}[o.font||'Helvetica'])[o.bold?1:0];
  const yieldFrame=()=>new Promise(resolve=>setTimeout(resolve,0));

  function undoPredictor(data,width,height,colors,predictor) {
    const stride=width*colors;
    if (predictor<=1) return data.length===stride*height?data:null;
    if (predictor===2 && data.length===stride*height) {
      const out=data.slice();
      for(let row=0;row<height;row++) for(let x=colors;x<stride;x++)
        out[row*stride+x]=(out[row*stride+x]+out[row*stride+x-colors])&255;
      return out;
    }
    if (predictor<10 || predictor>15 || data.length!==(stride+1)*height) return null;
    const out=new Uint8Array(stride*height);
    for(let row=0;row<height;row++) {
      const filter=data[row*(stride+1)];
      if(filter>4) return null;
      for(let x=0;x<stride;x++) {
        const a=x>=colors?out[row*stride+x-colors]:0;
        const b=row?out[(row-1)*stride+x]:0;
        const c=row&&x>=colors?out[(row-1)*stride+x-colors]:0;
        let prediction=0;
        if(filter===1) prediction=a;
        if(filter===2) prediction=b;
        if(filter===3) prediction=(a+b)>>1;
        if(filter===4) { const q=a+b-c,pa=Math.abs(q-a),pb=Math.abs(q-b),pc=Math.abs(q-c); prediction=pa<=pb&&pa<=pc?a:pb<=pc?b:c; }
        out[row*stride+x]=(data[row*(stride+1)+x+1]+prediction)&255;
      }
    }
    return out;
  }

  function imageDescriptor(context,stream) {
    if(!(stream instanceof P.PDFRawStream)) return null;
    const dict=stream.dict;
    if(String(lookup(context,dict,'Subtype'))!=='/Image' || dict.has(name('SMask')) || dict.has(name('Mask')) || dict.has(name('ImageMask'))) return null;
    if(number(context,dict,'BitsPerComponent',8)!==8) return null;
    const width=number(context,dict,'Width'),height=number(context,dict,'Height');
    if(width<32||height<32||width*height>36_000_000) return null;
    let cs=lookup(context,dict,'ColorSpace');
    if(cs instanceof P.PDFArray && String(cs.lookup(0))==='/ICCBased') {
      const profile=cs.lookup(1);
      const n=profile?.dict?number(context,profile.dict,'N'):0;
      cs=n===3?name('DeviceRGB'):n===1?name('DeviceGray'):null;
    }
    const colors=String(cs)==='/DeviceRGB'?3:String(cs)==='/DeviceGray'?1:0;
    if(!colors) return null;
    if(dict.has(name('Decode'))) {
      const decode=lookup(context,dict,'Decode');
      if(!(decode instanceof P.PDFArray)||decode.size()!==colors*2) return null;
      for(let i=0;i<decode.size();i++) if(decode.lookup(i)?.asNumber?.()!==(i%2)) return null;
    }
    let filter=lookup(context,dict,'Filter');
    if(filter instanceof P.PDFArray) { if(filter.size()!==1) return null; filter=filter.lookup(0); }
    if(String(filter)==='/DCTDecode') return {kind:'jpeg',bytes:stream.getContents(),width,height,colors};
    if(filter && String(filter)!=='/FlateDecode') return null;
    try {
      const decoded=P.decodePDFRawStream(stream).decode();
      let parms=lookup(context,dict,'DecodeParms');
      if(parms instanceof P.PDFArray) parms=parms.lookup(0);
      const predictor=parms instanceof P.PDFDict?number(context,parms,'Predictor',1):1;
      if(parms instanceof P.PDFDict && (number(context,parms,'Columns',width)!==width||number(context,parms,'Colors',colors)!==colors||number(context,parms,'BitsPerComponent',8)!==8)) return null;
      const pixels=undoPredictor(decoded,width,height,colors,predictor);
      return pixels?{kind:'pixels',pixels,width,height,colors}:null;
    } catch { return null; }
  }

  async function browserJPEG(desc,mode) {
    const max=mode==='small'?1280:2200;
    const factor=Math.min(1,max/Math.max(desc.width,desc.height));
    const width=Math.max(1,Math.round(desc.width*factor)),height=Math.max(1,Math.round(desc.height*factor));
    const canvas=document.createElement('canvas'); canvas.width=width; canvas.height=height;
    const ctx=canvas.getContext('2d',{alpha:false}); ctx.fillStyle='white';ctx.fillRect(0,0,width,height);
    let bitmap;
    try {
      if(desc.kind==='jpeg') {
        bitmap=await createImageBitmap(new Blob([desc.bytes],{type:'image/jpeg'}));
        ctx.drawImage(bitmap,0,0,width,height);
      } else {
        const raw=document.createElement('canvas');raw.width=desc.width;raw.height=desc.height;
        const rawContext=raw.getContext('2d');
        const rgba=rawContext.createImageData(desc.width,desc.height);
        for(let pixel=0;pixel<desc.width*desc.height;pixel++) {
          const offset=pixel*4,input=pixel*desc.colors;
          rgba.data[offset]=desc.pixels[input];rgba.data[offset+1]=desc.pixels[input+(desc.colors===3?1:0)];
          rgba.data[offset+2]=desc.pixels[input+(desc.colors===3?2:0)];rgba.data[offset+3]=255;
        }
        rawContext.putImageData(rgba,0,0);ctx.drawImage(raw,0,0,width,height);raw.width=raw.height=1;
      }
      const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',mode==='small'?.56:.8));
      if(!blob) return null;
      return {bytes:new Uint8Array(await blob.arrayBuffer()),width,height};
    } finally { bitmap?.close();canvas.width=canvas.height=1; }
  }

  async function compressImages(document,mode,processor,progress) {
    const entries=document.context.enumerateIndirectObjects();
    let optimized=0,eligible=0;
    for(let i=0;i<entries.length;i++) {
      const [reference,stream]=entries[i];
      const descriptor=imageDescriptor(document.context,stream);
      if(!descriptor) continue;
      eligible++;
      try {
        const jpeg=await processor(descriptor,mode);
        if(jpeg?.bytes?.length && jpeg.bytes.length+100<stream.getContents().length) {
          const dict=stream.dict.clone(document.context);
          dict.set(name('Filter'),name('DCTDecode'));dict.delete(name('DecodeParms'));dict.delete(name('Decode'));
          dict.set(name('ColorSpace'),name('DeviceRGB'));dict.set(name('BitsPerComponent'),P.PDFNumber.of(8));
          dict.set(name('Width'),P.PDFNumber.of(jpeg.width));dict.set(name('Height'),P.PDFNumber.of(jpeg.height));
          dict.set(name('Length'),P.PDFNumber.of(jpeg.bytes.length));
          document.context.assign(reference,P.PDFRawStream.of(dict,jpeg.bytes));optimized++;
        }
      } catch { /* Keep an unsupported image exactly as it was. */ }
      progress(65+Math.round(25*i/entries.length),'Comprimiendo imágenes…');
      await yieldFrame();
    }
    return {optimized,eligible};
  }

  class PDFProject {
    constructor() {
      this.sources=new Map();this.pages=[];this.history=new G.History();this.title='Documento';
      this.measurementDocument=null;this.measurementFonts=new Map();
    }
    checkpoint(){this.history.checkpoint(this.pages);}
    undo(){const pages=this.history.undo(this.pages);if(pages)this.pages=pages;return !!pages;}
    redo(){const pages=this.history.redo(this.pages);if(pages)this.pages=pages;return !!pages;}
    async addSource(bytes,filename,descriptors) {
      const document=await P.PDFDocument.load(bytes.slice(),{updateMetadata:false});
      if(document.isEncrypted) throw new Error('Este PDF está protegido. Abre una copia autorizada sin contraseña.');
      const count=document.getPageCount();
      if(!count||count!==descriptors.length) throw new Error('No se pudieron validar las páginas del PDF.');
      for(const view of descriptors)if(!Array.isArray(view.transform)||view.transform.length!==6||!view.transform.every(Number.isFinite)||!Number.isFinite(view.width)||!Number.isFinite(view.height)||view.width<=0||view.height<=0)
        throw new Error('Geometría PDF no válida.');
      this.checkpoint();
      const id=G.uid();
      this.sources.set(id,{id,bytes:bytes.slice(),filename,count});
      if(this.sources.size===1)this.title=filename.replace(/\.pdf$/i,'');
      for(let index=0;index<count;index++) {
        const view=descriptors[index];
        this.pages.push({id:G.uid(),sourceId:id,sourceIndex:index,label:`${filename} · ${index+1}`,
          width:view.width,height:view.height,transform:[...view.transform],overlays:[]});
      }
      return id;
    }
    async measure(object) {
      this.measurementDocument ||= await P.PDFDocument.create();
      const key=fontName(object);
      if(!this.measurementFonts.has(key))this.measurementFonts.set(key,await this.measurementDocument.embedFont(key));
      const font=this.measurementFonts.get(key);
      const lines=object.text.split('\n');
      try {
        return {width:Math.max(8,...lines.map(line=>font.widthOfTextAtSize(line,object.size)))+2,
          height:Math.max(1,lines.length)*object.size*1.2,baseline:object.size*.95};
      }catch{
        throw new Error('El texto contiene un carácter no compatible con estas tipografías, como un emoji. Usa letras, números y signos habituales.');
      }
    }
    async createText(text,size=20) {
      const object={id:G.uid(),kind:'text',text,size,font:'Helvetica',bold:false,color:'#172b42',x:50,y:70};
      Object.assign(object,await this.measure(object));return object;
    }
    addOverlay(index,object){this.checkpoint();this.pages[index].overlays.push(G.fitObject(object,this.pages[index]));}
    movePage(index,offset){const next=index+offset;if(next<0||next>=this.pages.length)return index;this.checkpoint();[this.pages[index],this.pages[next]]=[this.pages[next],this.pages[index]];return next;}
    reorderPage(id,targetId){const from=this.pages.findIndex(p=>p.id===id),to=this.pages.findIndex(p=>p.id===targetId);if(from<0||to<0||from===to)return false;this.checkpoint();const [moving]=this.pages.splice(from,1);this.pages.splice(to,0,moving);return true;}
    deletePage(index){if(this.pages.length<=1)throw new Error('El documento debe conservar al menos una página.');this.checkpoint();this.pages.splice(index,1);}
    get inputSize(){return [...this.sources.values()].reduce((sum,s)=>sum+s.bytes.length,0);}
    async export(mode='lossless',options={}) {
      if(!this.pages.length)throw new Error('Abre un PDF antes de exportar.');
      if(!['lossless','balanced','small'].includes(mode))throw new Error('Modo de compresión no válido.');
      const progress=options.progress||(()=>{});progress(5,'Preparando el documento…');await yieldFrame();
      const [first]=this.sources.values();
      const identity=this.pages.length===first.count&&this.pages.every((p,i)=>p.sourceId===first.id&&p.sourceIndex===i);
      const document=identity?await P.PDFDocument.load(first.bytes.slice(),{updateMetadata:false}):await P.PDFDocument.create();
      if(!identity){
        const loaded=new Map();
        for(const page of this.pages) {
          if(!loaded.has(page.sourceId))loaded.set(page.sourceId,await P.PDFDocument.load(this.sources.get(page.sourceId).bytes.slice(),{updateMetadata:false}));
          const [copied]=await document.copyPages(loaded.get(page.sourceId),[page.sourceIndex]);document.addPage(copied);
        }
        document.setTitle(this.title);document.setProducer('PDFLink');
      }
      const fonts=new Map(),images=new Map();
      for(let index=0;index<this.pages.length;index++) {
        const model=this.pages[index],page=document.getPage(index);
        for(const object of model.overlays) {
          page.pushOperators(P.pushGraphicsState(),P.concatTransformationMatrix(...G.placement(model,object)));
          if(object.kind==='text') {
            const key=fontName(object);
            if(!fonts.has(key))fonts.set(key,await document.embedFont(key));
            const font=fonts.get(key),[r,g,b]=hexRGB(object.color);
            for(const [row,line]of object.text.split('\n').entries())if(line)
              page.drawText(line,{x:1,y:object.height-object.size*.95-row*object.size*1.2,
                size:object.size,font,color:P.rgb(r,g,b),lineHeight:object.size*1.2});
          } else {
            if(!images.has(object.data))images.set(object.data,await document.embedPng(object.data));
            page.drawImage(images.get(object.data),{x:0,y:0,width:object.width,height:object.height});
          }
          page.pushOperators(P.popGraphicsState());
        }
        progress(10+Math.round(45*(index+1)/this.pages.length),`Preparando página ${index+1} de ${this.pages.length}…`);
        await yieldFrame();
      }
      const save={useObjectStreams:true,addDefaultPage:false,updateFieldAppearances:false};
      let bytes=await document.save(save);
      if(identity&&!this.pages.some(p=>p.overlays.length)&&first.bytes.length<bytes.length)bytes=first.bytes.slice();
      let stats={optimized:0,eligible:0};
      if(mode!=='lossless'){
        stats=await compressImages(document,mode,options.imageProcessor||browserJPEG,progress);
        const compressed=await document.save(save);if(compressed.length<bytes.length)bytes=compressed;
      }
      const check=await P.PDFDocument.load(bytes,{updateMetadata:false});
      if(check.getPageCount()!==this.pages.length)throw new Error('No se ha podido validar el PDF de salida.');
      progress(100,'PDF preparado.');return {bytes,...stats};
    }
  }
  return {PDFProject,undoPredictor,imageDescriptor,compressImages,browserJPEG,fontName};
});
