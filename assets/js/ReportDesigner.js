/**
 * ReportDesigner
 * Mantiene el estado y las interacciones del diseñador TCPDF.
 * Alpine solo crea y destruye esta instancia desde reportDesignerModule.
 */
class ReportDesigner {
  static STORAGE_KEY = "bee.reportDesigner.design.v1";
  static PAGE = { width: 210, height: 297, margin: 10 };
  static PX_PER_MM = 3; // escala del lienzo al 100 % de zoom
  static MM_TO_PT = 2.8346; // TCPDF usa puntos para las fuentes
  static ELEMENT_NAMES = {
    text: "Texto",
    line: "Línea",
    rect: "Cuadro",
    circle: "Elipse",
    table: "Tabla",
    image: "Imagen",
    qrcode: "Código QR",
  };
  static ELEMENT_ICONS = {
    text: "fa-font",
    line: "fa-minus",
    rect: "fa-square",
    circle: "fa-circle",
    table: "fa-table",
    image: "fa-image",
    qrcode: "fa-qrcode",
  };

  constructor({ root }) {
    this.root = root;
    this.canvas = root.querySelector("[data-rd-canvas]");
    this.stage = root.querySelector("[data-rd-stage]");
    this.layers = root.querySelector("[data-rd-layers]");
    this.properties = root.querySelector("[data-rd-properties]");
    this.elements = this.demoElements();
    this.selectedId = "title";
    this.zoom = 100;
    this.showGrid = true;
    this.showMargins = true;
    this.snapToGuides = true;
    this.reference = null;
    this.referenceOpacity = 0.4;
    this.history = [];
    this.historyIndex = -1;
    this.drag = null;
    this.dirty = false;
    this.nextId = 1;
    this.dom = {};
    this.rendered = { grid: null, margins: null, reference: undefined };
    this.measureCtx = null;
    this.onClick = this.handleClick.bind(this);
    this.onInput = this.handleInput.bind(this);
    this.onChange = this.handleChange.bind(this);
    this.onPointerDown = this.handlePointerDown.bind(this);
    this.onPointerMove = this.handlePointerMove.bind(this);
    this.onPointerUp = this.handlePointerUp.bind(this);
    this.onKeyDown = this.handleKeyDown.bind(this);
    this.onBeforeUnload = this.handleBeforeUnload.bind(this);
  }

  init() {
    this.buildCanvas();
    this.root.addEventListener("click", this.onClick);
    this.root.addEventListener("input", this.onInput);
    this.root.addEventListener("change", this.onChange);
    this.canvas.addEventListener("pointerdown", this.onPointerDown);
    window.addEventListener("pointermove", this.onPointerMove);
    window.addEventListener("pointerup", this.onPointerUp);
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("beforeunload", this.onBeforeUnload);
    this.pushHistory();
    this.render();
    this.setZoom(100);
    // En pantallas angostas el A4 al 100 % no cabe: se ajusta al ancho disponible.
    if (this.stage && this.stage.clientWidth && this.stage.clientWidth < this.pagePixelWidth(100) + 60) this.fitZoom();
  }

  destroy() {
    this.root.removeEventListener("click", this.onClick);
    this.root.removeEventListener("input", this.onInput);
    this.root.removeEventListener("change", this.onChange);
    this.canvas.removeEventListener("pointerdown", this.onPointerDown);
    window.removeEventListener("pointermove", this.onPointerMove);
    window.removeEventListener("pointerup", this.onPointerUp);
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("beforeunload", this.onBeforeUnload);
  }

  get selected() {
    return this.elements.find((element) => element.id === this.selectedId) || null;
  }

  demoElements() {
    return [
      { id: "title", type: "text", label: "Título del reporte", text: "DECLARACIÓN JURADA DE PROCEDENCIA DE MINERAL", binding: "", x: 13, y: 21, w: 184, h: 9, fontSize: 4.2, color: "#191a1d", align: "C", bold: true, visible: true, locked: false },
      { id: "date", type: "text", label: "Fecha", text: "Lima, {{fecha_emision}}", binding: "fecha_emision", x: 120, y: 33, w: 76, h: 6, fontSize: 3, color: "#3d3f45", align: "R", bold: false, visible: true, locked: false },
      { id: "intro", type: "text", label: "Texto de declaración", text: "Yo, {{declarante.nombre}}, identificado con DNI {{declarante.dni}}, declaro bajo juramento que:", binding: "", x: 15, y: 48, w: 180, h: 7, fontSize: 3.2, color: "#3d3f45", align: "L", bold: false, visible: true, locked: false },
      { id: "detail", type: "table", label: "Detalle de lote", x: 15, y: 70, w: 180, h: 18, fontSize: 2.7, color: "#191a1d", visible: true, locked: false },
      { id: "signature", type: "line", label: "Línea de firma", x: 30, y: 245, w: 60, h: 0, color: "#191a1d", visible: true, locked: false },
      { id: "fingerprint", type: "rect", label: "Recuadro de huella", x: 145, y: 225, w: 35, h: 35, color: "#73757d", fill: "transparent", visible: true, locked: false },
      { id: "qr", type: "qrcode", label: "Código QR", x: 165, y: 15, w: 18, h: 18, color: "#191a1d", visible: true, locked: true },
    ];
  }

  /* ------------------------------------------------------------------ */
  /* Eventos                                                             */
  /* ------------------------------------------------------------------ */

  handleClick(event) {
    const actionButton = event.target.closest("[data-rd-action]");
    if (actionButton && this.root.contains(actionButton)) {
      const action = actionButton.dataset.rdAction;
      const type = actionButton.dataset.rdType;
      if (action === "add") this.addElement(type);
      if (action === "undo") this.undo();
      if (action === "redo") this.redo();
      if (action === "zoom-in") this.setZoom(this.zoom + 10);
      if (action === "zoom-out") this.setZoom(this.zoom - 10);
      if (action === "zoom-reset") this.setZoom(100);
      if (action === "zoom-fit") this.fitZoom();
      if (action === "save") this.saveDesign();
      if (action === "export") this.exportDesign();
      if (action === "open") this.root.querySelector("[data-rd-open-file]").click();
      if (action === "load") this.loadDesign();
      if (action === "clear") this.clearAll();
      if (action === "clear-reference") this.clearReference();
      if (action === "clear-fill") this.updateSelected({ fill: "transparent" }, "Relleno quitado");
      if (action === "layer-up") this.moveLayer("up");
      if (action === "layer-down") this.moveLayer("down");
      if (action === "duplicate") this.duplicateSelected();
      if (action === "delete") this.deleteSelected();
      if (action === "preview") this.previewPDF();
      if (action === "generate") this.showCode();
      if (action === "copy-code") this.copyCode();
      if (action === "close-code") this.closeCode();
      if (action === "toggle-grid") this.toggleFlag(actionButton, "showGrid");
      if (action === "toggle-margins") this.toggleFlag(actionButton, "showMargins");
      if (action === "toggle-snap") this.toggleFlag(actionButton, "snapToGuides");
      return;
    }

    const visibilityButton = event.target.closest("[data-rd-visibility]");
    if (visibilityButton) {
      const element = this.byId(visibilityButton.dataset.rdVisibility);
      if (element) {
        element.visible = element.visible === false;
        this.commit("Visibilidad actualizada");
      }
      return;
    }

    const lockButton = event.target.closest("[data-rd-lock]");
    if (lockButton) {
      const element = this.byId(lockButton.dataset.rdLock);
      if (element) {
        element.locked = !element.locked;
        this.commit(element.locked ? "Capa bloqueada" : "Capa desbloqueada");
      }
      return;
    }

    const layer = event.target.closest("[data-rd-select]");
    if (layer) {
      this.selectedId = layer.dataset.rdSelect;
      this.render();
    }
  }

  toggleFlag(button, property) {
    const next = button.getAttribute("aria-pressed") !== "true";
    this[property] = next;
    button.setAttribute("aria-pressed", String(next));
    this.renderCanvas();
  }

  handleInput(event) {
    if (event.target.matches("[data-rd-opacity]")) {
      this.setReferenceOpacity(Number(event.target.value) / 100);
      return;
    }
    const input = event.target.closest("[data-rd-property]");
    if (!input || !this.selected) return;
    if (input.type === "number" && input.value === "") return; // no pisar el valor mientras se borra para reescribir
    const key = input.dataset.rdProperty;
    const value = input.type === "checkbox" ? input.checked : input.type === "number" ? Number(input.value) : input.value;
    this.selected[key] = value;
    this.renderCanvas();
    this.renderLayers();
    this.setStatus("Editando elemento…");
  }

  handleChange(event) {
    if (event.target.matches("[data-rd-reference]") && event.target.files?.[0]) {
      this.loadReference(event.target.files[0]);
      event.target.value = "";
      return;
    }
    if (event.target.matches("[data-rd-image-file]") && event.target.files?.[0]) {
      this.loadImageElement(event.target.files[0]);
      event.target.value = "";
      return;
    }
    if (event.target.matches("[data-rd-open-file]") && event.target.files?.[0]) {
      this.openDesignFile(event.target.files[0]);
      event.target.value = "";
      return;
    }
    if (event.target.matches("[data-rd-opacity]")) {
      this.setReferenceOpacity(Number(event.target.value) / 100);
      this.setDirty(true);
      return;
    }
    if (event.target.matches("[data-rd-property]")) {
      // No se vuelve a pintar el panel de propiedades: así el foco no se pierde al pasar con Tab entre campos.
      this.pushHistory();
      this.renderCanvas();
      this.renderLayers();
      this.setStatus("Cambios aplicados");
    }
  }

  handlePointerDown(event) {
    if (event.button !== 0) return;
    const target = event.target.closest("[data-rd-element]");
    if (!target) {
      // Clic en el papel vacío: quitar la selección.
      if (this.selectedId) {
        this.selectedId = null;
        this.render();
      }
      return;
    }
    const element = this.byId(target.dataset.rdElement);
    if (!element) return;
    this.selectedId = element.id;
    if (element.locked) {
      this.render();
      this.setStatus("Capa bloqueada: desbloquéala en «Capas» para moverla");
      return;
    }
    event.preventDefault();
    const point = this.svgPoint(event);
    if (!point) return;
    const resize = event.target.closest("[data-rd-resize]")?.dataset.rdResize || null;
    this.drag = {
      id: element.id,
      mode: resize ? "resize" : "move",
      edge: resize,
      point,
      x: element.x,
      y: element.y,
      w: element.w,
      h: element.h,
      changed: false,
    };
    this.render();
  }

  handlePointerMove(event) {
    if (this.drag || this.canvas.contains(event.target)) this.updateCursor(event);
    if (!this.drag) return;
    const element = this.byId(this.drag.id);
    const point = this.svgPoint(event);
    if (!element || !point) return;
    const page = ReportDesigner.PAGE;
    const dx = point.x - this.drag.point.x;
    const dy = point.y - this.drag.point.y;
    if (this.drag.mode === "move") {
      element.x = this.round(Math.max(0, Math.min(page.width - element.w, this.drag.x + dx)));
      element.y = this.round(Math.max(0, Math.min(page.height - element.h, this.drag.y + dy)));
      if (this.snapToGuides) {
        element.x = this.snap(element.x);
        element.y = this.snap(element.y);
      }
    } else {
      let width = this.drag.w + dx;
      let height = this.drag.h + dy;
      if (this.snapToGuides) {
        width = this.snap(element.x + width) - element.x;
        height = this.snap(element.y + height) - element.y;
      }
      element.w = this.round(Math.max(2, Math.min(page.width - element.x, width)));
      // Una línea solo se estira en horizontal; su "alto" es el desnivel y no debe cambiar al redimensionar.
      if (element.type !== "line") element.h = this.round(Math.max(2, Math.min(page.height - element.y, height)));
    }
    this.drag.changed = true;
    this.renderCanvas();
    this.renderLayers();
    this.renderProperties();
  }

  handlePointerUp() {
    if (!this.drag) return;
    const changed = this.drag.changed;
    this.drag = null;
    if (changed) {
      this.pushHistory();
      this.setStatus("Diseño modificado");
    }
  }

  handleKeyDown(event) {
    const key = event.key.toLowerCase();
    const mod = event.ctrlKey || event.metaKey;
    if (mod && key === "s") {
      event.preventDefault();
      this.saveDesign();
      return;
    }
    if (document.querySelector(".modal.show")) return;
    if (event.target.closest?.("input, textarea, select, [contenteditable='true']")) return;

    if (mod && key === "z") {
      event.preventDefault();
      if (event.shiftKey) this.redo();
      else this.undo();
    } else if (mod && key === "y") {
      event.preventDefault();
      this.redo();
    } else if (mod && key === "d") {
      event.preventDefault();
      this.duplicateSelected();
    } else if (event.key === "Delete" || event.key === "Backspace") {
      if (this.selected) event.preventDefault();
      this.deleteSelected();
    } else if (event.key === "Escape") {
      this.selectedId = null;
      this.render();
    } else if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key) && this.selected) {
      event.preventDefault();
      if (this.selected.locked) return this.setStatus("Capa bloqueada: desbloquéala para moverla");
      const page = ReportDesigner.PAGE;
      const amount = event.shiftKey ? 2 : 0.5;
      if (event.key === "ArrowUp") this.selected.y -= amount;
      if (event.key === "ArrowDown") this.selected.y += amount;
      if (event.key === "ArrowLeft") this.selected.x -= amount;
      if (event.key === "ArrowRight") this.selected.x += amount;
      this.selected.x = this.round(Math.max(0, Math.min(page.width - this.selected.w, this.selected.x)));
      this.selected.y = this.round(Math.max(0, Math.min(page.height - this.selected.h, this.selected.y)));
      this.commit("Elemento movido");
    }
  }

  handleBeforeUnload(event) {
    if (!this.dirty) return;
    event.preventDefault();
    event.returnValue = "";
  }

  svgPoint(event) {
    const matrix = this.canvas.getScreenCTM();
    if (!matrix) return null;
    const point = this.canvas.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    return point.matrixTransform(matrix.inverse());
  }

  updateCursor(event) {
    const label = this.root.querySelector("[data-rd-cursor]");
    if (!label) return;
    const point = this.svgPoint(event);
    const page = ReportDesigner.PAGE;
    const inside = point && point.x >= 0 && point.y >= 0 && point.x <= page.width && point.y <= page.height;
    label.textContent = inside ? `X ${point.x.toFixed(1)} · Y ${point.y.toFixed(1)} mm` : "X — · Y — mm";
  }

  /* ------------------------------------------------------------------ */
  /* Elementos                                                           */
  /* ------------------------------------------------------------------ */

  addElement(type) {
    if (!ReportDesigner.ELEMENT_NAMES[type]) return;
    if (type === "image") {
      this.root.querySelector("[data-rd-image-file]").click();
      return;
    }
    const element = this.defaultElement(type);
    this.elements.push(element);
    this.selectedId = element.id;
    this.commit(`${ReportDesigner.ELEMENT_NAMES[type]} agregado`);
  }

  loadImageElement(file) {
    const reader = new FileReader();
    reader.onload = () => {
      const element = this.defaultElement("image");
      element.srcData = String(reader.result);
      element.label = file.name || "Imagen";
      this.elements.push(element);
      this.selectedId = element.id;
      this.commit("Imagen agregada");
    };
    reader.readAsDataURL(file);
  }

  defaultElement(type) {
    const id = `element-${this.nextId++}`;
    const sizes = {
      text: [80, 8],
      line: [50, 0],
      rect: [50, 25],
      circle: [40, 25],
      table: [170, 18],
      image: [40, 40],
      qrcode: [22, 22],
    };
    const [w, h] = sizes[type] || [40, 12];
    return {
      id, type, label: `${ReportDesigner.ELEMENT_NAMES[type]} ${this.nextId - 1}`,
      text: type === "text" ? "Nuevo texto" : "", binding: "",
      x: type === "table" ? 20 : 20, y: 30 + (this.elements.length % 8) * 8, w, h,
      fontSize: 3.5, color: "#191a1d",
      fill: "transparent", align: "L", bold: false, visible: true, locked: false,
    };
  }

  updateSelected(changes, message) {
    if (!this.selected) return;
    Object.assign(this.selected, changes);
    this.commit(message);
  }

  deleteSelected() {
    if (!this.selected) return;
    if (this.selected.locked) return this.setStatus("Desbloquea la capa para poder eliminarla");
    const index = this.elements.findIndex((element) => element.id === this.selectedId);
    this.elements = this.elements.filter((element) => element.id !== this.selectedId);
    this.selectedId = this.elements[Math.min(index, this.elements.length - 1)]?.id || null;
    this.commit("Elemento eliminado");
  }

  duplicateSelected() {
    if (!this.selected) return;
    const clone = { ...this.selected, id: `element-${this.nextId++}`, label: `${this.selected.label || "Elemento"} copia`, x: this.round(this.selected.x + 4), y: this.round(this.selected.y + 4), locked: false };
    this.elements.push(clone);
    this.selectedId = clone.id;
    this.commit("Elemento duplicado");
  }

  /** Mueve la capa seleccionada: "up" la acerca al frente, "down" la envía atrás. */
  moveLayer(direction) {
    const index = this.elements.findIndex((element) => element.id === this.selectedId);
    const target = direction === "up" ? index + 1 : index - 1;
    if (index < 0 || target < 0 || target >= this.elements.length) return;
    [this.elements[index], this.elements[target]] = [this.elements[target], this.elements[index]];
    this.commit("Orden de capas actualizado");
  }

  clearAll() {
    if (!this.elements.length) return;
    this.confirmAction({ title: "¿Limpiar el diseño?", text: "Se quitarán todos los elementos del lienzo.", confirmText: "Limpiar" }).then((ok) => {
      if (!ok) return;
      this.elements = [];
      this.selectedId = null;
      this.commit("Lienzo limpiado");
    });
  }

  /* ------------------------------------------------------------------ */
  /* Zoom y referencia                                                   */
  /* ------------------------------------------------------------------ */

  pagePixelWidth(zoom = this.zoom) {
    return ReportDesigner.PAGE.width * ReportDesigner.PX_PER_MM * (zoom / 100);
  }

  setZoom(value) {
    this.zoom = Math.round(Math.max(30, Math.min(200, value)));
    this.canvas.style.width = `${this.pagePixelWidth()}px`;
    const label = this.root.querySelector("[data-rd-zoom-label]");
    if (label) label.textContent = `${this.zoom}%`;
    const scale = this.root.querySelector("[data-rd-scale-label]");
    if (scale) scale.textContent = `1 mm = ${(ReportDesigner.PX_PER_MM * this.zoom / 100).toFixed(1).replace(/\.0$/, "")} px`;
  }

  fitZoom() {
    if (!this.stage || !this.stage.clientWidth) return;
    const style = getComputedStyle(this.stage);
    const padding = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
    const available = this.stage.clientWidth - padding;
    this.setZoom(Math.floor((available / this.pagePixelWidth(100)) * 100));
  }

  loadReference(file) {
    const reader = new FileReader();
    reader.onload = () => {
      this.reference = String(reader.result);
      this.renderCanvas();
      this.syncReferenceControls();
      this.setDirty(true);
      this.setStatus("Referencia cargada");
    };
    reader.readAsDataURL(file);
  }

  clearReference() {
    if (!this.reference) return;
    this.reference = null;
    this.renderCanvas();
    this.syncReferenceControls();
    this.setDirty(true);
    this.setStatus("Referencia quitada");
  }

  setReferenceOpacity(value) {
    this.referenceOpacity = Math.max(0, Math.min(1, value));
    this.syncReferenceControls();
    this.renderCanvas();
  }

  syncReferenceControls() {
    const percent = Math.round(this.referenceOpacity * 100);
    const slider = this.root.querySelector("[data-rd-opacity]");
    const label = this.root.querySelector("[data-rd-opacity-label]");
    const clear = this.root.querySelector('[data-rd-action="clear-reference"]');
    if (slider) {
      slider.value = String(percent);
      slider.disabled = !this.reference;
    }
    if (label) label.textContent = `${percent}%`;
    if (clear) clear.disabled = !this.reference;
  }

  /* ------------------------------------------------------------------ */
  /* Guardado y carga                                                    */
  /* ------------------------------------------------------------------ */

  serialize() {
    const page = ReportDesigner.PAGE;
    return { version: 1, page: { width: page.width, height: page.height }, elements: this.elements, reference: this.reference, referenceOpacity: this.referenceOpacity };
  }

  /** Guarda en el navegador (localStorage). */
  saveDesign() {
    try {
      localStorage.setItem(ReportDesigner.STORAGE_KEY, JSON.stringify(this.serialize()));
      this.setDirty(false);
      this.setStatus("Diseño guardado");
      this.notify("Diseño guardado en este navegador.", "success");
    } catch (error) {
      console.error(error);
      this.notify("No se pudo guardar en el navegador (¿imagen muy pesada?). Usa Archivo → Exportar como JSON.", "error");
    }
  }

  /** Descarga el diseño como archivo JSON. */
  exportDesign() {
    const blob = new Blob([JSON.stringify(this.serialize(), null, 2)], { type: "application/json" });
    this.download(blob, "diseno-reporte.json");
    this.setStatus("Diseño exportado");
    this.notify("Archivo JSON descargado.", "success");
  }

  loadDesign() {
    const stored = localStorage.getItem(ReportDesigner.STORAGE_KEY);
    if (!stored) return this.notify("No hay un diseño guardado en este navegador.", "warning");
    this.confirmDiscard().then((ok) => {
      if (!ok) return;
      try { this.applyDesign(JSON.parse(stored)); this.notify("Diseño cargado.", "success"); }
      catch (error) { console.error(error); this.notify("El diseño guardado no es válido.", "error"); }
    });
  }

  openDesignFile(file) {
    this.confirmDiscard().then((ok) => {
      if (!ok) return;
      const reader = new FileReader();
      reader.onload = () => {
        try { this.applyDesign(JSON.parse(String(reader.result))); this.notify("Archivo de diseño cargado.", "success"); }
        catch (error) { console.error(error); this.notify("No se pudo leer el archivo de diseño.", "error"); }
      };
      reader.readAsText(file);
    });
  }

  confirmDiscard() {
    if (!this.dirty) return Promise.resolve(true);
    return this.confirmAction({ title: "Hay cambios sin guardar", text: "Si continúas, se perderán los cambios del diseño actual.", confirmText: "Continuar" });
  }

  applyDesign(data) {
    if (!data || !Array.isArray(data.elements)) throw new Error("Formato de diseño inválido");
    const known = ReportDesigner.ELEMENT_NAMES;
    this.elements = data.elements
      .filter((element) => element && known[element.type])
      .map((element) => ({ ...element }));
    // Asegura ids únicos y evita choques con los que se generen después.
    const used = new Set();
    let maxId = 0;
    this.elements.forEach((element) => {
      const match = /^element-(\d+)$/.exec(element.id || "");
      if (match) maxId = Math.max(maxId, Number(match[1]));
    });
    this.nextId = Math.max(this.nextId, maxId + 1);
    this.elements.forEach((element) => {
      if (!element.id || used.has(element.id)) element.id = `element-${this.nextId++}`;
      used.add(element.id);
    });
    this.reference = data.reference || null;
    this.referenceOpacity = Number(data.referenceOpacity ?? 0.4);
    this.selectedId = this.elements[0]?.id || null;
    this.history = [];
    this.historyIndex = -1;
    this.pushHistory();
    this.render();
    this.setDirty(false);
    this.setStatus("Diseño cargado");
  }

  /* ------------------------------------------------------------------ */
  /* Historial                                                           */
  /* ------------------------------------------------------------------ */

  undo() {
    if (this.historyIndex <= 0) return;
    this.historyIndex -= 1;
    this.restoreHistory();
  }

  redo() {
    if (this.historyIndex >= this.history.length - 1) return;
    this.historyIndex += 1;
    this.restoreHistory();
  }

  pushHistory() {
    const snapshot = JSON.stringify({ elements: this.elements, selectedId: this.selectedId });
    if (this.history[this.historyIndex] === snapshot) return;
    const isFirst = this.historyIndex === -1;
    this.history = this.history.slice(0, this.historyIndex + 1);
    this.history.push(snapshot);
    if (this.history.length > 60) this.history.shift();
    this.historyIndex = this.history.length - 1;
    if (!isFirst) this.setDirty(true);
    this.updateHistoryButtons();
  }

  restoreHistory() {
    const snapshot = JSON.parse(this.history[this.historyIndex]);
    this.elements = snapshot.elements;
    this.selectedId = snapshot.selectedId;
    this.setDirty(true);
    this.render();
    this.updateHistoryButtons();
    this.setStatus("Historial restaurado");
  }

  updateHistoryButtons() {
    this.root.querySelectorAll('[data-rd-action="undo"]').forEach((button) => { button.disabled = this.historyIndex <= 0; });
    this.root.querySelectorAll('[data-rd-action="redo"]').forEach((button) => { button.disabled = this.historyIndex >= this.history.length - 1; });
  }

  /* ------------------------------------------------------------------ */
  /* Render                                                              */
  /* ------------------------------------------------------------------ */

  render() {
    this.renderCanvas();
    this.renderLayers();
    this.renderProperties();
    this.syncReferenceControls();
    this.root.querySelectorAll("[data-rd-elements-count]").forEach((count) => {
      count.textContent = String(this.elements.length);
    });
  }

  /** Crea una sola vez las capas fijas del lienzo (papel, grilla, referencia, márgenes, contenido). */
  buildCanvas() {
    const { width, height } = ReportDesigner.PAGE;
    this.canvas.innerHTML = `<rect width="${width}" height="${height}" fill="#fff"/><g data-rd-grid pointer-events="none"></g><image data-rd-ref x="0" y="0" width="${width}" height="${height}" preserveAspectRatio="none" pointer-events="none" display="none"></image><g data-rd-margins pointer-events="none"></g><g data-rd-content></g>`;
    this.dom = {
      grid: this.canvas.querySelector("[data-rd-grid]"),
      reference: this.canvas.querySelector("[data-rd-ref]"),
      margins: this.canvas.querySelector("[data-rd-margins]"),
      content: this.canvas.querySelector("[data-rd-content]"),
    };
  }

  renderCanvas() {
    if (!this.dom.content) return;
    // La grilla, los márgenes y la imagen de referencia solo se repintan cuando cambian:
    // así arrastrar un elemento no vuelve a procesar una imagen de referencia pesada.
    if (this.rendered.grid !== this.showGrid) {
      this.dom.grid.innerHTML = this.showGrid ? this.gridMarkup() : "";
      this.rendered.grid = this.showGrid;
    }
    if (this.rendered.margins !== this.showMargins) {
      this.dom.margins.innerHTML = this.showMargins ? this.marginMarkup() : "";
      this.rendered.margins = this.showMargins;
    }
    const ref = this.dom.reference;
    if (this.rendered.reference !== this.reference) {
      if (this.reference) {
        ref.setAttribute("href", this.reference);
        ref.removeAttribute("display");
      } else {
        ref.removeAttribute("href");
        ref.setAttribute("display", "none");
      }
      this.rendered.reference = this.reference;
    }
    ref.setAttribute("opacity", String(this.referenceOpacity));

    const visible = this.elements.filter((element) => element.visible !== false).map((element) => this.elementMarkup(element)).join("");
    const empty = this.elements.length ? "" : `<g pointer-events="none" text-anchor="middle" font-family="Arial,sans-serif" fill="#73757d"><text x="105" y="145" font-size="4.5" font-weight="700">Lienzo vacío</text><text x="105" y="152" font-size="3">Agrega un elemento desde el panel izquierdo</text></g>`;
    this.dom.content.innerHTML = visible + empty;
  }

  gridMarkup() {
    const { width, height } = ReportDesigner.PAGE;
    let lines = "";
    for (let x = 0; x <= width; x += 10) lines += `<line x1="${x}" y1="0" x2="${x}" y2="${height}" stroke="${x % 50 === 0 ? "#dcd8cb" : "#eeece4"}" stroke-width="${x % 50 === 0 ? ".2" : ".12"}"/>`;
    for (let y = 0; y <= height; y += 10) lines += `<line x1="0" y1="${y}" x2="${width}" y2="${y}" stroke="${y % 50 === 0 ? "#dcd8cb" : "#eeece4"}" stroke-width="${y % 50 === 0 ? ".2" : ".12"}"/>`;
    return lines;
  }

  marginMarkup() {
    const { width, height, margin } = ReportDesigner.PAGE;
    return `<rect x="${margin}" y="${margin}" width="${width - margin * 2}" height="${height - margin * 2}" fill="none" stroke="#d99b00" stroke-width=".2" stroke-dasharray="1.5 1.5" opacity=".75"/>`;
  }

  elementMarkup(element) {
    const id = this.escapeAttr(element.id);
    const color = this.escapeAttr(element.color || "#191a1d");
    const selected = this.selectedId === element.id;
    const x = Number(element.x) || 0;
    const y = Number(element.y) || 0;
    const w = Number(element.w) || 0;
    const h = Number(element.h) || 0;
    const isLine = element.type === "line";
    // Caja que ocupa el elemento (una línea puede tener desnivel negativo).
    const box = { x, y: isLine ? Math.min(y, y + h) : y, w: Math.max(w, 1), h: isLine ? Math.abs(h) : Math.max(h, 1) };
    let shape = "";
    let overflow = false;

    if (element.type === "text") {
      const size = Number(element.fontSize) || 3;
      const align = element.align === "C" ? "middle" : element.align === "R" ? "end" : "start";
      const tx = element.align === "C" ? x + w / 2 : element.align === "R" ? x + w : x;
      const lines = this.textLines(element);
      overflow = lines.length * size * 1.2 > h * 1.05 + 0.01;
      shape = `<text x="${tx}" y="${y + size}" text-anchor="${align}" font-family="Arial,sans-serif" font-size="${size}" fill="${color}" font-weight="${element.bold ? "700" : "400"}">${lines.map((line, index) => `<tspan x="${tx}" dy="${index ? size * 1.2 : 0}">${this.escapeHtml(line)}</tspan>`).join("")}</text>`;
    } else if (isLine) {
      shape = `<line x1="${x}" y1="${y}" x2="${x + w}" y2="${y + h}" stroke="${color}" stroke-width=".35"/>`;
    } else if (element.type === "rect") {
      const filled = element.fill && element.fill !== "transparent";
      shape = `<rect x="${x}" y="${y}" width="${box.w}" height="${box.h}" fill="${filled ? this.escapeAttr(element.fill) : "none"}" stroke="${color}" stroke-width=".35"/>`;
    } else if (element.type === "circle") {
      shape = `<ellipse cx="${x + box.w / 2}" cy="${y + box.h / 2}" rx="${box.w / 2}" ry="${box.h / 2}" fill="none" stroke="${color}" stroke-width=".35"/>`;
    } else if (element.type === "table") {
      const header = box.h / 2;
      const text = (offset, label) => `<text x="${x + offset + 1}" y="${y + header / 2 + 0.8}" font-family="Arial,sans-serif" font-size="2.3" font-weight="700" fill="#191a1d">${label}</text>`;
      shape = `<rect x="${x}" y="${y}" width="${box.w}" height="${box.h}" fill="#fff" stroke="#d99b00" stroke-width=".3"/><rect x="${x}" y="${y}" width="${box.w}" height="${header}" fill="#fff6d8" stroke="#d99b00" stroke-width=".25"/><line x1="${x + box.w / 3}" y1="${y}" x2="${x + box.w / 3}" y2="${y + box.h}" stroke="#d99b00" stroke-width=".2"/><line x1="${x + 2 * box.w / 3}" y1="${y}" x2="${x + 2 * box.w / 3}" y2="${y + box.h}" stroke="#d99b00" stroke-width=".2"/>${text(0, "LOTE")}${text(box.w / 3, "PESO NETO")}${text(2 * box.w / 3, "PROCEDENCIA")}<text x="${x + 1}" y="${y + header + header / 2 + 0.8}" font-family="Arial,sans-serif" font-size="2.2" fill="#73757d">filas de $data['lotes']…</text>`;
    } else if (element.type === "image") {
      shape = element.srcData
        ? `<image href="${this.escapeAttr(element.srcData)}" x="${x}" y="${y}" width="${box.w}" height="${box.h}" preserveAspectRatio="xMidYMid meet"/>`
        : `<rect x="${x}" y="${y}" width="${box.w}" height="${box.h}" fill="#f7f6f2" stroke="${color}" stroke-width=".3"/><text x="${x + box.w / 2}" y="${y + box.h / 2}" text-anchor="middle" font-size="2.5" fill="#73757d">IMAGEN</text>`;
    } else if (element.type === "qrcode") {
      const s = Math.min(box.w, box.h) * 0.28;
      const finder = (fx, fy) => `<rect x="${fx}" y="${fy}" width="${s}" height="${s}" fill="none" stroke="${color}" stroke-width=".35"/>`;
      shape = `<rect x="${x}" y="${y}" width="${box.w}" height="${box.h}" fill="#fff" stroke="${color}" stroke-width=".3"/>${finder(x + 1, y + 1)}${finder(x + box.w - s - 1, y + 1)}${finder(x + 1, y + box.h - s - 1)}<text x="${x + box.w / 2}" y="${y + box.h / 2 + 1.2}" text-anchor="middle" font-family="Arial,sans-serif" font-size="${Math.min(3.2, box.w / 5)}" font-weight="700" fill="${color}">QR</text>`;
    }

    // Área de clic ampliada: las líneas y los textos finos serían casi imposibles de agarrar.
    const hitW = Math.max(box.w, 4);
    const hitH = Math.max(box.h, 4);
    const hit = `<rect class="rd-hit${overflow ? " is-overflow" : ""}" x="${box.x - (hitW - box.w) / 2}" y="${box.y - (hitH - box.h) / 2}" width="${hitW}" height="${hitH}"/>`;

    const outline = selected
      ? `<rect x="${box.x - 1}" y="${box.y - 1}" width="${box.w + 2}" height="${box.h + 2}" fill="none" stroke="#d99b00" stroke-width=".35" stroke-dasharray="1 1" pointer-events="none"/>${element.locked ? "" : `<rect data-rd-resize="se" x="${box.x + box.w - 1.5}" y="${box.y + box.h - 1.5}" width="3" height="3" fill="#d99b00" stroke="#fff" stroke-width=".3" style="cursor:nwse-resize"/>`}`
      : "";
    return `<g data-rd-element="${id}" style="cursor:${element.locked ? "not-allowed" : "move"}">${hit}${shape}${outline}</g>`;
  }

  renderLayers() {
    if (!this.layers) return;
    this.layers.innerHTML = this.elements.slice().reverse().map((element) => {
      const selected = this.selectedId === element.id;
      const hidden = element.visible === false;
      const locked = Boolean(element.locked);
      const id = this.escapeAttr(element.id);
      const name = this.escapeHtml(element.label || ReportDesigner.ELEMENT_NAMES[element.type]);
      return `
      <div class="rd-layer ${selected ? "is-selected" : ""} ${hidden ? "is-hidden" : ""}">
        <button class="rd-layer-main" type="button" data-rd-select="${id}" aria-current="${selected}" title="${name}">
          <span class="rd-layer-icon"><i class="fa ${this.iconFor(element.type)}"></i></span><span class="rd-layer-name text-truncate">${name}</span>
        </button>
        <button class="rd-icon-btn rd-icon-btn-sm" type="button" title="${hidden ? "Mostrar" : "Ocultar"}" aria-label="${hidden ? "Mostrar" : "Ocultar"} ${name}" aria-pressed="${hidden}" data-rd-visibility="${id}"><i class="fa ${hidden ? "fa-eye-slash" : "fa-eye"}"></i></button>
        <button class="rd-icon-btn rd-icon-btn-sm" type="button" title="${locked ? "Desbloquear" : "Bloquear"}" aria-label="${locked ? "Desbloquear" : "Bloquear"} ${name}" aria-pressed="${locked}" data-rd-lock="${id}"><i class="fa ${locked ? "fa-lock" : "fa-lock-open"}"></i></button>
      </div>`;
    }).join("") || `<div class="rd-empty">No hay elementos en el lienzo.</div>`;
  }

  renderProperties() {
    if (!this.properties) return;
    const element = this.selected;
    if (!element) {
      this.properties.innerHTML = `<div class="rd-empty"><i class="fa fa-arrow-pointer"></i>Selecciona un elemento del lienzo o de la lista de capas para editarlo.</div>`;
      return;
    }
    const type = element.type;
    const index = this.elements.findIndex((item) => item.id === element.id);

    const field = (key, label, value, { inputType = "text", step, min, unit, placeholder } = {}) => {
      const attrs = `${step != null ? ` step="${step}"` : ""}${min != null ? ` min="${min}"` : ""}${placeholder ? ` placeholder="${this.escapeAttr(placeholder)}"` : ""}`;
      const input = `<input class="form-control" id="rd-prop-${key}" type="${inputType}"${attrs} value="${this.escapeAttr(value ?? "")}" data-rd-property="${key}">`;
      return `<div><label class="form-label" for="rd-prop-${key}">${label}</label>${unit ? `<div class="input-group">${input}<span class="input-group-text">${unit}</span></div>` : input}</div>`;
    };
    const group = (title, body) => `<section class="rd-prop-group"><h3 class="rd-section-title">${title}</h3>${body}</section>`;

    const head = `<div class="rd-prop-head"><span class="rd-layer-icon"><i class="fa ${this.iconFor(type)}"></i></span><div class="flex-grow-1"><div class="rd-prop-type">${ReportDesigner.ELEMENT_NAMES[type]}${element.locked ? ' · <i class="fa fa-lock"></i> bloqueado' : ""}</div>${field("label", "Nombre de la capa", element.label || "")}</div></div>`;

    let content = "";
    if (type === "text") {
      const size = Number(element.fontSize) || 3;
      const align = element.align || "L";
      const radio = (value, icon, title) => `<input class="visually-hidden" type="radio" name="rd-align" id="rd-align-${value}" value="${value}" data-rd-property="align" ${align === value ? "checked" : ""}><label for="rd-align-${value}" title="${title}"><i class="fa ${icon}"></i><span class="visually-hidden">${title}</span></label>`;
      const overflow = this.textLines(element).length * size * 1.2 > (Number(element.h) || 0) * 1.05 + 0.01;
      content += group("Contenido", `<div class="mb-2"><label class="form-label" for="rd-prop-text">Texto</label><textarea class="form-control" id="rd-prop-text" rows="3" data-rd-property="text">${this.escapeHtml(element.text || "")}</textarea></div>${field("binding", "Campo dinámico", element.binding || "", { placeholder: "cliente.nombre" })}<div class="rd-hint">Si defines un campo dinámico, reemplaza al texto al generar el PDF.</div>${overflow ? `<div class="rd-hint is-warning"><i class="fa fa-triangle-exclamation me-1"></i>El texto no cabe en el alto del cuadro. Aumenta el alto o reduce el tamaño.</div>` : ""}`);
      content += group("Tipografía", `<div class="rd-prop-grid">${field("fontSize", "Tamaño", element.fontSize, { inputType: "number", step: ".1", min: "0.5", unit: "mm" })}<div><label class="form-label" for="rd-prop-color">Color</label><input class="form-control form-control-color" id="rd-prop-color" type="color" value="${this.escapeAttr(element.color || "#191a1d")}" data-rd-property="color"></div></div><div class="rd-hint">≈ ${Math.round(size * ReportDesigner.MM_TO_PT * 10) / 10} pt en el PDF</div><div class="rd-style-row"><div class="rd-segment" role="group" aria-label="Negrita"><input class="visually-hidden" type="checkbox" id="rd-bold" data-rd-property="bold" ${element.bold ? "checked" : ""}><label for="rd-bold" title="Negrita"><i class="fa fa-bold"></i><span class="visually-hidden">Negrita</span></label></div><div class="rd-segment" role="radiogroup" aria-label="Alineación">${radio("L", "fa-align-left", "Izquierda")}${radio("C", "fa-align-center", "Centro")}${radio("R", "fa-align-right", "Derecha")}</div></div>`);
    } else if (type === "line" || type === "rect" || type === "circle" || type === "qrcode") {
      const hasFill = element.fill && element.fill !== "transparent";
      const fillValue = /^#[0-9a-f]{6}$/i.test(element.fill || "") ? element.fill : "#ffffff";
      content += group("Apariencia", `<div class="rd-prop-grid"><div><label class="form-label" for="rd-prop-color">${type === "qrcode" ? "Color" : "Trazo"}</label><input class="form-control form-control-color" id="rd-prop-color" type="color" value="${this.escapeAttr(element.color || "#191a1d")}" data-rd-property="color"></div>${type === "rect" ? `<div><label class="form-label" for="rd-prop-fill">Relleno</label><input class="form-control form-control-color" id="rd-prop-fill" type="color" value="${this.escapeAttr(fillValue)}" data-rd-property="fill"></div>` : ""}</div>${type === "rect" ? `<button class="btn btn-outline-secondary btn-sm w-100 mt-2" type="button" data-rd-action="clear-fill" ${hasFill ? "" : "disabled"}><i class="fa fa-droplet-slash me-1"></i>${hasFill ? "Quitar relleno" : "Sin relleno"}</button>` : ""}`);
    }

    const sizeLabels = type === "line" ? ["Largo", "Desnivel"] : ["Ancho", "Alto"];
    content += group("Posición y tamaño", `<div class="rd-prop-grid">${field("x", "X", element.x, { inputType: "number", step: ".5", min: "0", unit: "mm" })}${field("y", "Y", element.y, { inputType: "number", step: ".5", min: "0", unit: "mm" })}${field("w", sizeLabels[0], element.w, { inputType: "number", step: ".5", min: "0", unit: "mm" })}${field("h", sizeLabels[1], element.h, { inputType: "number", step: ".5", unit: "mm" })}</div>`);

    content += group("Capa", `<div class="rd-btn-row"><button class="btn btn-outline-secondary btn-sm" type="button" data-rd-action="layer-up" ${index >= this.elements.length - 1 ? "disabled" : ""}><i class="fa fa-arrow-up me-1"></i>Subir</button><button class="btn btn-outline-secondary btn-sm" type="button" data-rd-action="layer-down" ${index <= 0 ? "disabled" : ""}><i class="fa fa-arrow-down me-1"></i>Bajar</button></div><div class="rd-btn-row"><button class="btn btn-outline-secondary btn-sm" type="button" data-rd-action="duplicate"><i class="fa fa-copy me-1"></i>Duplicar</button><button class="btn btn-outline-danger btn-sm" type="button" data-rd-action="delete"><i class="fa fa-trash me-1"></i>Eliminar</button></div>`);

    this.properties.innerHTML = head + content;
  }

  /* ------------------------------------------------------------------ */
  /* Texto: medición y saltos de línea                                   */
  /* ------------------------------------------------------------------ */

  measureText(text, size, bold) {
    if (!this.measureCtx) this.measureCtx = document.createElement("canvas").getContext("2d");
    this.measureCtx.font = `${bold ? "700" : "400"} 100px Arial, sans-serif`;
    return (this.measureCtx.measureText(text).width * size) / 100;
  }

  /** Divide el texto en líneas según el ancho del cuadro, igual que lo haría MultiCell. */
  textLines(element) {
    const size = Number(element.fontSize) || 3;
    const maxWidth = Math.max(Number(element.w) || 0, size);
    const source = element.binding ? `{{${element.binding}}}` : String(element.text || "");
    const lines = [];
    source.split("\n").forEach((paragraph) => {
      let line = "";
      paragraph.split(" ").forEach((word) => {
        const candidate = line ? `${line} ${word}` : word;
        if (line && this.measureText(candidate, size, element.bold) > maxWidth) {
          lines.push(line);
          line = word;
        } else line = candidate;
      });
      lines.push(line);
    });
    return lines;
  }

  /* ------------------------------------------------------------------ */
  /* Código TCPDF y vista previa                                         */
  /* ------------------------------------------------------------------ */

  showCode() {
    const textarea = this.root.querySelector("[data-rd-code]");
    textarea.value = this.generateTcpdfCode();
    const modal = this.root.querySelector("[data-rd-code-modal]");
    if (window.bootstrap?.Modal) bootstrap.Modal.getOrCreateInstance(modal).show();
    else { textarea.focus(); textarea.select(); }
  }

  generateTcpdfCode() {
    const n = (value) => Math.round((Number(value) || 0) * 100) / 100;
    const pt = (mm) => Math.round((Number(mm) || 3) * ReportDesigner.MM_TO_PT * 10) / 10; // el diseño usa mm; TCPDF usa pt
    const rgb = (hex) => this.hexToRgb(hex).join(", ");
    const code = ["// Código generado por el Diseñador de reportes", "// Unidades en milímetros; pegar dentro de la clase TCPDF.", "", "$this->SetLineWidth(0.35);", ""];
    for (const element of this.elements.filter((item) => item.visible !== false)) {
      const label = (element.label || element.type).replace(/[\r\n]/g, " ");
      const x = n(element.x), y = n(element.y), w = n(element.w), h = n(element.h);
      if (element.type === "text") {
        const text = element.binding ? `$data['${this.phpEscape(element.binding)}'] ?? ''` : `'${this.phpEscape(element.text || "")}'`;
        const align = { L: "L", C: "C", R: "R" }[element.align] || "L";
        code.push(`// ${label}`, `$this->SetFont('helvetica', '${element.bold ? "B" : ""}', ${pt(element.fontSize)});`, `$this->SetTextColor(${rgb(element.color)});`, `$this->SetXY(${x}, ${y});`, `$this->MultiCell(${w}, ${h}, ${text}, 0, '${align}', false, 1, '', '', true, 0, false, true, ${h}, 'T', false);`, "");
      } else if (element.type === "line") code.push(`// ${label}`, `$this->SetDrawColor(${rgb(element.color)});`, `$this->Line(${x}, ${y}, ${n(x + w)}, ${n(y + h)});`, "");
      else if (element.type === "rect") {
        const filled = /^#[0-9a-f]{6}$/i.test(element.fill || "");
        code.push(`// ${label}`, `$this->SetDrawColor(${rgb(element.color)});`);
        if (filled) code.push(`$this->SetFillColor(${rgb(element.fill)});`);
        code.push(`$this->Rect(${x}, ${y}, ${w}, ${h}, '${filled ? "DF" : "D"}');`, "");
      } else if (element.type === "circle") code.push(`// ${label}`, `$this->SetDrawColor(${rgb(element.color)});`, `$this->Ellipse(${n(x + w / 2)}, ${n(y + h / 2)}, ${n(w / 2)}, ${n(h / 2)});`, "");
      else if (element.type === "image") code.push(`// ${label}`, `// $this->Image($imagePath, ${x}, ${y}, ${w}, ${h});`, "");
      else if (element.type === "qrcode") code.push(`// ${label}`, `$this->write2DBarcode($data['qr'] ?? '', 'QRCODE,H', ${x}, ${y}, ${w}, ${h});`, "");
      else if (element.type === "table") {
        const columnWidth = n(w / 3);
        const rowHeight = n(Math.max(5, h / 2));
        code.push(
          `// ${label}`,
          "$this->SetDrawColor(0, 0, 0);",
          "$this->SetTextColor(0, 0, 0);",
          "$this->SetFont('helvetica', 'B', 8);",
          `$this->SetXY(${x}, ${y});`,
          `$this->Cell(${columnWidth}, ${rowHeight}, 'LOTE', 1, 0, 'L', true);`,
          `$this->Cell(${columnWidth}, ${rowHeight}, 'PESO NETO', 1, 0, 'L', true);`,
          `$this->Cell(${columnWidth}, ${rowHeight}, 'PROCEDENCIA', 1, 1, 'L', true);`,
          "$this->SetFont('helvetica', '', 8);",
          "foreach (($data['lotes'] ?? []) as $fila) {",
          `  $this->Cell(${columnWidth}, ${rowHeight}, $fila['codigo'] ?? '', 1, 0, 'L');`,
          `  $this->Cell(${columnWidth}, ${rowHeight}, $fila['peso_neto'] ?? '', 1, 0, 'L');`,
          `  $this->Cell(${columnWidth}, ${rowHeight}, $fila['procedencia'] ?? '', 1, 1, 'L');`,
          "}",
          ""
        );
      }
    }
    return code.join("\n");
  }

  previewPDF() {
    if (!window.jspdf?.jsPDF) return this.notify("No se cargó jsPDF para la vista previa.", "error");
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF("p", "mm", "a4");
    pdf.setLineWidth(0.35);
    this.elements.filter((element) => element.visible !== false).forEach((element) => {
      const x = Number(element.x) || 0, y = Number(element.y) || 0, w = Number(element.w) || 0, h = Number(element.h) || 0;
      const [r, g, b] = this.hexToRgb(element.color);
      pdf.setDrawColor(r, g, b);
      pdf.setTextColor(r, g, b);
      if (element.type === "text") {
        const size = Number(element.fontSize) || 3;
        const align = element.align === "C" ? "center" : element.align === "R" ? "right" : "left";
        const tx = element.align === "C" ? x + w / 2 : element.align === "R" ? x + w : x;
        pdf.setFont("helvetica", element.bold ? "bold" : "normal");
        pdf.setFontSize(size * ReportDesigner.MM_TO_PT);
        pdf.text(this.textLines(element), tx, y + size, { align, lineHeightFactor: 1.2 });
      } else if (element.type === "line") pdf.line(x, y, x + w, y + h);
      else if (element.type === "rect") {
        const filled = /^#[0-9a-f]{6}$/i.test(element.fill || "");
        if (filled) pdf.setFillColor(...this.hexToRgb(element.fill));
        pdf.rect(x, y, w, h, filled ? "FD" : "S");
      } else if (element.type === "circle") pdf.ellipse(x + w / 2, y + h / 2, w / 2, h / 2);
      else if (element.type === "table") {
        pdf.setDrawColor(0, 0, 0);
        pdf.setTextColor(0, 0, 0);
        pdf.setFont("helvetica", "bold");
        pdf.setFontSize(7);
        pdf.rect(x, y, w, h);
        pdf.line(x, y + h / 2, x + w, y + h / 2);
        pdf.line(x + w / 3, y, x + w / 3, y + h);
        pdf.line(x + (2 * w) / 3, y, x + (2 * w) / 3, y + h);
        pdf.text("LOTE", x + 1.5, y + h / 4 + 1);
        pdf.text("PESO NETO", x + w / 3 + 1.5, y + h / 4 + 1);
        pdf.text("PROCEDENCIA", x + (2 * w) / 3 + 1.5, y + h / 4 + 1);
      } else if (element.type === "qrcode" || element.type === "image") pdf.rect(x, y, w, h);
    });
    window.open(pdf.output("bloburl"), "_blank", "noopener");
  }

  copyCode() {
    const textarea = this.root.querySelector("[data-rd-code]");
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(textarea.value).then(() => this.notify("Código copiado.", "success"));
    } else {
      textarea.select();
      document.execCommand("copy");
      this.notify("Código copiado.", "success");
    }
  }

  closeCode() {
    const modal = this.root.querySelector("[data-rd-code-modal]");
    bootstrap.Modal.getOrCreateInstance(modal).hide();
  }

  /* ------------------------------------------------------------------ */
  /* Utilidades                                                          */
  /* ------------------------------------------------------------------ */

  commit(message) {
    this.pushHistory();
    this.render();
    this.setStatus(message);
  }

  setStatus(message) {
    const status = this.root.querySelector("[data-rd-status]");
    if (status) status.textContent = message;
  }

  setDirty(value) {
    this.dirty = value;
    this.root.querySelectorAll("[data-rd-dirty]").forEach((badge) => { badge.hidden = !value; });
  }

  notify(message, type = "info") {
    if (window.toastr && typeof toastr[type] === "function") toastr[type](message);
    else if (type === "error") window.alert(message);
    else this.setStatus(message);
  }

  confirmAction({ title, text, confirmText = "Aceptar" }) {
    if (window.Swal) {
      return Swal.fire({ title, text, icon: "warning", showCancelButton: true, confirmButtonText: confirmText, cancelButtonText: "Cancelar" }).then((result) => result.isConfirmed);
    }
    return Promise.resolve(window.confirm(`${title}\n${text}`));
  }

  download(blob, filename) {
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  byId(id) { return this.elements.find((element) => element.id === id); }
  iconFor(type) { return ReportDesigner.ELEMENT_ICONS[type] || "fa-cube"; }
  snap(value) { const nearest = Math.round(value / 10) * 10; return Math.abs(nearest - value) < 1.2 ? nearest : value; }
  round(value) { return Math.round(value * 10) / 10; }
  hexToRgb(hex, fallback = [25, 26, 29]) {
    const match = /^#?([0-9a-f]{6})$/i.exec(String(hex || ""));
    if (!match) return fallback;
    const value = parseInt(match[1], 16);
    return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
  }
  escapeHtml(value) { return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]); }
  escapeAttr(value) { return this.escapeHtml(value); }
  phpEscape(value) { return String(value ?? "").replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/[\r\n]/g, " "); }
}