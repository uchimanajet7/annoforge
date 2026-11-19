import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { crc32, deflateSync } from 'node:zlib';
import { receiveAnnotationExport, assertToolSuccess } from '../scripts/tools/web/receive-annotation-export.mjs';

const tmpRoot = process.env.ANNOFORGE_TEST_TMP_DIR || tmpdir();
assert.ok(isAbsolute(tmpRoot), 'ANNOFORGE_TEST_TMP_DIRには絶対パスを指定してください');
const webMcpDocumentation = await readFile(new URL('../docs/WEBMCP.md', import.meta.url), 'utf8');
const connectionExamples = [...webMcpDocumentation.split('### 4.11 ')[1]
  .matchAll(/```javascript\n([\s\S]*?)\n```/g)].map(match => match[1]);
assert.equal(connectionExamples.length, 2, '接続例の検出・受信の両ブロックを実行する');

async function runConnectionExample(outputDirectory, transformResult = (_name, result) => JSON.stringify(result)) {
  const tools = mockTools();
  const names = ['get_annotations', 'prepare_annotation_export', 'read_annotation_export', 'release_annotation_export'];
  const publishedNames = new Map(names.map(name => [`${name}__test-registration`, name]));
  const calls = [];
  const output = [];
  const siteTools = {
    description: () => `WebMCP tools available in this document:\n${JSON.stringify([...publishedNames.keys()])}`,
    async call(publishedName, input) {
      const name = publishedNames.get(publishedName);
      assert.ok(name, '現在の一覧にある完全なツール名を使う');
      calls.push(name);
      const result = name === 'get_annotations' ? { revision: 7 } : await tools.callTool(name, input);
      return transformResult(name, result);
    }
  };
  let source = connectionExamples.join('\n')
    .replace("'/absolute/path/to/annoforge/scripts/tools/web/receive-annotation-export.mjs'",
      JSON.stringify(new URL('../scripts/tools/web/receive-annotation-export.mjs', import.meta.url).href))
    .replace("'/absolute/path/to/approved-output-directory'", JSON.stringify(outputDirectory));
  for (const [publishedName, name] of publishedNames) {
    source = source.replace(`'<一覧にある ${name} の完全な名前>'`, JSON.stringify(publishedName));
  }
  const tab = { capabilities: { get: async id => {
    assert.equal(id, 'webmcp');
    return { fetchTools: async () => siteTools };
  } } };
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  await new AsyncFunction('tab', 'nodeRepl', source)(tab, { write: value => output.push(value) });
  return { result: output.at(-1), calls };
}

function pngChunk(type, data) {
  const chunk = Buffer.alloc(data.length + 12);
  chunk.writeUInt32BE(data.length, 0);
  chunk.write(type, 4, 4, 'ascii');
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(chunk.subarray(4, -4)), chunk.length - 4);
  return chunk;
}
const png = Buffer.concat([
  Buffer.from('89504e470d0a1a0a', 'hex'),
  pngChunk('IHDR', Buffer.from('00000001000000010806000000', 'hex')),
  pngChunk('IDAT', deflateSync(Buffer.from([0, 255, 0, 0, 255]))),
  pngChunk('IEND', Buffer.alloc(0))
]);
const json = Buffer.from(JSON.stringify({ draw: [{ shape: 'rectangle', color: 'FF0000', thickness: 6, x: 0, y: 0, width: 5, height: 5 }] }, null, 2));

async function outputRoot(t) {
  await mkdir(tmpRoot, { recursive: true });
  const directory = await mkdtemp(join(tmpRoot, 'annoforge-export-test-'));
  // このテストが作成した専用ディレクトリだけを片付ける。
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

function mockTools({ pngBytes = png, jsonBytes = json, mutateManifest, mutateChunk, failRelease = false } = {}) {
  const calls = [];
  const bytes = { png: pngBytes, json: jsonBytes };
  let manifest;
  return {
    calls,
    async callTool(name, input) {
      calls.push({ name, input });
      if (name === 'prepare_annotation_export') {
        manifest = {
          outcome: 'export_prepared', exportId: 'test-export', revision: 7, annotationCount: 1,
          artifacts: Object.fromEntries(['png', 'json'].map(format => [format, {
            filename: format === 'png' ? '日本語の画像-annotated.png' : '日本語の画像-annotations.json',
            mimeType: format === 'png' ? 'image/png' : 'application/json',
            byteLength: bytes[format].length,
            sha256: createHash('sha256').update(bytes[format]).digest('hex'),
            ...(format === 'png' ? { width: 1, height: 1 } : {})
          }]))
        };
        mutateManifest?.(manifest);
        return manifest;
      }
      if (name === 'read_annotation_export') {
        const data = bytes[input.format];
        const nextOffset = Math.min(input.offset + input.maxBytes, data.length);
        const chunk = {
          exportId: manifest.exportId, revision: manifest.revision, format: input.format,
          offset: input.offset, nextOffset, eof: nextOffset === data.length,
          base64: data.subarray(input.offset, nextOffset).toString('base64')
        };
        mutateChunk?.(chunk);
        return chunk;
      }
      if (name === 'release_annotation_export') {
        if (failRelease) throw new Error('release failed');
        return { exportId: input.exportId, released: true };
      }
      throw new Error(`Unexpected tool: ${name}`);
    }
  };
}

test('文書のCUA接続例でJSON文字列を解析し、revision取得からPNG・JSON保存と解放まで実行できる', async t => {
  const outputDirectory = await outputRoot(t);
  const { result, calls } = await runConnectionExample(outputDirectory);
  assert.equal(result.outcome, 'files_verified');
  assert.equal(result.revision, 7);
  assert.equal(result.releaseWarning, undefined);
  assert.deepEqual(await readFile(result.files.png.path), png);
  assert.deepEqual(await readFile(result.files.json.path), json);
  assert.deepEqual(calls, ['get_annotations', 'prepare_annotation_export',
    'read_annotation_export', 'read_annotation_export', 'release_annotation_export']);
});

for (const failedTool of ['get_annotations', 'prepare_annotation_export', 'read_annotation_export']) {
  test(`接続例は${failedTool}の不正なJSON文字列を成功扱いせず、出力を残さない`, async t => {
    const outputDirectory = await outputRoot(t);
    const calls = [];
    await assert.rejects(runConnectionExample(outputDirectory, (name, result) => {
      calls.push(name);
      return name === failedTool ? '{broken' : JSON.stringify(result);
    }), SyntaxError);
    assert.deepEqual(await readdir(outputDirectory), []);
    if (failedTool === 'read_annotation_export') assert.equal(calls.at(-1), 'release_annotation_export');
    if (failedTool === 'get_annotations') assert.deepEqual(calls, ['get_annotations']);
  });
}

test('接続例は解放結果のJSON解析失敗を、検証済みファイル取得とは分けて報告する', async t => {
  const outputDirectory = await outputRoot(t);
  const { result } = await runConnectionExample(outputDirectory,
    (name, value) => name === 'release_annotation_export' ? '{broken' : JSON.stringify(value));
  assert.equal(result.outcome, 'files_verified');
  assert.match(result.releaseWarning, /SyntaxError/);
  assert.deepEqual(await readFile(result.files.png.path), png);
  assert.deepEqual(await readFile(result.files.json.path), json);
});

test('PNGとJSONの実バイト列を保存し、絶対パスを返し、準備済み出力を解放する', async t => {
  const outputDirectory = await outputRoot(t);
  const tools = mockTools();
  const result = await receiveAnnotationExport({ callTool: tools.callTool, expectedRevision: 7, outputDirectory });
  assert.equal(result.outcome, 'files_verified');
  assert.equal(result.annotationCount, 1);
  assert.deepEqual(await readFile(result.files.png.path), png);
  assert.deepEqual(await readFile(result.files.json.path), json);
  assert.match(result.markdown, /^!\[注釈付きPNG\]\(<\//);
  assert.match(result.markdown, /\[PNG\]\(<.*>\) · \[JSON\]\(<.*>\)$/);
  const destinations = [...result.markdown.matchAll(/\(<([^>]+)>\)/g)].map(match => decodeURIComponent(match[1]));
  assert.deepEqual(destinations, [result.files.png.path, result.files.png.path, result.files.json.path]);
  assert.equal(tools.calls.at(-1).name, 'release_annotation_export');
  assert.ok(tools.calls.every(call => !call.name.includes('download')));
});

test('空白・日本語・括弧・URL区切りを含む実パスから安全な画像とファイルリンクを生成する', async t => {
  const root = await outputRoot(t);
  const outputDirectory = join(root, '表示 (確認) #1 %');
  const tools = mockTools({ mutateManifest: manifest => {
    manifest.artifacts.png.filename = '画像 [完成](1) #100% &copy;.png';
    manifest.artifacts.json.filename = '注釈 [完成](1) #100% &copy;.json';
  } });
  const result = await receiveAnnotationExport({ callTool: tools.callTool, expectedRevision: 7, outputDirectory });
  const destinations = [...result.markdown.matchAll(/\(<([^>]+)>\)/g)].map(match => match[1]);
  assert.equal(destinations.length, 3);
  assert.deepEqual(destinations.map(decodeURIComponent), [result.files.png.path, result.files.png.path, result.files.json.path]);
  assert.ok(destinations.every(path => !/[\s()#&\[\]]/.test(path)));
  assert.deepEqual(await readFile(result.files.png.path), png);
  assert.deepEqual(await readFile(result.files.json.path), json);
  assert.doesNotMatch(result.markdown, /data:|base64|```/);
});

test('再実行しても既存ファイルを上書きせず、別の出力先を作る', async t => {
  const outputDirectory = await outputRoot(t);
  const sentinelPath = join(outputDirectory, 'annotated.png');
  await writeFile(sentinelPath, 'keep');
  const first = await receiveAnnotationExport({ callTool: mockTools().callTool, expectedRevision: 7, outputDirectory });
  const second = await receiveAnnotationExport({ callTool: mockTools().callTool, expectedRevision: 7, outputDirectory });
  assert.notEqual(first.directory, second.directory);
  assert.equal(await readFile(sentinelPath, 'utf8'), 'keep');
  assert.deepEqual(await readFile(first.files.png.path), png);
});

test('12 MiBを超えるデータも小さい範囲ごとに受信できる', async t => {
  const outputDirectory = await outputRoot(t);
  // 正規のtEXtチャンクを加え、画像の寸法とは独立に大きなファイルを検証する。
  const large = Buffer.concat([png.subarray(0, -12), pngChunk('tEXt', Buffer.concat([Buffer.from('Comment\0'), Buffer.alloc(13 * 1024 * 1024, 65)])), png.subarray(-12)]);
  const tools = mockTools({ pngBytes: large });
  const result = await receiveAnnotationExport({ callTool: tools.callTool, expectedRevision: 7, outputDirectory });
  assert.deepEqual(await readFile(result.files.png.path), large);
  const pngCalls = tools.calls.filter(call => call.name === 'read_annotation_export' && call.input.format === 'png');
  assert.ok(pngCalls.length > 48);
  assert.ok(pngCalls.every(call => call.input.maxBytes === 256 * 1024));
});

const invalidCases = [
  ['revision不一致', { mutateManifest: m => { m.revision++; } }],
  ['保存先を抜ける名前', { mutateManifest: m => { m.artifacts.png.filename = '../outside.png'; } }],
  ['異なる画像の寸法', { mutateManifest: m => { m.artifacts.png.width++; } }],
  ['ハッシュ不一致', { mutateManifest: m => { m.artifacts.png.sha256 = '0'.repeat(64); } }],
  ['JSONの件数不一致', { mutateManifest: m => { m.annotationCount++; } }],
  ['JSONの構文破損', { jsonBytes: Buffer.from('{broken') }],
  ['PNGの終端欠落', { pngBytes: png.subarray(0, -12) }],
  ['PNGチャンクの破損', { pngBytes: Buffer.from(png).fill(0, 29, 33) }],
  ['取得中の版変更', { mutateChunk: c => { c.revision++; } }],
  ['出力IDの取り違え', { mutateChunk: c => { c.exportId = 'other'; } }],
  ['範囲の飛び越し', { mutateChunk: c => { c.offset++; } }],
  ['終端の誤り', { mutateChunk: c => { c.eof = false; } }],
  ['base64の切り詰め', { mutateChunk: c => { c.base64 = c.base64.slice(0, -4); } }],
  ['非正規base64', { mutateChunk: c => { c.base64 += '\n'; } }]
];
for (const [name, options] of invalidCases) {
  test(`${name}を成功扱いせず、不完全ファイルを削除して解放する`, async t => {
    const outputDirectory = await outputRoot(t);
    const tools = mockTools(options);
    await assert.rejects(receiveAnnotationExport({ callTool: tools.callTool, expectedRevision: 7, outputDirectory }));
    assert.deepEqual(await readdir(outputDirectory), []);
    assert.equal(tools.calls.at(-1).name, 'release_annotation_export');
  });
}

test('ページ内バッファの解放失敗を、検証済みファイルの取得失敗と混同しない', async t => {
  const outputDirectory = await outputRoot(t);
  const tools = mockTools({ failRelease: true });
  const result = await receiveAnnotationExport({ callTool: tools.callTool, expectedRevision: 7, outputDirectory });
  assert.equal(result.outcome, 'files_verified');
  assert.match(result.releaseWarning, /release failed/);
  assert.match(result.markdown, /^!\[注釈付きPNG\]/);
  assert.deepEqual(await readFile(result.files.png.path), png);
});

test('相対パスはツール実行前に拒否する', async () => {
  const tools = mockTools();
  await assert.rejects(receiveAnnotationExport({ callTool: tools.callTool, expectedRevision: 7, outputDirectory: 'relative' }));
  assert.equal(tools.calls.length, 0);
});

for (const failedTool of ['get_annotations', 'prepare_annotation_export', 'read_annotation_export']) {
  test(`接続例は${failedTool}のエラーJSONのcodeと理由を保持し、不完全ファイルを残さない`, async t => {
    const outputDirectory = await outputRoot(t);
    const calls = [];
    await assert.rejects(runConnectionExample(outputDirectory, (name, result) => {
      calls.push(name);
      return JSON.stringify(name === failedTool
        ? { error: { code: 'REVISION_CONFLICT', message: '作業状態が更新されました' } } : result);
    }), error => error.code === 'REVISION_CONFLICT' && /作業状態が更新/.test(error.message));
    assert.deepEqual(await readdir(outputDirectory), []);
    if (failedTool === 'read_annotation_export') assert.equal(calls.at(-1), 'release_annotation_export');
    else assert.equal(calls.at(-1), failedTool);
  });
}

test('接続例は解放のエラーJSONを警告として保持し、取得済みファイルを成功のまま残す', async t => {
  const outputDirectory = await outputRoot(t);
  const { result } = await runConnectionExample(outputDirectory, (name, value) => JSON.stringify(
    name === 'release_annotation_export' ? { error: { code: 'INTERNAL_ERROR', message: '解放を完了できません' } } : value));
  assert.equal(result.outcome, 'files_verified');
  assert.match(result.releaseWarning, /INTERNAL_ERROR.*解放を完了できません/);
  assert.deepEqual(await readFile(result.files.png.path), png);
  assert.deepEqual(await readFile(result.files.json.path), json);
});

test('読取りと解放の両方のエラーJSONを失わず、不完全ファイルだけを削除する', async t => {
  const outputDirectory = await outputRoot(t);
  const sentinelPath = join(outputDirectory, 'keep.txt');
  await writeFile(sentinelPath, 'keep');
  const tools = mockTools();
  await assert.rejects(receiveAnnotationExport({ expectedRevision: 7, outputDirectory,
    callTool: async (name, input) => {
      if (name === 'read_annotation_export') return { error: { code: 'EXPORT_UNAVAILABLE', message: '出力が無効です' } };
      if (name === 'release_annotation_export') return { error: { code: 'INTERNAL_ERROR', message: '解放できません' } };
      return tools.callTool(name, input);
    }
  }), error => {
    assert.ok(error instanceof AggregateError);
    assert.deepEqual(error.errors.map(item => item.code), ['EXPORT_UNAVAILABLE', 'INTERNAL_ERROR']);
    return true;
  });
  assert.deepEqual(await readdir(outputDirectory), ['keep.txt']);
  assert.equal(await readFile(sentinelPath, 'utf8'), 'keep');
});

test('不正なエラーJSONを成功結果として扱わない', () => {
  for (const error of [null, false, '', [], {}, { code: 'INVALID_INPUT' },
    { code: 'INVALID_INPUT', message: '' }, { code: 'bad code', message: '失敗' }]) {
    assert.throws(() => assertToolSuccess({ error }), /エラー結果が不正/);
  }
  const success = { exportId: 'released', released: false };
  assert.equal(assertToolSuccess(success), success);
});

test('取消しなどの拒否理由がfalse・0・空文字・nullでも受信失敗を見落とさず、後処理する', async t => {
  const outputDirectory = await outputRoot(t);
  for (const reason of [false, 0, '', null]) {
    for (const failedTool of ['prepare_annotation_export', 'read_annotation_export']) {
      const tools = mockTools();
      await assert.rejects(receiveAnnotationExport({ expectedRevision: 7, outputDirectory,
        callTool: (name, input) => name === failedTool ? Promise.reject(reason) : tools.callTool(name, input)
      }), error => error === reason);
      assert.deepEqual(await readdir(outputDirectory), []);
      if (failedTool === 'read_annotation_export') assert.equal(tools.calls.at(-1).name, 'release_annotation_export');
      else assert.deepEqual(tools.calls, []);
    }
  }
});
