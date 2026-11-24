/* Developer utility: prepare classic browser scripts from the pinned local ESM files.
 * No dependencies, network requests, eval or build step are needed by end users.
 */
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=__dirname;

function splitModule(filename){
  const input=fs.readFileSync(path.join(root,filename),'utf8');
  const match=input.match(/\bexport\s*\{([^}]+)\};?\s*$/);
  if(!match)throw new Error(`Unsupported module export syntax: ${filename}`);
  const exports=match[1].split(',').map(value=>{
    const entry=value.trim().match(/^([\w$]+)(?:\s+as\s+([\w$]+))?$/);
    if(!entry)throw new Error(`Unsupported named export in ${filename}`);
    return entry[2]?`${entry[2]}:${entry[1]}`:entry[1];
  }).join(',');
  return {body:input.slice(0,match.index),exports};
}

const viewer=splitModule('pdf.min.mjs');
const viewerBody=viewer.body.replaceAll('import.meta.url','moduleUrl');
const viewerScript=`/* PDFLink local-file adapter. Mozilla PDF.js original notices follow. */\n(function(root){\n'use strict';\nconst moduleUrl=typeof document!=='undefined'&&document.currentScript?document.currentScript.src:'';\nroot.PDFLinkViewerReady=(async function(){\n${viewerBody}\nreturn {${viewer.exports}};\n})();\n})(globalThis);\n`;
const worker=splitModule('pdf.worker.min.mjs');
const workerBody=worker.body.replaceAll('import.meta.url',"'about:blank'");
const workerScript=`/* PDFLink classic worker bootstrap. Mozilla PDF.js original notices follow. */\nglobalThis.PDFLinkWorkerBootstrap=function PDFLinkWorkerBootstrap(){\n'use strict';\n${workerBody}\n};\n`;
for(const [filename,source]of [['pdf.viewer.local.js',viewerScript],['pdf.worker.local.js',workerScript]]){
  new vm.Script(source,{filename});
  fs.writeFileSync(path.join(root,filename),source,'utf8');
  console.log(`Prepared ${filename}`);
}
