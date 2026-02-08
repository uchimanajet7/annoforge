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
    clearBtn.addEventListener('click', clearAll);
    copyJsonBtn.addEventListener('click', copyAllAnnotations);
    bindDragAndDrop();
    bindImportModal();
    // ツールボタン
    toolButtons().forEach(btn => {
      btn.addEventListener('click', () => {
        toolButtons().forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentTool = btn.getAttribute('data-tool');
        cancelDraft();
        applySelectionUI();
        stage.draggable(false);
        stage.container().style.cursor = 'default';
        showHint(toolHint(currentTool));
      });
    });
    // カラー
    if (colorPicker) {
      colorPicker.value = currentColor;
      colorPicker.addEventListener('input', (e) => {
        currentColor = e.target.value;
        highlightActiveColor();
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
      sw.className = 'color-swatch';
      sw.title = hex;
      sw.setAttribute('aria-label', `色 ${hex}`);
      sw.style.backgroundColor = hex;
      sw.addEventListener('click', () => {
        currentColor = hex;
        if (colorPicker) colorPicker.value = hex;
        highlightActiveColor();
      });
      swatchesEl.appendChild(sw);
    });
    highlightActiveColor();
  }
  function highlightActiveColor() {
    if (!swatchesEl) return;
    Array.from(swatchesEl.children).forEach(el => {
      const isActive = rgbToHex(el.style.backgroundColor) === currentColor.toLowerCase();
      if (isActive) el.classList.add('active'); else el.classList.remove('active');
    });
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
    loadedImageName = file.name || '';
    // ファイル名は先にUIへ反映（画像読み込み前でも見えるように）
    updateImageNameUI();
    const reader = new FileReader();
    reader.onload = (event) => {
      loadedImage = new Image();
      loadedImage.onload = () => {
        placeImage();
        clearAll(); // 既存の形状を消去
        // 表示とツール状態を統一: 選択ツール、ステージ倍率1、画像はfit比率で中央配置、選択/ドラフト解除
        resetView();
        cancelDraft();
        clearSelection();
        currentTool = 'select';
        try {
          // ツールボタンのアクティブ表示を選択に戻す
          toolButtons().forEach(b => b.classList.remove('active'));
          const selBtn = document.querySelector('.tool-btn[data-tool="select"]');
          if (selBtn) selBtn.classList.add('active');
        } catch {}
        applySelectionUI();
        stage.draggable(false);
        updateImageNameUI();
        showNotification(loadedImageName ? `${loadedImageName} を読み込みました` : '画像を読み込みました');
      };
      loadedImage.src = event.target.result;
    };
    reader.readAsDataURL(file);
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
    annotationsLayer.getChildren().each((node) => {
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

  // 選択解除
  function clearSelection() {
    selectedShapeId = null;
    if (transformer) transformer.nodes([]);
    removeAnchors();
    annotationsLayer.draw();
  }

  // 選択UI適用
  function applySelectionUI() {
    if (currentTool !== 'select') clearSelection();
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
  function commonStrokeProps(thickness = defaultThickness) {
    return { stroke: colorForStroke(), strokeWidth: thickness, listening: true };
  }

  // 図形選択
  function onSelectShape(node) {
    const model = findModelByNode(node);
    if (!model) return;
    selectedShapeId = model.id;
    removeAnchors();
    if (!transformer) {
      transformer = new Konva.Transformer({ rotateEnabled: true, enabledAnchors: ['top-left','top-right','bottom-left','bottom-right'] });
      annotationsLayer.add(transformer);
    }
    if (model.type === 'rectangle' || model.type === 'circle') {
      // 円は等倍スケール、矩形は自由比率
      transformer.keepRatio(model.type === 'circle');
      transformer.nodes([node]);
      annotationsLayer.draw();
    } else {
      transformer.nodes([]);
      drawAnchorsForModel(model, node);
    }
  }

  // アンカー描画（線/多角形/平行四辺形）
  function drawAnchorsForModel(model, node) {
    const points = getModelPoints(model);
    points.forEach((p, idx) => {
      const c = new Konva.Circle({ x: p.x * canvasScale, y: p.y * canvasScale, radius: 6, fill: '#fff', stroke: '#333', strokeWidth: 2, draggable: true });
      c.on('dragmove', () => {
        const nx = c.x() / canvasScale; const ny = c.y() / canvasScale;
        updateModelPoint(model, idx, { x: nx, y: ny });
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
      updateAnnotationList();
    });
    node.on('dragend', () => {
      const model = findModelByNode(node);
      if (!model) { node.position({ x: 0, y: 0 }); return; }
      // モデル座標を反映したノード形状へ置き換え、その後ローカル座標(0,0)に戻す
      redrawNodeFromModel(model, node);
      node.position({ x: 0, y: 0 });
      annotationsLayer.batchDraw();
      const ow = node.getAttr('_origStrokeWidth'); if (ow) { node.strokeWidth(ow); node.setAttr('_origStrokeWidth', null); annotationsLayer.batchDraw(); }
    }); // ローカル座標に戻す
    node.on('transformend', () => {
      const model = findModelByNode(node); if (!model) return;
      if (model.type === 'rectangle') {
        const sx = node.scaleX(); const sy = node.scaleY(); node.scaleX(1); node.scaleY(1);
        node.width(node.width() * sx); node.height(node.height() * sy);
        model.x = Math.round(node.x() / canvasScale);
        model.y = Math.round(node.y() / canvasScale);
        model.width = Math.round(node.width() / canvasScale);
        model.height = Math.round(node.height() / canvasScale);
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
    draft.node.setAttr('shapeId', model.id); draft.node.draggable(true); attachCommonNodeHandlers(draft.node);
    shapes.push(model); draft = null; updateAnnotationList();
  }

  // 矩形作図
  function startRect(pos) {
    draft = {
      type: 'rectangle', start: { x: pos.x, y: pos.y },
      node: new Konva.Rect({ x: pos.x, y: pos.y, width: 0, height: 0, ...commonStrokeProps(defaultThickness), draggable: true })
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
    draft.node.setAttr('shapeId', model.id);
    attachCommonNodeHandlers(draft.node);
    shapes.push(model);
    draft = null; annotationsLayer.draw(); updateAnnotationList();
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
    draft.node.setAttr('shapeId', model.id); draft.node.draggable(true); attachCommonNodeHandlers(draft.node);
    shapes.push(model); draft = null; updateAnnotationList();
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
    draft.node.setAttr('shapeId', model.id); draft.node.draggable(true); attachCommonNodeHandlers(draft.node);
    shapes.push(model); draft = null; updateAnnotationList();
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
    draft.node.setAttr('shapeId', model.id); draft.node.draggable(true); attachCommonNodeHandlers(draft.node);
    shapes.push(model); draft = null; updateAnnotationList();
  }

  // 一覧とJSON表示の更新
  function updateAnnotationList() {
    annotationList.innerHTML = '';
    shapes.forEach((s, idx) => {
      const item = document.createElement('div'); item.className = 'annotation-item';
      const swatch = `display:inline-block;width:12px;height:12px;background-color:${s.colorHex || '#000'};margin-right:5px;border:1px solid #ccc;`;
      item.innerHTML = `
        <div style="${swatch}"></div>
        <strong>${shapeTitle(s, idx)}</strong><br>
        ${shapeSummary(s)}
      `;
      const del = document.createElement('button'); del.className = 'delete-btn'; del.textContent = '削除';
      del.addEventListener('click', (e) => { e.stopPropagation(); deleteAnnotationByIndex(idx); });
      item.appendChild(del);
      item.addEventListener('click', () => highlightShape(s.id));
      annotationList.appendChild(item);
    });
    if (shapes.length === 0) {
      const msg = document.createElement('div'); msg.style.color = '#666'; msg.style.padding = '10px';
      msg.textContent = 'アノテーションがありません。ツールを選択して画像上を操作してください。';
      annotationList.appendChild(msg);
    }
    updateJsonDisplay();
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
    const node = annotationsLayer.findOne((n) => n.getAttr('shapeId') === s.id);
    if (node) node.destroy(); shapes.splice(index, 1); annotationsLayer.draw();
    showNotification(`${shapeTitle(s, index)} を削除しました`); updateAnnotationList();
  }

  function highlightShape(id) {
    const node = annotationsLayer.findOne((n) => n.getAttr('shapeId') === id); if (!node) return;
    const orig = node.strokeWidth(); node.strokeWidth(orig + 4); annotationsLayer.draw();
    setTimeout(() => { node.strokeWidth(orig); annotationsLayer.draw(); }, 800);
  }

  function updateJsonDisplay() {
    if (shapes.length === 0) { jsonDisplay.textContent = 'アノテーションがありません'; return; }
    const allJson = { draw: shapes.map(shapeToJson) };
    jsonDisplay.textContent = JSON.stringify(allJson, null, 2);
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

  // rgb() → #rrggbb
  function rgbToHex(rgb) {
    if (!rgb) return '';
    const m = rgb.match(/rgb\((\d+)\s*,\s*(\d+)\s*,\s*(\d+)\)/i);
    if (!m) return rgb.toLowerCase();
    const toHex = (n) => ('0' + parseInt(n, 10).toString(16)).slice(-2);
    return '#' + toHex(m[1]) + toHex(m[2]) + toHex(m[3]);
  }

  // クリップボード
  function copyAllAnnotations() {
    if (shapes.length === 0) { showNotification('コピーするアノテーションがありません', 'error'); return; }
    const jsonString = JSON.stringify({ draw: shapes.map(shapeToJson) }, null, 2);
    copyToClipboard(jsonString); showNotification(`${shapes.length}個のアノテーションをコピーしました`);
  }

  // JSONダウンロード/注釈画像ダウンロード
  const downloadJsonBtn = document.getElementById('downloadJsonBtn');
  const downloadImageBtn = document.getElementById('downloadImageBtn');
  if (downloadJsonBtn) downloadJsonBtn.addEventListener('click', downloadJsonFile);
  if (downloadImageBtn) downloadImageBtn.addEventListener('click', downloadAnnotatedImage);

  function downloadJsonFile() {
    if (shapes.length === 0) { showNotification('ダウンロードするアノテーションがありません', 'error'); return; }
    const data = { draw: shapes.map(shapeToJson) };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const fname = makeFileName(loadedImageName, 'annotations.json', '-annotations.json');
    triggerDownload(blob, fname);
  }

  function downloadAnnotatedImage() {
    if (!loadedImage) { showNotification('先に画像を読み込んでください', 'error'); return; }
    // 一時的にガイドとトランスフォーマを非表示
    const prevGuidesVisible = guidesLayer.visible();
    guidesLayer.visible(false);
    const hadTransformer = !!transformer;
    let prevTransformerVisible = false;
    if (transformer) { prevTransformerVisible = transformer.visible(); transformer.visible(false); }
    const dataURL = stage.toDataURL({ mimeType: 'image/png' });
    // 元の状態に戻す
    if (transformer) transformer.visible(prevTransformerVisible);
    guidesLayer.visible(prevGuidesVisible);
    // ダウンロード
    const fname = makeFileName(loadedImageName, 'annotated.png', '-annotated.png');
    dataUrlToDownload(dataURL, fname);
  }

  function makeFileName(baseName, fallback, suffix) {
    if (!baseName) return fallback;
    const dot = baseName.lastIndexOf('.');
    const stem = dot >= 0 ? baseName.slice(0, dot) : baseName;
    return stem + suffix;
  }

  function triggerDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; document.body.appendChild(a); a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 0);
  }

  function dataUrlToDownload(dataURL, filename) {
    const a = document.createElement('a');
    a.href = dataURL; a.download = filename; document.body.appendChild(a); a.click();
    setTimeout(() => { document.body.removeChild(a); }, 0);
  }

  // JSON読み込み（モーダルで実施）

  function importAnnotations(obj) {
    if (!obj || !Array.isArray(obj.draw)) { showNotification('不正なJSON形式です（draw配列が必要）', 'error'); return; }
    clearAll();
    let ok = 0, skip = 0;
    for (const it of obj.draw) {
      const shape = (it.shape || '').toLowerCase();
      const colorHex = normalizeHex(it.color);
      const thickness = Number.isFinite(it.thickness) ? it.thickness : defaultThickness;
      if (!colorHex) { skip++; continue; }
      if (shape === 'rectangle') {
        if (!isFinite(it.x)||!isFinite(it.y)||!isFinite(it.width)||!isFinite(it.height)) { skip++; continue; }
        const model = { id: idSeq++, type: 'rectangle', colorHex, thickness, x: Math.round(it.x), y: Math.round(it.y), width: Math.round(it.width), height: Math.round(it.height) };
        const node = new Konva.Rect({ x: model.x * canvasScale, y: model.y * canvasScale, width: model.width * canvasScale, height: model.height * canvasScale, ...commonStrokeProps(thickness), draggable: true });
        node.setAttr('shapeId', model.id); attachCommonNodeHandlers(node); annotationsLayer.add(node);
        shapes.push(model); ok++;
      } else if (shape === 'line') {
        if (!isFinite(it.x1)||!isFinite(it.y1)||!isFinite(it.x2)||!isFinite(it.y2)) { skip++; continue; }
        const model = { id: idSeq++, type: 'line', colorHex, thickness, x1: Math.round(it.x1), y1: Math.round(it.y1), x2: Math.round(it.x2), y2: Math.round(it.y2) };
        const pts = [model.x1 * canvasScale, model.y1 * canvasScale, model.x2 * canvasScale, model.y2 * canvasScale];
        const node = new Konva.Line({ points: pts, ...commonStrokeProps(thickness), draggable: true, hitStrokeWidth: Math.max(8, thickness) });
        node.setAttr('shapeId', model.id); attachCommonNodeHandlers(node); annotationsLayer.add(node);
        shapes.push(model); ok++;
      } else if (shape === 'polygon' || shape === 'parallelogram') {
        if (!Array.isArray(it.points) || it.points.length < 6 || it.points.length % 2 !== 0) { skip++; continue; }
        const pts = it.points.map(v => Math.round(v));
        const model = { id: idSeq++, type: shape, colorHex, thickness, points: pts };
        const scaled = pts.map(v => v * canvasScale);
        const node = new Konva.Line({ points: scaled, closed: shape !== 'polygon', ...commonStrokeProps(thickness), draggable: true });
        node.setAttr('shapeId', model.id); attachCommonNodeHandlers(node); annotationsLayer.add(node);
        shapes.push(model); ok++;
      } else if (shape === 'circle') {
        if (!isFinite(it.x)||!isFinite(it.y)||!isFinite(it.radius)) { skip++; continue; }
        const model = { id: idSeq++, type: 'circle', colorHex, thickness, x: Math.round(it.x), y: Math.round(it.y), radius: Math.round(it.radius) };
        const node = new Konva.Circle({ x: model.x * canvasScale, y: model.y * canvasScale, radius: model.radius * canvasScale, ...commonStrokeProps(thickness), draggable: true });
        node.strokeScaleEnabled(false);
        node.setAttr('shapeId', model.id); attachCommonNodeHandlers(node); annotationsLayer.add(node);
        shapes.push(model); ok++;
      } else {
        skip++;
      }
    }
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
  function clearAll() {
    shapes.splice(0, shapes.length);
    annotationsLayer.destroyChildren(); annotationsLayer.draw();
    updateAnnotationList();
  }
});
