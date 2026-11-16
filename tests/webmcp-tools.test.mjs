import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { assertOutputSchema } from './helpers/assert-output-schema.mjs';

const source = await readFile(new URL('../web/app.js', import.meta.url), 'utf8');
// DOM初期化と描画はモックに分離し、登録・入力検証・結果生成は実装の関数を実行する。
function implementation(name) {
  const match = source.match(new RegExp(`^  (?:async )?function ${name}\\([^]*?^  }`, 'm'));
  assert.ok(match, `実装関数が見つかりません: ${name}`);
  return match[0];
}
const functionNames = [
  'registerAnnoForgeWebMcpTools', 'getAnnotationDocument', 'shapeToJson', 'normalizeHex',
  'validateWebMcpUrlImageInput', 'openWebMcpImageFromUrl', 'validateWebMcpDataUrlImageInput',
  'openWebMcpImageFromDataUrl', 'validateWebMcpAnnotationDocument', 'validateWebMcpReplaceInput',
  'validateWebMcpDownloadInput', 'validateWebMcpPreviewInput', 'validateWebMcpExportInput',
  'validateWebMcpEmptyInput', 'validateWebMcpExportReference', 'assertWebMcpObject',
  'assertWebMcpExactKeys', 'assertWebMcpFiniteNumber', 'assertWebMcpSafeInteger',
  'assertWebMcpRevision', 'assertCurrentWorkspaceRevision', 'assertWebMcpPoints',
  'throwIfWebMcpExecutionAborted', 'createPngDataUrl', 'createPngBlob',
  'createAnnotationsJsonArtifact', 'requestAnnotationsJsonDownload', 'assertDecodedImageSize',
  'createAnnotatedImageResult', 'createWebMcpImagePreview', 'createAnnotatedImageArtifact',
  'requestAnnotatedImageDownload', 'describeExportArtifact', 'prepareAnnotationExport',
  'getPreparedAnnotationExport', 'readAnnotationExport', 'makeFileName', 'requestBrowserDownload',
  'importAnnotations', 'createImportedAnnotation', 'replaceWebMcpAnnotations',
  'advanceWorkspaceRevision', 'runImportFromModal', 'clearAll',
  'updateAnnotationList', 'updateJsonDisplay', 'shapeTitle', 'shapeSummary'
];
const png = await readFile(new URL('../web/ogp.png', import.meta.url));
const dataUrl = `data:image/png;base64,${png.toString('base64')}`;
const draw = [
  { shape: 'rectangle', x: 10, y: 20, width: 50, height: 40, color: 'FF0000', thickness: 6 },
  { shape: 'line', x1: 10, y1: 20, x2: 60, y2: 80, color: '00FF00', thickness: 2 },
  { shape: 'polygon', points: [0, 0, 50, 0, 20, 50], color: '0000FF', thickness: 3 },
  { shape: 'parallelogram', points: [0, 0, 50, 0, 60, 50, 10, 50], color: 'FF00FF', thickness: 4 },
  { shape: 'circle', x: 60, y: 60, radius: 20, color: '00FFFF', thickness: 5 }
];

async function harness() {
  const tools = new Map();
  const downloads = [];
  const notices = [];
  const modal = { closeCount: 0 };
  function element() {
    return {
      style: {}, dataset: {}, attributes: new Map(), children: [], textContent: '',
      classList: { toggle() {} },
      get childNodes() { return this.children; },
      set innerHTML(value) { this.children = []; this.textContent = value; },
      replaceChildren(...children) { this.children = children; },
      setAttribute(name, value) { this.attributes.set(name, String(value)); },
      append(...children) { this.children.push(...children); },
      appendChild(child) { this.children.push(child); },
      addEventListener() {}, click() { downloads.push(this.download); }, remove() {}
    };
  }
  class ShapeNode {
    strokeScaleEnabled() {}
    destroy() {
      if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1);
      this.parent = null;
      this.destroyed = true;
    }
  }
  const layers = [];
  class Layer extends ShapeNode {
    constructor() { super(); this.children = []; this.drawnIds = []; layers.push(this); }
    add(node) { this.children.push(node); node.parent = this; }
    draw() { this.drawnIds = this.children.filter(node => node.model).map(node => node.model.id); }
    destroyChildren() { for (const node of this.children.slice()) node.destroy(); }
    destroy() { this.destroyChildren(); super.destroy(); }
    zIndex(value) {
      const siblings = this.parent.children;
      const index = siblings.indexOf(this);
      if (value === undefined) return index;
      siblings.splice(index, 1);
      siblings.splice(value, 0, this);
    }
  }
  const stage = { children: [], add(layer) { this.children.push(layer); layer.parent = this; layer.draw(); } };
  const imageLayer = new Layer(), annotationsLayer = new Layer(), guidesLayer = new Layer();
  stage.add(imageLayer); stage.add(annotationsLayer); stage.add(guidesLayer);
  const context = {
    Blob, Uint8Array, DOMException, crypto: webcrypto,
    btoa: value => Buffer.from(value, 'binary').toString('base64'),
    URL: { createObjectURL: () => 'blob:test', revokeObjectURL() {} },
    setTimeout: callback => callback(),
    console: { error: (...args) => assert.fail(args.join(' ')) },
    document: {
      modelContext: { registerTool: async tool => { assert.ok(!tools.has(tool.name)); tools.set(tool.name, tool); } },
      body: { appendChild() {} },
      createElement: element
    },
    workspaceRevision: 0, loadedImage: null, loadedImageName: 'fixture.png', shapes: [], preparedAnnotationExport: null,
    idSeq: 1, canvasScale: 1, defaultThickness: 5, transformer: null, selectedShapeId: null,
    Konva: { Rect: ShapeNode, Line: ShapeNode, Circle: ShapeNode, Layer },
    stage, annotationsLayer, guidesLayer, draft: null, snapMarker: null,
    annotationList: element(), jsonDisplay: element(), syncColorControls() {},
    commonStrokeProps: () => ({}), registerFinalizedShapeNode(node, model) { node.model = model; },
    cancelDraft() {}, clearSelection() {}, hideCoordinates() {},
    showNotification: (...args) => notices.push(args),
    importJsonText: { value: '' }, importSummary: { textContent: '' },
    closeImportModal: () => { modal.closeCount++; },
    WEBMCP_EXPORT_CHUNK_BYTES: 256 * 1024, WEBMCP_EXPORT_MAX_CHUNK_BYTES: 1024 * 1024,
    WEBMCP_MAX_DATA_URL_LENGTH: 12 * 1024 * 1024,
    WEBMCP_PREVIEW_DEFAULT_MAX_DIMENSION: 1024, WEBMCP_PREVIEW_MIN_DIMENSION: 64,
    WEBMCP_PREVIEW_MAX_DIMENSION: 2048, DOWNLOAD_OBJECT_URL_RELEASE_DELAY_MS: 1000,
    AnnoForgeImageLoading: {
      parseImageUrl: value => new URL(value),
      decodeImage: async () => ({ naturalWidth: 1200, naturalHeight: 630 })
    },
    createAnnotatedImageCanvas: () => ({ width: 1200, height: 630,
      canvas: { toDataURL: () => dataUrl, toBlob: callback => callback(new Blob([png], { type: 'image/png' })) } })
  };
  context.imageLoader = { load: async () => {
    context.loadedImage = { naturalWidth: 1200, naturalHeight: 630 };
    context.shapes.length = 0;
    return { loaded: true, revision: ++context.workspaceRevision, image: { originalWidth: 1200, originalHeight: 630 } };
  } };
  await runInNewContext(`${functionNames.map(implementation).join('\n')}\nregisterAnnoForgeWebMcpTools()`, context);
  return { tools, context, downloads, notices, modal, layers, async call(name, input) {
    const tool = tools.get(name);
    const result = JSON.parse(JSON.stringify(await tool.execute(input)));
    assertOutputSchema(tool.outputSchema, result, name);
    return result;
  } };
}

function assertDisplayedAnnotations(h, state) {
  const items = h.context.annotationList.children.filter(item => item.className === 'annotation-item');
  assert.equal(items.length, state.annotationCount, '一覧の件数とWebMCPの件数が一致する');
  assert.deepEqual(items.map(item => item.dataset.shapeId), h.context.shapes.map(shape => String(shape.id)));
  if (state.annotationCount === 0) {
    assert.equal(h.context.jsonDisplay.textContent, 'アノテーションがありません');
  } else {
    assert.deepEqual(JSON.parse(h.context.jsonDisplay.textContent), { draw: state.draw });
  }
  assert.deepEqual(h.context.annotationsLayer.drawnIds, h.context.shapes.map(shape => shape.id));
}

test('10ツールすべてが出力スキーマを持ち、作業を置き換える3ツールだけconsequentialHintを有効にする', async () => {
  const h = await harness();
  const consequential = new Set(['open_image_from_url', 'open_image_from_data_url', 'replace_annotations']);
  assert.deepEqual([...h.tools.keys()].sort(), ['open_image_from_url', 'open_image_from_data_url',
    'get_annotations', 'get_image_preview', 'replace_annotations', 'start_annotations_json_download',
    'export_annotated_image', 'prepare_annotation_export', 'read_annotation_export', 'release_annotation_export'].sort());
  for (const [name, tool] of h.tools) {
    assert.equal(tool.outputSchema.type, 'object', name);
    assert.equal(tool.annotations.consequentialHint, consequential.has(name), name);
  }
});

test('全ツールの成功結果が登録スキーマに一致する（画像未読込み、5図形、両出力方式、PNG・JSON分割読取りと解放）', async () => {
  const h = await harness();
  assert.equal((await h.call('get_annotations', {})).image.originalWidth, null);
  await h.call('open_image_from_url', { expectedRevision: 0, url: 'https://example.com/fixture.png' });
  await h.call('open_image_from_data_url', { expectedRevision: 1, dataUrl });
  const replaced = await h.call('replace_annotations', { expectedRevision: 2, draw });
  const state = await h.call('get_annotations', {});
  assert.deepEqual(state.draw, draw);
  assert.equal(state.image.originalWidth, 1200);
  await h.call('get_image_preview', { maxDimension: 2048 });
  await h.call('start_annotations_json_download', { expectedRevision: replaced.revision });
  await h.call('export_annotated_image', { expectedRevision: replaced.revision, delivery: 'data_url' });
  await h.call('export_annotated_image', { expectedRevision: replaced.revision, delivery: 'download' });
  assert.deepEqual(h.downloads, ['fixture-annotations.json', 'fixture-annotated.png']);
  const manifest = await h.call('prepare_annotation_export', { expectedRevision: replaced.revision });
  for (const format of ['png', 'json']) {
    let offset = 0;
    while (offset < manifest.artifacts[format].byteLength) {
      const chunk = await h.call('read_annotation_export', { exportId: manifest.exportId, format, offset, maxBytes: 16384 });
      offset = chunk.nextOffset;
      assert.equal(chunk.eof, offset === manifest.artifacts[format].byteLength);
    }
  }
  assert.equal((await h.call('release_annotation_export', { exportId: manifest.exportId })).released, true);
  assert.equal((await h.call('release_annotation_export', { exportId: manifest.exportId })).released, false);
});

test('出力スキーマはUI由来の小さい図形や線幅を置換入力の制約で拒否しない', async () => {
  const h = await harness();
  h.context.importAnnotations({ draw: [{ shape: 'rectangle', x: 0, y: 0, width: 1, height: 2, color: 'FF0000', thickness: 0 }] });
  const state = await h.call('get_annotations', {});
  assert.equal(state.draw[0].width, 1);
  await assert.rejects(h.call('replace_annotations', { expectedRevision: state.revision, draw: state.draw }));
});

test('UI読込みは全形状の非数値・非有限の座標をスキップし、有効な図形だけを返す', async () => {
  const h = await harness();
  const invalidValues = ['invalid', '12', null, true, {}, [], undefined, NaN, Infinity, -Infinity];
  for (const annotation of draw) {
    const fields = Object.keys(annotation).filter(key => !['shape', 'color', 'thickness'].includes(key));
    for (const field of fields) {
      for (const value of invalidValues) {
        const invalid = { ...annotation, [field]: field === 'points'
          ? annotation.points.map((point, index) => index === 2 ? value : point) : value };
        h.context.importAnnotations({ draw: [invalid, draw[0]] });
        const state = await h.call('get_annotations', {});
        assert.deepEqual(state.draw, [draw[0]], `${annotation.shape}.${field}: ${String(value)}`);
        assert.deepEqual(h.notices.at(-1), ['1件読み込み、1件スキップ', 'error']);
      }
    }
  }
  const overflow = JSON.parse('{"draw":[{"shape":"polygon","points":[0,0,10,0,1e400,10],"color":"FF0000","thickness":1}]}');
  h.context.importAnnotations(overflow);
  assert.deepEqual((await h.call('get_annotations', {})).draw, []);
  assert.deepEqual(h.notices.at(-1), ['0件読み込み、1件スキップ', 'error']);
});

test('UI読込みは有限小数を整数化し、6要素の平行四辺形を出力契約のまま保持する', async () => {
  const h = await harness();
  const imported = draw.map(annotation => Object.fromEntries(Object.entries(annotation).map(([key, value]) => [key,
    key === 'thickness' ? value : typeof value === 'number' ? value + 0.25
      : Array.isArray(value) ? value.map(point => point + 0.25) : value])));
  imported[0].x = Number.MAX_SAFE_INTEGER + 1;
  imported[3].points = [0.25, 0.25, 50.25, 0.25, 60.25, 50.25];
  const expected = draw.map(annotation => ({ ...annotation }));
  expected[0].x = Number.MAX_SAFE_INTEGER + 1;
  expected[3].points = [0, 0, 50, 0, 60, 50];
  h.context.importAnnotations({ draw: imported });
  const state = await h.call('get_annotations', {});
  assert.deepEqual(state.draw, expected);
  assert.deepEqual(h.notices.at(-1), ['5件読み込み、0件スキップ', 'success']);
  await assert.rejects(h.call('replace_annotations', { expectedRevision: state.revision, draw: [state.draw[3]] }));
  assert.deepEqual((await h.call('get_annotations', {})).draw, expected);
});

test('モーダルは不正要素をスキップし、全件不正・混在の置換で版を1回更新して古い出力を無効にする', async () => {
  const invalidEntries = [null, 12, 'circle', false, [], {},
    { shape: null }, { shape: 1 }, { shape: true }, { shape: [] }, { shape: {} },
    { shape: 'unknown', color: 'FF0000' }];
  const inputs = invalidEntries.map(entry => ({ input: [entry], expected: [], skipped: 1 }));
  inputs.push({ input: [{ ...draw[4], shape: 'CIRCLE' }, ...invalidEntries, draw[1]],
    expected: [draw[4], draw[1]], skipped: invalidEntries.length });
  for (const { input, expected, skipped } of inputs) {
    const h = await harness();
    await h.call('open_image_from_data_url', { expectedRevision: 0, dataUrl });
    await h.call('replace_annotations', { expectedRevision: 1, draw });
    const before = await h.call('get_annotations', {});
    const prepared = await h.call('prepare_annotation_export', { expectedRevision: before.revision });
    h.notices.length = 0;
    h.context.importJsonText.value = JSON.stringify({ draw: input });
    h.context.runImportFromModal();
    const after = await h.call('get_annotations', {});
    assert.deepEqual(after.draw, expected);
    assert.equal(after.annotationCount, expected.length);
    assert.equal(after.revision, before.revision + 1);
    assert.equal(h.modal.closeCount, 1);
    assert.equal(h.context.importSummary.textContent, '');
    assert.deepEqual(h.notices, [[`${expected.length}件読み込み、${skipped}件スキップ`, 'error']]);
    for (const format of ['png', 'json']) {
      await assert.rejects(h.call('read_annotation_export', {
        exportId: prepared.exportId, format, offset: 0, maxBytes: 1024
      }), /無効または解放済み/);
    }
    const latest = await h.call('prepare_annotation_export', { expectedRevision: after.revision });
    const chunk = await h.call('read_annotation_export', {
      exportId: latest.exportId, format: 'json', offset: 0, maxBytes: 1048576
    });
    assert.equal(latest.revision, after.revision);
    assert.equal(latest.annotationCount, expected.length);
    assert.equal(chunk.eof, true);
    assert.deepEqual(JSON.parse(Buffer.from(chunk.base64, 'base64').toString('utf8')), { draw: expected });
  }
});

test('モーダルの構文・トップレベル形式エラーは注釈・版・準備済み出力を保持し、成功扱いしない', async () => {
  const h = await harness();
  await h.call('open_image_from_data_url', { expectedRevision: 0, dataUrl });
  await h.call('replace_annotations', { expectedRevision: 1, draw });
  const before = await h.call('get_annotations', {});
  const prepared = await h.call('prepare_annotation_export', { expectedRevision: before.revision });
  for (const input of ['{invalid', 'null', '[]', '12', '"text"', '{}', '{"draw":null}', '{"draw":{}}']) {
    h.notices.length = 0;
    h.context.importJsonText.value = input;
    h.context.runImportFromModal();
    assert.deepEqual(await h.call('get_annotations', {}), before);
    assert.equal(h.modal.closeCount, 0);
    const syntaxError = input === '{invalid';
    assert.equal(h.context.importSummary.textContent, syntaxError
      ? 'JSONの構文エラーがあります' : '不正なJSON形式です（draw配列が必要）');
    assert.deepEqual(h.notices, syntaxError ? [] : [['不正なJSON形式です（draw配列が必要）', 'error']]);
    for (const format of ['png', 'json']) {
      const chunk = await h.call('read_annotation_export', {
        exportId: prepared.exportId, format, offset: 0, maxBytes: 1048576
      });
      assert.equal(chunk.revision, before.revision);
      assert.equal(chunk.eof, true);
      if (format === 'json') assert.deepEqual(JSON.parse(Buffer.from(chunk.base64, 'base64').toString('utf8')), { draw });
    }
  }
});

test('不正な色の型・形式をスキップし、後続の有効図形と一覧・JSON表示まで反映する', async () => {
  const h = await harness();
  await h.call('open_image_from_data_url', { expectedRevision: 0, dataUrl });
  const invalidColors = [undefined, null, 123456, true, false, {}, [], ['FF0000'],
    { toString: null }, { toString: 123 }, { toString: 'FF0000' }, '', '#123', 'GG0000', '#1234567'];
  for (const annotation of draw) {
    for (const color of invalidColors) {
      const before = await h.call('get_annotations', {});
      h.notices.length = 0;
      h.context.importJsonText.value = JSON.stringify({ draw: [draw[0], { ...annotation, color }, draw[1]] });
      h.context.runImportFromModal();
      const after = await h.call('get_annotations', {});
      assert.deepEqual(after.draw, [draw[0], draw[1]], `${annotation.shape}: ${JSON.stringify(color)}`);
      assert.equal(after.revision, before.revision + 1);
      assert.equal(h.context.importSummary.textContent, '');
      assert.deepEqual(h.notices, [['2件読み込み、1件スキップ', 'error']]);
      assertDisplayedAnnotations(h, after);
    }
  }
  h.context.importJsonText.value = JSON.stringify({ draw: [
    { ...draw[0], color: ' #abc123 ' }, { ...draw[1], color: 'aBc123' }
  ] });
  h.context.runImportFromModal();
  const normalized = await h.call('get_annotations', {});
  assert.deepEqual(normalized.draw, [draw[0], draw[1]].map(annotation => ({ ...annotation, color: 'ABC123' })));
  assertDisplayedAnnotations(h, normalized);
});

for (const importedCount of [0, 1, 3]) {
  test(`${importedCount}件読込み後の描画例外でも、版・出力・一覧・JSON表示を同期する`, async () => {
    const h = await harness();
    await h.call('open_image_from_data_url', { expectedRevision: 0, dataUrl });
    await h.call('replace_annotations', { expectedRevision: 1, draw });
    const before = await h.call('get_annotations', {});
    const prepared = await h.call('prepare_annotation_export', { expectedRevision: before.revision });
    const OriginalNode = h.context.Konva.Rect;
    let created = 0;
    class FailingNode extends OriginalNode {
      constructor(...args) {
        if (created++ === importedCount) throw new Error('描画処理の失敗');
        super(...args);
      }
    }
    Object.assign(h.context.Konva, { Rect: FailingNode, Line: FailingNode, Circle: FailingNode });
    h.notices.length = 0;
    h.context.importJsonText.value = JSON.stringify({ draw });
    h.context.runImportFromModal();
    const after = await h.call('get_annotations', {});
    assert.equal(after.revision, before.revision + 1);
    assert.deepEqual(after.draw, draw.slice(0, importedCount));
    assert.equal(after.annotationCount, importedCount);
    assertDisplayedAnnotations(h, after);
    assert.equal(h.modal.closeCount, 0);
    assert.equal(h.context.importSummary.textContent, 'JSONの読み込みに失敗しました');
    assert.deepEqual(h.notices, []);
    for (const format of ['png', 'json']) {
      await assert.rejects(h.call('read_annotation_export', {
        exportId: prepared.exportId, format, offset: 0, maxBytes: 1024
      }), /無効または解放済み/);
    }
    const latest = await h.call('prepare_annotation_export', { expectedRevision: after.revision });
    const chunk = await h.call('read_annotation_export', {
      exportId: latest.exportId, format: 'json', offset: 0, maxBytes: 1048576
    });
    assert.deepEqual(JSON.parse(Buffer.from(chunk.base64, 'base64').toString('utf8')), { draw: after.draw });
  });
}

for (const failure of [
  { name: '0件生成後', kind: 'constructor', after: 0 },
  { name: '1件生成後', kind: 'constructor', after: 1 },
  { name: '3件生成後', kind: 'constructor', after: 3 },
  { name: 'ノード登録中', kind: 'registration', after: 3 },
  { name: 'レイヤーへの追加中', kind: 'add', after: 3 },
  { name: '注釈レイヤー描画後', kind: 'draw', after: 0 },
  { name: 'ガイドレイヤー描画後', kind: 'draw', after: 1 },
  { name: 'レイヤー並べ替え中', kind: 'zIndex', after: 0 },
  { name: '一覧の途中生成中', kind: 'list', after: 4 },
  { name: '一覧・JSON表示更新後', kind: 'controls', after: 0 }
]) {
  test(`WebMCP置換が${failure.name}に失敗しても、元の注釈・版・出力・表示を保持する`, async () => {
    const h = await harness();
    await h.call('open_image_from_data_url', { expectedRevision: 0, dataUrl });
    await h.call('replace_annotations', { expectedRevision: 1, draw });
    const c = h.context;
    c.selectedShapeId = c.shapes[0].id;
    c.transformer = new c.Konva.Rect();
    c.draft = { type: 'line', node: new c.Konva.Line() };
    c.snapMarker = new c.Konva.Circle();
    c.annotationsLayer.children[0].rotation = 35;
    c.annotationsLayer.add(c.transformer);
    c.annotationsLayer.add(c.draft.node);
    c.guidesLayer.add(c.snapMarker);
    c.annotationsLayer.draw();
    c.updateAnnotationList();
    const before = await h.call('get_annotations', {});
    const prepared = await h.call('prepare_annotation_export', { expectedRevision: before.revision });
    const read = format => h.call('read_annotation_export', { exportId: prepared.exportId, format, offset: 0, maxBytes: 1048576 });
    const previousChunks = { png: await read('png'), json: await read('json') };
    const previous = {
      layer: c.annotationsLayer, guides: c.guidesLayer, nodes: c.annotationsLayer.children.slice(),
      selected: c.selectedShapeId, transformer: c.transformer, draft: c.draft, snapMarker: c.snapMarker,
      listNodes: c.annotationList.children.slice(), jsonText: c.jsonDisplay.textContent,
      idSeq: c.idSeq, prepared: c.preparedAnnotationExport, stageLayers: c.stage.children.slice(),
      allocatedLayers: h.layers.length
    };
    let calls = 0;
    const fail = () => { if (calls++ >= failure.after) throw new Error('置換処理の失敗'); };
    if (failure.kind === 'constructor') {
      const OriginalNode = c.Konva.Rect;
      class FailingNode extends OriginalNode { constructor(...args) { fail(); super(...args); } }
      Object.assign(c.Konva, { Rect: FailingNode, Line: FailingNode, Circle: FailingNode });
    } else if (failure.kind === 'registration') {
      const original = c.registerFinalizedShapeNode;
      c.registerFinalizedShapeNode = (...args) => { original(...args); fail(); };
    } else if (['add', 'draw', 'zIndex'].includes(failure.kind)) {
      const original = c.Konva.Layer.prototype[failure.kind];
      c.Konva.Layer.prototype[failure.kind] = function (...args) {
        const result = original.apply(this, args);
        if (failure.kind !== 'zIndex' || args.length > 0) fail();
        return result;
      };
    } else if (failure.kind === 'list') {
      const original = c.document.createElement;
      c.document.createElement = (...args) => { fail(); return original(...args); };
    } else {
      c.syncColorControls = fail;
    }
    h.notices.length = 0;
    await assert.rejects(h.call('replace_annotations', {
      expectedRevision: before.revision, draw: draw.slice().reverse()
    }), /置換処理の失敗/);
    const after = await h.call('get_annotations', {});
    assert.deepEqual(after, before);
    assert.equal(c.annotationsLayer, previous.layer);
    assert.equal(c.guidesLayer, previous.guides);
    assert.deepEqual(c.stage.children, previous.stageLayers);
    for (const [index, node] of previous.nodes.entries()) {
      assert.equal(c.annotationsLayer.children[index], node, '元のノードを再生成せず保持する');
      assert.notEqual(node.destroyed, true);
    }
    assert.equal(c.annotationsLayer.children[0].rotation, 35);
    assert.equal(c.selectedShapeId, previous.selected);
    assert.equal(c.transformer, previous.transformer);
    assert.equal(c.draft, previous.draft);
    assert.equal(c.snapMarker, previous.snapMarker);
    assert.equal(c.guidesLayer.children[0], previous.snapMarker);
    assert.equal(c.idSeq, previous.idSeq);
    assert.equal(c.preparedAnnotationExport, previous.prepared);
    for (const [index, node] of previous.listNodes.entries()) assert.equal(c.annotationList.children[index], node);
    assert.equal(c.jsonDisplay.textContent, previous.jsonText);
    assertDisplayedAnnotations(h, after);
    assert.deepEqual(await read('png'), previousChunks.png);
    assert.deepEqual(await read('json'), previousChunks.json);
    assert.deepEqual(h.notices, []);
    for (const layer of h.layers.slice(previous.allocatedLayers)) assert.equal(layer.destroyed, true);
  });
}

for (const replacement of [draw.slice().reverse(), []]) {
  test(`WebMCP置換の成功時だけrevisionを1回進めて出力を無効化する（${replacement.length}件）`, async () => {
    const h = await harness();
    await h.call('open_image_from_data_url', { expectedRevision: 0, dataUrl });
    await h.call('replace_annotations', { expectedRevision: 1, draw });
    const c = h.context;
    const before = await h.call('get_annotations', {});
    const prepared = await h.call('prepare_annotation_export', { expectedRevision: before.revision });
    const previousLayer = c.annotationsLayer, previousGuides = c.guidesLayer;
    c.selectedShapeId = c.shapes[0].id;
    c.transformer = new c.Konva.Rect();
    c.draft = { node: new c.Konva.Line() };
    c.snapMarker = new c.Konva.Circle();
    c.annotationsLayer.add(c.transformer);
    c.annotationsLayer.add(c.draft.node);
    c.guidesLayer.add(c.snapMarker);
    const previousNodes = [...previousLayer.children, ...previousGuides.children];
    const result = await h.call('replace_annotations', { expectedRevision: before.revision, draw: replacement });
    const after = await h.call('get_annotations', {});
    assert.equal(result.revision, before.revision + 1);
    assert.equal(after.revision, result.revision);
    assert.equal(result.annotationCount, replacement.length);
    assert.deepEqual(after.draw, replacement);
    assertDisplayedAnnotations(h, after);
    assert.equal(c.stage.children.length, 3);
    assert.equal(c.stage.children[1], c.annotationsLayer);
    assert.equal(c.stage.children[2], c.guidesLayer);
    assert.equal(previousLayer.destroyed, true);
    assert.equal(previousGuides.destroyed, true);
    for (const node of previousNodes) assert.equal(node.destroyed, true);
    for (const field of ['selectedShapeId', 'transformer', 'draft', 'snapMarker', 'preparedAnnotationExport']) assert.equal(c[field], null);
    for (const format of ['png', 'json']) await assert.rejects(h.call('read_annotation_export', {
      exportId: prepared.exportId, format, offset: 0, maxBytes: 1024
    }), /無効または解放済み/);
  });
}

test('出力スキーマが必須値欠落・余分な値・型違い・画像状態矛盾・出力方式混在を拒否する', async () => {
  const h = await harness();
  const state = await h.call('get_annotations', {});
  for (const invalid of [
    { ...state, revision: '0' }, { ...state, revision: -1 }, { ...state, unexpected: true },
    { ...state, image: { loaded: false, originalWidth: 1200, originalHeight: 630 } },
    { ...state, image: { loaded: true, originalWidth: null, originalHeight: null } }
  ]) assert.throws(() => assertOutputSchema(h.tools.get('get_annotations').outputSchema, invalid));
  const missing = { ...state };
  delete missing.revision;
  assert.throws(() => assertOutputSchema(h.tools.get('get_annotations').outputSchema, missing));
  await h.call('open_image_from_data_url', { expectedRevision: 0, dataUrl });
  const download = await h.call('export_annotated_image', { expectedRevision: 1, delivery: 'download' });
  const schema = h.tools.get('export_annotated_image').outputSchema;
  assert.throws(() => assertOutputSchema(schema, { ...download, completionVerified: true }));
  assert.throws(() => assertOutputSchema(schema, { ...download, dataUrl }));
  const manifest = await h.call('prepare_annotation_export', { expectedRevision: 1 });
  manifest.artifacts.png.sha256 = 'invalid';
  assert.throws(() => assertOutputSchema(h.tools.get('prepare_annotation_export').outputSchema, manifest));
});
