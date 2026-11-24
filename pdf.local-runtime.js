/* Load PDF.js from classic sibling scripts, including when index.html uses file://.
 * Each PDF gets its own in-memory worker. No fetch, ESM import, server or CDN.
 */
(function(root){
  'use strict';
  let workerURL=null;
  function createPort(){
    if(typeof Worker==='undefined')return Promise.reject(new Error('Workers unavailable'));
    if(!workerURL){
      const source=`(${root.PDFLinkWorkerBootstrap.toString()})();`;
      workerURL=URL.createObjectURL(new Blob([source],{type:'text/javascript'}));
    }
    const port=new Worker(workerURL);
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>finish(new Error('Worker startup timed out')),6000);
      let settled=false;
      function cleanup(){clearTimeout(timer);port.removeEventListener('message',onMessage);port.removeEventListener('error',onError);}
      function finish(error){
        if(settled)return;settled=true;cleanup();
        if(error){port.terminate();reject(error);}else resolve(port);
      }
      function onMessage(event){if(event.data?.sourceName==='worker'&&event.data?.action==='ready')finish();}
      function onError(event){event.preventDefault();finish(new Error('Worker unavailable'));}
      port.addEventListener('message',onMessage);port.addEventListener('error',onError);
    });
  }
  root.PDFLinkLocalPDFReady=(async()=>{
    const api=await root.PDFLinkViewerReady;
    if(!api?.getDocument||typeof root.PDFLinkWorkerBootstrap!=='function')throw new Error('Local PDF libraries are missing.');
    function getLocalDocument(options){
      let task=null,port=null,pdfWorker=null,cancelled=false;
      const promise=(async()=>{
        try{port=await createPort();}catch{
          // Browsers that disallow blob workers can still work without loading modules.
          if(!root.pdfjsWorker)root.PDFLinkWorkerBootstrap();
        }
        if(cancelled){port?.terminate();throw new Error('Document loading cancelled.');}
        if(port)pdfWorker=api.PDFWorker.create({port});
        task=api.getDocument({...options,...(pdfWorker?{worker:pdfWorker}:{})});
        return task.promise;
      })();
      return {
        promise,
        async destroy(){
          cancelled=true;
          try{await task?.destroy();}
          finally{pdfWorker?.destroy();port?.terminate();}
        }
      };
    }
    return {...api,getDocument:getLocalDocument};
  })();
})(globalThis);
