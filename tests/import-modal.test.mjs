import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const source = await readFile(new URL('../web/app.js', import.meta.url), 'utf8');
const html = await readFile(new URL('../web/index.html', import.meta.url), 'utf8');
const styles = await readFile(new URL('../web/styles.css', import.meta.url), 'utf8');
const functionNames = ['bindImportModal', 'bindDragAndDrop', 'onPasteJsonFromClipboard',
  'isModalOpen', 'openImportModal', 'closeImportModal', 'validateImportText', 'runImportFromModal'];
function implementation(name) {
  const match = source.match(new RegExp(`^  (?:async )?function ${name}\\([^]*?(?=^  (?:async )?function )`, 'm'));
  assert.ok(match, `実装関数が見つかりません: ${name}`);
  return match[0];
}

// イベント登録と開閉は実装を実行する。DOM・クリップボード・描画はモックとする。
function harness({ importResult = true, importError = null } = {}) {
  const document = { activeElement: null };
  const hiddenTransitions = [], imported = [], files = [], notices = [];
  function element(id) {
    const tag = html.match(new RegExp(`<[^>]+\\bid="${id}"[^>]*>`))?.[0] || '';
    const attributes = new Map([...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map(match => [match[1], match[2]]));
    const classes = new Set((attributes.get('class') || '').split(/\s+/).filter(Boolean));
    const listeners = new Map();
    return {
      id, value: '', textContent: '', disabled: /\sdisabled\b/.test(tag),
      classList: { add: name => classes.add(name), remove: name => classes.delete(name), contains: name => classes.has(name) },
      getAttribute: name => attributes.get(name) ?? null,
      hasAttribute: name => attributes.has(name),
      setAttribute(name, value) {
        attributes.set(name, String(value));
        if (id === 'importModal' && name === 'aria-hidden' && value === 'true') {
          hiddenTransitions.push(this.contains(document.activeElement));
        }
      },
      focus() { document.activeElement = this; },
      addEventListener(name, listener) {
        if (!listeners.has(name)) listeners.set(name, []);
        listeners.get(name).push(listener);
      },
      async dispatch(name, event = {}) {
        for (const listener of listeners.get(name) || []) await listener({ target: this, preventDefault() {}, ...event });
      }
    };
  }
  const ids = ['importModal', 'openImportModalBtn', 'closeImportModalBtn', 'cancelImportBtn',
    'importPasteBtn', 'importJsonFile', 'importJsonText', 'importDropZone', 'runImportBtn', 'importSummary', 'stageContainer'];
  const context = Object.fromEntries(ids.map(id => [id, element(id)]));
  document.body = element('body');
  const children = new Set(ids.filter(id => !['importModal', 'openImportModalBtn', 'stageContainer'].includes(id)).map(id => context[id]));
  context.importModal.contains = node => node === context.importModal || children.has(node);
  context.document = document;
  context.window = { ...element('window'), isSecureContext: true };
  context.navigator = { clipboard: { readText: async () => '{"draw":[{"shape":"circle","x":10,"y":20,"radius":5}]}' } };
  context.readJsonFile = file => files.push(file);
  context.importAnnotations = obj => {
    imported.push(obj);
    if (importError) throw importError;
    return importResult;
  };
  context.showNotification = text => notices.push(text);
  runInNewContext(`${functionNames.map(implementation).join('\n')}\nbindImportModal(); bindDragAndDrop();`, context);
  return { ...context, hiddenTransitions, imported, files, notices };
}

function assertOpen(h) {
  assert.equal(h.isModalOpen(), true);
  assert.equal(h.importModal.getAttribute('aria-hidden'), 'false');
}
function assertClosed(h) {
  assert.equal(h.isModalOpen(), false);
  assert.equal(h.importModal.getAttribute('aria-hidden'), 'true');
  assert.equal(h.importModal.contains(h.document.activeElement), false);
  assert.ok(h.hiddenTransitions.every(hadFocus => !hadFocus), 'aria-hidden=true を設定する前に内部のフォーカスを移す');
}

test('ズームUIは補助表示より前、モーダル背景・内容より後ろに置き、通知の前後関係も保つ', () => {
  // CSS宣言の関係を検証する。描画とヒット判定は実ブラウザーで確認する。
  const rules = [...styles.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)];
  function layer(selector) {
    const matches = rules.filter(rule => rule[1].split(',').some(value => value.trim() === selector));
    assert.equal(matches.length, 1, `${selector} のスタイル宣言を一意に取得できる`);
    const zIndex = matches[0][2].match(/(?:^|;)\s*z-index\s*:\s*(-?\d+)\s*(?:;|$)/);
    assert.ok(zIndex, `${selector} に整数の z-index がある`);
    return Number(zIndex[1]);
  }
  const zoom = layer('.floating-zoom');
  const overlay = layer('.modal .modal__overlay');
  const content = layer('.modal .modal__content');
  assert.ok(layer('#coordinates') < zoom, '座標表示よりズームUIを前に置く');
  assert.ok(layer('.status-bar') < zoom, '状態表示よりズームUIを前に置く');
  assert.ok(zoom < overlay, 'モーダル背景でズームUIを覆う');
  assert.ok(overlay < content, 'モーダル内容を背景より前に置く');
  assert.ok(content < layer('.copy-notification'), '通知をモーダル内容より前に置く');
});

test('初期非表示と再オープンで表示・ARIA・フォーカスが一致する', async () => {
  const h = harness();
  assertClosed(h);
  for (let i = 0; i < 2; i++) {
    h.openImportModalBtn.focus();
    await h.openImportModalBtn.dispatch('click');
    assertOpen(h);
    assert.equal(h.document.activeElement, h.importJsonText);
    h.closeImportModal();
    assertClosed(h);
    assert.equal(h.document.activeElement, h.openImportModalBtn);
  }
});

for (const path of ['閉じる', 'キャンセル', 'Escape', '背景']) {
  test(`${path}で閉じると非表示になり、フォーカスを起動ボタンへ戻す`, async () => {
    const h = harness();
    await h.openImportModalBtn.dispatch('click');
    assertOpen(h);
    if (path === '閉じる' || path === 'キャンセル') {
      const button = path === '閉じる' ? h.closeImportModalBtn : h.cancelImportBtn;
      button.focus();
      await button.dispatch('click');
    } else if (path === 'Escape') {
      await h.window.dispatch('keydown', { key: 'Escape' });
    } else {
      // 背景の押下で入力欄がフォーカスを失い、その後にclickが届く。
      h.document.body.focus();
      await h.importModal.dispatch('click', { target: { hasAttribute: name => name === 'data-close-modal' } });
    }
    assertClosed(h);
    assert.equal(h.document.activeElement, h.openImportModalBtn);
  });
}

test('JSONのインポート成功でも共通の終了処理を通る', async () => {
  const h = harness();
  await h.openImportModalBtn.dispatch('click');
  const input = { draw: [{ shape: 'circle', x: 10, y: 20, radius: 5 }] };
  h.importJsonText.value = JSON.stringify(input);
  await h.importJsonText.dispatch('input');
  assert.equal(h.runImportBtn.disabled, false);
  h.runImportBtn.focus();
  await h.runImportBtn.dispatch('click');
  assert.deepEqual(JSON.parse(JSON.stringify(h.imported)), [input]);
  assertClosed(h);
  assert.equal(h.document.activeElement, h.openImportModalBtn);
});

test('構文エラー・内容領域クリック・Escape以外ではモーダルを隠さない', async () => {
  const h = harness();
  await h.openImportModalBtn.dispatch('click');
  h.importJsonText.value = '{invalid';
  await h.importJsonText.dispatch('input');
  assert.equal(h.runImportBtn.disabled, true);
  assert.equal(h.importSummary.textContent, 'JSONの構文エラーがあります');
  h.runImportFromModal();
  await h.importModal.dispatch('click', { target: h.importJsonText });
  await h.window.dispatch('keydown', { key: 'Enter' });
  assertOpen(h);
  assert.equal(h.imported.length, 0);
  assert.equal(h.document.activeElement, h.importJsonText);
});

test('形式エラーと読込み処理の例外でもモーダルを開いたまま、それぞれのエラーを表示する', async () => {
  for (const [options, input, message] of [
    [{ importResult: false }, '{}', '不正なJSON形式です（draw配列が必要）'],
    [{ importError: new Error('処理エラー') }, '{"draw":[{}]}', 'JSONの読み込みに失敗しました']
  ]) {
    const h = harness(options);
    await h.openImportModalBtn.dispatch('click');
    h.importJsonText.value = input;
    h.runImportFromModal();
    assertOpen(h);
    assert.equal(h.importSummary.textContent, message);
    assert.equal(h.document.activeElement, h.importJsonText);
    assert.deepEqual(h.notices, []);
  }
});

test('既に閉じた状態のEscapeは外部のフォーカスを移動しない', async () => {
  const h = harness();
  h.stageContainer.focus();
  await h.window.dispatch('keydown', { key: 'Escape' });
  assertClosed(h);
  assert.equal(h.document.activeElement, h.stageContainer);
});

test('既に閉じた状態の終了処理は外部のフォーカスを移動しない', () => {
  const h = harness();
  h.stageContainer.focus();
  h.closeImportModal();
  assertClosed(h);
  assert.equal(h.document.activeElement, h.stageContainer);
});

test('貼り付け・ステージへのJSONドロップも共通の開始処理を使う', async () => {
  const h = harness();
  await h.importPasteBtn.dispatch('click');
  assertOpen(h);
  assert.equal(h.document.activeElement, h.importJsonText);
  assert.equal(h.runImportBtn.disabled, false);
  h.closeImportModal();
  const file = { name: 'annotations.json', type: 'application/json' };
  await h.stageContainer.dispatch('drop', { dataTransfer: { files: [file] } });
  assert.deepEqual(h.files, [file]);
  assertOpen(h);
  assert.equal(h.document.activeElement, h.importJsonText);
});
