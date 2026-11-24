# Bibliotecas incluidas

## PDF-LIB 1.17.1

Fuente: https://github.com/Hopding/pdf-lib y https://www.npmjs.com/package/pdf-lib/v/1.17.1.

Archivo distribuido: `pdf-lib.min.js`. Se utiliza para leer, unir y generar documentos PDF. Licencia MIT; los avisos del código original se conservan en el archivo distribuido. Texto de licencia:

MIT License

Copyright (c) 2019 Andrew Dillon

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

## PDF.js 6.5.438

Fuente: https://github.com/mozilla/pdf.js/releases/tag/v6.5.438.

Archivos distribuidos: `pdf.min.mjs` y `pdf.worker.min.mjs`. Copyright Mozilla Foundation y colaboradores, con los años y avisos indicados en cada archivo. Licencia Apache 2.0, cuyo texto completo se incluye en `APACHE-2.0.txt`.

Las adaptaciones `pdf.viewer.local.js` y `pdf.worker.local.js` se generan con `build-local.cjs` a partir de esos archivos: se envuelven como scripts clásicos, se sustituyen referencias de URL de módulo no usadas en el modo local y se exponen sus interfaces sin un `export` ESM. Conservan todos los avisos de autor y licencia originales. `pdf.local-runtime.js` aporta el arranque local y la creación de workers en memoria.

Los archivos se distribuyen localmente. Los enlaces anteriores son referencias de procedencia y licencia; la aplicación no los consulta durante el uso.
