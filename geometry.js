/* PDFLink — geometry and undo state; no browser or network dependencies. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PDFLinkGeometry = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const uid = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const clone = value => structuredClone(value);
  function multiply(a, b) {
    return [a[0]*b[0]+a[2]*b[1], a[1]*b[0]+a[3]*b[1],
      a[0]*b[2]+a[2]*b[3], a[1]*b[2]+a[3]*b[3],
      a[0]*b[4]+a[2]*b[5]+a[4], a[1]*b[4]+a[3]*b[5]+a[5]];
  }
  function inverse(m) {
    const det = m[0]*m[3]-m[1]*m[2];
    if (!Number.isFinite(det) || Math.abs(det)<1e-12) throw new Error('Transformación de página no válida.');
    return [m[3]/det,-m[1]/det,-m[2]/det,m[0]/det,
      (m[2]*m[5]-m[3]*m[4])/det,(m[1]*m[4]-m[0]*m[5])/det];
  }
  const point = (m,x,y) => [m[0]*x+m[2]*y+m[4],m[1]*x+m[3]*y+m[5]];
  const clamp = (value,min,max) => Math.max(min,Math.min(value,Math.max(min,max)));
  function placement(page, object) {
    return multiply(inverse(page.transform),[1,0,0,-1,object.x,object.y+object.height]);
  }
  function fitObject(object, page) {
    const factor = Math.min(1,page.width/Math.max(1,object.width),page.height/Math.max(1,object.height));
    object.width *= factor; object.height *= factor;
    if (object.kind==='text') object.size *= factor;
    object.x=clamp(object.x,0,page.width-object.width);
    object.y=clamp(object.y,0,page.height-object.height);
    return object;
  }
  class History {
    constructor() { this.undoStack=[]; this.redoStack=[]; this.counter=0; this.state=0; this.saved=0; }
    checkpoint(pages) {
      this.undoStack.push({pages:clone(pages),state:this.state});
      if (this.undoStack.length>35) this.undoStack.shift();
      this.redoStack=[]; this.state=++this.counter;
    }
    undo(pages) {
      if (!this.undoStack.length) return null;
      this.redoStack.push({pages:clone(pages),state:this.state});
      const entry=this.undoStack.pop(); this.state=entry.state; return entry.pages;
    }
    redo(pages) {
      if (!this.redoStack.length) return null;
      this.undoStack.push({pages:clone(pages),state:this.state});
      const entry=this.redoStack.pop(); this.state=entry.state; return entry.pages;
    }
    markSaved() { this.saved=this.state; }
    get dirty() { return this.state!==this.saved; }
  }
  return {uid,clone,multiply,inverse,point,placement,clamp,fitObject,History};
});
