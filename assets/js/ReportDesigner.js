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
  static FONT_FAMILIES = {
    arial: { label: "Arial (Helvetica)", css: "Arial, Helvetica, sans-serif", tcpdf: "helvetica", jsPDF: "helvetica" },
    times: { label: "Times New Roman (Times)", css: '"Times New Roman", Times, serif', tcpdf: "times", jsPDF: "times" },
    courier: { label: "Courier New (Courier)", css: '"Courier New", Courier, monospace', tcpdf: "courier", jsPDF: "courier" },
  };
  static TABLE_BORDER_NAMES = {
    top: "Exterior superior",
    right: "Exterior derecho",
    bottom: "Exterior inferior",
    left: "Exterior izquierdo",
    insideHorizontal: "Interior horizontal",
    insideVertical: "Interior vertical",
  };
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
    this.elements = [];
    this.selectedId = null;
    this.selectedIds = [];
    this.selectionBox = null;
    this.activeTableCell = null;
    this.zoom = 100;
    this.showGrid = true;
    this.showMargins = true;
    this.snapToGuides = true;
    this.reference = null;
    this.referenceOpacity = 0.4;
    this.history = [];
    this.historyIndex = -1;
    this.drag = null;
    this.alignmentGuides = { vertical: null, horizontal: null };
    this.dirty = false;
    this.nextId = 1;
    this.dom = {};
    this.rendered = { grid: null, margins: null, reference: undefined };
    this.measureCtx = null;
    this.onClick = this.handleClick.bind(this);
    this.onInput = this.handleInput.bind(this);
    this.onChange = this.handleChange.bind(this);
    this.onFocusOut = this.handleFocusOut.bind(this);
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
    this.root.addEventListener("focusout", this.onFocusOut);
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
    this.root.removeEventListener("focusout", this.onFocusOut);
    this.canvas.removeEventListener("pointerdown", this.onPointerDown);
    window.removeEventListener("pointermove", this.onPointerMove);
    window.removeEventListener("pointerup", this.onPointerUp);
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("beforeunload", this.onBeforeUnload);
  }

  get selected() {
    return this.elements.find((element) => element.id === this.selectedId) || null;
  }

  setSelection(ids) {
    this.selectedIds = [...new Set(ids)].filter((id) => this.byId(id));
    this.selectedId = this.selectedIds[this.selectedIds.length - 1] || null;
  }

  expandGroupedIds(ids) {
    const groupIds = new Set(this.elements.filter((element) => ids.includes(element.id) && element.groupId).map((element) => element.groupId));
    return [...new Set([...ids, ...this.elements.filter((element) => element.groupId && groupIds.has(element.groupId)).map((element) => element.id)])];
  }

  selectionBounds(element) {
    if (element.type === "line") {
      const line = this.lineCoordinates(element);
      return { x: Math.min(line.x1, line.x2), y: Math.min(line.y1, line.y2), w: Math.max(Math.abs(line.x2 - line.x1), 1), h: Math.max(Math.abs(line.y2 - line.y1), 1) };
    }
    return { x: Number(element.x) || 0, y: Number(element.y) || 0, w: Math.max(Number(element.w) || 0, 1), h: Math.max(Number(element.h) || 0, 1) };
  }

  selectionBoundsFor(elements) {
    const bounds = elements.map((element) => this.selectionBounds(element));
    const left = Math.min(...bounds.map((item) => item.x));
    const top = Math.min(...bounds.map((item) => item.y));
    const right = Math.max(...bounds.map((item) => item.x + item.w));
    const bottom = Math.max(...bounds.map((item) => item.y + item.h));
    return { x: left, y: top, w: right - left, h: bottom - top };
  }

  renderSelectionBox() {
    if (!this.dom.selection) return;
    const box = this.selectionBox;
    this.dom.selection.innerHTML = box && (box.w > 0 || box.h > 0)
      ? `<rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" fill="#1683e8" fill-opacity=".1" stroke="#1683e8" stroke-width=".35" stroke-dasharray="1.5 1"/>`
      : "";
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
      if (action === "pick-color") this.pickColor(actionButton.dataset.rdColorTarget);
      if (action === "toggle-table-border") this.toggleTableBorder(actionButton.dataset.rdBorder);
      if (action === "set-table-alignment") this.setTableAlignment(actionButton);
      if (action === "toggle-manual-cell-bold") this.toggleManualCellBold(actionButton);
      if (action === "toggle-manual-cell-style") this.toggleManualCellStyle(actionButton);
      if (action === "add-table-column") this.addTableColumn();
      if (action === "delete-table-column") this.deleteTableColumn(Number(actionButton.dataset.rdColumn));
      if (action === "add-table-row") this.addTableRow();
      if (action === "delete-table-row") this.deleteTableRow(Number(actionButton.dataset.rdRow));
      if (action === "rotation-reset") this.updateSelected({ rotation: 0 }, "Rotación restablecida");
      if (action === "layer-up") this.moveLayer("up");
      if (action === "layer-down") this.moveLayer("down");
      if (action === "duplicate") this.duplicateSelected();
      if (action === "delete") this.deleteSelected();
      if (action === "group-elements") this.groupSelected();
      if (action === "ungroup-elements") this.ungroupSelected();
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
      this.activeTableCell = null;
      this.setSelection(this.expandGroupedIds([layer.dataset.rdSelect]));
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
    const inlineCell = event.target.closest?.("[data-rd-inline-cell]");
    if (inlineCell && this.selected?.type === "table" && this.selected.tableMode === "manual") {
      const row = Number(inlineCell.dataset.row);
      const column = Number(inlineCell.dataset.column);
      if (this.selected.rows?.[row]) this.selected.rows[row][column] = inlineCell.textContent.replace(/\r/g, "");
      this.setDirty(true);
      this.setStatus("Editando celda…");
      return;
    }
    const cellFontSize = event.target.closest?.("[data-rd-cell-font-size]");
    if (cellFontSize && this.selected?.type === "table" && this.selected.tableMode === "manual") {
      if (cellFontSize.value === "") return;
      const row = Number(cellFontSize.dataset.row);
      const column = Number(cellFontSize.dataset.column);
      const value = Math.max(0.5, Math.min(12, Number(cellFontSize.value) || 2.2));
      this.selected.cellFontSizes ||= [];
      this.selected.cellFontSizes[row] ||= [];
      this.selected.cellFontSizes[row][column] = value;
      this.renderCanvas();
      this.setStatus("Tamaño de celda actualizado");
      return;
    }
    const cellFontFamily = event.target.closest?.("[data-rd-cell-font-family]");
    if (cellFontFamily && this.selected?.type === "table" && this.selected.tableMode === "manual") {
      const row = Number(cellFontFamily.dataset.row);
      const column = Number(cellFontFamily.dataset.column);
      const key = ReportDesigner.FONT_FAMILIES[cellFontFamily.value] ? cellFontFamily.value : "arial";
      this.selected.cellFontFamilies ||= [];
      this.selected.cellFontFamilies[row] ||= [];
      this.selected.cellFontFamilies[row][column] = key;
      this.renderCanvas();
      this.setStatus("Fuente de celda actualizada");
      return;
    }
    const manualCell = event.target.closest("[data-rd-manual-cell]");
    if (manualCell && this.selected?.type === "table" && this.selected.tableMode === "manual") {
      const row = Number(manualCell.dataset.row);
      const column = Number(manualCell.dataset.column);
      if (this.selected.rows?.[row]) this.selected.rows[row][column] = manualCell.value;
      this.renderCanvas();
      this.setStatus("Editando celda…");
      return;
    }
    const input = event.target.closest("[data-rd-property]");
    if (!input || !this.selected) return;
    if (input.type === "number" && input.value === "") return; // no pisar el valor mientras se borra para reescribir
    const key = input.dataset.rdProperty;
    const value = input.type === "checkbox" ? input.checked : input.type === "number" ? Number(input.value) : input.value;
    const borderMatch = key.match(/^borders\.(top|right|bottom|left|insideHorizontal|insideVertical)\.(enabled|color|style)$/);
    const columnMatch = key.match(/^columns\.(\d+)\.(label|field|align)$/);
    const cellAlignMatch = key.match(/^cellAlignments\.(\d+)\.(\d+)$/);
    if (cellAlignMatch && this.selected.type === "table") {
      const [, rowIndex, columnIndex] = cellAlignMatch.map(Number);
      this.selected.cellAlignments ||= [];
      this.selected.cellAlignments[rowIndex] ||= [];
      this.selected.cellAlignments[rowIndex][columnIndex] = ["left", "center", "right"].includes(value) ? value : "left";
      this.renderCanvas();
      this.setStatus("Alineación de celda actualizada");
      return;
    }
    if (columnMatch && this.selected.type === "table") {
      this.getTableColumns(this.selected)[Number(columnMatch[1])][columnMatch[2]] = value;
      this.renderCanvas();
      this.setStatus("Editando columna…");
      return;
    }
    if (key === "tableMode" && this.selected.type === "table") {
      const previousMode = this.selected.tableMode || "dynamic";
      this.activeTableCell = null;
      this.selected.tableMode = value === "manual" ? "manual" : "dynamic";
      if (previousMode === "dynamic" && this.selected.tableMode === "manual") this.selected.showHeader = false;
      if (this.selected.tableMode === "dynamic") this.selected.showHeader = true;
      if (this.selected.tableMode === "manual" && !this.selected.rows?.length) {
        this.selected.rows = [Array(this.getTableColumns(this.selected).length).fill("")];
      }
      if (previousMode === "dynamic" && this.selected.tableMode === "manual") {
        this.selected.dynamicPreviewRows = this.selected.previewRows || 4;
        this.selected.previewRows = this.selected.rows.length;
      } else if (previousMode === "manual" && this.selected.tableMode === "dynamic") {
        this.selected.previewRows = this.selected.dynamicPreviewRows || 4;
      }
      this.selected.rowHeights = this.getTableRowHeights(this.selected, this.getTableDisplayRows(this.selected));
      this.selected.h = this.round(this.selected.rowHeights.reduce((sum, height) => sum + height, 0));
      this.renderProperties();
      this.renderCanvas();
      this.setStatus("Modo de tabla actualizado");
      return;
    }
    if (key === "showHeader" && this.selected.type === "table") {
      this.selected.showHeader = Boolean(value);
      this.selected.rowHeights = this.getTableRowHeights(this.selected, this.getTableDisplayRows(this.selected));
      this.selected.h = this.round(this.selected.rowHeights.reduce((sum, height) => sum + height, 0));
      this.renderProperties();
      this.renderCanvas();
      this.setStatus(this.selected.showHeader ? "Cabecera visible" : "Cabecera oculta");
      return;
    }
    if (borderMatch) {
      const [, side, property] = borderMatch;
      const borders = this.getTableBorders(this.selected);
      borders[side][property] = value;
      this.selected.borders = borders;
    } else if (key === "borders.color" || key === "borders.style") {
      const borders = this.getTableBorders(this.selected);
      for (const border of Object.values(borders)) border[key.endsWith(".color") ? "color" : "style"] = value;
      this.selected.borders = borders;
    } else {
      this.selected[key] = key === "rotation" ? this.normalizeAngle(value) : value;
    }
    if (this.selected.type === "table" && (key === "rowHeight" || key === "previewRows")) {
      this.selected.rowHeight = Math.max(2, Number(this.selected.rowHeight) || 7);
      this.selected.previewRows = Math.max(1, Math.min(20, Math.floor(Number(this.selected.previewRows) || 4)));
      input.value = String(this.selected[key]);
      this.selected.rowHeights = Array(this.selected.previewRows + 1).fill(this.selected.rowHeight);
      if (this.selected.tableMode === "manual" && this.selected.showHeader === false) this.selected.rowHeights[0] = 0;
      this.selected.h = Math.round(this.selected.rowHeights.reduce((sum, height) => sum + height, 0) * 100) / 100;
      const heightInput = this.properties.querySelector('[data-rd-property="h"]');
      if (heightInput) heightInput.value = String(this.selected.h);
    } else if (this.selected.type === "table" && key === "h") {
      const previewRows = Math.max(1, Math.min(20, Math.floor(Number(this.selected.previewRows) || 4)));
      const rowHeights = this.getTableRowHeights(this.selected, previewRows);
      const currentHeight = rowHeights.reduce((sum, height) => sum + height, 0);
      const scale = currentHeight > 0 ? Number(this.selected.h) / currentHeight : 1;
      this.selected.rowHeights = rowHeights.map((height) => height === 0 ? 0 : Math.max(2, this.round(height * scale)));
      this.selected.rowHeight = this.round(this.selected.rowHeights.slice(1).reduce((sum, height) => sum + height, 0) / previewRows);
      const rowHeightInput = this.properties.querySelector('[data-rd-property="rowHeight"]');
      if (rowHeightInput) rowHeightInput.value = String(this.selected.rowHeight);
    }
    if (key === "rotation") input.value = String(this.selected[key]);
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
    if (event.target.matches("[data-rd-property]") || event.target.matches("[data-rd-manual-cell]") || event.target.matches("[data-rd-cell-font-size]") || event.target.matches("[data-rd-cell-font-family]")) {
      // No se vuelve a pintar el panel de propiedades: así el foco no se pierde al pasar con Tab entre campos.
      this.pushHistory();
      this.renderCanvas();
      this.renderLayers();
      this.setStatus("Cambios aplicados");
    }
  }

  handleFocusOut(event) {
    if (!event.target.matches?.("[data-rd-inline-cell]")) return;
    this.pushHistory();
    this.setStatus("Celda actualizada");
  }

  handlePointerDown(event) {
    if (event.button !== 0) return;
    const target = event.target.closest("[data-rd-element]");
    if (!target) {
      // Arrastrar sobre el papel vacío crea una selección múltiple tipo marco.
      this.activeTableCell = null;
      this.alignmentGuides = { vertical: null, horizontal: null };
      const point = this.svgPoint(event);
      if (!point) return;
      event.preventDefault();
      this.selectionBox = { x: point.x, y: point.y, w: 0, h: 0 };
      this.drag = { mode: "marquee", point, start: point, baseIds: event.shiftKey ? [...this.selectedIds] : [], changed: false };
      this.renderSelectionBox();
      return;
    }
    const element = this.byId(target.dataset.rdElement);
    if (!element) return;
    const inlineCell = event.target.closest("[data-rd-inline-cell]");
    if (inlineCell && element.type === "table" && element.tableMode === "manual") {
      this.setSelection([element.id]);
      if (element.locked) {
        this.activeTableCell = null;
        this.renderLayers();
        this.renderProperties();
        this.setStatus("La tabla está bloqueada");
        return;
      }
      this.activeTableCell = { elementId: element.id, row: Number(inlineCell.dataset.row), column: Number(inlineCell.dataset.column) };
      this.canvas.querySelectorAll("[data-rd-inline-cell]").forEach((cell) => { cell.style.outline = "none"; });
      inlineCell.style.outline = ".2px dashed #d99b00";
      this.alignmentGuides = { vertical: null, horizontal: null };
      this.renderLayers();
      this.renderProperties();
      this.setStatus(element.locked ? "La tabla está bloqueada" : "Editando celda…");
      return;
    }
    this.activeTableCell = null;
    const wasSelected = this.selectedIds.includes(element.id);
    if (event.shiftKey) this.setSelection(this.expandGroupedIds([...this.selectedIds, element.id]));
    else if (!wasSelected) this.setSelection(element.groupId ? this.expandGroupedIds([element.id]) : [element.id]);
    else this.setSelection(this.expandGroupedIds(this.selectedIds));
    this.alignmentGuides = { vertical: null, horizontal: null };
    const point = this.svgPoint(event);
    if (this.selectedIds.length > 1 && !event.target.closest("[data-rd-rotate], [data-rd-resize], [data-rd-table-col-resize], [data-rd-table-row-resize]")) {
      const movable = this.selectedIds.map((id) => this.byId(id)).filter((item) => item && !item.locked);
      if (!movable.length || !point) return;
      event.preventDefault();
      this.drag = { mode: "move-multiple", point, changed: false, positions: movable.map((item) => ({ id: item.id, x: item.x, y: item.y })), bounds: this.selectionBoundsFor(movable) };
      this.render();
      return;
    }
    const rotateHandle = event.target.closest("[data-rd-rotate]");
    if (rotateHandle && element.type === "line" && !element.locked) {
      event.preventDefault();
      const line = this.lineCoordinates(element);
      if (!point) return;
      this.drag = {
        id: element.id,
        mode: "rotate",
        point,
        center: { x: line.cx, y: line.cy },
        pointerAngle: Math.atan2(point.y - line.cy, point.x - line.cx) * 180 / Math.PI,
        rotation: Number(element.rotation) || 0,
        changed: false,
      };
      return;
    }
    if (element.locked) {
      this.render();
      this.setStatus("Capa bloqueada: desbloquéala en «Capas» para moverla");
      return;
    }
    event.preventDefault();
    if (!point) return;
    const columnHandle = event.target.closest("[data-rd-table-col-resize]");
    const rowHandle = event.target.closest("[data-rd-table-row-resize]");
    if (element.type === "table" && (columnHandle || rowHandle)) {
      this.drag = {
        id: element.id,
        mode: columnHandle ? "table-column" : "table-row",
        index: Number(columnHandle?.dataset.rdTableColResize ?? rowHandle?.dataset.rdTableRowResize),
        point,
        columnWidths: this.getTableColumnWidths(element, element.w),
        previewRows: this.getTableDisplayRows(element),
        rowHeights: this.getTableRowHeights(element, this.getTableDisplayRows(element)),
        changed: false,
      };
      this.renderProperties();
      this.renderLayers();
      return;
    }
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
    const point = this.svgPoint(event);
    if (!point) return;
    if (this.drag.mode === "marquee") {
      const start = this.drag.start;
      const x = Math.min(start.x, point.x), y = Math.min(start.y, point.y);
      this.selectionBox = { x, y, w: Math.abs(point.x - start.x), h: Math.abs(point.y - start.y) };
      this.drag.changed = this.selectionBox.w > 0.5 || this.selectionBox.h > 0.5;
      this.renderSelectionBox();
      return;
    }
    if (this.drag.mode === "move-multiple") {
      const dx = point.x - this.drag.point.x, dy = point.y - this.drag.point.y;
      const bounds = this.drag.bounds;
      const moveX = Math.max(-bounds.x, Math.min(ReportDesigner.PAGE.width - bounds.x - bounds.w, dx));
      const moveY = Math.max(-bounds.y, Math.min(ReportDesigner.PAGE.height - bounds.y - bounds.h, dy));
      this.drag.positions.forEach((position) => {
        const item = this.byId(position.id);
        if (item) { item.x = this.round(position.x + moveX); item.y = this.round(position.y + moveY); }
      });
      this.drag.changed = Math.abs(moveX) > 0.01 || Math.abs(moveY) > 0.01;
      this.alignmentGuides = { vertical: null, horizontal: null };
      this.renderCanvas(); this.renderLayers(); this.renderProperties();
      return;
    }
    const element = this.byId(this.drag.id);
    if (!element) return;
    const page = ReportDesigner.PAGE;
    const dx = point.x - this.drag.point.x;
    const dy = point.y - this.drag.point.y;
    if (this.drag.mode === "table-column") {
      const total = Number(element.w) || 1;
      const widths = [...this.drag.columnWidths];
      const minimum = Math.min(8, total / 4);
      const index = this.drag.index;
      const prefix = widths.slice(0, index).reduce((sum, width) => sum + width, 0);
      const pairTotal = widths[index] + widths[index + 1];
      const boundary = Math.max(prefix + minimum, Math.min(prefix + pairTotal - minimum, prefix + widths[index] + dx));
      widths[index] = boundary - prefix;
      widths[index + 1] = pairTotal - widths[index];
      element.columnWidths = widths.map((width) => width / total);
      this.drag.changed = true;
      this.renderCanvas();
      return;
    } else if (this.drag.mode === "table-row") {
      const rowHeights = [...this.drag.rowHeights];
      const rowIndex = this.drag.index;
      const previous = rowHeights[rowIndex];
      const next = rowHeights[rowIndex + 1];
      const adjustedDelta = Math.max(2 - previous, Math.min(next - 2, dy));
      rowHeights[rowIndex] = this.round(previous + adjustedDelta);
      rowHeights[rowIndex + 1] = this.round(next - adjustedDelta);
      element.rowHeights = rowHeights;
      element.rowHeight = this.round(rowHeights.slice(1).reduce((sum, height) => sum + height, 0) / this.drag.previewRows);
      element.h = this.round(rowHeights.reduce((sum, height) => sum + height, 0));
      this.drag.changed = true;
      this.renderCanvas();
      this.renderProperties();
      return;
    } else if (this.drag.mode === "rotate") {
      const pointerAngle = Math.atan2(point.y - this.drag.center.y, point.x - this.drag.center.x) * 180 / Math.PI;
      let rotation = this.normalizeAngle(this.drag.rotation + pointerAngle - this.drag.pointerAngle);
      if (event.shiftKey) rotation = this.normalizeAngle(Math.round(rotation / 15) * 15);
      element.rotation = this.round(rotation);
      this.drag.changed = true;
      this.renderCanvas();
      this.renderProperties();
      return;
    } else if (this.drag.mode === "move") {
      element.x = this.round(Math.max(0, Math.min(page.width - element.w, this.drag.x + dx)));
      element.y = this.round(Math.max(0, Math.min(page.height - element.h, this.drag.y + dy)));
      if (this.snapToGuides) {
        element.x = this.snap(element.x);
        element.y = this.snap(element.y);
        const alignment = this.alignToElements(element);
        element.x = this.round(Math.max(0, Math.min(page.width - element.w, element.x + alignment.dx)));
        element.y = this.round(Math.max(0, Math.min(page.height - element.h, element.y + alignment.dy)));
        this.alignmentGuides = { vertical: alignment.vertical, horizontal: alignment.horizontal };
      } else {
        this.alignmentGuides = { vertical: null, horizontal: null };
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
      if (element.type === "table") {
        const rows = Math.max(1, Math.floor(Number(element.previewRows) || 1));
        element.rowHeight = this.round(element.h / (rows + 1));
        element.rowHeights = Array(rows + 1).fill(element.rowHeight);
      }
    }
    this.drag.changed = true;
    this.renderCanvas();
    this.renderLayers();
    this.renderProperties();
  }

  handlePointerUp() {
    if (!this.drag) return;
    if (this.drag.mode === "marquee") {
      const drag = this.drag;
      const box = this.selectionBox;
      this.drag = null;
      this.selectionBox = null;
      let ids = [...drag.baseIds];
      if (drag.changed && box) {
        const hits = this.elements.filter((element) => element.visible !== false).filter((element) => {
          const bounds = this.selectionBounds(element);
          return bounds.x <= box.x + box.w && bounds.x + bounds.w >= box.x && bounds.y <= box.y + box.h && bounds.y + bounds.h >= box.y;
        }).map((element) => element.id);
        ids = this.expandGroupedIds([...ids, ...hits]);
      } else if (!drag.baseIds.length) ids = [];
      this.setSelection(ids);
      this.renderSelectionBox();
      this.render();
      this.setStatus(ids.length ? `${ids.length} elementos seleccionados` : "Selección quitada");
      return;
    }
    const changed = this.drag.changed;
    this.drag = null;
    this.alignmentGuides = { vertical: null, horizontal: null };
    this.renderCanvas();
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
    if (event.target.closest?.("[data-rd-inline-cell]") && event.key === "Enter") {
      event.preventDefault();
      event.target.blur();
      return;
    }
    if (document.querySelector(".modal.show")) return;
    if (event.target.closest?.("input, textarea, select, [contenteditable]:not([contenteditable='false'])")) return;

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
      this.setSelection([]);
      this.render();
    } else if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key) && this.selected) {
      event.preventDefault();
      const movable = this.selectedIds.map((id) => this.byId(id)).filter((element) => element && !element.locked);
      if (!movable.length) return this.setStatus("Desbloquea la capa para moverla");
      const page = ReportDesigner.PAGE;
      const amount = event.shiftKey ? 2 : 0.5;
      const delta = { x: 0, y: 0 };
      if (event.key === "ArrowUp") delta.y = -amount;
      if (event.key === "ArrowDown") delta.y = amount;
      if (event.key === "ArrowLeft") delta.x = -amount;
      if (event.key === "ArrowRight") delta.x = amount;
      const bounds = this.selectionBoundsFor(movable);
      delta.x = Math.max(-bounds.x, Math.min(page.width - bounds.x - bounds.w, delta.x));
      delta.y = Math.max(-bounds.y, Math.min(page.height - bounds.y - bounds.h, delta.y));
      movable.forEach((element) => {
        element.x = this.round(element.x + delta.x);
        element.y = this.round(element.y + delta.y);
      });
      this.commit(movable.length > 1 ? "Selección movida" : "Elemento movido");
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
    this.setSelection([element.id]);
    this.commit(`${ReportDesigner.ELEMENT_NAMES[type]} agregado`);
  }

  loadImageElement(file) {
    const reader = new FileReader();
    reader.onload = () => {
      const element = this.defaultElement("image");
      element.srcData = String(reader.result);
      element.label = file.name || "Imagen";
      this.elements.push(element);
      this.setSelection([element.id]);
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
      table: [170, 35],
      image: [40, 40],
      qrcode: [22, 22],
    };
    const [w, h] = sizes[type] || [40, 12];
    return {
      id, type, label: `${ReportDesigner.ELEMENT_NAMES[type]} ${this.nextId - 1}`,
      text: type === "text" ? "Nuevo texto" : "", binding: "",
      x: type === "table" ? 20 : 20, y: 30 + (this.elements.length % 8) * 8, w, h,
      fontSize: 3.5, color: "#191a1d",
      fontFamily: type === "text" ? "arial" : "",
      fill: "transparent", align: "L", bold: false, visible: true, locked: false,
      rotation: 0,
      ...(type === "table" ? { tableMode: "dynamic", columns: [{ label: "LOTE", field: "codigo" }, { label: "PESO NETO", field: "peso_neto" }, { label: "PROCEDENCIA", field: "procedencia" }], rows: [["", "", ""]], borders: this.tableBorderDefaults(), borderWidth: 0.25, backgroundColor: "#ffffff", headerColor: "#fff6d8", rowHeight: 7, rowHeights: [7, 7, 7, 7, 7], previewRows: 4 } : {}),
    };
  }

  tableBorderDefaults() {
    const border = () => ({ enabled: true, color: "#d99b00", style: "solid" });
    return {
      top: border(),
      right: border(),
      bottom: border(),
      left: border(),
      insideHorizontal: border(),
      insideVertical: border(),
    };
  }

  getTableBorders(element) {
    const defaults = this.tableBorderDefaults();
    const saved = element?.borders || {};
    const commonStyle = ["solid", "dotted", "dashed"].includes(saved.style) ? saved.style : "solid";
    for (const side of Object.keys(defaults)) {
      const border = saved[side] || {};
      defaults[side] = {
        enabled: border.enabled !== false,
        color: /^#[0-9a-f]{6}$/i.test(border.color || "") ? border.color : defaults[side].color,
        style: ["solid", "dotted", "dashed"].includes(border.style) ? border.style : commonStyle,
      };
    }
    return defaults;
  }

  toggleTableBorder(side) {
    if (!this.selected || this.selected.type !== "table" || !ReportDesigner.TABLE_BORDER_NAMES[side]) return;
    const borders = this.getTableBorders(this.selected);
    borders[side].enabled = !borders[side].enabled;
    this.selected.borders = borders;
    this.commit("Bordes de tabla actualizados");
  }

  setTableAlignment(button) {
    const element = this.selected;
    const align = button.dataset.rdAlign;
    if (!element || element.type !== "table" || !["left", "center", "right"].includes(align)) return;
    if (button.dataset.rdRow !== undefined) {
      const row = Number(button.dataset.rdRow);
      const column = Number(button.dataset.rdColumn);
      element.cellAlignments ||= [];
      element.cellAlignments[row] ||= [];
      element.cellAlignments[row][column] = align;
    } else {
      const column = Number(button.dataset.rdColumn);
      const columns = this.getTableColumns(element);
      if (!columns[column]) return;
      columns[column].align = align;
    }
    this.commit("Alineación actualizada");
  }

  toggleManualCellBold(button) {
    const element = this.selected;
    const row = Number(button.dataset.rdRow);
    const column = Number(button.dataset.rdColumn);
    if (!element || element.type !== "table" || element.tableMode !== "manual" || !Number.isInteger(row) || !Number.isInteger(column)) return;
    element.cellBold ||= [];
    element.cellBold[row] ||= [];
    element.cellBold[row][column] = !element.cellBold[row][column];
    this.commit("Formato de celda actualizado");
  }

  toggleManualCellStyle(button) {
    const element = this.selected;
    const { row, column, style } = button.dataset;
    const rowIndex = Number(row), columnIndex = Number(column);
    const properties = { italic: "cellItalic", underline: "cellUnderline" };
    const property = properties[style];
    if (!element || element.type !== "table" || element.tableMode !== "manual" || !property || !Number.isInteger(rowIndex) || !Number.isInteger(columnIndex)) return;
    element[property] ||= [];
    element[property][rowIndex] ||= [];
    element[property][rowIndex][columnIndex] = !element[property][rowIndex][columnIndex];
    this.commit("Formato de celda actualizado");
  }

  getManualCellStyle(element, row, column) {
    const size = Number(element.cellFontSizes?.[row]?.[column]);
    return {
      fontSize: Number.isFinite(size) && size >= 0.5 ? Math.min(12, size) : 2.2,
      fontFamily: ReportDesigner.FONT_FAMILIES[element.cellFontFamilies?.[row]?.[column]] ? element.cellFontFamilies[row][column] : "arial",
      bold: Boolean(element.cellBold?.[row]?.[column]),
      italic: Boolean(element.cellItalic?.[row]?.[column]),
      underline: Boolean(element.cellUnderline?.[row]?.[column]),
      align: ["left", "center", "right"].includes(element.cellAlignments?.[row]?.[column]) ? element.cellAlignments[row][column] : "left",
    };
  }

  getTableColumns(element) {
    if (!Array.isArray(element.columns) || !element.columns.length) {
      element.columns = [
        { label: "LOTE", field: "codigo" },
        { label: "PESO NETO", field: "peso_neto" },
        { label: "PROCEDENCIA", field: "procedencia" },
      ];
    }
    return element.columns;
  }

  getTableDisplayRows(element) {
    return element.tableMode === "manual"
      ? Math.max(1, Math.min(50, element.rows?.length || 1))
      : Math.max(1, Math.min(20, Math.floor(Number(element.previewRows) || 1)));
  }

  addTableColumn() {
    const element = this.selected;
    if (!element || element.type !== "table") return;
    const columns = this.getTableColumns(element);
      columns.push({ label: `Columna ${columns.length + 1}`, field: "", align: "left" });
    if (Array.isArray(element.columnWidths) && element.columnWidths.length === columns.length - 1) {
      const ratios = element.columnWidths.map((width) => Number(width) || 1);
      const last = ratios.length - 1;
      const share = ratios[last] / 2;
      ratios[last] = share;
      ratios.push(share);
      element.columnWidths = ratios;
    }
    if (element.tableMode === "manual") {
      element.rows = (element.rows?.length ? element.rows : [[]]).map((row) => [...row, ""]);
      element.cellAlignments = (element.cellAlignments?.length ? element.cellAlignments : element.rows.map(() => [])).map((row) => [...row, "left"]);
      element.cellBold = (element.cellBold?.length ? element.cellBold : element.rows.map(() => [])).map((row) => [...row, false]);
      element.cellItalic = (element.cellItalic?.length ? element.cellItalic : element.rows.map(() => [])).map((row) => [...row, false]);
      element.cellUnderline = (element.cellUnderline?.length ? element.cellUnderline : element.rows.map(() => [])).map((row) => [...row, false]);
      element.cellFontSizes = (element.cellFontSizes?.length ? element.cellFontSizes : element.rows.map(() => [])).map((row) => [...row, 2.2]);
      element.cellFontFamilies = (element.cellFontFamilies?.length ? element.cellFontFamilies : element.rows.map(() => [])).map((row) => [...row, "arial"]);
    }
    this.commit("Columna agregada");
  }

  deleteTableColumn(index) {
    const element = this.selected;
    if (!element || element.type !== "table") return;
    const columns = this.getTableColumns(element);
    if (!Number.isInteger(index) || index < 0 || index >= columns.length) return;
    if (columns.length <= 1) return toastr.warning("La tabla debe conservar al menos una columna.");
    columns.splice(index, 1);
    if (Array.isArray(element.columnWidths)) element.columnWidths.splice(index, 1);
    if (Array.isArray(element.rows)) element.rows.forEach((row) => row.splice(index, 1));
    if (Array.isArray(element.cellAlignments)) element.cellAlignments.forEach((row) => row.splice(index, 1));
    if (Array.isArray(element.cellBold)) element.cellBold.forEach((row) => row.splice(index, 1));
    if (Array.isArray(element.cellItalic)) element.cellItalic.forEach((row) => row.splice(index, 1));
    if (Array.isArray(element.cellUnderline)) element.cellUnderline.forEach((row) => row.splice(index, 1));
    if (Array.isArray(element.cellFontSizes)) element.cellFontSizes.forEach((row) => row.splice(index, 1));
    if (Array.isArray(element.cellFontFamilies)) element.cellFontFamilies.forEach((row) => row.splice(index, 1));
    if (this.activeTableCell?.elementId === element.id) this.activeTableCell = null;
    this.commit("Columna eliminada");
  }

  addTableRow() {
    const element = this.selected;
    if (!element || element.type !== "table" || element.tableMode !== "manual") return;
    if ((element.rows?.length || 0) >= 50) return toastr.warning("La tabla manual admite hasta 50 filas.");
    element.rows ||= [];
    element.rows.push(Array(this.getTableColumns(element).length).fill(""));
    element.cellAlignments ||= [];
    element.cellAlignments.push(Array(this.getTableColumns(element).length).fill("left"));
    element.cellBold ||= [];
    element.cellBold.push(Array(this.getTableColumns(element).length).fill(false));
    element.cellItalic ||= [];
    element.cellItalic.push(Array(this.getTableColumns(element).length).fill(false));
    element.cellUnderline ||= [];
    element.cellUnderline.push(Array(this.getTableColumns(element).length).fill(false));
    element.cellFontSizes ||= [];
    element.cellFontSizes.push(Array(this.getTableColumns(element).length).fill(2.2));
    element.cellFontFamilies ||= [];
    element.cellFontFamilies.push(Array(this.getTableColumns(element).length).fill("arial"));
    element.previewRows = element.rows.length;
    const rowHeight = Math.max(2, Number(element.rowHeight) || 7);
    element.rowHeights = [...this.getTableRowHeights(element, element.rows.length - 1), rowHeight];
    element.h = this.round(element.rowHeights.reduce((sum, height) => sum + height, 0));
    this.commit("Fila agregada");
  }

  deleteTableRow(index) {
    const element = this.selected;
    if (!element || element.type !== "table" || element.tableMode !== "manual") return;
    if (!Number.isInteger(index) || index < 0 || index >= (element.rows?.length || 0)) return;
    if (!Array.isArray(element.rows) || element.rows.length <= 1) return toastr.warning("La tabla manual debe conservar al menos una fila.");
    const rowHeights = this.getTableRowHeights(element, element.rows.length);
    element.rows.splice(index, 1);
    element.cellAlignments?.splice(index, 1);
    element.cellBold?.splice(index, 1);
    element.cellItalic?.splice(index, 1);
    element.cellUnderline?.splice(index, 1);
    element.cellFontSizes?.splice(index, 1);
    element.cellFontFamilies?.splice(index, 1);
    if (this.activeTableCell?.elementId === element.id) this.activeTableCell = null;
    rowHeights.splice(index + 1, 1);
    element.rowHeights = rowHeights;
    element.previewRows = element.rows.length;
    element.h = this.round(rowHeights.reduce((sum, height) => sum + height, 0));
    this.commit("Fila eliminada");
  }

  normalizeAngle(angle) {
    return ((Number(angle) + 180) % 360 + 360) % 360 - 180;
  }

  lineCoordinates(element) {
    const x = Number(element.x) || 0;
    const y = Number(element.y) || 0;
    const w = Number(element.w) || 0;
    const h = Number(element.h) || 0;
    const cx = x + w / 2;
    const cy = y + h / 2;
    const length = Math.hypot(w, h);
    const angle = Math.atan2(h, w) + (Number(element.rotation) || 0) * Math.PI / 180;
    const dx = Math.cos(angle) * length / 2;
    const dy = Math.sin(angle) * length / 2;
    return { x1: cx - dx, y1: cy - dy, x2: cx + dx, y2: cy + dy, cx, cy, angle };
  }

  elementBounds(element) {
    if (element.type === "line") {
      const line = this.lineCoordinates(element);
      return {
        x: Math.min(line.x1, line.x2),
        y: Math.min(line.y1, line.y2),
        w: Math.abs(line.x2 - line.x1),
        h: Math.abs(line.y2 - line.y1),
      };
    }
    return {
      x: Number(element.x) || 0,
      y: Number(element.y) || 0,
      w: Number(element.w) || 0,
      h: Number(element.h) || 0,
    };
  }

  alignToElements(element) {
    const moving = this.elementBounds(element);
    const verticalAnchors = [moving.x, moving.x + moving.w / 2, moving.x + moving.w];
    const horizontalAnchors = [moving.y, moving.y + moving.h / 2, moving.y + moving.h];
    const pxPerMm = ReportDesigner.PX_PER_MM * (this.zoom / 100);
    const threshold = 7 / Math.max(pxPerMm, 0.1);
    let bestX = null;
    let bestY = null;

    for (const other of this.elements) {
      if (other.id === element.id || other.visible === false) continue;
      const bounds = this.elementBounds(other);
      const otherVertical = [bounds.x, bounds.x + bounds.w / 2, bounds.x + bounds.w];
      const otherHorizontal = [bounds.y, bounds.y + bounds.h / 2, bounds.y + bounds.h];

      for (const anchor of verticalAnchors) {
        for (const target of otherVertical) {
          const delta = target - anchor;
          if (Math.abs(delta) <= threshold && (!bestX || Math.abs(delta) < Math.abs(bestX.delta))) {
            bestX = { delta, position: target };
          }
        }
      }
      for (const anchor of horizontalAnchors) {
        for (const target of otherHorizontal) {
          const delta = target - anchor;
          if (Math.abs(delta) <= threshold && (!bestY || Math.abs(delta) < Math.abs(bestY.delta))) {
            bestY = { delta, position: target };
          }
        }
      }
    }

    return {
      dx: bestX?.delta || 0,
      dy: bestY?.delta || 0,
      vertical: bestX?.position ?? null,
      horizontal: bestY?.position ?? null,
    };
  }

  updateSelected(changes, message) {
    if (!this.selected) return;
    Object.assign(this.selected, changes);
    this.commit(message);
  }

  deleteSelected() {
    if (!this.selected) return;
    const selected = new Set(this.selectedIds.length ? this.selectedIds : [this.selectedId]);
    const removable = this.elements.filter((element) => selected.has(element.id) && !element.locked);
    if (!removable.length) return this.setStatus("Desbloquea la capa para poder eliminarla");
    const index = this.elements.findIndex((element) => selected.has(element.id));
    this.elements = this.elements.filter((element) => !selected.has(element.id) || element.locked);
    const next = this.elements[Math.min(index, this.elements.length - 1)]?.id || null;
    this.setSelection(next ? [next] : []);
    this.commit(removable.length > 1 ? `${removable.length} elementos eliminados` : "Elemento eliminado");
  }

  groupSelected() {
    const selected = this.selectedIds.map((id) => this.byId(id)).filter(Boolean);
    if (selected.length < 2) return this.setStatus("Selecciona al menos dos elementos para agrupar");
    const groupId = `group-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    selected.forEach((element) => { element.groupId = groupId; });
    this.setSelection(selected.map((element) => element.id));
    this.commit("Elementos agrupados");
  }

  ungroupSelected() {
    const selected = new Set(this.selectedIds);
    const groupIds = new Set(this.elements.filter((element) => selected.has(element.id) && element.groupId).map((element) => element.groupId));
    if (!groupIds.size) return this.setStatus("La selección no contiene grupos");
    this.elements.filter((element) => groupIds.has(element.groupId)).forEach((element) => { delete element.groupId; });
    this.setSelection([...selected]);
    this.commit("Grupo desagrupado");
  }

  duplicateSelected() {
    if (!this.selected) return;
    const clone = { ...this.selected, id: `element-${this.nextId++}`, label: `${this.selected.label || "Elemento"} copia`, x: this.round(this.selected.x + 4), y: this.round(this.selected.y + 4), locked: false };
    this.elements.push(clone);
      this.setSelection([clone.id]);
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
      this.setSelection([]);
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
      toastr.success("Diseño guardado en este navegador.");
    } catch (error) {
      console.error(error);
      toastr.error("No se pudo guardar en el navegador (¿imagen muy pesada?). Usa Archivo → Exportar como JSON.");
    }
  }

  /** Descarga el diseño como archivo JSON. */
  exportDesign() {
    const blob = new Blob([JSON.stringify(this.serialize(), null, 2)], { type: "application/json" });
    this.download(blob, "diseno-reporte.json");
    this.setStatus("Diseño exportado");
    toastr.success("Archivo JSON descargado.");
  }

  loadDesign() {
    const stored = localStorage.getItem(ReportDesigner.STORAGE_KEY);
    if (!stored) return toastr.warning("No hay un diseño guardado en este navegador.");
    this.confirmDiscard().then((ok) => {
      if (!ok) return;
      try { this.applyDesign(JSON.parse(stored)); toastr.success("Diseño cargado."); }
      catch (error) { console.error(error); toastr.error("El diseño guardado no es válido."); }
    });
  }

  openDesignFile(file) {
    this.confirmDiscard().then((ok) => {
      if (!ok) return;
      const reader = new FileReader();
      reader.onload = () => {
        try { this.applyDesign(JSON.parse(String(reader.result))); toastr.success("Archivo de diseño cargado."); }
        catch (error) { console.error(error); toastr.error("No se pudo leer el archivo de diseño.", "error"); }
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
      .map((element) => {
        const normalized = { ...element };
        if (normalized.type === "table") {
          normalized.tableMode = normalized.tableMode === "manual" ? "manual" : "dynamic";
          normalized.showHeader = normalized.tableMode === "dynamic" ? true : normalized.showHeader === true;
          normalized.columns = this.getTableColumns(normalized);
          normalized.columns.forEach((column) => { column.align = ["left", "center", "right"].includes(column.align) ? column.align : "left"; });
          normalized.rows = Array.isArray(normalized.rows) && normalized.rows.length
            ? normalized.rows.map((row) => normalized.columns.map((_, index) => String(row?.[index] ?? "")))
            : [Array(normalized.columns.length).fill("")];
          if (normalized.tableMode === "manual") normalized.rows = normalized.rows.slice(0, 50);
          normalized.cellAlignments = Array.isArray(normalized.cellAlignments)
            ? normalized.rows.map((row, rowIndex) => normalized.columns.map((_, columnIndex) => ["left", "center", "right"].includes(normalized.cellAlignments?.[rowIndex]?.[columnIndex]) ? normalized.cellAlignments[rowIndex][columnIndex] : "left"))
            : normalized.rows.map(() => normalized.columns.map(() => "left"));
          normalized.cellBold = Array.isArray(normalized.cellBold)
            ? normalized.rows.map((row, rowIndex) => normalized.columns.map((_, columnIndex) => normalized.cellBold?.[rowIndex]?.[columnIndex] === true))
            : normalized.rows.map(() => normalized.columns.map(() => false));
          normalized.cellItalic = Array.isArray(normalized.cellItalic)
            ? normalized.rows.map((row, rowIndex) => normalized.columns.map((_, columnIndex) => normalized.cellItalic?.[rowIndex]?.[columnIndex] === true))
            : normalized.rows.map(() => normalized.columns.map(() => false));
          normalized.cellUnderline = Array.isArray(normalized.cellUnderline)
            ? normalized.rows.map((row, rowIndex) => normalized.columns.map((_, columnIndex) => normalized.cellUnderline?.[rowIndex]?.[columnIndex] === true))
            : normalized.rows.map(() => normalized.columns.map(() => false));
          normalized.cellFontSizes = Array.isArray(normalized.cellFontSizes)
            ? normalized.rows.map((row, rowIndex) => normalized.columns.map((_, columnIndex) => {
              const size = Number(normalized.cellFontSizes?.[rowIndex]?.[columnIndex]);
              return Number.isFinite(size) && size >= 0.5 ? Math.min(12, size) : 2.2;
            }))
            : normalized.rows.map(() => normalized.columns.map(() => 2.2));
          normalized.cellFontFamilies = Array.isArray(normalized.cellFontFamilies)
            ? normalized.rows.map((row, rowIndex) => normalized.columns.map((_, columnIndex) => ReportDesigner.FONT_FAMILIES[normalized.cellFontFamilies?.[rowIndex]?.[columnIndex]] ? normalized.cellFontFamilies[rowIndex][columnIndex] : "arial"))
            : normalized.rows.map(() => normalized.columns.map(() => "arial"));
          if (normalized.tableMode === "manual") normalized.previewRows = normalized.rows.length;
          if (normalized.rowHeight == null || normalized.previewRows == null) {
            normalized.previewRows = 1;
            normalized.rowHeight = (Number(normalized.h) || 18) / 2;
          }
          normalized.rowHeights = this.getTableRowHeights(normalized, normalized.previewRows);
          normalized.h = this.round(normalized.rowHeights.reduce((sum, height) => sum + height, 0));
          normalized.rowHeight = this.round(normalized.rowHeights.slice(1).reduce((sum, height) => sum + height, 0) / normalized.previewRows);
          normalized.borderWidth ??= 0.25;
          normalized.backgroundColor ||= "#ffffff";
          normalized.headerColor ||= "#fff6d8";
          normalized.dynamicPreviewRows ??= normalized.previewRows;
          normalized.borders = this.getTableBorders(normalized);
        }
        return normalized;
      });
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
    this.setSelection(this.elements[0] ? [this.elements[0].id] : []);
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
    const snapshot = JSON.stringify({ elements: this.elements, selectedId: this.selectedId, selectedIds: this.selectedIds });
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
    this.setSelection(snapshot.selectedIds || (snapshot.selectedId ? [snapshot.selectedId] : []));
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
    this.canvas.innerHTML = `<rect width="${width}" height="${height}" fill="#fff"/><g data-rd-grid pointer-events="none"></g><image data-rd-ref x="0" y="0" width="${width}" height="${height}" preserveAspectRatio="none" pointer-events="none" display="none"></image><g data-rd-margins pointer-events="none"></g><g data-rd-content></g><g data-rd-alignment-guides pointer-events="none"></g><g data-rd-selection pointer-events="none"></g>`;
    this.dom = {
      grid: this.canvas.querySelector("[data-rd-grid]"),
      reference: this.canvas.querySelector("[data-rd-ref]"),
      margins: this.canvas.querySelector("[data-rd-margins]"),
      content: this.canvas.querySelector("[data-rd-content]"),
      alignmentGuides: this.canvas.querySelector("[data-rd-alignment-guides]"),
      selection: this.canvas.querySelector("[data-rd-selection]"),
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
    this.dom.alignmentGuides.innerHTML = this.alignmentGuidesMarkup();
    this.renderSelectionBox();
  }

  alignmentGuidesMarkup() {
    const { width, height } = ReportDesigner.PAGE;
    const guides = [];
    if (this.alignmentGuides.vertical != null) {
      const x = this.alignmentGuides.vertical;
      guides.push(`<line x1="${x}" y1="0" x2="${x}" y2="${height}" stroke="#1683e8" stroke-width=".45" stroke-dasharray="1.4 1"/>`);
    }
    if (this.alignmentGuides.horizontal != null) {
      const y = this.alignmentGuides.horizontal;
      guides.push(`<line x1="0" y1="${y}" x2="${width}" y2="${y}" stroke="#1683e8" stroke-width=".45" stroke-dasharray="1.4 1"/>`);
    }
    return guides.join("");
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

  tableMarkup(element, x, y, w, h) {
    const previewRows = this.getTableDisplayRows(element);
    const rowHeights = this.getTableRowHeights(element, previewRows);
    const tableHeight = rowHeights.reduce((sum, height) => sum + height, 0);
    const header = rowHeights[0];
    const columns = this.getTableColumns(element);
    const columnWidths = this.getTableColumnWidths(element, w);
    const columnX = [];
    columnWidths.slice(0, -1).forEach((width, index) => columnX.push(x + columnWidths.slice(0, index + 1).reduce((sum, value) => sum + value, 0)));
    const borders = this.getTableBorders(element);
    const drawLine = (side, x1, y1, x2, y2, width) => {
      const border = borders[side];
      if (!border.enabled) return "";
      const dash = border.style === "dashed" ? 'stroke-dasharray="1.5 1"'
        : border.style === "dotted" ? 'stroke-dasharray=".2 .8" stroke-linecap="round"' : "";
      return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${this.escapeAttr(border.color)}" stroke-width="${element.borderWidth ?? width}" ${dash}/>`;
    };
    const textColor = this.escapeAttr(element.color || "#191a1d");
    const headerText = (offset, width, label, align) => {
      const normalized = ["left", "center", "right"].includes(align) ? align : "left";
      const textX = normalized === "center" ? x + offset + width / 2 : normalized === "right" ? x + offset + width - 1 : x + offset + 1;
      const anchor = normalized === "center" ? "middle" : normalized === "right" ? "end" : "start";
      return `<text x="${textX}" y="${y + header / 2 + .8}" text-anchor="${anchor}" font-family="Arial,sans-serif" font-size="2.3" font-weight="700" fill="${this.escapeAttr(element.headerTextColor || element.color || "#191a1d")}">${this.escapeHtml(label)}</text>`;
    };
    let rowTop = y + header;
    const bodyRows = rowHeights.slice(1).map((height, i) => {
      const row = element.rows?.[i] || [];
      let offset = 0;
      const cells = columns.map((column, columnIndex) => {
        const cellText = element.tableMode === "manual" ? row[columnIndex] || "" : (column.field ? `{{${column.field}}}` : "");
        const cellStyle = element.tableMode === "manual" ? this.getManualCellStyle(element, i, columnIndex) : null;
        const align = cellStyle?.align || column.align || "left";
        const cellX = x + offset;
        let markup;
        if (cellStyle && !element.locked) {
          const justify = align === "center" ? "center" : align === "right" ? "flex-end" : "flex-start";
          const fontFamily = ReportDesigner.FONT_FAMILIES[cellStyle.fontFamily] || ReportDesigner.FONT_FAMILIES.arial;
          const active = this.activeTableCell?.elementId === element.id && this.activeTableCell.row === i && this.activeTableCell.column === columnIndex;
          markup = `<foreignObject x="${cellX}" y="${rowTop}" width="${columnWidths[columnIndex]}" height="${height}"><div xmlns="http://www.w3.org/1999/xhtml" data-rd-inline-cell data-row="${i}" data-column="${columnIndex}" contenteditable="plaintext-only" spellcheck="false" style="display:flex;align-items:center;justify-content:${justify};box-sizing:border-box;width:100%;height:100%;padding:0 1px;overflow:hidden;overflow-wrap:anywhere;white-space:pre-wrap;outline:${active ? ".2px dashed #d99b00" : "none"};font-family:${this.escapeAttr(fontFamily.css)};font-size:${cellStyle.fontSize}px;line-height:${cellStyle.fontSize * 1.15}px;font-weight:${cellStyle.bold ? "700" : "400"};font-style:${cellStyle.italic ? "italic" : "normal"};text-decoration:${cellStyle.underline ? "underline" : "none"};color:${textColor};cursor:text">${this.escapeHtml(cellText)}</div></foreignObject>`;
        } else {
        const textX = align === "center" ? x + offset + columnWidths[columnIndex] / 2 : align === "right" ? x + offset + columnWidths[columnIndex] - 1 : x + offset + 1;
        const anchor = align === "center" ? "middle" : align === "right" ? "end" : "start";
        const weight = cellStyle?.bold ? "700" : "400";
        const fontSize = cellStyle?.fontSize || 2.2;
        const fontFamily = ReportDesigner.FONT_FAMILIES[cellStyle?.fontFamily] || ReportDesigner.FONT_FAMILIES.arial;
        const fontStyle = cellStyle?.italic ? "italic" : "normal";
        const decoration = cellStyle?.underline ? "text-decoration=\"underline\"" : "";
        markup = `<text x="${textX}" y="${rowTop + height / 2 + .8}" text-anchor="${anchor}" font-family="${this.escapeAttr(fontFamily.css)}" font-size="${fontSize}" font-weight="${weight}" font-style="${fontStyle}" ${decoration} fill="${textColor}">${this.escapeHtml(cellText)}</text>`;
        }
        offset += columnWidths[columnIndex];
        return markup;
      }).join("");
      const markup = `${i > 0 ? drawLine("insideHorizontal", x, rowTop, x + w, rowTop, .2) : ""}${cells}`;
      rowTop += height;
      return markup;
    }).join("");
    const hasHeader = element.tableMode !== "manual" || element.showHeader !== false;
    const headers = hasHeader ? columns.map((column, index) => headerText(columnWidths.slice(0, index).reduce((sum, width) => sum + width, 0), columnWidths[index], column.label || `Columna ${index + 1}`, column.align)).join("") : "";
    const verticalBorders = columnX.map((divider) => drawLine("insideVertical", divider, y, divider, y + tableHeight, .2)).join("");
    return `<rect x="${x}" y="${y}" width="${w}" height="${tableHeight}" fill="${this.escapeAttr(element.backgroundColor || "#ffffff")}" stroke="none"/>${hasHeader ? `<rect x="${x}" y="${y}" width="${w}" height="${header}" fill="${this.escapeAttr(element.headerColor || "#fff6d8")}" stroke="none"/>` : ""}${drawLine("top", x, y, x + w, y, .3)}${drawLine("right", x + w, y, x + w, y + tableHeight, .3)}${drawLine("bottom", x, y + tableHeight, x + w, y + tableHeight, .3)}${drawLine("left", x, y, x, y + tableHeight, .3)}${hasHeader ? drawLine("insideHorizontal", x, y + header, x + w, y + header, .2) : ""}${bodyRows}${verticalBorders}${headers}`;
  }

  getTableColumnWidths(element, totalWidth) {
    const total = Math.max(1, Number(totalWidth) || 1);
    const count = this.getTableColumns(element).length;
    const saved = Array.isArray(element.columnWidths) && element.columnWidths.length === count
      ? element.columnWidths.map(Number)
      : Array(count).fill(1);
    const ratios = saved.map((ratio) => Number.isFinite(ratio) && ratio > 0 ? ratio : 1);
    const ratioTotal = ratios.reduce((sum, ratio) => sum + ratio, 0);
    return ratios.map((ratio) => total * ratio / ratioTotal);
  }

  getTableRowHeights(element, previewRows = Number(element.previewRows) || 1) {
    const maximum = element.tableMode === "manual" ? 50 : 20;
    const count = Math.max(1, Math.min(maximum, Math.floor(Number(previewRows) || 1))) + 1;
    const fallback = Math.max(2, Number(element.rowHeight) || 7);
    const saved = Array.isArray(element.rowHeights) ? element.rowHeights : [];
    return Array.from({ length: count }, (_, index) => {
      if (index === 0 && element.tableMode === "manual" && element.showHeader === false) return 0;
      const height = Number(saved[index]);
      return Number.isFinite(height) && height >= 2 ? height : fallback;
    });
  }

  tableResizeHandles(element, x, y, w) {
    if (element.locked || this.selectedId !== element.id) return "";
    const previewRows = this.getTableDisplayRows(element);
    const rowHeights = this.getTableRowHeights(element, previewRows);
    const tableHeight = rowHeights.reduce((sum, height) => sum + height, 0);
    const columnWidths = this.getTableColumnWidths(element, w);
    const dividers = [];
    columnWidths.slice(0, -1).forEach((width, index) => dividers.push(x + columnWidths.slice(0, index + 1).reduce((sum, value) => sum + value, 0)));
    const columns = dividers.map((divider, index) => `<line x1="${divider}" y1="${y}" x2="${divider}" y2="${y + tableHeight}" stroke="#d99b00" stroke-width=".35" opacity=".45" pointer-events="none"/><rect data-rd-table-col-resize="${index}" x="${divider - 1.25}" y="${y}" width="2.5" height="${tableHeight}" fill="#d99b00" opacity=".001" style="cursor:col-resize"/>`).join("");
    const hasHeader = element.tableMode !== "manual" || element.showHeader !== false;
    const boundaries = hasHeader ? Array.from({ length: previewRows }, (_, index) => index) : Array.from({ length: Math.max(0, previewRows - 1) }, (_, index) => index + 1);
    const rows = boundaries.map((index) => {
      const offset = rowHeights.slice(0, index + 1).reduce((sum, height) => sum + height, 0);
      const divider = y + offset;
      return `<line x1="${x}" y1="${divider}" x2="${x + w}" y2="${divider}" stroke="#d99b00" stroke-width=".35" opacity=".45" pointer-events="none"/><rect data-rd-table-row-resize="${index}" x="${x}" y="${divider - 1.25}" width="${w}" height="2.5" fill="#d99b00" opacity=".001" style="cursor:row-resize"/>`;
    }).join("");
    return `${columns}${rows}`;
  }

  elementMarkup(element) {
    const id = this.escapeAttr(element.id);
    const color = this.escapeAttr(element.color || "#191a1d");
    const selected = this.selectedIds.includes(element.id) || this.selectedId === element.id;
    const primarySelected = this.selectedId === element.id && this.selectedIds.length <= 1;
    const x = Number(element.x) || 0;
    const y = Number(element.y) || 0;
    const w = Number(element.w) || 0;
    const h = Number(element.h) || 0;
    const isLine = element.type === "line";
    const line = isLine ? this.lineCoordinates(element) : null;
    // Caja que ocupa el elemento; en una línea se calcula a partir de los extremos ya rotados.
    const box = isLine
      ? { x: Math.min(line.x1, line.x2), y: Math.min(line.y1, line.y2), w: Math.max(Math.abs(line.x2 - line.x1), 1), h: Math.max(Math.abs(line.y2 - line.y1), 1) }
      : { x, y, w: Math.max(w, 1), h: Math.max(h, 1) };
    let shape = "";
    let overflow = false;

    if (element.type === "text") {
      const size = Number(element.fontSize) || 3;
      const fontFamily = ReportDesigner.FONT_FAMILIES[element.fontFamily] || ReportDesigner.FONT_FAMILIES.arial;
      const align = element.align === "C" ? "middle" : element.align === "R" ? "end" : "start";
      const tx = element.align === "C" ? x + w / 2 : element.align === "R" ? x + w : x;
      const lines = this.textLines(element);
      overflow = lines.length * size * 1.2 > h * 1.05 + 0.01;
      shape = `<text x="${tx}" y="${y + size}" text-anchor="${align}" font-family="${this.escapeAttr(fontFamily.css)}" font-size="${size}" fill="${color}" font-weight="${element.bold ? "700" : "400"}">${lines.map((line, index) => `<tspan x="${tx}" dy="${index ? size * 1.2 : 0}">${this.escapeHtml(line)}</tspan>`).join("")}</text>`;
    } else if (isLine) {
      shape = `<line x1="${line.x1}" y1="${line.y1}" x2="${line.x2}" y2="${line.y2}" stroke="${color}" stroke-width=".35"/>`;
    } else if (element.type === "rect") {
      const filled = element.fill && element.fill !== "transparent";
      shape = `<rect x="${x}" y="${y}" width="${box.w}" height="${box.h}" fill="${filled ? this.escapeAttr(element.fill) : "none"}" stroke="${color}" stroke-width=".35"/>`;
    } else if (element.type === "circle") {
      shape = `<ellipse cx="${x + box.w / 2}" cy="${y + box.h / 2}" rx="${box.w / 2}" ry="${box.h / 2}" fill="none" stroke="${color}" stroke-width=".35"/>`;
    } else if (element.type === "table") {
      shape = this.tableMarkup(element, x, y, box.w, box.h);
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

    const rotationHandle = primarySelected && isLine && !element.locked
      ? (() => {
        const handleX = line.cx + Math.sin(line.angle) * 7;
        const handleY = line.cy - Math.cos(line.angle) * 7;
        return `<line x1="${line.cx}" y1="${line.cy}" x2="${handleX}" y2="${handleY}" stroke="#d99b00" stroke-width=".3" stroke-dasharray=".8 .6" pointer-events="none"/><circle data-rd-rotate cx="${handleX}" cy="${handleY}" r="2.2" fill="#fff" stroke="#d99b00" stroke-width=".6" style="cursor:grab"/><text x="${handleX}" y="${handleY + .8}" text-anchor="middle" font-size="2.4" fill="#191a1d" pointer-events="none">↻</text>`;
      })()
      : "";
    const tableHandles = element.type === "table" && primarySelected ? this.tableResizeHandles(element, x, y, box.w) : "";
    const outline = selected
      ? `<rect x="${box.x - 1}" y="${box.y - 1}" width="${box.w + 2}" height="${box.h + 2}" fill="none" stroke="#d99b00" stroke-width=".35" stroke-dasharray="1 1" pointer-events="none"/>${primarySelected && !element.locked ? `<rect data-rd-resize="se" x="${box.x + box.w - 1.5}" y="${box.y + box.h - 1.5}" width="3" height="3" fill="#d99b00" stroke="#fff" stroke-width=".3" style="cursor:nwse-resize"/>` : ""}${rotationHandle}`
      : "";
    const tableMoveHandle = primarySelected && element.type === "table" && !element.locked
      ? `<rect data-rd-table-move x="${box.x + box.w / 2 - 3}" y="${box.y - 2.5}" width="6" height="1.5" rx=".6" fill="#d99b00" stroke="#fff" stroke-width=".25" style="cursor:move"/>`
      : "";
    return `<g data-rd-element="${id}" style="cursor:${element.locked ? "not-allowed" : "move"}">${hit}${shape}${outline}${tableMoveHandle}${tableHandles}</g>`;
  }

  renderLayers() {
    if (!this.layers) return;
    this.layers.innerHTML = this.elements.slice().reverse().map((element) => {
      const selected = this.selectedIds.includes(element.id) || this.selectedId === element.id;
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
    if (this.selectedIds.length > 1) {
      const grouped = this.elements.some((element) => this.selectedIds.includes(element.id) && element.groupId);
      this.properties.innerHTML = `<section class="rd-prop-group"><h3 class="rd-section-title">Selección múltiple</h3><p class="mb-2"><strong>${this.selectedIds.length} elementos seleccionados</strong></p><p class="rd-hint">Arrástralos desde el lienzo para moverlos juntos.</p><div class="d-grid gap-2"><button class="btn btn-warning" type="button" data-rd-action="group-elements"><i class="fa fa-object-group me-2"></i>Agrupar</button>${grouped ? `<button class="btn btn-outline-secondary" type="button" data-rd-action="ungroup-elements"><i class="fa fa-object-ungroup me-2"></i>Desagrupar</button>` : ""}<button class="btn btn-outline-danger" type="button" data-rd-action="delete"><i class="fa fa-trash me-2"></i>Eliminar selección</button></div></section>`;
      return;
    }
    const element = this.selected;
    if (!element) {
      this.properties.innerHTML = `<div class="rd-empty"><i class="fa fa-arrow-pointer"></i>Selecciona un elemento del lienzo o de la lista de capas para editarlo.</div>`;
      return;
    }
    const type = element.type;
    const index = this.elements.findIndex((item) => item.id === element.id);

    const field = (key, label, value, { inputType = "text", step, min, max, unit, placeholder } = {}) => {
      const attrs = `${step != null ? ` step="${step}"` : ""}${min != null ? ` min="${min}"` : ""}${max != null ? ` max="${max}"` : ""}${placeholder ? ` placeholder="${this.escapeAttr(placeholder)}"` : ""}`;
      const input = `<input class="form-control" id="rd-prop-${key}" type="${inputType}"${attrs} value="${this.escapeAttr(value ?? "")}" data-rd-property="${key}">`;
      return `<div><label class="form-label" for="rd-prop-${key}">${label}</label>${unit ? `<div class="input-group">${input}<span class="input-group-text">${unit}</span></div>` : input}</div>`;
    };
    const colorField = (key, label, value) => `<div><label class="form-label" for="rd-prop-${key}">${label}</label><div class="input-group rd-color-control"><input class="form-control form-control-color" id="rd-prop-${key}" type="color" value="${this.escapeAttr(value)}" data-rd-property="${key}"><button class="btn btn-outline-secondary btn-sm" type="button" data-rd-action="pick-color" data-rd-color-target="${key}" title="Tomar un color de la pantalla" aria-label="Tomar color para ${label.toLowerCase()}"><i class="fa fa-eye-dropper" aria-hidden="true"></i></button></div></div>`;
    const group = (title, body) => `<section class="rd-prop-group"><h3 class="rd-section-title">${title}</h3>${body}</section>`;

    const head = `<div class="rd-prop-head"><span class="rd-layer-icon"><i class="fa ${this.iconFor(type)}"></i></span><div class="flex-grow-1"><div class="rd-prop-type">${ReportDesigner.ELEMENT_NAMES[type]}${element.locked ? ' · <i class="fa fa-lock"></i> bloqueado' : ""}</div>${field("label", "Nombre de la capa", element.label || "")}</div></div>`;

    let content = "";
    if (type === "text") {
      const size = Number(element.fontSize) || 3;
      const fontKey = ReportDesigner.FONT_FAMILIES[element.fontFamily] ? element.fontFamily : "arial";
      const fontFamily = ReportDesigner.FONT_FAMILIES[fontKey];
      const align = element.align || "L";
      const radio = (value, icon, title) => `<input class="visually-hidden" type="radio" name="rd-align" id="rd-align-${value}" value="${value}" data-rd-property="align" ${align === value ? "checked" : ""}><label for="rd-align-${value}" title="${title}"><i class="fa ${icon}"></i><span class="visually-hidden">${title}</span></label>`;
      const overflow = this.textLines(element).length * size * 1.2 > (Number(element.h) || 0) * 1.05 + 0.01;
      content += group("Contenido", `<div class="mb-2"><label class="form-label" for="rd-prop-text">Texto</label><textarea class="form-control" id="rd-prop-text" rows="3" data-rd-property="text">${this.escapeHtml(element.text || "")}</textarea></div>${field("binding", "Campo dinámico", element.binding || "", { placeholder: "cliente.nombre" })}<div class="rd-hint">Si defines un campo dinámico, reemplaza al texto al generar el PDF.</div>${overflow ? `<div class="rd-hint is-warning"><i class="fa fa-triangle-exclamation me-1"></i>El texto no cabe en el alto del cuadro. Aumenta el alto o reduce el tamaño.</div>` : ""}`);
      const fontOptions = Object.entries(ReportDesigner.FONT_FAMILIES).map(([key, font]) => `<option value="${key}" ${fontKey === key ? "selected" : ""}>${font.label}</option>`).join("");
      content += group("Tipografía", `<div class="mb-2"><label class="form-label" for="rd-prop-fontFamily">Fuente</label><select class="form-select" id="rd-prop-fontFamily" data-rd-property="fontFamily">${fontOptions}</select></div><div class="rd-prop-grid">${field("fontSize", "Tamaño", element.fontSize, { inputType: "number", step: ".1", min: "0.5", unit: "mm" })}${colorField("color", "Color", element.color || "#191a1d")}</div><div class="rd-hint">≈ ${Math.round(size * ReportDesigner.MM_TO_PT * 10) / 10} pt en el PDF</div><div class="rd-style-row"><div class="rd-segment" role="group" aria-label="Negrita"><input class="visually-hidden" type="checkbox" id="rd-bold" data-rd-property="bold" ${element.bold ? "checked" : ""}><label for="rd-bold" title="Negrita"><i class="fa fa-bold"></i><span class="visually-hidden">Negrita</span></label></div><div class="rd-segment" role="radiogroup" aria-label="Alineación">${radio("L", "fa-align-left", "Izquierda")}${radio("C", "fa-align-center", "Centro")}${radio("R", "fa-align-right", "Derecha")}</div></div>`);
    } else if (type === "table") {
      const borders = this.getTableBorders(element);
      const columns = this.getTableColumns(element);
      const tableMode = element.tableMode === "manual" ? "manual" : "dynamic";
      const modeOptions = [["dynamic", "Filas dinámicas por lote"], ["manual", "Tabla manual"]]
        .map(([value, label]) => `<option value="${value}" ${tableMode === value ? "selected" : ""}>${label}</option>`).join("");
      const alignmentButtons = (align, attrs) => `<div class="btn-group btn-group-sm" role="group" aria-label="Alineación de celda">${[["left", "fa-align-left", "Alinear a la izquierda"], ["center", "fa-align-center", "Centrar"], ["right", "fa-align-right", "Alinear a la derecha"]].map(([value, icon, label]) => `<button type="button" class="btn ${align === value ? "btn-warning" : "btn-outline-secondary"}" data-rd-action="set-table-alignment" data-rd-align="${value}" ${attrs} title="${label}" aria-label="${label}" aria-pressed="${align === value}"><i class="fa ${icon}" aria-hidden="true"></i></button>`).join("")}</div>`;
      const columnEditor = columns.map((column, columnIndex) => `<div class="border rounded p-2 mb-2"><div class="d-flex align-items-center justify-content-between mb-2"><strong>Columna ${columnIndex + 1}</strong><button class="btn btn-outline-danger btn-sm" type="button" data-rd-action="delete-table-column" data-rd-column="${columnIndex}" title="Eliminar columna" aria-label="Eliminar columna ${columnIndex + 1}" ${columns.length <= 1 ? "disabled" : ""}><i class="fa fa-trash"></i></button></div>${field(`columns.${columnIndex}.label`, tableMode === "manual" ? "Nombre de referencia" : "Encabezado", column.label || `Columna ${columnIndex + 1}`)}${tableMode === "dynamic" ? `<div class="mt-2">${field(`columns.${columnIndex}.field`, "Campo del lote", column.field || "", { placeholder: "codigo" })}</div><div class="d-flex align-items-center justify-content-between mt-2"><label class="form-label mb-0">Alineación de celdas</label>${alignmentButtons(column.align || "left", `data-rd-column="${columnIndex}"`)}</div>` : `<div class="d-flex align-items-center justify-content-between mt-2"><label class="form-label mb-0">Alineación de cabecera</label>${alignmentButtons(column.align || "left", `data-rd-column="${columnIndex}"`)}</div>`}</div>`).join("");
      const manualRows = (element.rows?.length ? element.rows : [Array(columns.length).fill("")]).map((row, rowIndex) => {
        const summary = row.map((value, columnIndex) => `<span><strong>${this.escapeHtml(columns[columnIndex]?.label || `Columna ${columnIndex + 1}`)}:</strong> ${this.escapeHtml(value || "—")}</span>`).join(' <span class="text-muted">·</span> ');
        return `<div class="border rounded px-2 py-1 mb-1 d-flex align-items-center justify-content-between gap-2"><span class="text-truncate"><strong>Fila ${rowIndex + 1}</strong><span class="ms-2">${summary}</span></span><button class="btn btn-outline-danger btn-sm flex-shrink-0" type="button" data-rd-action="delete-table-row" data-rd-row="${rowIndex}" title="Eliminar fila" aria-label="Eliminar fila ${rowIndex + 1}" ${element.rows?.length <= 1 ? "disabled" : ""}><i class="fa fa-trash"></i></button></div>`;
      }).join("");
      const activeCell = this.activeTableCell?.elementId === element.id && tableMode === "manual" && element.rows?.[this.activeTableCell.row]?.[this.activeTableCell.column] !== undefined
        ? { ...this.activeTableCell, style: this.getManualCellStyle(element, this.activeTableCell.row, this.activeTableCell.column) }
        : null;
      const cellFontOptions = Object.entries(ReportDesigner.FONT_FAMILIES).map(([key, font]) => `<option value="${key}" ${activeCell?.style.fontFamily === key ? "selected" : ""}>${font.label}</option>`).join("");
      const cellFormatToolbar = tableMode !== "manual" ? "" : activeCell
        ? group("Celda seleccionada", `<div class="rd-cell-position"><i class="fa fa-table" aria-hidden="true"></i><span>Fila ${activeCell.row + 1} · ${this.escapeHtml(columns[activeCell.column]?.label || `Columna ${activeCell.column + 1}`)}</span></div><div class="rd-cell-format-grid"><div class="rd-cell-control"><label class="form-label" for="rd-cell-font-family">Fuente</label><select class="form-select form-select-sm" id="rd-cell-font-family" aria-label="Fuente de la celda" data-rd-cell-font-family data-row="${activeCell.row}" data-column="${activeCell.column}">${cellFontOptions}</select></div><div class="rd-cell-control rd-cell-size"><label class="form-label" for="rd-cell-font-size">Tamaño de letra</label><div class="input-group input-group-sm"><span class="input-group-text"><i class="fa fa-text-height" aria-hidden="true"></i></span><input class="form-control" id="rd-cell-font-size" type="number" min="0.5" max="12" step="0.1" aria-label="Tamaño de letra en milímetros" title="Tamaño de letra en milímetros" data-rd-cell-font-size data-row="${activeCell.row}" data-column="${activeCell.column}" value="${activeCell.style.fontSize}"><span class="input-group-text">mm</span></div></div></div><div class="rd-cell-format-actions"><div class="btn-group btn-group-sm" role="group" aria-label="Estilos de texto"><button type="button" class="btn ${activeCell.style.bold ? "btn-warning" : "btn-outline-secondary"}" data-rd-action="toggle-manual-cell-bold" data-rd-row="${activeCell.row}" data-rd-column="${activeCell.column}" title="Negrita" aria-label="Negrita" aria-pressed="${activeCell.style.bold}"><i class="fa fa-bold"></i></button><button type="button" class="btn ${activeCell.style.italic ? "btn-warning" : "btn-outline-secondary"}" data-rd-action="toggle-manual-cell-style" data-style="italic" data-row="${activeCell.row}" data-column="${activeCell.column}" title="Cursiva" aria-label="Cursiva" aria-pressed="${activeCell.style.italic}"><i class="fa fa-italic"></i></button><button type="button" class="btn ${activeCell.style.underline ? "btn-warning" : "btn-outline-secondary"}" data-rd-action="toggle-manual-cell-style" data-row="${activeCell.row}" data-column="${activeCell.column}" title="Subrayado" aria-label="Subrayado" aria-pressed="${activeCell.style.underline}"><i class="fa fa-underline"></i></button></div>${alignmentButtons(activeCell.style.align, `data-rd-row="${activeCell.row}" data-rd-column="${activeCell.column}"`)}</div>`)
        : group("Formato de celda", `<p class="rd-hint mb-0">Haz clic en una celda del lienzo para editar su texto y formato aquí.</p>`);
      const styles = [
        ["solid", "Sólido"],
        ["dotted", "Punteado"],
        ["dashed", "Discontinuo"],
      ];
      const borderButtons = Object.entries(ReportDesigner.TABLE_BORDER_NAMES).map(([side, label]) => {
        const border = borders[side];
        const icons = {
          top: '<path d="M3 5h18"/><path d="M5 5v14M19 5v14M3 19h18"/>',
          right: '<path d="M19 3v18"/><path d="M5 5v14M5 3h14M5 21h14"/>',
          bottom: '<path d="M3 19h18"/><path d="M5 5v14M19 5v14M3 5h18"/>',
          left: '<path d="M5 3v18"/><path d="M19 5v14M5 5h14M5 19h14"/>',
          insideHorizontal: '<path d="M3 3h18M3 12h18M3 21h18M5 3v18M19 3v18"/>',
          insideVertical: '<path d="M3 3v18M12 3v18M21 3v18M3 5h18M3 19h18"/>',
        };
        return `<button type="button" class="rd-table-border-button ${border.enabled ? "is-active" : ""}" data-rd-action="toggle-table-border" data-rd-border="${side}" title="${label}" aria-label="${label}" aria-pressed="${border.enabled}"><svg viewBox="0 0 24 24" aria-hidden="true">${icons[side]}</svg></button>`;
      }).join("");
      const styleOptions = styles.map(([value, text]) => `<option value="${value}" ${borders.top.style === value ? "selected" : ""}>${text}</option>`).join("");
      content += cellFormatToolbar;
      content += group("Estructura", `<div><label class="form-label" for="rd-table-mode">Tipo de tabla</label><select class="form-select" id="rd-table-mode" data-rd-property="tableMode">${modeOptions}</select><p class="rd-hint">Las filas dinámicas se repiten por cada lote. Las manuales se editan directamente en el lienzo.</p></div>${tableMode === "manual" ? `<div class="form-check form-switch mt-2"><input class="form-check-input" type="checkbox" role="switch" id="rd-table-header" data-rd-property="showHeader" ${element.showHeader ? "checked" : ""}><label class="form-check-label" for="rd-table-header">Mostrar cabecera</label></div>` : ""}<div class="d-flex align-items-center justify-content-between mt-2 mb-2"><h4 class="form-label mb-0">Columnas</h4><button class="btn btn-outline-primary btn-sm" type="button" data-rd-action="add-table-column"><i class="fa fa-plus me-1"></i>Columna</button></div>${columnEditor}${tableMode === "manual" ? `<div class="d-flex align-items-center justify-content-between mt-3 mb-2"><h4 class="form-label mb-0">Filas manuales</h4><button class="btn btn-outline-primary btn-sm" type="button" data-rd-action="add-table-row"><i class="fa fa-plus me-1"></i>Fila</button></div>${manualRows}` : `<div class="rd-hint">En modo dinámico, las filas finales las determina la cantidad de lotes.</div>`}`);
      content += group("Apariencia", `<div class="rd-prop-grid">${colorField("backgroundColor", "Color de fondo de filas", element.backgroundColor || "#ffffff")}${colorField("color", "Color de texto de filas", element.color || "#191a1d")}</div><div class="rd-prop-grid mt-2">${colorField("headerColor", "Color de fondo de cabecera", element.headerColor || "#fff6d8")}${colorField("headerTextColor", "Color de texto de cabecera", element.headerTextColor || element.color || "#191a1d")}</div>`);
      content += group("Bordes", `<div><label class="form-label">Bordes</label><div class="rd-table-border-buttons" role="group" aria-label="Lados de la tabla">${borderButtons}</div></div><p class="rd-hint">Activa cada lado de forma independiente.</p><p class="rd-hint">Arrastra las divisiones del lienzo para ajustar el ancho de columnas y las filas adyacentes.</p><div><label class="form-label" for="rd-table-border-style">Estilo de borde</label><select class="form-select" id="rd-table-border-style" data-rd-property="borders.style">${styleOptions}</select></div><div class="rd-prop-grid mt-2">${colorField("borders.color", "Color de borde", borders.top.color)}${field("borderWidth", "Grosor de borde", element.borderWidth ?? 0.25, { inputType: "number", step: ".05", min: "0.05", max: "3", unit: "mm" })}</div><div class="rd-prop-grid mt-2">${field("rowHeight", "Alto uniforme de filas", element.rowHeight ?? 7, { inputType: "number", step: ".5", min: "2", max: "100", unit: "mm" })}${tableMode === "dynamic" ? field("previewRows", "Filas de vista previa", element.previewRows ?? 4, { inputType: "number", step: "1", min: "1", max: "20" }) : ""}</div>`);
    } else if (type === "line" || type === "rect" || type === "circle" || type === "qrcode") {
      const hasFill = element.fill && element.fill !== "transparent";
      const fillValue = /^#[0-9a-f]{6}$/i.test(element.fill || "") ? element.fill : "#ffffff";
      content += group("Apariencia", `<div class="rd-prop-grid">${colorField("color", type === "qrcode" ? "Color" : "Trazo", element.color || "#191a1d")}${type === "rect" ? colorField("fill", "Relleno", fillValue) : ""}</div>${type === "rect" ? `<button class="btn btn-outline-secondary btn-sm w-100 mt-2" type="button" data-rd-action="clear-fill" ${hasFill ? "" : "disabled"}><i class="fa fa-droplet-slash me-1"></i>${hasFill ? "Quitar relleno" : "Sin relleno"}</button>` : ""}`);
      if (type === "line") {
        content += group("Rotación", `${field("rotation", "Ángulo", this.normalizeAngle(element.rotation || 0), { inputType: "number", step: "1", min: "-180", max: "180", unit: "°" })}<div class="rd-btn-row mt-2"><button class="btn btn-outline-secondary btn-sm" type="button" data-rd-action="rotation-reset"><i class="fa fa-rotate-left me-1"></i>Restablecer</button></div><p class="rd-hint">Arrastra el control circular en el lienzo para girar la línea. Mantén Mayús para ajustar en pasos de 15°.</p>`);
      }
    }

    const sizeLabels = type === "line" ? ["Largo", "Desnivel"] : ["Ancho", "Alto"];
    content += group("Posición y tamaño", `<div class="rd-prop-grid">${field("x", "X", element.x, { inputType: "number", step: ".5", min: "0", unit: "mm" })}${field("y", "Y", element.y, { inputType: "number", step: ".5", min: "0", unit: "mm" })}${field("w", sizeLabels[0], element.w, { inputType: "number", step: ".5", min: "0", unit: "mm" })}${field("h", sizeLabels[1], element.h, { inputType: "number", step: ".5", unit: "mm" })}</div>`);

    content += group("Capa", `<div class="rd-btn-row"><button class="btn btn-outline-secondary btn-sm" type="button" data-rd-action="layer-up" ${index >= this.elements.length - 1 ? "disabled" : ""}><i class="fa fa-arrow-up me-1"></i>Subir</button><button class="btn btn-outline-secondary btn-sm" type="button" data-rd-action="layer-down" ${index <= 0 ? "disabled" : ""}><i class="fa fa-arrow-down me-1"></i>Bajar</button></div><div class="rd-btn-row"><button class="btn btn-outline-secondary btn-sm" type="button" data-rd-action="duplicate"><i class="fa fa-copy me-1"></i>Duplicar</button><button class="btn btn-outline-danger btn-sm" type="button" data-rd-action="delete"><i class="fa fa-trash me-1"></i>Eliminar</button></div>`);

    this.properties.innerHTML = head + content;
  }

  /* ------------------------------------------------------------------ */
  /* Texto: medición y saltos de línea                                   */
  /* ------------------------------------------------------------------ */

  measureText(text, size, bold, fontFamily = "arial") {
    if (!this.measureCtx) this.measureCtx = document.createElement("canvas").getContext("2d");
    const family = ReportDesigner.FONT_FAMILIES[fontFamily] || ReportDesigner.FONT_FAMILIES.arial;
    this.measureCtx.font = `${bold ? "700" : "400"} 100px ${family.css}`;
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
        if (line && this.measureText(candidate, size, element.bold, element.fontFamily) > maxWidth) {
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

  tableTcpdfCode(element, { label, x, y, w, n, rgb }) {
    const columns = this.getTableColumns(element);
    const columnWidths = this.getTableColumnWidths(element, w).map(n);
    const manual = element.tableMode === "manual";
    const rows = manual ? (element.rows || []) : [];
    const previewRows = this.getTableDisplayRows(element);
    const rowHeights = this.getTableRowHeights(element, previewRows).map(n);
    const defaultRowHeight = n(Number(element.rowHeight) || rowHeights.slice(1).reduce((sum, height) => sum + height, 0) / previewRows);
    const borderWidth = n(element.borderWidth ?? 0.25);
    const borders = this.getTableBorders(element);
    const styleCode = (side) => {
      const border = borders[side];
      const dash = border.style === "dashed" ? "'2,2'" : border.style === "dotted" ? "'0.5,1.5'" : "0";
      const cap = border.style === "dotted" ? "round" : "butt";
      return `$this->SetLineStyle(['width' => ${borderWidth}, 'cap' => '${cap}', 'join' => 'miter', 'dash' => ${dash}, 'color' => [${rgb(border.color)}]]);`;
    };
    const hasHeader = !manual || element.showHeader !== false;
    const lines = [
      `// ${label}`,
      `$tableRowHeights = [${rowHeights.join(", ")}];`,
      `$tableHeaderHeight = ${hasHeader ? "$tableRowHeights[0]" : "0"};`,
    ];
    if (hasHeader) {
      lines.push(
        `$this->SetTextColor(${rgb(element.headerTextColor || element.color || "#191a1d")});`,
        `$this->SetFillColor(${rgb(element.headerColor || "#fff6d8")});`,
        "$this->SetFont('helvetica', 'B', 8);",
        `$this->SetXY(${x}, ${y});`
      );
      columns.forEach((column, index) => {
        const line = index === columns.length - 1 ? 1 : 0;
        const align = { left: "L", center: "C", right: "R" }[column.align] || "L";
        lines.push(`$this->Cell(${columnWidths[index]}, $tableHeaderHeight, '${this.phpEscape(column.label || `Columna ${index + 1}`)}', 0, ${line}, '${align}', true);`);
      });
    }
    lines.push(
      "$this->SetFont('helvetica', '', 8);",
      `$this->SetTextColor(${rgb(element.color || "#191a1d")});`,
      `$this->SetFillColor(${rgb(element.backgroundColor || "#ffffff")});`,
      `$tableY = ${y} + $tableHeaderHeight;`
    );
    if (hasHeader && borders.insideHorizontal.enabled) {
      lines.push(styleCode("insideHorizontal"), `$this->Line(${x}, $tableY, ${n(x + w)}, $tableY);`);
    }
    if (manual) {
      rows.forEach((row, rowIndex) => {
        lines.push(`$rowHeight = $tableRowHeights[${rowIndex + 1}] ?? ${defaultRowHeight};`, `$this->SetXY(${x}, $tableY);`);
        columns.forEach((_, columnIndex) => {
          const value = `'${this.phpEscape(row?.[columnIndex] || "")}'`;
          const style = this.getManualCellStyle(element, rowIndex, columnIndex);
          const align = { left: "L", center: "C", right: "R" }[style.align] || "L";
          const fontStyle = `${style.bold ? "B" : ""}${style.italic ? "I" : ""}${style.underline ? "U" : ""}`;
          const fontFamily = ReportDesigner.FONT_FAMILIES[style.fontFamily] || ReportDesigner.FONT_FAMILIES.arial;
          lines.push(`$this->SetFont('${fontFamily.tcpdf}', '${fontStyle}', ${n(style.fontSize * ReportDesigner.MM_TO_PT)});`);
          lines.push(`$this->Cell(${columnWidths[columnIndex]}, $rowHeight, ${value}, 0, ${columnIndex === columns.length - 1 ? 1 : 0}, '${align}', true);`);
        });
        lines.push("$tableY += $rowHeight;");
        if (borders.insideHorizontal.enabled && rowIndex < rows.length - 1) {
          lines.push(styleCode("insideHorizontal"), `$this->Line(${x}, $tableY, ${n(x + w)}, $tableY);`);
        }
      });
    } else {
      lines.push("$tableRow = 1;", "$tableRowCount = count($data['lotes'] ?? []);", "foreach (($data['lotes'] ?? []) as $fila) {");
      lines.push(`  $rowHeight = $tableRowHeights[$tableRow] ?? ${defaultRowHeight};`, `  $this->SetXY(${x}, $tableY);`);
      columns.forEach((column, index) => {
        const value = column.field ? `$fila['${this.phpEscape(column.field)}'] ?? ''` : "''";
        const align = { left: "L", center: "C", right: "R" }[column.align] || "L";
        lines.push(`  $this->Cell(${columnWidths[index]}, $rowHeight, ${value}, 0, ${index === columns.length - 1 ? 1 : 0}, '${align}', true);`);
      });
      lines.push("  $tableY += $rowHeight;", "  $tableRow++;");
      if (borders.insideHorizontal.enabled) lines.push(`  if ($tableRow <= $tableRowCount) { ${styleCode("insideHorizontal")} $this->Line(${x}, $tableY, ${n(x + w)}, $tableY); }`);
      lines.push("}");
    }
    lines.push("$tableBottom = $tableY;");
    const borderLine = (side, x1, y1, x2, y2) => {
      if (!borders[side].enabled) return;
      lines.push(styleCode(side), `$this->Line(${x1}, ${y1}, ${x2}, ${y2});`);
    };
    borderLine("top", x, y, n(x + w), y);
    borderLine("right", n(x + w), y, n(x + w), "$tableBottom");
    borderLine("bottom", x, "$tableBottom", n(x + w), "$tableBottom");
    borderLine("left", x, y, x, "$tableBottom");
    let dividerX = x;
    columnWidths.slice(0, -1).forEach((width) => {
      dividerX = n(dividerX + width);
      borderLine("insideVertical", dividerX, y, dividerX, "$tableBottom");
    });
    lines.push("$this->SetLineStyle(['width' => 0.35, 'cap' => 'butt', 'join' => 'miter', 'dash' => 0, 'color' => [0, 0, 0]]);", "");
    return lines;
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
        const font = ReportDesigner.FONT_FAMILIES[element.fontFamily] || ReportDesigner.FONT_FAMILIES.arial;
        code.push(`// ${label}`, `$this->SetFont('${font.tcpdf}', '${element.bold ? "B" : ""}', ${pt(element.fontSize)});`, `$this->SetTextColor(${rgb(element.color)});`, `$this->SetXY(${x}, ${y});`, `$this->MultiCell(${w}, ${h}, ${text}, 0, '${align}', false, 1, '', '', true, 0, false, true, ${h}, 'T', false);`, "");
      } else if (element.type === "line") {
        const line = this.lineCoordinates(element);
        code.push(`// ${label}`, `$this->SetDrawColor(${rgb(element.color)});`, `$this->Line(${n(line.x1)}, ${n(line.y1)}, ${n(line.x2)}, ${n(line.y2)});`, "");
      }
      else if (element.type === "rect") {
        const filled = /^#[0-9a-f]{6}$/i.test(element.fill || "");
        code.push(`// ${label}`, `$this->SetDrawColor(${rgb(element.color)});`);
        if (filled) code.push(`$this->SetFillColor(${rgb(element.fill)});`);
        code.push(`$this->Rect(${x}, ${y}, ${w}, ${h}, '${filled ? "DF" : "D"}');`, "");
      } else if (element.type === "circle") code.push(`// ${label}`, `$this->SetDrawColor(${rgb(element.color)});`, `$this->Ellipse(${n(x + w / 2)}, ${n(y + h / 2)}, ${n(w / 2)}, ${n(h / 2)});`, "");
      else if (element.type === "image") code.push(`// ${label}`, `// $this->Image($imagePath, ${x}, ${y}, ${w}, ${h});`, "");
      else if (element.type === "qrcode") code.push(`// ${label}`, `$this->write2DBarcode($data['qr'] ?? '', 'QRCODE,H', ${x}, ${y}, ${w}, ${h});`, "");
      else if (element.type === "table") {
        code.push(...this.tableTcpdfCode(element, { label, x, y, w, n, rgb }));
      }
    }
    return code.join("\n");
  }

  previewPDF() {
    if (!window.jspdf?.jsPDF) return toastr.error("No se cargó jsPDF para la vista previa.");
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
        const font = ReportDesigner.FONT_FAMILIES[element.fontFamily] || ReportDesigner.FONT_FAMILIES.arial;
        pdf.setFont(font.jsPDF, element.bold ? "bold" : "normal");
        pdf.setFontSize(size * ReportDesigner.MM_TO_PT);
        pdf.text(this.textLines(element), tx, y + size, { align, lineHeightFactor: 1.2 });
      } else if (element.type === "line") {
        const line = this.lineCoordinates(element);
        pdf.line(line.x1, line.y1, line.x2, line.y2);
      }
      else if (element.type === "rect") {
        const filled = /^#[0-9a-f]{6}$/i.test(element.fill || "");
        if (filled) pdf.setFillColor(...this.hexToRgb(element.fill));
        pdf.rect(x, y, w, h, filled ? "FD" : "S");
      } else if (element.type === "circle") pdf.ellipse(x + w / 2, y + h / 2, w / 2, h / 2);
      else if (element.type === "table") {
        const borders = this.getTableBorders(element);
        const columns = this.getTableColumns(element);
        const columnWidths = this.getTableColumnWidths(element, w);
        const previewRows = this.getTableDisplayRows(element);
        const rowHeights = this.getTableRowHeights(element, previewRows);
        const tableHeight = rowHeights.reduce((sum, height) => sum + height, 0);
        const headerHeight = rowHeights[0];
        const hasHeader = element.tableMode !== "manual" || element.showHeader !== false;
        const borderWidth = Number(element.borderWidth ?? 0.25);
        const drawBorder = (side, x1, y1, x2, y2, width) => {
          const border = borders[side];
          if (!border.enabled) return;
          pdf.setDrawColor(...this.hexToRgb(border.color));
          pdf.setLineWidth(borderWidth || width);
          pdf.setLineDashPattern(border.style === "dashed" ? [1.5, 1] : border.style === "dotted" ? [0.25, 0.8] : [], 0);
          pdf.line(x1, y1, x2, y2);
        };
        pdf.setFillColor(...this.hexToRgb(element.backgroundColor || "#ffffff"));
        pdf.rect(x, y, w, tableHeight, "F");
        if (hasHeader) {
          pdf.setTextColor(...this.hexToRgb(element.headerTextColor || element.color || "#191a1d"));
          pdf.setFont("helvetica", "bold");
          pdf.setFontSize(7);
          pdf.setFillColor(...this.hexToRgb(element.headerColor || "#fff6d8"));
          pdf.rect(x, y, w, headerHeight, "F");
          let columnX = x;
          columns.forEach((column, index) => {
            const align = column.align || "left";
            const textX = align === "center" ? columnX + columnWidths[index] / 2 : align === "right" ? columnX + columnWidths[index] - 1.5 : columnX + 1.5;
            pdf.text(String(column.label || `Columna ${index + 1}`), textX, y + headerHeight / 2 + 1, { align });
            columnX += columnWidths[index];
          });
        }
        pdf.setFontSize(7);
        const manualRows = element.tableMode === "manual" ? (element.rows || []) : [];
        let bodyY = y + headerHeight;
        for (let rowIndex = 0; rowIndex < previewRows; rowIndex++) {
          const cellHeight = rowHeights[rowIndex + 1];
          let cellX = x;
          columns.forEach((column, columnIndex) => {
            const value = element.tableMode === "manual"
              ? (manualRows[rowIndex]?.[columnIndex] || "")
              : (column.field ? `{{${column.field}}}` : "");
            pdf.setTextColor(...this.hexToRgb(element.color || "#191a1d"));
            const cellStyle = element.tableMode === "manual" ? this.getManualCellStyle(element, rowIndex, columnIndex) : { align: column.align || "left", fontSize: 2.2, bold: false, italic: false, underline: false };
            const fontStyle = cellStyle.bold && cellStyle.italic ? "bolditalic" : cellStyle.bold ? "bold" : cellStyle.italic ? "italic" : "normal";
            const fontFamily = ReportDesigner.FONT_FAMILIES[cellStyle.fontFamily] || ReportDesigner.FONT_FAMILIES.arial;
            pdf.setFont(fontFamily.jsPDF, fontStyle);
            pdf.setFontSize(cellStyle.fontSize * ReportDesigner.MM_TO_PT);
            const align = cellStyle.align;
            const textX = align === "center" ? cellX + columnWidths[columnIndex] / 2 : align === "right" ? cellX + columnWidths[columnIndex] - 1.5 : cellX + 1.5;
            const textY = bodyY + cellHeight / 2 + 1;
            pdf.text(String(value), textX, textY, { align });
            if (cellStyle.underline && String(value)) {
              const textWidth = pdf.getTextWidth(String(value));
              const lineX = align === "center" ? textX - textWidth / 2 : align === "right" ? textX - textWidth : textX;
              pdf.setDrawColor(...this.hexToRgb(element.color || "#191a1d"));
              pdf.setLineWidth(0.12);
              pdf.line(lineX, textY + 0.45, lineX + textWidth, textY + 0.45);
            }
            cellX += columnWidths[columnIndex];
          });
          bodyY += cellHeight;
        }
        drawBorder("top", x, y, x + w, y, 0.3);
        drawBorder("right", x + w, y, x + w, y + tableHeight, 0.3);
        drawBorder("bottom", x, y + tableHeight, x + w, y + tableHeight, 0.3);
        drawBorder("left", x, y, x, y + tableHeight, 0.3);
        let dividerY = y + headerHeight;
        if (hasHeader) drawBorder("insideHorizontal", x, dividerY, x + w, dividerY, 0.2);
        for (let row = 1; row < previewRows; row++) {
          dividerY += rowHeights[row];
          drawBorder("insideHorizontal", x, dividerY, x + w, dividerY, 0.2);
        }
        let verticalX = x;
        columnWidths.slice(0, -1).forEach((columnWidth) => {
          verticalX += columnWidth;
          drawBorder("insideVertical", verticalX, y, verticalX, y + tableHeight, 0.2);
        });
        pdf.setLineDashPattern([], 0);
        pdf.setLineWidth(0.35);
        pdf.setDrawColor(0, 0, 0);
      } else if (element.type === "qrcode" || element.type === "image") pdf.rect(x, y, w, h);
    });
    window.open(pdf.output("bloburl"), "_blank", "noopener");
  }

  copyCode() {
    const textarea = this.root.querySelector("[data-rd-code]");
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(textarea.value).then(() => toastr.success("Código copiado."));
    } else {
      textarea.select();
      document.execCommand("copy");
      toastr.success("Código copiado.");
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

  async pickColor(property) {
    const borderMatch = property.match(/^borders\.(top|right|bottom|left|insideHorizontal|insideVertical)\.color$/);
    const commonBorderColor = property === "borders.color";
    if (!this.selected || (!['color', 'fill', 'backgroundColor'].includes(property) && !borderMatch && !commonBorderColor)) return;
    if (typeof window.EyeDropper !== "function") {
      return toastr.warning("El cuentagotas requiere un navegador compatible, como Chrome o Edge reciente.");
    }

    const selectedId = this.selectedId;
    try {
      const { sRGBHex } = await new window.EyeDropper().open();
      if (this.selectedId !== selectedId) {
        return toastr.warning("La selección cambió. Vuelve a elegir el cuentagotas para aplicar el color.");
      }
      const element = this.byId(selectedId);
      if (!element) return;
      if (borderMatch) {
        const borders = this.getTableBorders(element);
        borders[borderMatch[1]].color = sRGBHex.toUpperCase();
        element.borders = borders;
      } else if (commonBorderColor) {
        const borders = this.getTableBorders(element);
        for (const border of Object.values(borders)) border.color = sRGBHex.toUpperCase();
        element.borders = borders;
      } else {
        element[property] = sRGBHex.toUpperCase();
      }
      this.commit(borderMatch || commonBorderColor ? "Color del borde actualizado" : property === "fill" ? "Relleno actualizado" : property === "backgroundColor" ? "Color de fondo actualizado" : "Color actualizado");
    } catch (error) {
      if (error?.name === "AbortError") return;
      console.error(error);
      toastr.error("No se pudo abrir el cuentagotas. Comprueba que el sitio use HTTPS o localhost.");
    }
  }

  setStatus(message) {
    const status = this.root.querySelector("[data-rd-status]");
    if (status) status.textContent = message;
  }

  setDirty(value) {
    this.dirty = value;
    this.root.querySelectorAll("[data-rd-dirty]").forEach((badge) => { badge.hidden = !value; });
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
