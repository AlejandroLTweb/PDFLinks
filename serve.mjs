/* A static, loopback-only development server. Never accepts PDF uploads. */
import http from 'node:http';
import {readFile,realpath,stat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';

const root=await realpath(path.resolve(path.dirname(fileURLToPath(import.meta.url))));
const option=process.argv.indexOf('--port');
const port=Number(option>=0?process.argv[option+1]:process.env.PORT||4177);
if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('Usa un puerto válido entre 1024 y 65535.');
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8',
  '.mjs':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml',
  '.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.wasm':'application/wasm',
  '.bcmap':'application/octet-stream','.pfb':'application/octet-stream','.ttf':'font/ttf','.woff':'font/woff',
  '.woff2':'font/woff2','.md':'text/plain; charset=utf-8','.txt':'text/plain; charset=utf-8'};
const server=http.createServer(async(req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('Cross-Origin-Resource-Policy','same-origin');res.setHeader('Cache-Control','no-store');
  res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()');
  if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405,{Allow:'GET, HEAD'});res.end('Solo se sirven archivos estáticos.');return;}
  try{
    const pathname=decodeURIComponent(new URL(req.url,'http://127.0.0.1').pathname);
    if(pathname.includes('\\')||pathname.includes('\0')||pathname.split('/').some(segment=>segment.startsWith('.'))){res.writeHead(403);res.end();return;}
    let target=path.resolve(root,'.'+pathname);
    if(target!==root&&!target.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
    if((await stat(target)).isDirectory())target=path.join(target,'index.html');
    target=await realpath(target);
    if(target!==root&&!target.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
    const content=await readFile(target);
    res.writeHead(200,{'Content-Type':types[path.extname(target).toLowerCase()]||'application/octet-stream','Content-Length':content.length});
    res.end(req.method==='HEAD'?undefined:content);
  }catch{res.writeHead(404,{'Content-Type':'text/plain; charset=utf-8'});res.end('Archivo no encontrado.');}
});
server.on('error',error=>{console.error(error.code==='EADDRINUSE'?`El puerto ${port} está ocupado. Usa npm start -- --port 4178.`:error.message);process.exitCode=1;});
server.listen(port,'127.0.0.1',()=>{
  const url=`http://127.0.0.1:${port}`;
  console.log(`\nPDFLink está listo: ${url}\nSin subidas. Solo acceso desde este ordenador.\nPulsa Ctrl+C para cerrar.\n`);
  if(process.argv.includes('--open')){
    const args=process.platform==='win32'?['cmd.exe',['/c','start','',url]]:process.platform==='darwin'?['open',[url]]:['xdg-open',[url]];
    const child=spawn(args[0],args[1],{detached:true,stdio:'ignore',windowsHide:true});child.on('error',()=>{});child.unref();
  }
});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(()=>process.exit(0)));
