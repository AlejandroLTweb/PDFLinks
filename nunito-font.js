/* Local TrueType embedding for the two bundled Nunito Sans faces. */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory(require('./pdf-lib.min.js'),require('./nunito-data.js'));
  else root.PDFLinkNunito=factory(root.PDFLib,root.PDFLinkNunitoData);
})(typeof globalThis!=='undefined'?globalThis:this,function(P,data){
  'use strict';
  const bytes=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
  function parse(b){
    const v=new DataView(b.buffer,b.byteOffset,b.byteLength),u16=o=>v.getUint16(o),i16=o=>v.getInt16(o),u32=o=>v.getUint32(o),tables={};
    for(let i=0;i<u16(4);i++){const o=12+i*16;tables[String.fromCharCode(...b.slice(o,o+4))]=u32(o+8);}
    const head=tables.head,hhea=tables.hhea,upm=u16(head+18),count=u16(tables.maxp+4),metrics=u16(hhea+34);
    const widths=Array.from({length:count},(_,i)=>u16(tables.hmtx+Math.min(i,metrics-1)*4)*1000/upm);
    const cmap=new Map(),start=tables.cmap;let sub=null,rank=-1;
    for(let i=0;i<u16(start+2);i++){
      const o=start+4+i*8,platform=u16(o),encoding=u16(o+2),s=start+u32(o+4),format=u16(s);
      const score=(platform===0||platform===3&&(encoding===1||encoding===10))?(format===12?2:format===4?1:-1):-1;
      if(score>rank){sub=s;rank=score;}
    }
    if(rank===2){for(let i=0;i<u32(sub+12);i++){const o=sub+16+i*12,first=u32(o),last=u32(o+4),glyph=u32(o+8);for(let c=first;c<=last;c++)if(glyph+c-first<count)cmap.set(c,glyph+c-first);}}
    else if(rank===1){const n=u16(sub+6)/2,end=sub+14,first=end+2*n+2,delta=first+2*n,range=delta+2*n;
      for(let i=0;i<n;i++)for(let c=u16(first+2*i);c<=u16(end+2*i)&&c<65535;c++){
        const r=u16(range+2*i);let g=r?u16(range+2*i+r+2*(c-u16(first+2*i))):c;
        if(!r||g)g=(g+i16(delta+2*i))&65535;if(g&&g<count)cmap.set(c,g);
      }
    }else throw new Error('La fuente no contiene una tabla Unicode compatible.');
    return {b,cmap,widths,upm,ascent:i16(hhea+4)*1000/upm,descent:i16(hhea+6)*1000/upm,bbox:[36,38,40,42].map(o=>i16(head+o)*1000/upm)};
  }
  const faces={light:parse(bytes(data.light)),bold:parse(bytes(data.bold))};
  const face=o=>faces[o.bold?'bold':'light'];
  function glyphs(f,text){return Array.from(text,c=>{const g=f.cmap.get(c.codePointAt(0));if(g===undefined)throw new Error('Nunito Sans no admite el carácter '+c+'.');return g;});}
  const hex=n=>n.toString(16).padStart(4,'0').toUpperCase();
  const unicode=c=>c<=65535?hex(c):hex(0xD800+((c-65536)>>10))+hex(0xDC00+((c-65536)&1023));
  function measure(o){const f=face(o);return Math.max(0,...o.text.split('\n').map(line=>glyphs(f,line).reduce((sum,g)=>sum+f.widths[g],0)*o.size/1000));}
  function embed(doc,o){
    const f=face(o),ctx=doc.context,fontName=o.bold?'NunitoSans-Bold':'NunitoSans-12ptExtraLight';
    const file=ctx.register(ctx.flateStream(f.b,{Length1:f.b.length}));
    const descriptor=ctx.register(ctx.obj({Type:'FontDescriptor',FontName:fontName,Flags:32,FontBBox:f.bbox,ItalicAngle:0,Ascent:f.ascent,Descent:f.descent,CapHeight:f.ascent,StemV:o.bold?120:60,FontFile2:file}));
    const cid=ctx.register(ctx.obj({Type:'Font',Subtype:'CIDFontType2',BaseFont:fontName,CIDSystemInfo:{Registry:P.PDFString.of('Adobe'),Ordering:P.PDFString.of('Identity'),Supplement:0},FontDescriptor:descriptor,CIDToGIDMap:'Identity',DW:1000,W:[0,f.widths]}));
    const mappings=new Map();for(const [c,g]of f.cmap)if(!mappings.has(g))mappings.set(g,c);
    const pairs=[...mappings].map(([g,c])=>'<'+hex(g)+'> <'+unicode(c)+'>');
    let mapping='/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n';
    for(let i=0;i<pairs.length;i+=100){const group=pairs.slice(i,i+100);mapping+=group.length+' beginbfchar\n'+group.join('\n')+'\nendbfchar\n';}
    mapping+='endcmap\nCMapName currentdict /CMap defineresource pop\nend\nend';
    const toUnicode=ctx.register(ctx.flateStream(mapping));
    const ref=ctx.register(ctx.obj({Type:'Font',Subtype:'Type0',BaseFont:fontName,Encoding:'Identity-H',DescendantFonts:[cid],ToUnicode:toUnicode}));
    const embedder=new P.CustomFontEmbedder({unitsPerEm:1000,postscriptName:fontName,characterSet:[]},f.b);
    Object.assign(embedder,{fontName,encodeText:text=>P.PDFHexString.of(glyphs(f,text).map(hex).join('')),widthOfTextAtSize:(text,size)=>glyphs(f,text).reduce((sum,g)=>sum+f.widths[g],0)*size/1000,heightOfFontAtSize:size=>(f.ascent-f.descent)*size/1000,sizeOfFontAtHeight:height=>height*1000/(f.ascent-f.descent),embedIntoContext:async()=>ref});
    return P.PDFFont.of(ref,doc,embedder);
  }
  async function load(){
    for(const [key,weight]of [['light','200'],['bold','700']]){const font=await new FontFace('PDFLink Nunito Sans',faces[key].b,{weight}).load();document.fonts.add(font);}
  }
  return {measure,embed,load};
});
