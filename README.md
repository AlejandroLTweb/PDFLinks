# PDFLink

Editor web de PDF en **HTML, CSS y JavaScript**, para utilizarlo en local. Los documentos se leen y procesan en la memoria del navegador: **no se suben a GitHub ni a ningún otro servidor**.

Repositorio: [AlejandroLTweb/PDFLinks](https://github.com/AlejandroLTweb/PDFLinks).

## Abrir PDFLink: solo doble clic

1. En GitHub, pulsa **Code → Download ZIP**.
2. **Extrae la carpeta completa** del ZIP. Conserva juntos todos los archivos.
3. Haz doble clic en **index.html**. Se abrirá PDFLink en tu navegador.

**No necesitas terminal, Node.js, npm, instalación ni conexión a Internet.** Usa Chrome o Edge actualizado. Si Windows abre el HTML con otro programa, elige **Abrir con → Google Chrome / Microsoft Edge**.

El acceso opcional **Abrir_PDFLink.cmd** también abre `index.html` directamente y no requiere Node.js. No abras el HTML desde dentro del ZIP, porque Windows podría extraer solo ese archivo y dejar atrás sus bibliotecas.

Los scripts del visor se incluyen preparados para cargar desde `file://`. El procesamiento usa workers en memoria; si el navegador no permite esos workers, el motor dispone de una alternativa local en la misma pestaña. No se inicia ningún servidor ni programa externo al abrir el HTML.

## Funciones

- **Visualizar** PDF, navegar mediante miniaturas y ajustar el zoom.
- **Unir** varios documentos, cambiar el orden de sus páginas o eliminar páginas.
- **Añadir textos** con varias líneas, tres familias tipográficas, tamaño, color y negrita.
- **Insertar imágenes** PNG, JPG, WEBP o BMP, incluidas firmas con fondo transparente.
- **Dibujar una firma** con ratón, dedo o lápiz digital.
- **Mover y redimensionar** los elementos arrastrándolos y usando su esquina verde. El panel permite ajustar posiciones y tamaños en puntos PDF.
- **Deshacer y rehacer** durante la sesión.
- **Exportar** una copia en PDF con texto seleccionable.
- **Comprimir** imágenes compatibles sin convertir las páginas completas en fotografías.

El botón **Probar con un documento de ejemplo** genera un PDF sin datos personales dentro del navegador.

### Compresión

| Opción | Comportamiento |
| --- | --- |
| Sin pérdida | Reescribe y optimiza la estructura. Mantiene las imágenes originales. |
| Equilibrada | Recompresión JPEG con calidad 80 %; lado máximo de 2200 píxeles para imágenes compatibles. |
| Tamaño reducido | Recompresión JPEG con calidad 56 %; lado máximo de 1280 píxeles para imágenes compatibles. |

Se procesan imágenes JPEG y ciertas imágenes RGB o grises de 8 bits, incluidas algunas imágenes con compresión Flate y predictores PNG/TIFF. Se mantienen las transparencias, máscaras, imágenes monocromas y espacios de color no compatibles. La compresión puede perder detalle en las imágenes; el texto y los vectores se conservan. Si una recompresión aumenta el tamaño, se conserva la alternativa menor.

No se garantiza una reducción concreta: los PDF ya optimizados pueden reducirse poco o nada.

### Atajos

| Atajo | Acción |
| --- | --- |
| Ctrl+O | Abrir PDF |
| Ctrl+S | Exportar PDF |
| Ctrl+Z | Deshacer |
| Ctrl+Y / Ctrl+Mayús+Z | Rehacer |
| Supr | Eliminar el elemento seleccionado |
| Escape | Deseleccionar |
| Flechas / Mayús+flechas | Mover el elemento 1 / 10 puntos |
| Ctrl+rueda | Cambiar el zoom |

## Privacidad

- No hay cuentas, analítica, telemetría, cookies de la aplicación ni servicios externos durante su uso.
- No se usan CDN en tiempo de ejecución: los motores PDF están incluidos localmente.
- No se guardan los documentos ni las firmas en `localStorage`, IndexedDB ni bases de datos.
- Los PDF seleccionados se leen con la API de archivos del navegador, sin servidor de procesamiento.
- El resultado se descarga solo cuando pulsas **Descargar PDF**. El navegador y el sistema operativo pueden aplicar sus propias políticas de descargas, sincronización o memoria virtual.
- La política de contenido bloquea conexiones a orígenes externos.

**GitHub almacena el código del proyecto, no los PDF que abras con él.**

## Alcance y límites

- Se añaden elementos sobre el contenido original; no se modifican sus párrafos ni imágenes. No incluye OCR ni edición de campos de formulario.
- Los añadidos son editables durante la sesión. Al reabrir un PDF exportado se integran en el contenido y no vuelven a reconocerse como elementos separados de PDFLink.
- Las firmas dibujadas son firmas visuales, no firmas electrónicas con certificado. Editar o reescribir un PDF firmado puede invalidar su firma digital.
- Los PDF cifrados requieren una copia autorizada sin contraseña. No se elimina protección de documentos.
- Al unir o reorganizar páginas, pueden perderse marcadores o interactividad de formularios y enlaces internos. Revisa esos elementos cuando sean importantes.
- Las tres fuentes estándar admiten castellano, valenciano y caracteres latinos habituales; algunos alfabetos y emojis no se admiten en los textos nuevos.
- El visor utiliza el motor PDF.js y las fuentes del sistema. No se incluyen los recursos opcionales de CMaps asiáticos ni decodificadores WASM/JPEG2000. Los PDF que dependen de fuentes asiáticas no incrustadas o ciertos formatos de imagen pueden no visualizarse correctamente. Los bytes originales se conservan al exportar las páginas.
- Límite de apertura: 150 MB por PDF. Las imágenes insertadas se limitan a 30 MB y 36 megapíxeles; las muy grandes se reducen a 4000 píxeles de lado máximo al insertarse.
- Los documentos permanecen en memoria mientras la pestaña está abierta. Exporta antes de cerrarla.

## Archivos del proyecto

| Archivo | Responsabilidad |
| --- | --- |
| `index.html` | Interfaz y diálogos accesibles en castellano. |
| `styles.css` | Diseño adaptable, herramientas y editor. |
| `app.js` | Archivos locales, visor, miniaturas, arrastre, firma e interfaz. |
| `geometry.js` | Matrices para páginas giradas/recortadas e historial. |
| `pdf-engine.js` | Unión, exportación vectorial y compresión de imágenes. |
| `pdf-lib.min.js` | Biblioteca PDF-LIB 1.17.1 (MIT). |
| `pdf.min.mjs`, `pdf.worker.min.mjs` | PDF.js 6.5.438 (Apache 2.0). |
| `pdf.viewer.local.js`, `pdf.worker.local.js` | Adaptaciones de PDF.js ya preparadas para apertura directa de archivos. |
| `pdf.local-runtime.js` | Arranque local y workers creados en memoria, sin importar módulos desde disco. |
| `build-local.cjs` | Utilidad de desarrollo para regenerar las adaptaciones incluidas. |
| `serve.mjs` | Servidor estático opcional para desarrollo. No se necesita para usar PDFLink. |
| `engine.test.cjs` | Pruebas automáticas con PDF sintéticos. |
| `local-startup.test.cjs` | Pruebas del arranque sin servidor y del procesamiento en workers locales. |

No utiliza React, Vite, Electron, Python ni un backend de procesamiento. No necesita compilación.

## Comprobaciones

Estas herramientas son **solo para desarrollo**, no para las personas que usan el editor. Requieren Node.js 22.13 o posterior:

```sh
npm test
npm run check
```

Las pruebas comprueban unión y orden de páginas, geometría con giros y recortes, exportación vectorial, transparencias, historial, predictores de imágenes, selección de imágenes comprimibles, rechazo de entradas no válidas y referencias locales de la interfaz. No leen documentos personales. La conversión JPEG del navegador y la interacción visual requieren una comprobación en un navegador real.

También se comprueba que los scripts clásicos cargan un PDF sin módulos, sin `fetch` ni servidor, que varios PDF pueden usar workers independientes y que un PDF no válido libera su worker. No se modifica la seguridad del navegador.

Para regenerar los archivos de distribución después de actualizar los motores originales: `npm run build:local`. Los archivos generados ya están incluidos, por lo que el usuario final no ejecuta ese comando. Como opción de desarrollo, `npm start` conserva el servidor estático en `http://127.0.0.1:4177`.

## Licencias

El código propio del proyecto se ofrece bajo licencia **MIT**. Los motores incluidos conservan sus licencias y avisos de autor. Consulta **THIRD_PARTY_NOTICES.md** y **APACHE-2.0.txt**.
