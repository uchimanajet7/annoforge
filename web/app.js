// すべてのコメントは日本語で記述する
document.addEventListener('DOMContentLoaded', () => {
  // DOM参照
  const imageInput = document.getElementById('imageInput');
  const openFileBtn = document.getElementById('openFileBtn');
  const clearBtn = document.getElementById('clearBtn');
  const copyJsonBtn = document.getElementById('copyJsonBtn');
  const zoomInBtn = document.getElementById('zoomInBtn');
  const zoomOutBtn = document.getElementById('zoomOutBtn');
  const zoomResetBtn = document.getElementById('zoomResetBtn');
  const toolButtons = () => Array.from(document.querySelectorAll('.tool-btn[data-tool]'));
  const swatchesEl = document.getElementById('colorSwatches');
  const colorPicker = document.getElementById('colorPicker');
  const coordinatesDisplay = document.getElementById('coordinates');
  const annotationList = document.getElementById('annotationList');
  const jsonDisplay = document.getElementById('jsonDisplay');
  const stageContainer = document.getElementById('stageContainer');
  const imageNameEl = document.getElementById('imageNameTop');
  const statusBar = document.getElementById('statusBar');
  const zoomBadge = document.getElementById('zoomBadge');

  // ステータス/ヒント/倍率表示
  function updateZoomBadge() {
    if (!zoomBadge || !stage) return;
    const p = Math.round((stage.scaleX() || 1) * 100);
    zoomBadge.textContent = p + '%';
  }
  let hintOverride = '';
  function toolLabel(t){
    switch(t){
      case 'select': return '選択';
      case 'rectangle': return '矩形';
      case 'line': return '直線';
      case 'polygon': return '多角形';
      case 'parallelogram': return '平行四辺形';
      case 'circle': return '円';
      default: return '選択';
    }
  }
  function toolHint(t){
    if (hintOverride) return hintOverride;
    switch(t){
      case 'select': return '背景ドラッグでパン / クリックで選択 / 右下でズーム';
      case 'rectangle': return 'ドラッグで作成 / 離して確定';
      case 'line': return 'クリックで始点→ドラッグで終点→離して確定';
      case 'polygon': return 'クリックで頂点追加 / ダブルクリックかEnterで確定';
      case 'parallelogram': return 'P1→P2→P3をクリック / 4点目は自動';
      case 'circle': return 'クリックで中心→ドラッグで半径→離して確定';
      default: return '';
    }
  }
  let hintTimer = null;
  function showHint(text, ms = 2500){
    if (!statusBar) return;
    if (hintTimer) { clearTimeout(hintTimer); hintTimer = null; }
    hintOverride = text || '';
    statusBar.textContent = hintOverride;
    statusBar.style.display = hintOverride ? 'block' : 'none';
    if (hintOverride && ms > 0) {
      hintTimer = setTimeout(() => { hintOverride=''; statusBar.style.display='none'; }, ms);
    }
  }
  // インポートモーダル関連
  const openImportModalBtn = document.getElementById('openImportModalBtn');
  const importModal = document.getElementById('importModal');
  const closeImportModalBtn = document.getElementById('closeImportModalBtn');
  const cancelImportBtn = document.getElementById('cancelImportBtn');
  const importJsonText = document.getElementById('importJsonText');
  const importJsonFile = document.getElementById('importJsonFile');
  const importDropZone = document.getElementById('importDropZone');
  const importSummary = document.getElementById('importSummary');
  const runImportBtn = document.getElementById('runImportBtn');
  const importPasteBtn = document.getElementById('importPasteBtn');

  // Konva ステージ/レイヤ
  let stage = null;
  let imageLayer = null;
  let annotationsLayer = null;
  let guidesLayer = null;

  // 状態
  let loadedImage = null; // HTMLImageElement
  let imageNode = null;   // Konva.Image
  let loadedImageName = '';
  let canvasScale = 1;    // 表示倍率（画像幅に対する比率）
  let currentTool = 'select';
  let currentColor = '#FF0000';
  let idSeq = 1;
  let selectedShapeId = null;
  let transformer = null;
  // ズーム/パン用
  const SCALE_BY = 1.05;
  const MIN_SCALE = 0.2;
  const MAX_SCALE = 5;
  let spaceDown = false;
  let lastCenter = null;
  let lastDist = 0;
  let dragStopped = false;
  // スナップ用
  let snapMarker = null;

  // 作図中の一時情報
  let draft = null; // { type, node, points:number[], start:{x,y} }

  // 形状モデル配列（原寸座標で保持）
  const shapes = []; // { id, type, colorHex, thickness, ...geometry }
  let workspaceRevision = 0;
  let preparedAnnotationExport = null;
  const WEBMCP_EXPORT_CHUNK_BYTES = 256 * 1024;
  const WEBMCP_EXPORT_MAX_CHUNK_BYTES = 1024 * 1024;
  const WEBMCP_MAX_IMAGE_BYTES = 12 * 1024 * 1024;
  const WEBMCP_MAX_DATA_URL_LENGTH = 12 * 1024 * 1024;
  const WEBMCP_PREVIEW_DEFAULT_MAX_DIMENSION = 1024;
  const WEBMCP_PREVIEW_MIN_DIMENSION = 64;
  const WEBMCP_PREVIEW_MAX_DIMENSION = 2048;
  const WEBMCP_IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
  const DOWNLOAD_OBJECT_URL_RELEASE_DELAY_MS = 1000;
  const DOWNLOAD_REQUESTED_MESSAGE = 'ブラウザーにダウンロードを要求しました。完了状態はダウンロード一覧で確認してください';

  function advanceWorkspaceRevision() {
    workspaceRevision += 1;
    preparedAnnotationExport = null;
  }

  function cancelDraft() {
    if (!draft) return;
    hideCoordinates();
    hideSnap();
    if (draft.node) {
      draft.node.destroy();
      annotationsLayer.draw();
    }
    draft = null;
  }

  // 色（ストロークのみ、塗りなし）
  const paletteColors = ['#FF0000','#00CC66','#0066FF','#FF00FF','#00CCCC','#FFCC00','#FF6600','#7F00FF','#0080FF','#FF0080'];

  // 線の既定設定
  const defaultThickness = 5;

  // 初期化
  init();

  // 初期化処理
  function init() {
    setupStage();
    bindUI();
    buildColorSwatches();
    drawEmptyState();
    updateImageNameUI();
    updateZoomBadge();
  }

  // ステージの初期セットアップ
  function setupStage() {
    const { width, height } = getAvailableStageSize();
    stage = new Konva.Stage({ container: 'stageContainer', width, height });
    // 初期カーソルは選択ツール前提でデフォルト
    stage.container().style.cursor = 'default';
    // タッチジェスチャのデフォルト動作を抑制
    stage.container().style.touchAction = 'none';

    imageLayer = new Konva.Layer({ listening: false });
    annotationsLayer = new Konva.Layer();
    guidesLayer = new Konva.Layer({ listening: false });
    stage.add(imageLayer);
    stage.add(annotationsLayer);
    stage.add(guidesLayer);

    // ステージイベント（content* ではなく通常の mouse* を使用）
    stage.on('mousedown', (e) => {
      if (currentTool === 'select') {
        if (e.target === stage) {
          clearSelection();
          stage.draggable(true);
          stage.container().style.cursor = 'grabbing';
          stage.startDrag();
        }
        return;
      }
      onPointerDown();
    });
    stage.on('mousemove', onPointerMove);
    stage.on('mouseup', onPointerUp);

    // ホイールズームは無効化（虫眼鏡/ボタンに統一）
    stage.on('wheel', (e) => { e.evt.preventDefault(); });

    // 背景パン終了時の後片付け
    stage.on('dragend', () => {
      if (currentTool === 'select') {
        stage.draggable(false);
        stage.container().style.cursor = 'default';
      }
    });

    // ズームバッジ更新（スケール属性の変化を監視）
    stage.on('scaleXChange', () => updateZoomBadge());
    stage.on('scaleYChange', () => updateZoomBadge());

    // ピンチズーム（2本指）
    function getDistance(p1, p2) { return Math.hypot(p2.x - p1.x, p2.y - p1.y); }
    function getCenter(p1, p2) { return { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 }; }
    stage.on('touchmove', (e) => {
      e.evt.preventDefault();
      const t1 = e.evt.touches[0];
      const t2 = e.evt.touches[1];
      if (t1 && !t2 && !stage.isDragging() && dragStopped) { stage.startDrag(); dragStopped = false; }
      if (t1 && t2) {
        if (stage.isDragging()) { dragStopped = true; stage.stopDrag(); }
        const p1 = { x: t1.clientX, y: t1.clientY };
        const p2 = { x: t2.clientX, y: t2.clientY };
        if (!lastCenter) { lastCenter = getCenter(p1, p2); return; }
        const newCenter = getCenter(p1, p2);
        const dist = getDistance(p1, p2); if (!lastDist) lastDist = dist;
        const pointTo = { x: (newCenter.x - stage.x()) / stage.scaleX(), y: (newCenter.y - stage.y()) / stage.scaleX() };
        let scale = stage.scaleX() * (dist / lastDist);
        scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale));
        stage.scale({ x: scale, y: scale });
        const dx = newCenter.x - lastCenter.x; const dy = newCenter.y - lastCenter.y;
        const newPos = { x: newCenter.x - pointTo.x * scale + dx, y: newCenter.y - pointTo.y * scale + dy };
        stage.position(newPos);
        lastDist = dist; lastCenter = newCenter; stage.batchDraw(); updateZoomBadge();
      }
    });
    stage.on('touchend', () => { lastDist = 0; lastCenter = null; });

    // ステージ外でマウスボタンを離した場合のフォールバック（ドラフトを確実に確定）
    const onWindowPointerUp = () => {
      if (!loadedImage || !draft) return;
      onPointerUp();
    };
    window.addEventListener('mouseup', onWindowPointerUp);
    window.addEventListener('touchend', onWindowPointerUp);
    // コンテナからマウスが出た場合も安全側で確定
    stage.container().addEventListener('mouseleave', onWindowPointerUp);

    // リサイズ対応
    window.addEventListener('resize', () => resizeStageToImage());
  }

  // UIイベント紐付け
  function bindUI() {
    if (openFileBtn) openFileBtn.addEventListener('click', () => imageInput && imageInput.click());
    imageInput.addEventListener('change', handleImageUpload);
    clearBtn.addEventListener('click', () => clearAll());
    copyJsonBtn.addEventListener('click', copyAllAnnotations);
    bindDragAndDrop();
    bindImportModal();
    // ツールボタン
    toolButtons().forEach(btn => {
      btn.addEventListener('click', () => setCurrentTool(btn.getAttribute('data-tool')));
    });
    // カラー
    if (colorPicker) {
      colorPicker.value = currentColor;
      colorPicker.addEventListener('input', (e) => {
        applyColorChoice(e.target.value);
      });
    }

    // 多角形確定（ダブルクリック/Enter）
    stageContainer.addEventListener('dblclick', () => {
      if (draft && draft.type === 'polygon') finalizePolygon();
    });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') return;
      if (e.key === 'Enter' && draft && draft.type === 'polygon') finalizePolygon();
    });

    // ズームボタン
    if (zoomInBtn) zoomInBtn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); zoomAtCenter(true); });
    if (zoomOutBtn) zoomOutBtn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); zoomAtCenter(false); });
    if (zoomResetBtn) zoomResetBtn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); resetView(); });
  }

  // ステージコンテナへのドラッグ＆ドロップ対応
  function bindDragAndDrop() {
    const container = stageContainer;
    if (!container) return;
    let dragCounter = 0;
    const add = () => container.classList.add('drop-active');
    const remove = () => container.classList.remove('drop-active');

    container.addEventListener('dragenter', (e) => { e.preventDefault(); dragCounter++; add(); });
    container.addEventListener('dragover', (e) => { e.preventDefault(); });
    container.addEventListener('dragleave', () => { dragCounter = Math.max(0, dragCounter - 1); if (dragCounter === 0) remove(); });
    container.addEventListener('drop', (e) => {
      e.preventDefault(); dragCounter = 0; remove();
      const files = e.dataTransfer && e.dataTransfer.files ? Array.from(e.dataTransfer.files) : [];
      const jsonFile = files.find(f => (f.type || '').includes('json') || (f.name || '').toLowerCase().endsWith('.json'));
      if (jsonFile) { openImportModal(); readJsonFile(jsonFile); return; }
      const img = files.find(f => (f.type || '').startsWith('image/'));
      if (img) loadImageFile(img);
    });
  }

  // インポートモーダル
  function bindImportModal() {
    if (openImportModalBtn) openImportModalBtn.addEventListener('click', openImportModal);
    if (importPasteBtn) importPasteBtn.addEventListener('click', onPasteJsonFromClipboard);
    if (closeImportModalBtn) closeImportModalBtn.addEventListener('click', closeImportModal);
    if (cancelImportBtn) cancelImportBtn.addEventListener('click', closeImportModal);
    if (importJsonFile) importJsonFile.addEventListener('change', (e) => {
      const f = e.target.files && e.target.files[0]; if (f) readJsonFile(f);
      e.target.value = '';
    });
    if (importJsonText) importJsonText.addEventListener('input', validateImportText);
    if (importDropZone) {
      let dzCounter = 0;
      const add = () => importDropZone.classList.add('active');
      const remove = () => importDropZone.classList.remove('active');
      importDropZone.addEventListener('dragenter', (e) => { e.preventDefault(); dzCounter++; add(); });
      importDropZone.addEventListener('dragover', (e) => { e.preventDefault(); });
      importDropZone.addEventListener('dragleave', () => { dzCounter = Math.max(0, dzCounter-1); if (dzCounter===0) remove(); });
      importDropZone.addEventListener('drop', (e) => {
        e.preventDefault(); dzCounter = 0; remove();
        const files = e.dataTransfer && e.dataTransfer.files ? Array.from(e.dataTransfer.files) : [];
        const jf = files.find(f => (f.type || '').includes('json') || (f.name || '').toLowerCase().endsWith('.json'));
        if (jf) readJsonFile(jf);
      });
    }
    if (runImportBtn) runImportBtn.addEventListener('click', runImportFromModal);
    // ESCで閉じる
    window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && isModalOpen()) closeImportModal(); });
    // オーバーレイクリックで閉じる
    if (importModal) importModal.addEventListener('click', (e) => { if (e.target && e.target.hasAttribute('data-close-modal')) closeImportModal(); });
  }

  async function onPasteJsonFromClipboard() {
    openImportModal();
    if (!importJsonText) return;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        const text = await navigator.clipboard.readText();
        if (!text) {
          importJsonText.value = '';
          importSummary.textContent = 'クリップボードが空です。Ctrl/⌘+Vで貼り付けてください。';
          runImportBtn.disabled = true;
          importJsonText.focus();
          return;
        }
        importJsonText.value = text;
        validateImportText();
        importJsonText.focus();
      } else {
        importSummary.textContent = 'クリップボードにアクセスできません。Ctrl/⌘+Vで貼り付けてください。';
        importJsonText.focus();
      }
    } catch (e) {
      importSummary.textContent = 'クリップボードの読み取りに失敗しました。Ctrl/⌘+Vで貼り付けてください。';
      importJsonText.focus();
    }
  }

  function isModalOpen() { return importModal && importModal.classList.contains('show'); }
  function openImportModal() { if (!importModal) return; importModal.classList.add('show'); runImportBtn.disabled = true; importSummary.textContent=''; }
  function closeImportModal() { if (!importModal) return; importModal.classList.remove('show'); }
  function readJsonFile(file) {
    const reader = new FileReader();
    reader.onload = (ev) => { importJsonText.value = ev.target.result || ''; validateImportText(); };
    reader.readAsText(file);
  }
  function validateImportText() {
    const txt = importJsonText.value.trim();
    if (!txt) { importSummary.textContent = ''; runImportBtn.disabled = true; return; }
    try {
      const obj = JSON.parse(txt);
      const count = Array.isArray(obj && obj.draw) ? obj.draw.length : 0;
      if (!count) { importSummary.textContent = '形式が不正、または要素がありません'; runImportBtn.disabled = true; return; }
      importSummary.textContent = `読み込み候補: ${count} 件。実行すると既存を置換します。`;
      runImportBtn.disabled = false;
    } catch (e) {
      importSummary.textContent = 'JSONの構文エラーがあります';
      runImportBtn.disabled = true;
    }
  }
  function runImportFromModal() {
    try {
      const obj = JSON.parse(importJsonText.value.trim());
      importAnnotations(obj);
      closeImportModal();
      showNotification('JSONをインポートしました');
    } catch {
      importSummary.textContent = 'JSONの構文エラーがあります';
    }
  }

  // カラーパレット生成
  function buildColorSwatches() {
    if (!swatchesEl) return;
    swatchesEl.innerHTML = '';
    paletteColors.forEach(hex => {
      const sw = document.createElement('button');
      sw.type = 'button';
      sw.className = 'color-swatch';
      sw.dataset.color = normalizeHex(hex);
      sw.title = hex;
      sw.setAttribute('aria-label', `色 ${hex}`);
      sw.setAttribute('aria-pressed', 'false');
      sw.style.backgroundColor = hex;
      sw.addEventListener('click', () => applyColorChoice(hex));
      swatchesEl.appendChild(sw);
    });
    syncColorControls();
  }

  function getSelectedShape() {
    if (selectedShapeId === null) return null;
    return shapes.find(shape => shape.id === selectedShapeId) || null;
  }

  function getColorControlTargetLabel() {
    const selectedShape = getSelectedShape();
    if (!selectedShape) return '新規アノテーションの線色';
    const index = shapes.findIndex(shape => shape.id === selectedShape.id);
    return `${shapeTitle(selectedShape, index)}の線色`;
  }

  function syncColorControls() {
    const selectedShape = getSelectedShape();
    const activeColor = normalizeHex(selectedShape ? selectedShape.colorHex : currentColor) || '#FF0000';
    const targetLabel = getColorControlTargetLabel();
    if (swatchesEl) {
      swatchesEl.setAttribute('aria-label', targetLabel);
      Array.from(swatchesEl.children).forEach(swatch => {
        const swatchColor = normalizeHex(swatch.dataset.color);
        const isActive = swatchColor === activeColor;
        swatch.classList.toggle('active', isActive);
        swatch.setAttribute('aria-pressed', isActive ? 'true' : 'false');
        swatch.setAttribute('aria-label', `${targetLabel}: ${swatchColor}`);
      });
    }
    if (colorPicker) {
      colorPicker.value = activeColor.toLowerCase();
      colorPicker.setAttribute('aria-label', `${targetLabel}（任意色）`);
    }
  }

  function applyColorChoice(value) {
    const colorHex = normalizeHex(value);
    if (!colorHex) {
      syncColorControls();
      return false;
    }

    currentColor = colorHex;
    const selectedShape = getSelectedShape();
    if (!selectedShape || normalizeHex(selectedShape.colorHex) === colorHex) {
      syncColorControls();
      return false;
    }

    selectedShape.colorHex = colorHex;
    const node = findAnnotationNodeById(selectedShape.id);
    if (node) node.stroke(colorHex);
    advanceWorkspaceRevision();
    annotationsLayer.batchDraw();
    updateAnnotationList();
    return true;
  }

  // 空状態描画
  function drawEmptyState() {
    imageLayer.destroyChildren();
    const text = new Konva.Text({
      x: 0,
      y: stage.height() / 2 - 10,
      width: stage.width(),
      align: 'center',
      text: '画像をアップロードしてください',
      fontSize: 20,
      fill: '#999'
    });
    imageLayer.add(text);
    imageLayer.draw();
  }

  // 画像アップロード処理（ファイル入力）
  function handleImageUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    loadImageFile(file);
  }

  // 画像アップロード処理（D&D/共通）
  function loadImageFile(file) {
    if (!file || !((file.type || '').startsWith('image/'))) return;
    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const image = await decodeImageSource(event.target.result);
        commitLoadedImage(image, file.name || '');
      } catch (error) {
        console.error('画像の読み込みに失敗しました:', error);
        showNotification('画像の読み込みに失敗しました', 'error');
      }
    };
    reader.onerror = () => showNotification('画像の読み込みに失敗しました', 'error');
    reader.readAsDataURL(file);
  }

  function decodeImageSource(source, signal) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      let settled = false;

      const cleanup = () => {
        image.onload = null;
        image.onerror = null;
        if (signal) signal.removeEventListener('abort', onAbort);
      };
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        cleanup();
        callback(value);
      };
      const onAbort = () => {
        image.src = '';
        const reason = signal && signal.reason;
        finish(reject, reason instanceof Error ? reason : new DOMException('画像の読み込みがキャンセルされました', 'AbortError'));
      };

      image.onload = () => finish(resolve, image);
      image.onerror = () => finish(reject, new Error('取得したデータを画像としてデコードできません'));
      if (signal) {
        if (signal.aborted) {
          onAbort();
          return;
        }
        signal.addEventListener('abort', onAbort, { once: true });
      }
      image.src = source;
    });
  }

  function commitLoadedImage(image, imageName) {
    loadedImage = image;
    loadedImageName = imageName;
    placeImage();
    clearAll({ advanceRevision: false }); // 既存の形状を消去
    advanceWorkspaceRevision();
    // 表示とツール状態を統一: 選択ツール、ステージ倍率1、画像はfit比率で中央配置、選択/ドラフト解除
    resetView();
    setCurrentTool('select', { announce: false });
    updateImageNameUI();
    showNotification(loadedImageName ? `${loadedImageName} を読み込みました` : '画像を読み込みました');
  }

  // 画像名のUI更新
  function updateImageNameUI() {
    if (!imageNameEl) return;
    if (loadedImageName) {
      imageNameEl.textContent = loadedImageName;
      imageNameEl.title = loadedImageName;
    } else {
      imageNameEl.textContent = '';
      imageNameEl.title = '';
    }
  }

  // 画像の配置とステージサイズの調整
  function placeImage() {
    if (!loadedImage) return;
    const prevScale = stage ? (stage.scaleX() || 1) : 1;
    const prevPos = stage ? stage.position() : { x: 0, y: 0 };
    const sz = getAvailableStageSize();
    stage.width(sz.width);
    stage.height(sz.height);

    // 画像をステージ内に収まるようフィット（拡大はしない）
    const iw = loadedImage.width;
    const ih = loadedImage.height;
    const fit = Math.min(sz.width / iw, sz.height / ih, 1);
    const newWidth = Math.round(iw * fit);
    const newHeight = Math.round(ih * fit);
    canvasScale = fit;

    imageLayer.destroyChildren();
    imageNode = new Konva.Image({ image: loadedImage, x: 0, y: 0, width: newWidth, height: newHeight, listening: false });
    imageLayer.add(imageNode);
    imageLayer.draw();

    // 既存のズーム/位置を維持
    stage.scale({ x: prevScale, y: prevScale });
    stage.position(prevPos);
  }

  // ステージの再調整（ウィンドウリサイズ時）
  function resizeStageToImage() {
    if (!loadedImage) return;
    placeImage();
    // 既存形状の描画サイズも反映し直す
    annotationsLayer.getChildren().forEach((node) => {
      const model = findModelByNode(node);
      if (model) redrawNodeFromModel(model, node);
    });
    annotationsLayer.draw();
    guidesLayer.draw();
  }

  // ビューポートに対するステージの利用可能サイズを計算
  function getAvailableStageSize() {
    const width = stageContainer.clientWidth || 800;
    const rect = stageContainer.getBoundingClientRect();
    const bottomMargin = 24; // 余白
    const avail = Math.floor(window.innerHeight - rect.top - bottomMargin);
    const height = Math.max(300, Math.min(avail, Math.floor(window.innerHeight * 0.7))); // 上限: 70vh
    return { width, height };
  }

  // ステージ座標→原寸座標
  function toOriginal(x, y) { return { x: Math.round(x / canvasScale), y: Math.round(y / canvasScale) }; }

  // 描画色
  function colorForStroke() { return currentColor; }

  // ツール状態を一箇所で切り替える
  function setCurrentTool(tool, { announce = true } = {}) {
    const nextButton = document.querySelector(`.tool-btn[data-tool="${tool}"]`);
    if (!nextButton) return false;
    toolButtons().forEach(button => button.classList.toggle('active', button === nextButton));
    currentTool = tool;
    cancelDraft();
    applySelectionUI();
    stage.draggable(false);
    if (announce) showHint(toolHint(currentTool));
    return true;
  }

  // 確定済み形状の操作可否を現在のツールに同期する
  function syncAnnotationInteractivity() {
    const canDrag = currentTool === 'select';
    annotationsLayer.getChildren().forEach((node) => {
      if (node.getAttr('shapeId') !== undefined) node.draggable(canDrag);
    });
  }

  function findAnnotationNodeById(id) {
    return annotationsLayer.findOne((node) => node.getAttr('shapeId') === id);
  }

  // 選択用の一時的な前面化を解除して、確定モデル順へ戻す
  function restoreAnnotationNodeOrder() {
    shapes.forEach((shape) => {
      const node = findAnnotationNodeById(shape.id);
      if (node) node.moveToTop();
    });
    if (transformer) transformer.moveToTop();
  }

  function syncAnnotationListSelection() {
    annotationList.querySelectorAll('.annotation-item[data-shape-id]').forEach((item) => {
      const isSelected = Number(item.dataset.shapeId) === selectedShapeId;
      item.classList.toggle('selected', isSelected);
      const selectButton = item.querySelector('.annotation-select-btn');
      if (selectButton) selectButton.setAttribute('aria-pressed', isSelected ? 'true' : 'false');
    });
  }

  // 選択解除
  function clearSelection() {
    selectedShapeId = null;
    if (transformer) transformer.nodes([]);
    removeAnchors();
    restoreAnnotationNodeOrder();
    syncAnnotationListSelection();
    syncColorControls();
    annotationsLayer.draw();
  }

  // 選択UI適用
  function applySelectionUI() {
    if (currentTool !== 'select') clearSelection();
    syncAnnotationInteractivity();
    // ツールに応じてカーソルを変更
    if (currentTool === 'select') {
      stage.container().style.cursor = 'default';
    } else {
      stage.container().style.cursor = 'crosshair';
    }
  }

  // ノード→モデル検索
  function findModelByNode(node) {
    const id = node.getAttr('shapeId');
    return shapes.find(s => s.id === id);
  }

  // 共通ストローク設定
  function commonStrokeProps(thickness = defaultThickness, stroke = colorForStroke()) {
    return { stroke, strokeWidth: thickness, listening: true };
  }

  function registerFinalizedShapeNode(node, model) {
    node.setAttr('shapeId', model.id);
    node.draggable(currentTool === 'select');
    attachCommonNodeHandlers(node);
  }

  // 図形選択
  function onSelectShape(node) {
    const model = findModelByNode(node);
    if (!model) return;
    if (transformer) transformer.nodes([]);
    removeAnchors();
    restoreAnnotationNodeOrder();
    selectedShapeId = model.id;
    if (!transformer) {
      transformer = new Konva.Transformer({ rotateEnabled: true, enabledAnchors: ['top-left','top-right','bottom-left','bottom-right'] });
      annotationsLayer.add(transformer);
    }
    node.moveToTop();
    if (model.type === 'rectangle' || model.type === 'circle') {
      // 円は等倍スケール、矩形は自由比率
      transformer.keepRatio(model.type === 'circle');
      transformer.nodes([node]);
      transformer.moveToTop();
    } else {
      transformer.nodes([]);
      drawAnchorsForModel(model, node);
    }
    syncAnnotationListSelection();
    syncColorControls();
    annotationsLayer.draw();
  }

  // アンカー描画（線/多角形/平行四辺形）
  function drawAnchorsForModel(model, node) {
    const points = getModelPoints(model);
    points.forEach((p, idx) => {
      const c = new Konva.Circle({ x: p.x * canvasScale, y: p.y * canvasScale, radius: 6, fill: '#fff', stroke: '#333', strokeWidth: 2, draggable: true });
      c.on('dragmove', () => {
        const nx = c.x() / canvasScale; const ny = c.y() / canvasScale;
        updateModelPoint(model, idx, { x: nx, y: ny });
        advanceWorkspaceRevision();
        redrawNodeFromModel(model, node);
        updateAnnotationList();
      });
      c.on('mouseenter', () => { showHint(model.type==='polygon' ? '頂点: ドラッグで移動 / ダブルクリックで削除' : '頂点: ドラッグで移動'); });
      c.on('dblclick', () => {
        if (model.type === 'polygon') {
          if (!Array.isArray(model.points) || model.points.length < 6) return;
          if (model.points.length <= 6) return; // 3点未満にはしない
          model.points.splice(idx*2, 2);
          if (model.points.length < 6) {
            // ノード削除
            node.destroy();
            const i = shapes.findIndex(s => s.id === model.id);
            if (i >= 0) shapes.splice(i, 1);
            annotationsLayer.draw();
          } else {
            redrawNodeFromModel(model, node);
          }
          advanceWorkspaceRevision();
          updateAnnotationList();
        }
      });
      guidesLayer.add(c);
    });
    guidesLayer.draw();
  }

  // アンカー削除
  function removeAnchors() { guidesLayer.destroyChildren(); guidesLayer.draw(); }

  // モデルから点配列を取得
  function getModelPoints(model) {
    if (model.type === 'line') return [{ x: model.x1, y: model.y1 }, { x: model.x2, y: model.y2 }];
    if (model.type === 'polygon' || model.type === 'parallelogram') {
      const pts = []; for (let i=0;i<model.points.length;i+=2) pts.push({ x: model.points[i], y: model.points[i+1] }); return pts;
    }
    if (model.type === 'rectangle') return [{ x: model.x, y: model.y }, { x: model.x + model.width, y: model.y + model.height }];
    return [];
  }

  // モデルの点を更新
  function updateModelPoint(model, index, p) {
    if (model.type === 'line') {
      if (index === 0) { model.x1 = Math.round(p.x); model.y1 = Math.round(p.y); }
      else { model.x2 = Math.round(p.x); model.y2 = Math.round(p.y); }
    } else if (model.type === 'polygon' || model.type === 'parallelogram') {
      model.points[index*2] = Math.round(p.x); model.points[index*2+1] = Math.round(p.y);
    }
  }

  // モデル→ノードの再描画
  function redrawNodeFromModel(model, node) {
    if (model.type === 'line') {
      node.points([model.x1 * canvasScale, model.y1 * canvasScale, model.x2 * canvasScale, model.y2 * canvasScale]);
      node.position({ x: 0, y: 0 });
    } else if (model.type === 'polygon' || model.type === 'parallelogram') {
      const scaled = model.points.map(v => v * canvasScale);
      node.points(scaled);
      node.position({ x: 0, y: 0 });
      node.closed(model.type !== 'polygon' ? true : node.closed());
    } else if (model.type === 'rectangle') {
      node.x(model.x * canvasScale);
      node.y(model.y * canvasScale);
      node.width(model.width * canvasScale);
      node.height(model.height * canvasScale);
    } else if (model.type === 'circle') {
      node.x(model.x * canvasScale);
      node.y(model.y * canvasScale);
      node.radius(model.radius * canvasScale);
    }
    annotationsLayer.batchDraw();
    // アンカー再配置
    removeAnchors();
    if (selectedShapeId === model.id && (model.type !== 'rectangle' && model.type !== 'circle')) drawAnchorsForModel(model, node);
  }

  // ノード共通ハンドラ
  function attachCommonNodeHandlers(node) {
    node.on('mousedown', (e) => {
      if (currentTool === 'select') { onSelectShape(node); e.cancelBubble = true; }
    });
    node.on('dragstart', () => {
      const ow = node.strokeWidth(); node.setAttr('_origStrokeWidth', ow);
      node.strokeWidth(ow + 4); annotationsLayer.batchDraw();
      showHint('ドラッグで移動中', 1200);
    });
    node.on('dragmove', () => {
      const model = findModelByNode(node); if (!model) return;
      if (model.type === 'rectangle') {
        model.x = Math.round(node.x() / canvasScale);
        model.y = Math.round(node.y() / canvasScale);
      } else if (model.type === 'circle') {
        model.x = Math.round(node.x() / canvasScale);
        model.y = Math.round(node.y() / canvasScale);
      } else if (model.type === 'line') {
        const dx = node.x(); const dy = node.y(); const pts = node.points();
        model.x1 = Math.round((pts[0] + dx) / canvasScale);
        model.y1 = Math.round((pts[1] + dy) / canvasScale);
        model.x2 = Math.round((pts[2] + dx) / canvasScale);
        model.y2 = Math.round((pts[3] + dy) / canvasScale);
      } else if (model.type === 'polygon' || model.type === 'parallelogram') {
        const dx = node.x(); const dy = node.y(); const pts = node.points();
        for (let i=0;i<pts.length;i+=2) { model.points[i] = Math.round((pts[i] + dx) / canvasScale); model.points[i+1] = Math.round((pts[i+1] + dy) / canvasScale); }
      }
      advanceWorkspaceRevision();
      updateAnnotationList();
    });
    node.on('dragend', () => {
      const model = findModelByNode(node);
      // 点配列の形状だけが redrawNodeFromModel 内で位置を (0,0) に正規化される。
      // 矩形と円はモデルの x/y をノード位置として保持する。
      if (model) redrawNodeFromModel(model, node);
      const ow = node.getAttr('_origStrokeWidth');
      if (ow !== undefined && ow !== null) {
        node.strokeWidth(ow);
        node.setAttr('_origStrokeWidth', null);
      }
      annotationsLayer.batchDraw();
    });
    node.on('transformend', () => {
      const model = findModelByNode(node); if (!model) return;
      if (model.type === 'rectangle') {
        const sx = node.scaleX(); const sy = node.scaleY(); node.scaleX(1); node.scaleY(1);
        node.width(node.width() * sx); node.height(node.height() * sy);
        model.x = Math.round(node.x() / canvasScale);
        model.y = Math.round(node.y() / canvasScale);
        model.width = Math.round(node.width() / canvasScale);
        model.height = Math.round(node.height() / canvasScale);
        advanceWorkspaceRevision();
        updateAnnotationList();
      } else if (model.type === 'circle') {
        // Transformerのスケールを半径に正規化し、スケールは1に戻す
        const sx = node.scaleX(); const sy = node.scaleY();
        const s = (Math.abs(sx) + Math.abs(sy)) / 2; // 念のため等倍化
        node.scaleX(1); node.scaleY(1);
        const newR = Math.max(1, node.radius() * s);
        node.radius(newR);
        model.x = Math.round(node.x() / canvasScale);
        model.y = Math.round(node.y() / canvasScale);
        model.radius = Math.round(newR / canvasScale);
        advanceWorkspaceRevision();
        updateAnnotationList();
      }
    });
  }

  // ポインタイベント: down/move/up
  function onPointerDown() {
    if (!loadedImage) return;
    const pos = getWorldPointer(); if (!pos) return;
    if (currentTool === 'rectangle') startRect(pos);
    else if (currentTool === 'line') startLine(pos);
    else if (currentTool === 'polygon') clickPolygon(pos);
    else if (currentTool === 'parallelogram') clickParallelogram(pos);
    else if (currentTool === 'circle') startCircle(pos);
  }
  function onPointerMove() {
    if (!loadedImage || !draft) return;
    const pos = getWorldPointer(); if (!pos) return;
    if (draft.type === 'rectangle') updateDraftRect(pos);
    else if (draft.type === 'line') updateDraftLine(pos);
    else if (draft.type === 'polygon') updateDraftPolygon(pos);
    else if (draft.type === 'parallelogram') updateDraftParallelogram(pos);
    else if (draft.type === 'circle') updateDraftCircle(pos);
  }
  function onPointerUp() {
    if (!loadedImage || !draft) return;
    if (draft.type === 'rectangle') finalizeRect();
    else if (draft.type === 'line') finalizeLine();
    else if (draft.type === 'circle') finalizeCircle();
  }

  // 座標表示
  function showCoordinates(text) {
    coordinatesDisplay.textContent = text;
    coordinatesDisplay.style.display = 'block';
    const p = stage && stage.getPointerPosition ? stage.getPointerPosition() : null;
    if (p) {
      const offset = 12;
      let x = p.x + offset;
      let y = p.y + offset;
      coordinatesDisplay.style.left = x + 'px';
      coordinatesDisplay.style.top = y + 'px';
      coordinatesDisplay.style.bottom = 'auto';
      coordinatesDisplay.style.right = 'auto';
    }
  }
  function hideCoordinates() { coordinatesDisplay.style.display = 'none'; }

  // ズーム制御
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function zoomAtCenter(zoomIn) {
    const screen = { x: stage.width() / 2, y: stage.height() / 2 };
    zoomAtScreenPoint(screen, zoomIn);
  }
  function zoomAtScreenPoint(screenPt, zoomIn) {
    const oldScale = stage.scaleX() || 1;
    const worldPoint = { x: (screenPt.x - stage.x()) / oldScale, y: (screenPt.y - stage.y()) / oldScale };
    let newScale = zoomIn ? oldScale * SCALE_BY : oldScale / SCALE_BY;
    newScale = clamp(newScale, MIN_SCALE, MAX_SCALE);
    stage.scale({ x: newScale, y: newScale });
    const newPos = { x: screenPt.x - worldPoint.x * newScale, y: screenPt.y - worldPoint.y * newScale };
    stage.position(newPos);
    stage.batchDraw();
    updateZoomBadge();
  }

  // ビューのリセット（初期位置/倍率）
  function resetView() {
    const s = 1;
    stage.scale({ x: s, y: s });
    // 画像の中心がステージの中心に来るように配置
    let iw = 0, ih = 0;
    if (imageNode) { iw = imageNode.width(); ih = imageNode.height(); }
    else { iw = stage.width(); ih = stage.height(); }
    const cx = (stage.width() - iw * s) / 2;
    const cy = (stage.height() - ih * s) / 2;
    stage.position({ x: cx, y: cy });
    stage.batchDraw();
    updateZoomBadge();
  }

  // ステージのポインタ（世界座標）を取得
  function getWorldPointer() {
    const p = stage.getPointerPosition(); if (!p) return null;
    const s = stage.scaleX() || 1; const x = (p.x - stage.x()) / s; const y = (p.y - stage.y()) / s;
    return { x, y };
  }

  // 端点スナップ（ワールド座標）
  function nearestEndpoint(pos) {
    if (!pos) return null;
    const scale = stage ? (stage.scaleX() || 1) : 1;
    const radius = 12 / scale; // 画面上で概ね12px相当
    let best = null; let bestD = Infinity;
    for (const s of shapes) {
      const pts = getModelPoints(s);
      for (const pt of pts) {
        const wx = pt.x * canvasScale; const wy = pt.y * canvasScale;
        const dx = pos.x - wx; const dy = pos.y - wy; const d = Math.hypot(dx, dy);
        if (d < radius && d < bestD) { best = { x: wx, y: wy }; bestD = d; }
      }
    }
    return best;
  }
  function showSnap(x, y) {
    hideSnap();
    snapMarker = new Konva.Circle({ x, y, radius: 6, stroke: '#3498db', strokeWidth: 2, fill: 'rgba(52,152,219,0.2)', listening: false });
    guidesLayer.add(snapMarker); guidesLayer.batchDraw();
  }
  function hideSnap() { if (snapMarker) { snapMarker.destroy(); snapMarker = null; guidesLayer.batchDraw(); } }

  // 円作図（中心クリック→ドラッグで半径→マウスアップで確定）
  function startCircle(pos) {
    const x = pos.x, y = pos.y;
    const node = new Konva.Circle({ x, y, radius: 1, ...commonStrokeProps(defaultThickness), draggable: false });
    // 変形時の線幅視認性を一定にする（任意）
    node.strokeScaleEnabled(false);
    draft = { type: 'circle', node, start: { x, y } };
    annotationsLayer.add(node); annotationsLayer.draw();
  }
  function updateDraftCircle(pos) {
    const cx = draft.start.x, cy = draft.start.y;
    const r = Math.hypot(pos.x - cx, pos.y - cy);
    draft.node.radius(Math.max(1, r));
    const o = toOriginal(pos.x, pos.y);
    const oc = toOriginal(cx, cy);
    showCoordinates(`中心: (${oc.x},${oc.y})  半径: ${Math.round(r / canvasScale)}px`);
    annotationsLayer.batchDraw();
  }
  function finalizeCircle() {
    hideCoordinates();
    const r = draft.node.radius();
    if (r < 3) { draft.node.destroy(); annotationsLayer.draw(); draft = null; return; }
    const model = {
      id: idSeq++, type: 'circle', colorHex: colorForStroke(), thickness: defaultThickness,
      x: Math.round(draft.node.x() / canvasScale), y: Math.round(draft.node.y() / canvasScale), radius: Math.round(r / canvasScale)
    };
    registerFinalizedShapeNode(draft.node, model);
    shapes.push(model); draft = null; advanceWorkspaceRevision(); updateAnnotationList();
  }

  // 矩形作図
  function startRect(pos) {
    draft = {
      type: 'rectangle', start: { x: pos.x, y: pos.y },
      node: new Konva.Rect({ x: pos.x, y: pos.y, width: 0, height: 0, ...commonStrokeProps(defaultThickness), draggable: false })
    };
    annotationsLayer.add(draft.node);
    annotationsLayer.draw();
  }
  function updateDraftRect(pos) {
    const x = Math.min(draft.start.x, pos.x); const y = Math.min(draft.start.y, pos.y);
    const w = Math.abs(pos.x - draft.start.x); const h = Math.abs(pos.y - draft.start.y);
    draft.node.position({ x, y }); draft.node.size({ width: w, height: h });
    const o = toOriginal(x, y); const ow = Math.round(w / canvasScale); const oh = Math.round(h / canvasScale);
    showCoordinates(`X:${o.x}px, Y:${o.y}px, W:${ow}px, H:${oh}px`);
  }
  function finalizeRect() {
    const w = draft.node.width(); const h = draft.node.height(); hideCoordinates();
    if (w < 5 || h < 5) { draft.node.destroy(); annotationsLayer.draw(); draft = null; return; }
    const model = {
      id: idSeq++, type: 'rectangle', colorHex: colorForStroke(), thickness: defaultThickness,
      x: Math.round(draft.node.x() / canvasScale), y: Math.round(draft.node.y() / canvasScale),
      width: Math.round(draft.node.width() / canvasScale), height: Math.round(draft.node.height() / canvasScale)
    };
    registerFinalizedShapeNode(draft.node, model);
    shapes.push(model);
    draft = null; advanceWorkspaceRevision(); annotationsLayer.draw(); updateAnnotationList();
  }

  // 直線作図
  function startLine(pos) {
    const n = nearestEndpoint(pos);
    const p = n ? { x: n.x, y: n.y } : { x: pos.x, y: pos.y };
    if (n) { showSnap(n.x, n.y); }
    const node = new Konva.Line({ points: [p.x, p.y, p.x, p.y], ...commonStrokeProps(defaultThickness), draggable: false, hitStrokeWidth: Math.max(8, defaultThickness) });
    draft = { type: 'line', node };
    annotationsLayer.add(node); annotationsLayer.draw();
    showHint('クリックで終点を指定 / 端点に近づけるとスナップ', 2000);
  }
  function updateDraftLine(pos) {
    const pts = draft.node.points();
    const n = nearestEndpoint(pos);
    const ex = n ? n.x : pos.x; const ey = n ? n.y : pos.y;
    draft.node.points([pts[0], pts[1], ex, ey]);
    if (n) showSnap(n.x, n.y); else hideSnap();
    const a = toOriginal(pts[0], pts[1]); const b = toOriginal(ex, ey);
    showCoordinates(`(${a.x},${a.y}) → (${b.x},${b.y})`);
    annotationsLayer.batchDraw();
  }
  function finalizeLine() {
    hideCoordinates();
    hideSnap();
    const p = draft.node.points(); const len = Math.hypot(p[2]-p[0], p[3]-p[1]);
    if (len < 5) { draft.node.destroy(); annotationsLayer.draw(); draft = null; return; }
    const model = {
      id: idSeq++, type: 'line', colorHex: colorForStroke(), thickness: defaultThickness,
      x1: Math.round(p[0] / canvasScale), y1: Math.round(p[1] / canvasScale), x2: Math.round(p[2] / canvasScale), y2: Math.round(p[3] / canvasScale)
    };
    registerFinalizedShapeNode(draft.node, model);
    shapes.push(model); draft = null; advanceWorkspaceRevision(); updateAnnotationList();
  }

  // 多角形作図
  function clickPolygon(pos) {
    const x = pos.x, y = pos.y;
    if (!draft) {
      const node = new Konva.Line({ points: [x, y], closed: false, ...commonStrokeProps(defaultThickness), draggable: false });
      draft = { type: 'polygon', node, points: [x, y] };
      annotationsLayer.add(node); annotationsLayer.draw();
    } else {
      draft.points.push(x, y); draft.node.points(draft.points); annotationsLayer.batchDraw();
    }
  }
  function updateDraftPolygon(pos) {
    if (!draft.points || draft.points.length < 2) return;
    const tmp = draft.points.slice(); tmp.push(pos.x, pos.y); draft.node.points(tmp);
    const last = tmp.length; const o = toOriginal(tmp[last-2], tmp[last-1]);
    showCoordinates(`点: (${o.x},${o.y})  頂点数:${(tmp.length/2)}`);
    annotationsLayer.batchDraw();
  }
  function finalizePolygon() {
    if (!draft || draft.type !== 'polygon') return;
    const pts = draft.points; if (pts.length < 6) { draft.node.destroy(); annotationsLayer.draw(); draft = null; return; }
    hideCoordinates(); draft.node.closed(true);
    const model = { id: idSeq++, type: 'polygon', colorHex: colorForStroke(), thickness: defaultThickness, points: pts.map(v => Math.round(v / canvasScale)) };
    registerFinalizedShapeNode(draft.node, model);
    shapes.push(model); draft = null; advanceWorkspaceRevision(); updateAnnotationList();
  }

  // 平行四辺形作図（3点指定で確定）
  function clickParallelogram(pos) {
    const x = pos.x, y = pos.y;
    if (!draft) {
      const node = new Konva.Line({ points: [x, y], closed: false, ...commonStrokeProps(defaultThickness), draggable: false });
      draft = { type: 'parallelogram', node, points: [x, y] };
      annotationsLayer.add(node); annotationsLayer.draw();
    } else {
      draft.points.push(x, y);
      if (draft.points.length >= 6) {
        const p1 = { x: draft.points[0], y: draft.points[1] };
        const p2 = { x: draft.points[2], y: draft.points[3] };
        const p3 = { x: draft.points[4], y: draft.points[5] };
        const p4 = { x: p3.x + (p2.x - p1.x), y: p3.y + (p2.y - p1.y) };
        // 頂点順を [P1, P2, P4, P3] にする
        const tmp = [p1.x, p1.y, p2.x, p2.y, p4.x, p4.y, p3.x, p3.y, p1.x, p1.y];
        draft.node.points(tmp); draft.node.closed(true);
        finalizeParallelogram();
      } else {
        draft.node.points(draft.points); annotationsLayer.batchDraw();
      }
    }
  }
  function updateDraftParallelogram(pos) {
    const pts = draft.points;
    if (pts.length === 2) {
      draft.node.points([pts[0], pts[1], pos.x, pos.y]);
    } else if (pts.length === 4) {
      const p1 = { x: pts[0], y: pts[1] };
      const p2 = { x: pts[2], y: pts[3] };
      const p3 = { x: pos.x, y: pos.y };
      const p4 = { x: p3.x + (p2.x - p1.x), y: p3.y + (p2.y - p1.y) };
      // プレビューも [P1, P2, P4, P3]
      draft.node.points([p1.x, p1.y, p2.x, p2.y, p4.x, p4.y, p3.x, p3.y, p1.x, p1.y]); draft.node.closed(true);
    }
    annotationsLayer.batchDraw();
  }
  function finalizeParallelogram() {
    hideCoordinates();
    const pts = draft.node.points(); if (pts.length < 8) { draft.node.destroy(); annotationsLayer.draw(); draft = null; return; }
    const modelPts = pts.slice(0, 8).map(v => Math.round(v / canvasScale));
    const model = { id: idSeq++, type: 'parallelogram', colorHex: colorForStroke(), thickness: defaultThickness, points: modelPts };
    registerFinalizedShapeNode(draft.node, model);
    shapes.push(model); draft = null; advanceWorkspaceRevision(); updateAnnotationList();
  }

  // 一覧とJSON表示の更新
  function updateAnnotationList() {
    annotationList.innerHTML = '';
    shapes.forEach((s, idx) => {
      const title = shapeTitle(s, idx);
      const item = document.createElement('div');
      item.className = 'annotation-item';
      item.dataset.shapeId = String(s.id);
      item.classList.toggle('selected', selectedShapeId === s.id);

      const selectButton = document.createElement('button');
      selectButton.type = 'button';
      selectButton.className = 'annotation-select-btn';
      selectButton.setAttribute('aria-label', `${title}を選択`);
      selectButton.setAttribute('aria-pressed', selectedShapeId === s.id ? 'true' : 'false');

      const swatch = document.createElement('span');
      swatch.className = 'annotation-color-swatch';
      swatch.style.backgroundColor = s.colorHex || '#000';
      const titleText = document.createElement('strong');
      titleText.textContent = title;
      const summary = document.createElement('span');
      summary.className = 'annotation-summary';
      summary.textContent = shapeSummary(s);
      selectButton.append(swatch, titleText, document.createElement('br'), summary);
      selectButton.addEventListener('click', () => selectAnnotationById(s.id));

      const del = document.createElement('button'); del.className = 'delete-btn'; del.textContent = '削除';
      del.type = 'button';
      del.setAttribute('aria-label', `${title}を削除`);
      del.addEventListener('click', (e) => { e.stopPropagation(); deleteAnnotationByIndex(idx); });
      item.append(selectButton, del);
      annotationList.appendChild(item);
    });
    if (shapes.length === 0) {
      const msg = document.createElement('div'); msg.style.color = '#666'; msg.style.padding = '10px';
      msg.textContent = 'アノテーションがありません。ツールを選択して画像上を操作してください。';
      annotationList.appendChild(msg);
    }
    updateJsonDisplay();
    syncColorControls();
  }

  function selectAnnotationById(id) {
    const node = findAnnotationNodeById(id);
    if (!node || !setCurrentTool('select', { announce: false })) return;
    onSelectShape(node);
  }

  function shapeTitle(s, idx) {
    const n = idx + 1;
    if (s.type === 'rectangle') return `矩形 #${n}`;
    if (s.type === 'line') return `直線 #${n}`;
    if (s.type === 'polygon') return `多角形 #${n}`;
    if (s.type === 'parallelogram') return `平行四辺形 #${n}`;
    if (s.type === 'circle') return `円 #${n}`;
    return `図形 #${n}`;
  }
  function shapeSummary(s) {
    if (s.type === 'rectangle') return `X:${s.x}px, Y:${s.y}px, W:${s.width}px, H:${s.height}px`;
    if (s.type === 'line') return `(${s.x1},${s.y1})→(${s.x2},${s.y2})`;
    if (s.type === 'polygon' || s.type === 'parallelogram') return `頂点:${s.points.length / 2}点`;
    if (s.type === 'circle') return `中心:(${s.x},${s.y}), 半径:${s.radius}px`;
    return '';
  }

  function deleteAnnotationByIndex(index) {
    const s = shapes[index]; if (!s) return;
    const node = findAnnotationNodeById(s.id);
    if (selectedShapeId === s.id) clearSelection();
    if (node) node.destroy(); shapes.splice(index, 1); advanceWorkspaceRevision(); annotationsLayer.draw();
    showNotification(`${shapeTitle(s, index)} を削除しました`); updateAnnotationList();
  }

  function updateJsonDisplay() {
    if (shapes.length === 0) { jsonDisplay.textContent = 'アノテーションがありません'; return; }
    const allJson = getAnnotationDocument();
    jsonDisplay.textContent = JSON.stringify(allJson, null, 2);
  }
  function getAnnotationDocument() {
    return { draw: shapes.map(shapeToJson) };
  }
  function shapeToJson(s) {
    const colorHex = (s.colorHex || '#000000').substring(1);
    if (s.type === 'rectangle') return { shape: 'rectangle', x: s.x, y: s.y, width: s.width, height: s.height, color: colorHex, thickness: s.thickness };
    if (s.type === 'line') return { shape: 'line', x1: s.x1, y1: s.y1, x2: s.x2, y2: s.y2, color: colorHex, thickness: s.thickness };
    if (s.type === 'polygon') return { shape: 'polygon', points: s.points.slice(), color: colorHex, thickness: s.thickness };
    if (s.type === 'parallelogram') return { shape: 'parallelogram', points: s.points.slice(), color: colorHex, thickness: s.thickness };
    if (s.type === 'circle') return { shape: 'circle', x: s.x, y: s.y, radius: s.radius, color: colorHex, thickness: s.thickness };
    return {};
  }

  function validateWebMcpUrlImageInput(input) {
    assertWebMcpObject(input, 'input');
    assertWebMcpExactKeys(input, ['expectedRevision', 'url'], 'input');
    assertWebMcpRevision(input.expectedRevision, 'input.expectedRevision');
    if (typeof input.url !== 'string' || input.url.trim() === '') {
      throw new TypeError('input.url は空でない絶対URL文字列である必要があります');
    }
    return {
      expectedRevision: input.expectedRevision,
      url: parseAllowedWebMcpImageUrl(input.url.trim())
    };
  }

  function parseAllowedWebMcpImageUrl(value) {
    let parsed;
    try {
      parsed = new URL(value);
    } catch {
      throw new TypeError('input.url は有効な絶対URLである必要があります');
    }

    if (parsed.username || parsed.password) {
      throw new TypeError('input.url にユーザー名またはパスワードを含めることはできません');
    }
    if (parsed.protocol === 'https:') return parsed;

    const pageUrl = new URL(window.location.href);
    if (
      parsed.protocol === 'http:' &&
      pageUrl.protocol === 'http:' &&
      isLoopbackHostname(pageUrl.hostname) &&
      parsed.origin === pageUrl.origin
    ) {
      return parsed;
    }

    throw new TypeError('input.url はHTTPS、または現在のloopbackページと同一オリジンのHTTP URLである必要があります');
  }

  function isLoopbackHostname(hostname) {
    const normalized = String(hostname || '').toLowerCase();
    return normalized === '127.0.0.1' || normalized === 'localhost' || normalized === '[::1]' || normalized === '::1';
  }

  async function openWebMcpImageFromUrl(openInput, signal) {
    assertCurrentWorkspaceRevision(openInput.expectedRevision);
    throwIfWebMcpExecutionAborted(signal);

    let response;
    try {
      response = await fetch(openInput.url.href, {
        method: 'GET',
        mode: 'cors',
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        cache: 'no-store',
        signal
      });
    } catch (error) {
      throwIfWebMcpExecutionAborted(signal);
      throw new Error('画像URLを取得できません。URL、ネットワーク、または配信元のCORS設定を確認してください');
    }

    if (!response.ok) {
      throw new Error(`画像URLの取得に失敗しました（HTTP ${response.status}）`);
    }
    parseAllowedWebMcpImageUrl(response.url || openInput.url.href);

    const contentType = (response.headers.get('content-type') || '').split(';', 1)[0].trim().toLowerCase();
    if (!WEBMCP_IMAGE_MIME_TYPES.has(contentType)) {
      throw new TypeError('画像URLのContent-Typeはimage/png、image/jpeg、image/webpのいずれかである必要があります');
    }

    const contentLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(contentLength) && contentLength > WEBMCP_MAX_IMAGE_BYTES) {
      throw new RangeError('画像URLのデータは12 MiB以下である必要があります');
    }

    const blob = await response.blob();
    throwIfWebMcpExecutionAborted(signal);
    if (blob.size === 0) throw new TypeError('画像URLから空のデータが返されました');
    if (blob.size > WEBMCP_MAX_IMAGE_BYTES) throw new RangeError('画像URLのデータは12 MiB以下である必要があります');

    const objectUrl = URL.createObjectURL(blob);
    try {
      const image = await decodeImageSource(objectUrl, signal);
      throwIfWebMcpExecutionAborted(signal);
      assertCurrentWorkspaceRevision(openInput.expectedRevision);
      commitLoadedImage(image, '');
      return {
        loaded: true,
        revision: workspaceRevision,
        image: {
          originalWidth: image.naturalWidth,
          originalHeight: image.naturalHeight
        }
      };
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }

  function validateWebMcpDataUrlImageInput(input) {
    assertWebMcpObject(input, 'input');
    assertWebMcpExactKeys(input, ['expectedRevision', 'dataUrl'], 'input');
    assertWebMcpRevision(input.expectedRevision, 'input.expectedRevision');
    if (typeof input.dataUrl !== 'string' || input.dataUrl.length === 0) {
      throw new TypeError('input.dataUrl は空でないData URL文字列である必要があります');
    }
    if (input.dataUrl.length > WEBMCP_MAX_DATA_URL_LENGTH) {
      throw new RangeError('input.dataUrl は12 MiB以下である必要があります');
    }

    const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]*={0,2})$/.exec(input.dataUrl);
    if (!match) {
      throw new TypeError('input.dataUrl はPNG、JPEG、WebPのbase64 Data URLである必要があります');
    }

    let decodedLength;
    try {
      decodedLength = atob(match[2]).length;
    } catch {
      throw new TypeError('input.dataUrl のbase64データが不正です');
    }
    if (decodedLength === 0) throw new TypeError('input.dataUrl の画像データが空です');
    if (decodedLength > WEBMCP_MAX_IMAGE_BYTES) {
      throw new RangeError('input.dataUrl の画像データは12 MiB以下である必要があります');
    }

    return input;
  }

  async function openWebMcpImageFromDataUrl(openInput, signal) {
    assertCurrentWorkspaceRevision(openInput.expectedRevision);
    throwIfWebMcpExecutionAborted(signal);
    const image = await decodeImageSource(openInput.dataUrl, signal);
    throwIfWebMcpExecutionAborted(signal);
    assertCurrentWorkspaceRevision(openInput.expectedRevision);
    commitLoadedImage(image, '');
    return {
      loaded: true,
      revision: workspaceRevision,
      image: {
        originalWidth: image.naturalWidth,
        originalHeight: image.naturalHeight
      }
    };
  }

  function validateWebMcpAnnotationDocument(input) {
    assertWebMcpObject(input, 'input');
    assertWebMcpExactKeys(input, ['draw'], 'input');
    if (!Array.isArray(input.draw)) throw new TypeError('draw は配列である必要があります');

    for (let index = 0; index < input.draw.length; index++) {
      const annotation = input.draw[index];
      const path = `draw[${index}]`;
      assertWebMcpObject(annotation, path);

      if (annotation.shape === 'rectangle') {
        assertWebMcpExactKeys(annotation, ['shape', 'x', 'y', 'width', 'height', 'color', 'thickness'], path);
        assertWebMcpSafeInteger(annotation.x, `${path}.x`);
        assertWebMcpSafeInteger(annotation.y, `${path}.y`);
        assertWebMcpSafeInteger(annotation.width, `${path}.width`);
        assertWebMcpSafeInteger(annotation.height, `${path}.height`);
        if (annotation.width < 5) throw new TypeError(`${path}.width は5以上である必要があります`);
        if (annotation.height < 5) throw new TypeError(`${path}.height は5以上である必要があります`);
      } else if (annotation.shape === 'line') {
        assertWebMcpExactKeys(annotation, ['shape', 'x1', 'y1', 'x2', 'y2', 'color', 'thickness'], path);
        assertWebMcpSafeInteger(annotation.x1, `${path}.x1`);
        assertWebMcpSafeInteger(annotation.y1, `${path}.y1`);
        assertWebMcpSafeInteger(annotation.x2, `${path}.x2`);
        assertWebMcpSafeInteger(annotation.y2, `${path}.y2`);
        if (Math.hypot(annotation.x2 - annotation.x1, annotation.y2 - annotation.y1) < 5) {
          throw new TypeError(`${path} の線の長さは5以上である必要があります`);
        }
      } else if (annotation.shape === 'polygon') {
        assertWebMcpExactKeys(annotation, ['shape', 'points', 'color', 'thickness'], path);
        assertWebMcpPoints(annotation.points, path, 6, false);
      } else if (annotation.shape === 'parallelogram') {
        assertWebMcpExactKeys(annotation, ['shape', 'points', 'color', 'thickness'], path);
        assertWebMcpPoints(annotation.points, path, 8, true);
      } else if (annotation.shape === 'circle') {
        assertWebMcpExactKeys(annotation, ['shape', 'x', 'y', 'radius', 'color', 'thickness'], path);
        assertWebMcpSafeInteger(annotation.x, `${path}.x`);
        assertWebMcpSafeInteger(annotation.y, `${path}.y`);
        assertWebMcpSafeInteger(annotation.radius, `${path}.radius`);
        if (annotation.radius < 3) throw new TypeError(`${path}.radius は3以上である必要があります`);
      } else {
        throw new TypeError(`${path}.shape は rectangle、line、polygon、parallelogram、circle のいずれかである必要があります`);
      }

      if (typeof annotation.color !== 'string' || !/^#?[0-9A-Fa-f]{6}$/.test(annotation.color) || !normalizeHex(annotation.color)) {
        throw new TypeError(`${path}.color は先頭の # が任意の6桁HEX文字列である必要があります`);
      }
      assertWebMcpFiniteNumber(annotation.thickness, `${path}.thickness`);
      if (annotation.thickness <= 0) throw new TypeError(`${path}.thickness は0より大きい値である必要があります`);
    }

    return input;
  }

  function validateWebMcpReplaceInput(input) {
    assertWebMcpObject(input, 'input');
    assertWebMcpExactKeys(input, ['expectedRevision', 'draw'], 'input');
    assertWebMcpRevision(input.expectedRevision, 'input.expectedRevision');
    validateWebMcpAnnotationDocument({ draw: input.draw });
    return input;
  }

  function validateWebMcpDownloadInput(input) {
    assertWebMcpObject(input, 'input');
    assertWebMcpExactKeys(input, ['expectedRevision'], 'input');
    assertWebMcpRevision(input.expectedRevision, 'input.expectedRevision');
    return input;
  }

  function validateWebMcpPreviewInput(input) {
    assertWebMcpObject(input, 'input');
    const extraKey = Object.keys(input).find((key) => key !== 'maxDimension');
    if (extraKey !== undefined) throw new TypeError(`input[${JSON.stringify(extraKey)}] は追加できません`);
    const maxDimension = input.maxDimension === undefined
      ? WEBMCP_PREVIEW_DEFAULT_MAX_DIMENSION
      : input.maxDimension;
    if (
      !Number.isSafeInteger(maxDimension) ||
      maxDimension < WEBMCP_PREVIEW_MIN_DIMENSION ||
      maxDimension > WEBMCP_PREVIEW_MAX_DIMENSION
    ) {
      throw new TypeError(`input.maxDimension は${WEBMCP_PREVIEW_MIN_DIMENSION}以上${WEBMCP_PREVIEW_MAX_DIMENSION}以下の整数である必要があります`);
    }
    return { maxDimension };
  }

  function validateWebMcpExportInput(input) {
    assertWebMcpObject(input, 'input');
    assertWebMcpExactKeys(input, ['expectedRevision', 'delivery'], 'input');
    assertWebMcpRevision(input.expectedRevision, 'input.expectedRevision');
    if (input.delivery !== 'data_url' && input.delivery !== 'download') {
      throw new TypeError('input.delivery はdata_urlまたはdownloadである必要があります');
    }
    return input;
  }

  function validateWebMcpEmptyInput(input) {
    assertWebMcpObject(input, 'input');
    assertWebMcpExactKeys(input, [], 'input');
    return input;
  }

  function validateWebMcpExportReference(input, read = false) {
    assertWebMcpObject(input, 'input');
    assertWebMcpExactKeys(input, read ? ['exportId', 'format', 'offset', 'maxBytes'] : ['exportId'], 'input');
    if (typeof input.exportId !== 'string' || !input.exportId) {
      throw new TypeError('input.exportId は出力準備で取得した識別子である必要があります');
    }
    if (read) {
      if (input.format !== 'png' && input.format !== 'json') throw new TypeError('input.format はpngまたはjsonである必要があります');
      assertWebMcpRevision(input.offset, 'input.offset');
      if (!Number.isSafeInteger(input.maxBytes) || input.maxBytes < 1 || input.maxBytes > WEBMCP_EXPORT_MAX_CHUNK_BYTES) {
        throw new TypeError(`input.maxBytes は1以上${WEBMCP_EXPORT_MAX_CHUNK_BYTES}以下の整数である必要があります`);
      }
    }
    return input;
  }

  function assertWebMcpObject(value, path) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new TypeError(`${path} はオブジェクトである必要があります`);
    }
  }

  function assertWebMcpExactKeys(value, expectedKeys, path) {
    const missingKey = expectedKeys.find((key) => !Object.prototype.hasOwnProperty.call(value, key));
    if (missingKey) throw new TypeError(`${path}.${missingKey} は必須です`);
    const extraKey = Object.keys(value).find((key) => !expectedKeys.includes(key));
    if (extraKey !== undefined) throw new TypeError(`${path}[${JSON.stringify(extraKey)}] は追加できません`);
  }

  function assertWebMcpFiniteNumber(value, path) {
    if (!Number.isFinite(value)) throw new TypeError(`${path} は有限数である必要があります`);
  }

  function assertWebMcpSafeInteger(value, path) {
    if (!Number.isSafeInteger(value)) throw new TypeError(`${path} は安全な整数である必要があります`);
  }

  function assertWebMcpRevision(value, path) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new TypeError(`${path} は0以上の安全な整数である必要があります`);
    }
  }

  function assertCurrentWorkspaceRevision(expectedRevision) {
    if (expectedRevision !== workspaceRevision) {
      throw new Error(`作業状態が更新されています。get_annotations で最新の revision (${workspaceRevision}) を取得して再実行してください`);
    }
  }

  function assertWebMcpPoints(points, path, requiredLength, exactLength) {
    if (!Array.isArray(points)) throw new TypeError(`${path}.points は整数配列である必要があります`);
    if (exactLength && points.length !== requiredLength) {
      throw new TypeError(`${path}.points は正確に${requiredLength}要素である必要があります`);
    }
    if (!exactLength && points.length < requiredLength) {
      throw new TypeError(`${path}.points は${requiredLength}要素以上である必要があります`);
    }
    if (points.length % 2 !== 0) throw new TypeError(`${path}.points は偶数要素である必要があります`);
    for (let index = 0; index < points.length; index++) {
      assertWebMcpSafeInteger(points[index], `${path}.points[${index}]`);
    }
  }

  function throwIfWebMcpExecutionAborted(signal) {
    if (!signal || !signal.aborted) return;
    if (typeof signal.throwIfAborted === 'function') signal.throwIfAborted();
    throw new DOMException('WebMCP ツールの実行がキャンセルされました', 'AbortError');
  }

  async function registerAnnoForgeWebMcpTools() {
    if (typeof document.modelContext?.registerTool !== 'function') return;

    const urlImageInputSchema = {
      type: 'object',
      additionalProperties: false,
      required: ['expectedRevision', 'url'],
      properties: {
        expectedRevision: {
          type: 'integer',
          minimum: 0
        },
        url: {
          type: 'string',
          minLength: 1
        }
      }
    };

    const dataUrlImageInputSchema = {
      type: 'object',
      additionalProperties: false,
      required: ['expectedRevision', 'dataUrl'],
      properties: {
        expectedRevision: {
          type: 'integer',
          minimum: 0
        },
        dataUrl: {
          type: 'string',
          minLength: 1,
          maxLength: WEBMCP_MAX_DATA_URL_LENGTH,
          pattern: '^data:image/(png|jpeg|webp);base64,'
        }
      }
    };

    const previewInputSchema = {
      type: 'object',
      additionalProperties: false,
      properties: {
        maxDimension: {
          type: 'integer',
          minimum: WEBMCP_PREVIEW_MIN_DIMENSION,
          maximum: WEBMCP_PREVIEW_MAX_DIMENSION,
          default: WEBMCP_PREVIEW_DEFAULT_MAX_DIMENSION
        }
      }
    };

    const coordinateInputSchema = {
      type: 'integer',
      minimum: Number.MIN_SAFE_INTEGER,
      maximum: Number.MAX_SAFE_INTEGER
    };

    const sizeInputSchema = {
      type: 'integer',
      minimum: 5,
      maximum: Number.MAX_SAFE_INTEGER
    };

    const radiusInputSchema = {
      type: 'integer',
      minimum: 3,
      maximum: Number.MAX_SAFE_INTEGER
    };

    const replaceAnnotationsInputSchema = {
      type: 'object',
      additionalProperties: false,
      required: ['expectedRevision', 'draw'],
      properties: {
        expectedRevision: {
          type: 'integer',
          minimum: 0
        },
        draw: {
          type: 'array',
          items: {
            oneOf: [
              {
                type: 'object',
                additionalProperties: false,
                required: ['shape', 'x', 'y', 'width', 'height', 'color', 'thickness'],
                properties: {
                  shape: { const: 'rectangle' },
                  x: coordinateInputSchema,
                  y: coordinateInputSchema,
                  width: sizeInputSchema,
                  height: sizeInputSchema,
                  color: { type: 'string', pattern: '^#?[0-9A-Fa-f]{6}$' },
                  thickness: { type: 'number', exclusiveMinimum: 0 }
                }
              },
              {
                type: 'object',
                additionalProperties: false,
                required: ['shape', 'x1', 'y1', 'x2', 'y2', 'color', 'thickness'],
                properties: {
                  shape: { const: 'line' },
                  x1: coordinateInputSchema,
                  y1: coordinateInputSchema,
                  x2: coordinateInputSchema,
                  y2: coordinateInputSchema,
                  color: { type: 'string', pattern: '^#?[0-9A-Fa-f]{6}$' },
                  thickness: { type: 'number', exclusiveMinimum: 0 }
                }
              },
              {
                type: 'object',
                additionalProperties: false,
                required: ['shape', 'points', 'color', 'thickness'],
                properties: {
                  shape: { const: 'polygon' },
                  points: {
                    type: 'array',
                    minItems: 6,
                    items: coordinateInputSchema
                  },
                  color: { type: 'string', pattern: '^#?[0-9A-Fa-f]{6}$' },
                  thickness: { type: 'number', exclusiveMinimum: 0 }
                }
              },
              {
                type: 'object',
                additionalProperties: false,
                required: ['shape', 'points', 'color', 'thickness'],
                properties: {
                  shape: { const: 'parallelogram' },
                  points: {
                    type: 'array',
                    minItems: 8,
                    maxItems: 8,
                    items: coordinateInputSchema
                  },
                  color: { type: 'string', pattern: '^#?[0-9A-Fa-f]{6}$' },
                  thickness: { type: 'number', exclusiveMinimum: 0 }
                }
              },
              {
                type: 'object',
                additionalProperties: false,
                required: ['shape', 'x', 'y', 'radius', 'color', 'thickness'],
                properties: {
                  shape: { const: 'circle' },
                  x: coordinateInputSchema,
                  y: coordinateInputSchema,
                  radius: radiusInputSchema,
                  color: { type: 'string', pattern: '^#?[0-9A-Fa-f]{6}$' },
                  thickness: { type: 'number', exclusiveMinimum: 0 }
                }
              }
            ]
          }
        }
      }
    };

    const downloadInputSchema = {
      type: 'object',
      additionalProperties: false,
      required: ['expectedRevision'],
      properties: {
        expectedRevision: {
          type: 'integer',
          minimum: 0
        }
      }
    };

    const exportImageInputSchema = {
      type: 'object',
      additionalProperties: false,
      required: ['expectedRevision', 'delivery'],
      properties: {
        expectedRevision: {
          type: 'integer',
          minimum: 0
        },
        delivery: {
          type: 'string',
          enum: ['data_url', 'download']
        }
      }
    };

    try {
      await document.modelContext.registerTool({
        name: 'open_image_from_url',
        title: 'URLから画像を開く',
        description: '現在の版が expectedRevision と一致する場合だけ、12 MiB以下のPNG、JPEG、WebPを、HTTPS URL（クロスオリジンの場合は配信元のCORS許可が必要）または同一オリジンのloopback HTTP URLから開きます。成功時は既存アノテーションを消去します。',
        inputSchema: urlImageInputSchema,
        annotations: {
          readOnlyHint: false,
          untrustedContentHint: false
        },
        execute: async (input, { signal } = {}) => {
          throwIfWebMcpExecutionAborted(signal);
          const openInput = validateWebMcpUrlImageInput(input);
          return openWebMcpImageFromUrl(openInput, signal);
        }
      });

      await document.modelContext.registerTool({
        name: 'open_image_from_data_url',
        title: 'Data URLから画像を開く',
        description: '現在の版が expectedRevision と一致する場合だけ、呼び出し側から渡された12 MiB以下のPNG、JPEG、WebPのbase64 Data URLを開きます。会話の添付ファイルを直接読み取る機能ではありません。成功時は既存アノテーションを消去します。',
        inputSchema: dataUrlImageInputSchema,
        annotations: {
          readOnlyHint: false,
          untrustedContentHint: false
        },
        execute: async (input, { signal } = {}) => {
          throwIfWebMcpExecutionAborted(signal);
          const openInput = validateWebMcpDataUrlImageInput(input);
          return openWebMcpImageFromDataUrl(openInput, signal);
        }
      });

      await document.modelContext.registerTool({
        name: 'get_annotations',
        title: '現在のアノテーションを取得',
        description: '現在の AnnoForge ページにある全アノテーションを、元画像座標の draw 配列として読み取ります。画像データとファイル名は返しません。',
        inputSchema: {
          type: 'object',
          properties: {},
          additionalProperties: false
        },
        annotations: {
          readOnlyHint: true,
          untrustedContentHint: false
        },
        execute: async (input, { signal } = {}) => {
          throwIfWebMcpExecutionAborted(signal);
          validateWebMcpEmptyInput(input);
          const annotationDocument = getAnnotationDocument();
          return {
            revision: workspaceRevision,
            draw: annotationDocument.draw,
            annotationCount: annotationDocument.draw.length,
            image: {
              loaded: !!loadedImage,
              originalWidth: loadedImage ? loadedImage.naturalWidth : null,
              originalHeight: loadedImage ? loadedImage.naturalHeight : null
            }
          };
        }
      });

      await document.modelContext.registerTool({
        name: 'get_image_preview',
        title: '現在の画像プレビューを取得',
        description: '元画像の範囲に確定済みアノテーションを重ね、縦横比を維持したPNG Data URLとして返します。最大辺は既定1024px、指定可能範囲は64pxから2048pxで、元画像より拡大しません。表示のパン、ズーム、選択状態は結果へ影響しません。',
        inputSchema: previewInputSchema,
        annotations: {
          readOnlyHint: true,
          untrustedContentHint: true
        },
        execute: async (input, { signal } = {}) => {
          throwIfWebMcpExecutionAborted(signal);
          const previewInput = validateWebMcpPreviewInput(input);
          if (!loadedImage) throw new Error('プレビューを取得する前に画像を開いてください');
          return createWebMcpImagePreview(previewInput.maxDimension, signal);
        }
      });

      await document.modelContext.registerTool({
        name: 'replace_annotations',
        title: 'アノテーションを置換',
        description: '現在の版が expectedRevision と一致する場合だけ、全アノテーションを整数ピクセル座標の AnnoForge draw 配列で置き換えます。空配列は全消去です。全項目の検証後にだけ変更します。',
        inputSchema: replaceAnnotationsInputSchema,
        annotations: {
          readOnlyHint: false,
          untrustedContentHint: false
        },
        execute: async (input, { signal } = {}) => {
          throwIfWebMcpExecutionAborted(signal);
          const replaceInput = validateWebMcpReplaceInput(input);
          assertCurrentWorkspaceRevision(replaceInput.expectedRevision);
          throwIfWebMcpExecutionAborted(signal);
          importAnnotations({ draw: replaceInput.draw });
          return {
            replaced: true,
            annotationCount: shapes.length,
            revision: workspaceRevision
          };
        }
      });

      await document.modelContext.registerTool({
        name: 'start_annotations_json_download',
        title: 'アノテーションJSONの保存を開始',
        description: '現在の版が expectedRevision と一致し、アノテーションがある場合だけ、現在の draw のJSONを生成してブラウザーへダウンロードを要求します。結果は要求送信までを示し、ブラウザーでの保存完了は確認しません。PNGとJSONの実ファイル受信にはprepare_annotation_exportとread_annotation_exportによる直接取得経路もあります。',
        inputSchema: downloadInputSchema,
        annotations: {
          readOnlyHint: false,
          untrustedContentHint: false
        },
        execute: async (input, { signal } = {}) => {
          throwIfWebMcpExecutionAborted(signal);
          const downloadInput = validateWebMcpDownloadInput(input);
          assertCurrentWorkspaceRevision(downloadInput.expectedRevision);
          throwIfWebMcpExecutionAborted(signal);
          return requestAnnotationsJsonDownload(downloadInput.expectedRevision, signal);
        }
      });

      await document.modelContext.registerTool({
        name: 'export_annotated_image',
        title: '注釈付き画像を出力',
        description: '現在の版が expectedRevision と一致する場合だけ、元画像と確定済みアノテーションを元画像と同じ寸法のPNGとして出力します。data_urlはPNGデータをツール呼び出し元へ返しますが、会話への表示や添付は保証しません。downloadはブラウザーへダウンロードを要求しますが、保存完了は確認しません。実ファイルを受信して会話へ添付する場合は、prepare_annotation_exportとread_annotation_exportでPNGとJSONを直接取得できます。表示のパン、ズーム、選択状態は結果へ影響しません。',
        inputSchema: exportImageInputSchema,
        annotations: {
          readOnlyHint: false,
          untrustedContentHint: true
        },
        execute: async (input, { signal } = {}) => {
          throwIfWebMcpExecutionAborted(signal);
          const exportInput = validateWebMcpExportInput(input);
          assertCurrentWorkspaceRevision(exportInput.expectedRevision);
          if (!loadedImage) throw new Error('注釈付き画像を出力する前に画像を開いてください');
          throwIfWebMcpExecutionAborted(signal);
          if (exportInput.delivery === 'download') {
            return requestAnnotatedImageDownload(signal, exportInput.expectedRevision);
          }

          const imageResult = await createAnnotatedImageResult(signal);
          return {
            outcome: 'data_returned',
            delivery: 'data_url',
            revision: imageResult.revision,
            annotationCount: imageResult.annotationCount,
            mimeType: 'image/png',
            width: imageResult.width,
            height: imageResult.height,
            dataUrl: imageResult.dataUrl
          };
        }
      });

      await document.modelContext.registerTool({
        name: 'prepare_annotation_export',
        title: 'PNGとJSONの受け渡しを準備',
        description: '同じexpectedRevisionの元画像寸法PNGと注釈JSONを生成し、exportIdと各ファイルの名前・バイト数・SHA-256を返します。自動ダウンロードは行いません。read_annotation_exportで実データを取得できます。準備済み出力はページ内で1組だけ保持し、新しい準備・画像や注釈の編集・release_annotation_export・ページ終了で無効になります。保存と会話への添付は呼び出し側が行います。',
        inputSchema: downloadInputSchema,
        annotations: { readOnlyHint: false, untrustedContentHint: true },
        execute: async (input, { signal } = {}) => {
          const { expectedRevision } = validateWebMcpDownloadInput(input);
          return prepareAnnotationExport(expectedRevision, signal);
        }
      });

      await document.modelContext.registerTool({
        name: 'read_annotation_export',
        title: '準備済み出力のバイト列を取得',
        description: '準備したPNGまたはJSONの指定範囲をbase64で返します。offsetはバイト位置です。nextOffsetまで順に取得し、元のバイト列として連結してください。結果を会話へ全文展開する必要はありません。取得した実ファイルのバイト数とSHA-256を準備結果と照合してください。これはプレビューでもダウンロード開始通知でもありません。',
        inputSchema: {
          type: 'object', additionalProperties: false,
          required: ['exportId', 'format', 'offset', 'maxBytes'],
          properties: {
            exportId: { type: 'string', minLength: 1 },
            format: { type: 'string', enum: ['png', 'json'] },
            offset: { type: 'integer', minimum: 0 },
            maxBytes: { type: 'integer', minimum: 1, maximum: WEBMCP_EXPORT_MAX_CHUNK_BYTES, default: WEBMCP_EXPORT_CHUNK_BYTES }
          }
        },
        annotations: { readOnlyHint: true, untrustedContentHint: true },
        execute: async (input, { signal } = {}) => readAnnotationExport(validateWebMcpExportReference(input, true), signal)
      });

      await document.modelContext.registerTool({
        name: 'release_annotation_export',
        title: '準備済み出力を解放',
        description: '指定したexportIdが現在の準備済み出力と一致する場合だけメモリーから解放します。画像と注釈、取得済みファイルは変更しません。既に解放済みの場合はreleased:falseを返します。',
        inputSchema: {
          type: 'object', additionalProperties: false, required: ['exportId'],
          properties: { exportId: { type: 'string', minLength: 1 } }
        },
        annotations: { readOnlyHint: false, untrustedContentHint: false },
        execute: async (input, { signal } = {}) => {
          throwIfWebMcpExecutionAborted(signal);
          const { exportId } = validateWebMcpExportReference(input);
          const released = preparedAnnotationExport?.exportId === exportId;
          if (released) preparedAnnotationExport = null;
          return { exportId, released };
        }
      });
    } catch (error) {
      console.error('WebMCP ツールの登録に失敗しました:', error);
    }
  }

  // クリップボード
  function copyAllAnnotations() {
    if (shapes.length === 0) { showNotification('コピーするアノテーションがありません', 'error'); return; }
    const jsonString = JSON.stringify(getAnnotationDocument(), null, 2);
    copyToClipboard(jsonString); showNotification(`${shapes.length}個のアノテーションをコピーしました`);
  }

  // JSONダウンロード/注釈画像ダウンロード
  const downloadJsonBtn = document.getElementById('downloadJsonBtn');
  const downloadImageBtn = document.getElementById('downloadImageBtn');
  if (downloadJsonBtn) downloadJsonBtn.addEventListener('click', downloadJsonFile);
  if (downloadImageBtn) downloadImageBtn.addEventListener('click', downloadAnnotatedImage);

  function downloadJsonFile() {
    try {
      requestAnnotationsJsonDownload();
      showNotification(DOWNLOAD_REQUESTED_MESSAGE);
    } catch (error) {
      console.error('アノテーションJSONの保存に失敗しました:', error);
      showNotification(error instanceof Error ? error.message : 'アノテーションJSONを保存できません', 'error');
    }
  }

  async function downloadAnnotatedImage() {
    if (!loadedImage) { showNotification('先に画像を読み込んでください', 'error'); return; }
    try {
      await requestAnnotatedImageDownload();
      showNotification(DOWNLOAD_REQUESTED_MESSAGE);
    } catch (error) {
      console.error('注釈付き画像の保存に失敗しました:', error);
      showNotification(error instanceof Error ? error.message : '注釈付き画像を保存できません', 'error');
    }
  }

  // 表示用ステージではなく、元画像座標の確定モデルから出力専用シーンを生成する。
  // これにより、パン、ズーム、画面サイズ、ドラフト、選択表示は出力へ混入しない。
  function createAnnotatedImageCanvas({ maxDimension } = {}) {
    if (!loadedImage) throw new Error('注釈付き画像を生成する前に画像を開いてください');

    const originalWidth = loadedImage.naturalWidth;
    const originalHeight = loadedImage.naturalHeight;
    if (!Number.isSafeInteger(originalWidth) || originalWidth <= 0 || !Number.isSafeInteger(originalHeight) || originalHeight <= 0) {
      throw new Error('元画像の寸法を取得できません');
    }

    const outputScale = maxDimension === undefined
      ? 1
      : Math.min(1, maxDimension / Math.max(originalWidth, originalHeight));
    const width = Math.max(1, Math.round(originalWidth * outputScale));
    const height = Math.max(1, Math.round(originalHeight * outputScale));
    const container = document.createElement('div');
    let renderStage = null;

    try {
      renderStage = new Konva.Stage({ container, width, height });
      const renderLayer = new Konva.Layer({ listening: false });
      const content = new Konva.Group({
        scaleX: width / originalWidth,
        scaleY: height / originalHeight,
        listening: false
      });
      content.add(new Konva.Image({
        image: loadedImage,
        x: 0,
        y: 0,
        width: originalWidth,
        height: originalHeight,
        listening: false
      }));
      for (const model of shapes) {
        content.add(createAnnotatedImageShapeNode(model));
      }
      renderLayer.add(content);
      renderStage.add(renderLayer);
      renderLayer.draw();

      const canvas = renderStage.toCanvas({
        x: 0,
        y: 0,
        width,
        height,
        pixelRatio: 1
      });
      if (!canvas || canvas.width !== width || canvas.height !== height) {
        throw new Error('要求した寸法のキャンバスを生成できません');
      }
      return { canvas, width, height };
    } catch (error) {
      const detail = error instanceof Error && error.message ? `: ${error.message}` : '';
      throw new Error(`注釈付き画像を生成できません${detail}`);
    } finally {
      if (renderStage) renderStage.destroy();
    }
  }

  function createAnnotatedImageShapeNode(model) {
    const stroke = model.colorHex || '#000000';
    const strokeWidth = model.thickness;
    const common = { stroke, strokeWidth, listening: false };

    if (model.type === 'rectangle') {
      return new Konva.Rect({
        x: model.x,
        y: model.y,
        width: model.width,
        height: model.height,
        rotation: getFinalizedShapeRotation(model),
        ...common
      });
    }
    if (model.type === 'line') {
      return new Konva.Line({
        points: [model.x1, model.y1, model.x2, model.y2],
        ...common
      });
    }
    if (model.type === 'polygon' || model.type === 'parallelogram') {
      return new Konva.Line({
        points: model.points.slice(),
        closed: true,
        ...common
      });
    }
    if (model.type === 'circle') {
      return new Konva.Circle({
        x: model.x,
        y: model.y,
        radius: model.radius,
        rotation: getFinalizedShapeRotation(model),
        ...common
      });
    }
    throw new Error(`未対応のアノテーション種別です: ${model.type}`);
  }

  // 回転角は既存JSONの対象外なので、矩形と円だけ確定済み表示ノードから引き継ぐ。
  function getFinalizedShapeRotation(model) {
    if (model.type !== 'rectangle' && model.type !== 'circle') return 0;
    const node = annotationsLayer.findOne((candidate) => candidate.getAttr('shapeId') === model.id);
    const rotation = node ? node.rotation() : 0;
    return Number.isFinite(rotation) ? rotation : 0;
  }

  function createPngDataUrl(canvas, failureMessage) {
    let dataUrl;
    try {
      dataUrl = canvas.toDataURL('image/png');
    } catch (error) {
      console.error(failureMessage, error);
      throw new Error(failureMessage);
    }
    if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/png;base64,')) {
      throw new Error(failureMessage);
    }
    return dataUrl;
  }

  function createPngBlob(canvas) {
    return new Promise((resolve, reject) => {
      try {
        canvas.toBlob((blob) => {
          if (!blob || blob.size === 0) {
            reject(new Error('注釈付き画像をPNGとして保存できません'));
            return;
          }
          resolve(blob);
        }, 'image/png');
      } catch (error) {
        console.error('注釈付き画像のPNG変換に失敗しました:', error);
        reject(new Error('注釈付き画像をPNGとして保存できません'));
      }
    });
  }

  function createAnnotationsJsonArtifact() {
    const revision = workspaceRevision;
    const annotationCount = shapes.length;
    const json = JSON.stringify(getAnnotationDocument(), null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    if (blob.size === 0) throw new Error('アノテーションJSONを生成できません');
    return {
      blob,
      filename: makeFileName(loadedImageName, 'annotations.json', '-annotations.json'),
      mimeType: 'application/json',
      byteLength: blob.size,
      revision,
      annotationCount
    };
  }

  function requestAnnotationsJsonDownload(expectedRevision, signal) {
    if (expectedRevision !== undefined) assertCurrentWorkspaceRevision(expectedRevision);
    throwIfWebMcpExecutionAborted(signal);
    if (shapes.length === 0) throw new Error('アノテーションJSONを保存する前にアノテーションを作成してください');
    const artifact = createAnnotationsJsonArtifact();
    throwIfWebMcpExecutionAborted(signal);
    if (workspaceRevision !== artifact.revision) {
      throw new Error('JSONの生成中に作業状態が更新されました。最新のrevisionで再実行してください');
    }
    if (expectedRevision !== undefined) assertCurrentWorkspaceRevision(expectedRevision);
    return requestBrowserDownload(artifact);
  }

  function assertDecodedImageSize(image, width, height, label) {
    if (image.naturalWidth !== width || image.naturalHeight !== height) {
      throw new Error(`${label}を要求した寸法で生成できません`);
    }
  }

  async function createAnnotatedImageResult(signal) {
    const revision = workspaceRevision;
    const annotationCount = shapes.length;
    throwIfWebMcpExecutionAborted(signal);
    const { canvas, width, height } = createAnnotatedImageCanvas();
    const dataUrl = createPngDataUrl(canvas, '注釈付き画像をPNGとして生成できません');
    if (dataUrl.length > WEBMCP_MAX_DATA_URL_LENGTH) {
      throw new RangeError('注釈付き画像のData URLが12 MiBを超えています。prepare_annotation_exportとread_annotation_exportで分割取得するか、保存完了を確認できるクライアントでdownloadを使用してください');
    }
    const image = await decodeImageSource(dataUrl, signal);
    assertDecodedImageSize(image, width, height, '注釈付き画像');
    throwIfWebMcpExecutionAborted(signal);
    if (workspaceRevision !== revision) {
      throw new Error('画像の生成中に作業状態が更新されました。最新のrevisionで再実行してください');
    }
    return {
      dataUrl,
      width,
      height,
      revision,
      annotationCount
    };
  }

  async function createWebMcpImagePreview(maxDimension, signal) {
    const revision = workspaceRevision;
    const annotationCount = shapes.length;
    throwIfWebMcpExecutionAborted(signal);
    const { canvas, width, height } = createAnnotatedImageCanvas({ maxDimension });
    const dataUrl = createPngDataUrl(canvas, '画像プレビューをPNGとして生成できません');
    if (dataUrl.length > WEBMCP_MAX_DATA_URL_LENGTH) {
      throw new RangeError('画像プレビューのData URLが12 MiBを超えています。maxDimensionを小さくしてください');
    }
    const image = await decodeImageSource(dataUrl, signal);
    assertDecodedImageSize(image, width, height, '画像プレビュー');
    throwIfWebMcpExecutionAborted(signal);
    if (workspaceRevision !== revision) {
      throw new Error('プレビューの生成中に作業状態が更新されました。再実行してください');
    }
    return {
      revision,
      annotationCount,
      mimeType: 'image/png',
      width,
      height,
      dataUrl
    };
  }

  async function createAnnotatedImageArtifact(signal, expectedRevision) {
    if (expectedRevision !== undefined) assertCurrentWorkspaceRevision(expectedRevision);
    const revision = workspaceRevision;
    const annotationCount = shapes.length;
    throwIfWebMcpExecutionAborted(signal);
    const { canvas, width, height } = createAnnotatedImageCanvas();
    const blob = await createPngBlob(canvas);
    throwIfWebMcpExecutionAborted(signal);
    if (workspaceRevision !== revision) {
      throw new Error('画像の生成中に作業状態が更新されました。最新のrevisionで再実行してください');
    }
    if (expectedRevision !== undefined) assertCurrentWorkspaceRevision(expectedRevision);
    return {
      blob,
      filename: makeFileName(loadedImageName, 'annotated.png', '-annotated.png'),
      mimeType: 'image/png',
      byteLength: blob.size,
      width,
      height,
      revision,
      annotationCount
    };
  }

  async function requestAnnotatedImageDownload(signal, expectedRevision) {
    const artifact = await createAnnotatedImageArtifact(signal, expectedRevision);
    throwIfWebMcpExecutionAborted(signal);
    return requestBrowserDownload(artifact);
  }

  async function describeExportArtifact(artifact) {
    const digest = await crypto.subtle.digest('SHA-256', await artifact.blob.arrayBuffer());
    const sha256 = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
    const { blob, revision, annotationCount, ...metadata } = artifact;
    return { ...metadata, sha256 };
  }

  async function prepareAnnotationExport(expectedRevision, signal) {
    throwIfWebMcpExecutionAborted(signal);
    assertCurrentWorkspaceRevision(expectedRevision);
    const json = createAnnotationsJsonArtifact();
    const png = await createAnnotatedImageArtifact(signal, expectedRevision);
    const [pngMetadata, jsonMetadata] = await Promise.all([describeExportArtifact(png), describeExportArtifact(json)]);
    throwIfWebMcpExecutionAborted(signal);
    assertCurrentWorkspaceRevision(expectedRevision);
    const exportId = crypto.randomUUID();
    preparedAnnotationExport = { exportId, revision: expectedRevision, png, json };
    return {
      outcome: 'export_prepared', exportId, revision: expectedRevision, annotationCount: json.annotationCount,
      artifacts: { png: pngMetadata, json: jsonMetadata }
    };
  }

  function getPreparedAnnotationExport(exportId) {
    if (!preparedAnnotationExport || preparedAnnotationExport.exportId !== exportId) {
      throw new Error('出力は無効または解放済みです。最新のrevisionでprepare_annotation_exportを再実行してください');
    }
    assertCurrentWorkspaceRevision(preparedAnnotationExport.revision);
    return preparedAnnotationExport;
  }

  async function readAnnotationExport({ exportId, format, offset, maxBytes }, signal) {
    throwIfWebMcpExecutionAborted(signal);
    const prepared = getPreparedAnnotationExport(exportId);
    const artifact = prepared[format];
    if (offset >= artifact.byteLength) throw new RangeError('input.offset はファイルのバイト数未満である必要があります');
    const nextOffset = Math.min(offset + maxBytes, artifact.byteLength);
    const bytes = new Uint8Array(await artifact.blob.slice(offset, nextOffset).arrayBuffer());
    throwIfWebMcpExecutionAborted(signal);
    getPreparedAnnotationExport(exportId);
    let binary = '';
    for (let index = 0; index < bytes.length; index += 32768) {
      binary += String.fromCharCode(...bytes.subarray(index, index + 32768));
    }
    return {
      exportId, revision: prepared.revision, format, offset, nextOffset,
      eof: nextOffset === artifact.byteLength, base64: btoa(binary)
    };
  }

  function makeFileName(baseName, fallback, suffix) {
    if (!baseName) return fallback;
    const dot = baseName.lastIndexOf('.');
    const stem = dot >= 0 ? baseName.slice(0, dot) : baseName;
    return stem + suffix;
  }

  function requestBrowserDownload(artifact) {
    let url = null;
    let anchor = null;
    try {
      url = URL.createObjectURL(artifact.blob);
      anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = artifact.filename;
      anchor.style.display = 'none';
      document.body.appendChild(anchor);
      anchor.click();
    } catch (error) {
      if (anchor) anchor.remove();
      if (url) URL.revokeObjectURL(url);
      throw new Error('ブラウザーへダウンロード要求を送信できません');
    }

    setTimeout(() => {
      anchor.remove();
      URL.revokeObjectURL(url);
    }, DOWNLOAD_OBJECT_URL_RELEASE_DELAY_MS);

    const result = {
      outcome: 'download_requested',
      requestDispatched: true,
      completionVerified: false,
      filename: artifact.filename,
      mimeType: artifact.mimeType,
      byteLength: artifact.byteLength,
      revision: artifact.revision,
      annotationCount: artifact.annotationCount
    };
    if (artifact.width !== undefined) result.width = artifact.width;
    if (artifact.height !== undefined) result.height = artifact.height;
    return result;
  }

  // JSON読み込み（モーダルで実施）

  function importAnnotations(obj) {
    if (!obj || !Array.isArray(obj.draw)) { showNotification('不正なJSON形式です（draw配列が必要）', 'error'); return; }
    clearAll({ advanceRevision: false });
    let ok = 0, skip = 0;
    for (const it of obj.draw) {
      const shape = (it.shape || '').toLowerCase();
      const colorHex = normalizeHex(it.color);
      const thickness = Number.isFinite(it.thickness) ? it.thickness : defaultThickness;
      if (!colorHex) { skip++; continue; }
      if (shape === 'rectangle') {
        if (!isFinite(it.x)||!isFinite(it.y)||!isFinite(it.width)||!isFinite(it.height)) { skip++; continue; }
        const model = { id: idSeq++, type: 'rectangle', colorHex, thickness, x: Math.round(it.x), y: Math.round(it.y), width: Math.round(it.width), height: Math.round(it.height) };
        const node = new Konva.Rect({ x: model.x * canvasScale, y: model.y * canvasScale, width: model.width * canvasScale, height: model.height * canvasScale, ...commonStrokeProps(thickness, colorHex), draggable: false });
        registerFinalizedShapeNode(node, model); annotationsLayer.add(node);
        shapes.push(model); ok++;
      } else if (shape === 'line') {
        if (!isFinite(it.x1)||!isFinite(it.y1)||!isFinite(it.x2)||!isFinite(it.y2)) { skip++; continue; }
        const model = { id: idSeq++, type: 'line', colorHex, thickness, x1: Math.round(it.x1), y1: Math.round(it.y1), x2: Math.round(it.x2), y2: Math.round(it.y2) };
        const pts = [model.x1 * canvasScale, model.y1 * canvasScale, model.x2 * canvasScale, model.y2 * canvasScale];
        const node = new Konva.Line({ points: pts, ...commonStrokeProps(thickness, colorHex), draggable: false, hitStrokeWidth: Math.max(8, thickness) });
        registerFinalizedShapeNode(node, model); annotationsLayer.add(node);
        shapes.push(model); ok++;
      } else if (shape === 'polygon' || shape === 'parallelogram') {
        if (!Array.isArray(it.points) || it.points.length < 6 || it.points.length % 2 !== 0) { skip++; continue; }
        const pts = it.points.map(v => Math.round(v));
        const model = { id: idSeq++, type: shape, colorHex, thickness, points: pts };
        const scaled = pts.map(v => v * canvasScale);
        const node = new Konva.Line({ points: scaled, closed: true, ...commonStrokeProps(thickness, colorHex), draggable: false });
        registerFinalizedShapeNode(node, model); annotationsLayer.add(node);
        shapes.push(model); ok++;
      } else if (shape === 'circle') {
        if (!isFinite(it.x)||!isFinite(it.y)||!isFinite(it.radius)) { skip++; continue; }
        const model = { id: idSeq++, type: 'circle', colorHex, thickness, x: Math.round(it.x), y: Math.round(it.y), radius: Math.round(it.radius) };
        const node = new Konva.Circle({ x: model.x * canvasScale, y: model.y * canvasScale, radius: model.radius * canvasScale, ...commonStrokeProps(thickness, colorHex), draggable: false });
        node.strokeScaleEnabled(false);
        registerFinalizedShapeNode(node, model); annotationsLayer.add(node);
        shapes.push(model); ok++;
      } else {
        skip++;
      }
    }
    advanceWorkspaceRevision();
    annotationsLayer.draw();
    updateAnnotationList();
    showNotification(`${ok}件読み込み、${skip}件スキップ` , skip ? 'error' : 'success');
  }

  function normalizeHex(c) {
    if (!c) return null;
    let s = String(c).trim();
    if (s.startsWith('#')) s = s.slice(1);
    if (!/^([0-9a-fA-F]{6})$/.test(s)) return null;
    return '#' + s.toUpperCase();
  }
  function copyToClipboard(text) {
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).catch(err => console.error('クリップボードへのコピーに失敗しました:', err));
    } else {
      const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.left = '-999999px'; ta.style.top = '-999999px';
      document.body.appendChild(ta); ta.focus(); ta.select();
      try { document.execCommand('copy'); } catch (e) { console.error('コピー失敗:', e); }
      document.body.removeChild(ta);
    }
  }

  // 通知
  function showNotification(message, type = 'success') {
    let notification = document.querySelector('.copy-notification');
    if (!notification) { notification = document.createElement('div'); notification.className = 'copy-notification'; document.body.appendChild(notification); }
    notification.textContent = message; notification.style.backgroundColor = type === 'success' ? '#2ecc71' : '#e74c3c';
    notification.classList.add('show'); setTimeout(() => notification.classList.remove('show'), 2000);
  }

  // 全消去
  function clearAll({ advanceRevision = true } = {}) {
    const hadAnnotations = shapes.length > 0;
    cancelDraft();
    clearSelection();
    shapes.splice(0, shapes.length);
    annotationsLayer.destroyChildren(); annotationsLayer.draw();
    transformer = null;
    selectedShapeId = null;
    if (advanceRevision && hadAnnotations) advanceWorkspaceRevision();
    updateAnnotationList();
  }

  registerAnnoForgeWebMcpTools();
});
