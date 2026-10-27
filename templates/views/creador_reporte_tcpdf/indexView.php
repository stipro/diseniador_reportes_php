<?php require_once INCLUDES . 'header.php'; ?>
<main class="app-content app-content--compact d-flex flex-column">
  <div class="d-flex flex-column flex-grow-1 min-h-0" x-data="reportDesignerModule()">
    <?= Flasher::flash(); ?>

    <!-- Encabezado: solo contexto y acciones de archivo -->
    <header class="rd-header">
      <div>
        <span class="rd-eyebrow">Herramientas</span>
        <h1>Diseñador de reportes</h1>
        <p>Diseña reportes para TCPDF con medidas precisas en milímetros.</p>
      </div>
      <div class="rd-header-actions">
        <div class="dropdown">
          <button class="btn btn-outline-secondary btn-sm dropdown-toggle" type="button" data-bs-toggle="dropdown" aria-expanded="false">
            <i class="fa fa-folder-open me-1"></i>Archivo
          </button>
          <ul class="dropdown-menu dropdown-menu-end">
            <li><button class="dropdown-item" type="button" data-rd-action="open"><i class="fa fa-file-import me-2 text-bee"></i>Abrir archivo JSON…</button></li>
            <li><button class="dropdown-item" type="button" data-rd-action="load"><i class="fa fa-clock-rotate-left me-2 text-bee"></i>Cargar guardado del navegador</button></li>
            <li>
              <hr class="dropdown-divider">
            </li>
            <li><button class="dropdown-item" type="button" data-rd-action="export"><i class="fa fa-file-export me-2 text-bee"></i>Exportar como JSON</button></li>
          </ul>
        </div>
        <button class="btn btn-warning btn-sm" type="button" data-rd-action="save" title="Guardar en este navegador (Ctrl S)">
          <i class="fa fa-floppy-disk me-1"></i>Guardar
        </button>
      </div>
    </header>

    <input class="d-none" type="file" accept="application/json,.json" data-rd-open-file>
    <input class="d-none" type="file" accept="image/*" data-rd-image-file>

    <section class="rd-shell" aria-label="Editor de plantilla de reporte">

      <!-- Barra de herramientas del editor -->
      <div class="rd-toolbar" role="toolbar" aria-label="Herramientas del editor">
        <div class="rd-toolbar-title">
          <span class="bee-tool-icon"><i class="fa fa-file-pdf"></i></span>
          <div>
            <div class="rd-toolbar-name">Plantilla de reporte <span class="rd-dirty" data-rd-dirty hidden>● Sin guardar</span></div>
            <div class="rd-toolbar-sub">A4 vertical · 210 × 297 mm</div>
          </div>
        </div>

        <div class="rd-toolbar-group" role="group" aria-label="Historial">
          <button class="rd-icon-btn" type="button" title="Deshacer (Ctrl Z)" aria-label="Deshacer" data-rd-action="undo" disabled><i class="fa fa-rotate-left"></i></button>
          <button class="rd-icon-btn" type="button" title="Rehacer (Ctrl Y)" aria-label="Rehacer" data-rd-action="redo" disabled><i class="fa fa-rotate-right"></i></button>
        </div>

        <div class="rd-toolbar-group" role="group" aria-label="Ayudas visuales">
          <button class="rd-icon-btn" type="button" title="Grilla de 10 mm" aria-label="Mostrar grilla" aria-pressed="true" data-rd-action="toggle-grid"><i class="fa fa-border-all"></i></button>
          <button class="rd-icon-btn" type="button" title="Márgenes de 10 mm" aria-label="Mostrar márgenes" aria-pressed="true" data-rd-action="toggle-margins"><i class="fa fa-vector-square"></i></button>
          <button class="rd-icon-btn" type="button" title="Ajustar a la grilla y alinear con otros elementos" aria-label="Ajustar a la grilla y a otros elementos" aria-pressed="true" data-rd-action="toggle-snap"><i class="fa fa-magnet"></i></button>
        </div>

        <div class="rd-toolbar-group" role="group" aria-label="Zoom">
          <button class="rd-icon-btn" type="button" title="Alejar" aria-label="Alejar" data-rd-action="zoom-out"><i class="fa fa-minus"></i></button>
          <button class="rd-zoom-value" type="button" title="Restablecer al 100 %" data-rd-action="zoom-reset"><span data-rd-zoom-label>100%</span></button>
          <button class="rd-icon-btn" type="button" title="Acercar" aria-label="Acercar" data-rd-action="zoom-in"><i class="fa fa-plus"></i></button>
          <button class="rd-icon-btn" type="button" title="Ajustar al ancho disponible" aria-label="Ajustar al ancho" data-rd-action="zoom-fit"><i class="fa fa-expand"></i></button>
        </div>

        <div class="rd-toolbar-group rd-toolbar-end">
          <button class="btn btn-outline-secondary btn-sm" type="button" data-rd-action="preview"><i class="fa fa-eye me-1"></i><span class="d-none d-md-inline">Vista previa </span>PDF</button>
          <button class="btn btn-warning btn-sm" type="button" data-rd-action="generate"><i class="fa fa-code me-1"></i>Generar TCPDF</button>
        </div>
      </div>

      <div class="rd-workspace">

        <!-- Izquierda: elementos y referencia -->
        <aside class="rd-panel rd-panel-tools" aria-label="Elementos y referencia">
          <div class="rd-block">
            <h2 class="rd-section-title">Agregar elemento</h2>
            <div class="rd-tool-grid">
              <button class="rd-tool" type="button" data-rd-action="add" data-rd-type="text"><i class="fa fa-font"></i>Texto</button>
              <button class="rd-tool" type="button" data-rd-action="add" data-rd-type="line"><i class="fa fa-minus"></i>Línea</button>
              <button class="rd-tool" type="button" data-rd-action="add" data-rd-type="rect"><i class="fa fa-square"></i>Cuadro</button>
              <button class="rd-tool" type="button" data-rd-action="add" data-rd-type="circle"><i class="fa fa-circle"></i>Elipse</button>
              <button class="rd-tool" type="button" data-rd-action="add" data-rd-type="table"><i class="fa fa-table"></i>Tabla</button>
              <button class="rd-tool" type="button" data-rd-action="add" data-rd-type="image"><i class="fa fa-image"></i>Imagen</button>
              <button class="rd-tool" type="button" data-rd-action="add" data-rd-type="qrcode"><i class="fa fa-qrcode"></i>Código QR</button>
            </div>
          </div>

          <div class="rd-block">
            <h2 class="rd-section-title">Imagen de referencia</h2>
            <label class="rd-dropzone">
              <i class="fa fa-cloud-arrow-up"></i>
              <span>Cargar una captura del documento original</span>
              <input class="visually-hidden" type="file" accept="image/*" data-rd-reference>
            </label>
            <div class="rd-range-row"><label for="rdOpacity">Opacidad</label><span data-rd-opacity-label>40%</span></div>
            <input class="form-range" id="rdOpacity" type="range" min="0" max="100" value="40" data-rd-opacity disabled>
            <button class="btn btn-outline-secondary btn-sm w-100 mt-2" type="button" data-rd-action="clear-reference" disabled><i class="fa fa-xmark me-1"></i>Quitar referencia</button>
          </div>

          <div class="rd-block">
            <details class="rd-shortcuts">
              <summary class="rd-section-title mb-0"><i class="fa fa-keyboard me-1"></i>Atajos de teclado</summary>
              <div class="rd-shortcut"><span>Deshacer</span><kbd>Ctrl Z</kbd></div>
              <div class="rd-shortcut"><span>Rehacer</span><kbd>Ctrl Y</kbd></div>
              <div class="rd-shortcut"><span>Duplicar</span><kbd>Ctrl D</kbd></div>
              <div class="rd-shortcut"><span>Guardar</span><kbd>Ctrl S</kbd></div>
              <div class="rd-shortcut"><span>Eliminar</span><kbd>Supr</kbd></div>
              <div class="rd-shortcut"><span>Mover 0,5 mm</span><kbd>← ↑ → ↓</kbd></div>
              <div class="rd-shortcut"><span>Mover 2 mm</span><kbd>Mayús + flechas</kbd></div>
              <div class="rd-shortcut"><span>Deseleccionar</span><kbd>Esc</kbd></div>
            </details>
          </div>

          <div class="rd-block">
            <button class="btn btn-outline-danger btn-sm w-100" type="button" data-rd-action="clear"><i class="fa fa-trash me-1"></i>Limpiar lienzo</button>
          </div>
        </aside>

        <!-- Centro: lienzo -->
        <section class="rd-stage-wrap" aria-label="Lienzo">
          <div class="rd-stage" data-rd-stage>
            <div class="rd-page">
              <svg viewBox="0 0 210 297" class="rd-canvas" role="img" aria-label="Lienzo A4 del reporte" data-rd-canvas></svg>
            </div>
          </div>
          <div class="rd-statusbar">
            <span><i class="fa fa-layer-group me-1"></i><span data-rd-elements-count>0</span> elementos</span>
            <span data-rd-cursor>X — · Y — mm</span>
            <span data-rd-scale-label>1 mm = 3 px</span>
            <span data-rd-status role="status" aria-live="polite">Listo</span>
          </div>
        </section>

        <!-- Derecha: capas y propiedades -->
        <aside class="rd-panel rd-panel-inspector" aria-label="Capas y propiedades">
          <section class="rd-layers-section">
            <h2 class="rd-section-title">Capas <span class="badge bg-bee-soft text-dark" data-rd-elements-count>0</span></h2>
            <div class="rd-layers-list" data-rd-layers></div>
          </section>
          <section class="rd-props-section">
            <div data-rd-properties>
              <div class="rd-empty"><i class="fa fa-arrow-pointer"></i>Selecciona un elemento para editarlo.</div>
            </div>
          </section>
        </aside>
      </div>
    </section>

    <p class="rd-footnote"><i class="fa fa-circle-info me-1"></i>«Guardar» almacena el diseño en este navegador. Usa <strong>Archivo → Exportar como JSON</strong> para llevarlo a otro equipo.</p>

    <div class="modal fade" tabindex="-1" aria-hidden="true" data-rd-code-modal>
      <div class="modal-dialog modal-xl modal-dialog-centered modal-dialog-scrollable">
        <div class="modal-content">
          <div class="modal-header">
            <h2 class="modal-title h5">Código TCPDF generado</h2><button class="btn-close" type="button" aria-label="Cerrar" data-bs-dismiss="modal"></button>
          </div>
          <div class="modal-body">
            <p class="small text-secondary">Revisa los campos dinámicos y el código de las tablas antes de incorporarlo a tu clase TCPDF. Los tamaños de fuente ya están convertidos a puntos.</p>
            <textarea class="form-control font-monospace rd-code" rows="18" readonly spellcheck="false" data-rd-code></textarea>
          </div>
          <div class="modal-footer"><button class="btn btn-outline-secondary" type="button" data-bs-dismiss="modal">Cerrar</button><button class="btn btn-warning" type="button" data-rd-action="copy-code"><i class="fa fa-copy me-1"></i>Copiar código</button></div>
        </div>
      </div>
    </div>
  </div>
</main>

<?php require_once INCLUDES . 'scripts.php'; ?>
</body>

</html>
