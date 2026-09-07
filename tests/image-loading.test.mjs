import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const source = await readFile(new URL('../web/image-loading.js', import.meta.url), 'utf8');
const file = new File(['image bytes'], 'local.gif', { type: 'image/gif' });
const urlInput = { kind: 'url', value: 'https://images.example/image.png' };
const dataInput = { kind: 'data_url', value: 'data:image/png;base64,aW1hZ2U=' };
const fileInput = { kind: 'file', value: file };
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
}
function response({ type = 'image/png', size = 5, length = size, url = urlInput.value, status = 200 } = {}) {
  return { ok: status === 200, status, url, headers: new Headers({ 'content-type': type, 'content-length': String(length) }),
    blob: async () => new Blob([new Uint8Array(size)], { type }) };
}
function harness({ href = 'https://app.example/', fetchResponse = response(), autoDecode = true, decodeFails = false } = {}) {
  const images = [], requests = [], urls = new Map(), revoked = [], commits = [];
  let version = 'revision-4:draft-0';
  class TestURL extends URL {
    static createObjectURL(blob) { const url = `blob:test-${urls.size}`; urls.set(url, blob); return url; }
    static revokeObjectURL(url) { revoked.push(url); }
  }
  class TestImage {
    constructor() { images.push(this); this.naturalWidth = 80; this.naturalHeight = 60; }
    set src(value) {
      this.source = value;
      if (value && autoDecode) queueMicrotask(() => decodeFails ? this.onerror?.() : this.onload?.());
    }
  }
  const context = { URL: TestURL, Blob, Image: TestImage, AbortController, DOMException, atob,
    location: { href }, fetch: async (url, options) => { requests.push({ url, options }); return typeof fetchResponse === 'function' ? fetchResponse() : fetchResponse; } };
  runInNewContext(source, context);
  const api = context.AnnoForgeImageLoading;
  const loader = api.createLoader({ getVersion: () => version, commitImage: (image, name) => {
    commits.push({ image, name });
    version = 'revision-5:draft-0';
    return { loaded: true, revision: 5 };
  } });
  return { api, loader, images, requests, urls, revoked, commits, changeVersion: value => { version = value; } };
}

test('URLの取得条件を共通化し、デコード成功後だけ画像を反映して一時URLを解放する', async () => {
  const h = harness();
  assert.deepEqual(await h.loader.load(urlInput), { loaded: true, revision: 5 });
  assert.equal(h.commits.length, 1);
  assert.equal(h.commits[0].name, '');
  const request = h.requests[0];
  assert.equal(request.options.mode, 'cors');
  assert.equal(request.options.credentials, 'omit');
  assert.equal(request.options.referrerPolicy, 'no-referrer');
  assert.equal(request.options.cache, 'no-store');
  assert.deepEqual(h.revoked, [...h.urls.keys()]);
});

test('通常ファイルにはURL専用の形式制限を課さず、ファイル名を保持する', async () => {
  const h = harness();
  await h.loader.load(fileInput);
  assert.equal(h.commits[0].name, 'local.gif');
  assert.equal(h.requests.length, 0);
  assert.equal(h.urls.values().next().value, file);
  assert.equal(h.revoked.length, 1);
});

test('出力・プレビュー用のデコードはsignalなしでも使え、作業状態を変更しない', async () => {
  const h = harness();
  const image = await h.api.decodeImage(dataInput.value);
  assert.equal(image.source, dataInput.value);
  assert.equal(image.naturalWidth, 80);
  assert.equal(h.commits.length, 0);
});

test('プレビュー用のデコードを取り消しても進行中の画像読込みを妨げない', async () => {
  const h = harness({ autoDecode: false });
  const loading = h.loader.load(fileInput);
  const controller = new AbortController();
  const preview = h.api.decodeImage(dataInput.value, controller.signal);
  const rejected = assert.rejects(preview, { name: 'AbortError' });
  controller.abort();
  await rejected;
  assert.equal(h.images[1].source, '');
  h.images[0].onload();
  await loading;
  assert.equal(h.commits.length, 1);
});

test('プレビュー用のデコード失敗・開始前の取消しを成功扱いしない', async () => {
  const h = harness({ decodeFails: true });
  await assert.rejects(h.api.decodeImage(dataInput.value), /デコード/);
  await assert.rejects(h.api.decodeImage(dataInput.value, AbortSignal.abort()), { name: 'AbortError' });
  assert.equal(h.commits.length, 0);
});

for (const href of ['http://127.0.0.1:8007/', 'http://localhost:8007/', 'http://[::1]:8007/']) {
  test(`開発用HTTPは同一loopbackオリジンのみ: ${href}`, () => {
    const h = harness({ href });
    assert.equal(h.api.parseImageUrl(`${href}a.png`).href, `${href}a.png`);
    assert.throws(() => h.api.parseImageUrl(href.replace('8007', '8008') + 'a.png'), /HTTPS/);
    assert.throws(() => h.api.parseImageUrl('http://elsewhere.example/a.png'), /HTTPS/);
  });
}

for (const value of ['', '/image.png', 'not a URL', 'https://name:password@images.example/a.png', 'http://images.example/a.png', 'file:///a.png', 'data:image/png;base64,YQ==', 'blob:https://app.example/a']) {
  test(`許可しないURLで取得・反映しない: ${value}`, async () => {
    const h = harness();
    await assert.rejects(h.loader.load({ kind: 'url', value }));
    assert.equal(h.requests.length, 0);
    assert.equal(h.commits.length, 0);
  });
}

for (const [name, fetchResponse, pattern] of [
  ['HTTPエラー', response({ status: 404 }), /404/],
  ['禁止されたリダイレクト', response({ url: 'http://images.example/a.png' }), /HTTPS/],
  ['HTML応答', response({ type: 'text/html' }), /PNG/],
  ['空画像', response({ size: 0 }), /空/],
  ['ヘッダーで容量超過', response({ length: 12 * 1024 * 1024 + 1 }), /12 MiB/],
  ['本文で容量超過', response({ size: 12 * 1024 * 1024 + 1, length: 0 }), /12 MiB/],
  ['ネットワーク/CORSの拒否', () => { throw new TypeError('Failed to fetch'); }, /URL、ネットワーク、または配信元のCORS/]
]) {
  test(`${name}で元の作業を変更しない`, async () => {
    const h = harness({ fetchResponse });
    await assert.rejects(h.loader.load(urlInput), pattern);
    assert.equal(h.commits.length, 0);
    assert.equal(h.images.length, 0);
  });
}

test('URLの上限値・MIMEのパラメーター付き応答を受け入れる', async () => {
  const h = harness({ fetchResponse: response({ size: 12 * 1024 * 1024, type: 'image/png; charset=binary' }) });
  await h.loader.load(urlInput);
  assert.equal(h.commits.length, 1);
});

for (const input of [urlInput, dataInput, fileInput]) {
  test(`${input.kind}: デコード失敗でも元の作業を保持し一時URLを解放する`, async () => {
    const h = harness({ decodeFails: true });
    await assert.rejects(h.loader.load(input), /デコード/);
    assert.equal(h.commits.length, 0);
    assert.deepEqual(h.revoked, [...h.urls.keys()]);
  });
  test(`${input.kind}: デコード中の取消しで元の作業を保持する`, async () => {
    const h = harness({ autoDecode: false });
    const controller = new AbortController();
    const pending = h.loader.load(input, { signal: controller.signal });
    const rejected = assert.rejects(pending, { name: 'AbortError' });
    await tick();
    controller.abort();
    await rejected;
    assert.equal(h.commits.length, 0);
    assert.equal(h.images[0].source, '');
    assert.deepEqual(h.revoked, [...h.urls.keys()]);
  });
  for (const version of ['revision-5:draft-0', 'revision-4:draft-1']) {
    test(`${input.kind}: 読込み中の編集 ${version} を消去しない`, async () => {
      const h = harness({ autoDecode: false });
      const pending = h.loader.load(input);
      const rejected = assert.rejects(pending, /作業内容が変更/);
      await tick();
      h.changeVersion(version);
      h.images[0].onload();
      await rejected;
      assert.equal(h.commits.length, 0);
      assert.deepEqual(h.revoked, [...h.urls.keys()]);
    });
  }
}

for (const first of [urlInput, dataInput, fileInput]) {
  for (const second of [urlInput, dataInput, fileInput]) {
    test(`${first.kind}→${second.kind}: 経路をまたいで新しい読込みだけを反映する`, async () => {
      const h = harness({ autoDecode: false });
      const old = h.loader.load(first);
      const rejected = assert.rejects(old, { name: 'AbortError' });
      await tick();
      const next = h.loader.load(second);
      await rejected;
      await tick();
      h.images[1].onload();
      await next;
      assert.equal(h.commits.length, 1);
      assert.equal(h.commits[0].image, h.images[1]);
      assert.equal(h.images[0].source, '');
      assert.deepEqual([...h.revoked].sort(), [...h.urls.keys()].sort());
    });
  }
}

test('不正入力・古い版・開始前の取消しは既存の有効な読込みを妨げない', async () => {
  const h = harness({ autoDecode: false });
  const pending = h.loader.load(urlInput);
  await tick();
  await assert.rejects(h.loader.load({ kind: 'url', value: '/bad' }));
  await assert.rejects(h.loader.load({ kind: 'data_url', value: 'data:image/png;base64,!!!' }));
  await assert.rejects(h.loader.load(fileInput, { expectedVersion: 'stale' }));
  await assert.rejects(h.loader.load(fileInput, { signal: AbortSignal.abort() }));
  assert.equal(h.requests[0].options.signal.aborted, false);
  h.images[0].onload();
  await pending;
  assert.equal(h.commits.length, 1);
});

test('旧fetchが遅れて戻っても新しい画像を上書きしない', async () => {
  const gate = deferred();
  const h = harness({ fetchResponse: () => gate.promise });
  const old = h.loader.load(urlInput);
  const rejected = assert.rejects(old, { name: 'AbortError' });
  await h.loader.load(dataInput);
  gate.resolve(response());
  await rejected;
  assert.equal(h.commits.length, 1);
  assert.equal(h.images.length, 1);
});

test('本文の取得中に取り消された結果をデコードしない', async () => {
  const body = deferred();
  const h = harness({ fetchResponse: { ...response(), blob: () => body.promise } });
  const pending = h.loader.load(urlInput);
  const rejected = assert.rejects(pending, { name: 'AbortError' });
  await tick();
  h.loader.cancel();
  body.resolve(new Blob(['image bytes']));
  await rejected;
  assert.equal(h.images.length, 0);
  assert.equal(h.commits.length, 0);
});

test('完了済み処理の外部signalは次の読込みを取り消さない', async () => {
  const h = harness();
  const oldController = new AbortController();
  await h.loader.load(dataInput, { signal: oldController.signal });
  const next = h.loader.load(fileInput);
  oldController.abort();
  await next;
  assert.equal(h.commits.length, 2);
});

for (const value of ['', null, 'data:image/svg+xml;base64,YQ==', 'data:image/png;base64,', 'data:image/png;base64,Y', 'data:image/png;base64,!!!', 'x'.repeat(12 * 1024 * 1024 + 1)]) {
  test(`Data URLの不正入力を拒否 (${typeof value === 'string' ? value.length : 'null'}文字)`, async () => {
    const h = harness();
    await assert.rejects(h.loader.load({ kind: 'data_url', value }));
    assert.equal(h.images.length, 0);
    assert.equal(h.commits.length, 0);
  });
}
