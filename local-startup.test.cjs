/* Classic-script startup tests. No HTTP server, browser automation or external requests. */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const vm=require('node:vm');
const {Worker:NodeWorker}=require('node:worker_threads');
const {resolveObjectURL}=require('node:buffer');
const P=require('./pdf-lib.min.js');

const webWorkerPrelude=`
const {parentPort}=require('node:worker_threads');
const listeners=new Map();
globalThis.self=globalThis;
globalThis.onmessage=null;
globalThis.postMessage=(message,transfer)=>parentPort.postMessage(message,transfer);
globalThis.addEventListener=(type,listener)=>{if(type==='message'){const wrapped=data=>listener({data});listeners.set(listener,wrapped);parentPort.on('message',wrapped);}};
globalThis.removeEventListener=(type,listener)=>{const wrapped=listeners.get(listener);if(wrapped){parentPort.off('message',wrapped);listeners.delete(listener);}};
Object.defineProperty(Uint8Array.prototype,'toHex',{value:function(){return Buffer.from(this).toString('hex')},configurable:true});
globalThis.process=undefined;
`;

class WebWorkerPort {
  static created=0;static terminated=0;
  constructor(url){
    WebWorkerPort.created++;this.listeners=new Map();this.pending=[];this.closed=false;
    this.initialized=resolveObjectURL(url).text().then(source=>{
      if(this.closed)return;
      this.worker=new NodeWorker(webWorkerPrelude+source,{eval:true});
      this.worker.on('message',data=>this.dispatch('message',{data}));
      this.worker.on('error',error=>this.dispatch('error',{message:error.message,preventDefault(){}}));
      for(const [message,transfer]of this.pending)this.worker.postMessage(message,transfer);
      this.pending=[];
    });
  }
  addEventListener(type,listener){if(!this.listeners.has(type))this.listeners.set(type,new Set());this.listeners.get(type).add(listener);}
  removeEventListener(type,listener){this.listeners.get(type)?.delete(listener);}
  dispatch(type,event){for(const listener of [...(this.listeners.get(type)||[])])listener(event);}
  postMessage(message,transfer){if(this.worker)this.worker.postMessage(message,transfer);else this.pending.push([message,transfer]);}
  terminate(){if(this.closed)return;this.closed=true;WebWorkerPort.terminated++;return this.worker?.terminate();}
}

async function classicContext(Worker){
  const document={currentScript:{src:'file:///PDFLinks-main/pdf.viewer.local.js'}};
  const context=vm.createContext({console,setTimeout,clearTimeout,queueMicrotask,structuredClone,
    TextDecoder,TextEncoder,URL,Blob,Uint8Array,Uint8ClampedArray,Int32Array,Uint32Array,Float32Array,Float64Array,
    ArrayBuffer,DataView,AbortController,AbortSignal,ReadableStream,TransformStream,DOMException,
    document,DOMMatrix:class DOMMatrix{},Worker});
  context.window=context;
  vm.runInContext("Object.defineProperty(Uint8Array.prototype,'toHex',{value:function(){return Array.from(this,x=>x.toString(16).padStart(2,'0')).join('')},configurable:true});",context);
  for(const filename of ['pdf.worker.local.js','pdf.viewer.local.js','pdf.local-runtime.js']){
    const source=await fs.readFile(path.join(__dirname,filename),'utf8');
    assert.ok(!/\bimport\.meta\b|\bexport\s*\{/.test(source),filename);
    new vm.Script(source,{filename}).runInContext(context);
  }
  return {context,api:await context.PDFLinkLocalPDFReady};
}

async function bytes(text){const pdf=await P.PDFDocument.create();pdf.addPage().drawText(text);return pdf.save();}
async function read(api,data){
  const task=api.getDocument({data:data.slice(),useWasm:false,useSystemFonts:true,disableFontFace:true,
    isOffscreenCanvasSupported:false,disableWorkerRendering:true,verbosity:0});
  try{const pdf=await task.promise,page=await pdf.getPage(1),text=await page.getTextContent();return text.items.map(i=>i.str).join(' ');}
  finally{await task.destroy();}
}

test('classic local scripts open a PDF without modules, fetch or a Worker',async()=>{
  const {api}=await classicContext(undefined);
  assert.match(await read(api,await bytes('DOBLE CLIC: España 123 €')),/DOBLE CLIC: España 123 €/);
});

test('classic in-memory workers parse separate PDFs and shut down independently',async()=>{
  const before=WebWorkerPort.terminated,{api}=await classicContext(WebWorkerPort);
  const values=await Promise.all([read(api,await bytes('PRIMER PDF')),read(api,await bytes('SEGUNDO PDF'))]);
  assert.match(values[0],/PRIMER PDF/);assert.match(values[1],/SEGUNDO PDF/);
  assert.equal(WebWorkerPort.terminated-before,2);
});

test('downloaded-folder startup only loads classic relative scripts',async()=>{
  const html=await fs.readFile(path.join(__dirname,'index.html'),'utf8');
  assert.ok(!/<script[^>]+type=["']module/.test(html));
  for(const match of html.matchAll(/<script[^>]+src="([^"]+)"/g)){
    assert.ok(!/^https?:|\.mjs$/.test(match[1]),match[1]);await fs.access(path.join(__dirname,match[1]));
  }
  const app=await fs.readFile(path.join(__dirname,'app.js'),'utf8');
  assert.ok(!/\bimport\s*\(/.test(app));assert.ok(!/npm start/.test(app));
});

test('an invalid PDF releases its in-memory worker',async()=>{
  const before=WebWorkerPort.terminated,{api}=await classicContext(WebWorkerPort);
  await assert.rejects(read(api,new Uint8Array([1,2,3,4,5])));
  assert.equal(WebWorkerPort.terminated-before,1);
});
