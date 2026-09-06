import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { crc32, deflateSync } from 'node:zlib';
import { receiveAnnotationExport } from '../scripts/tools/web/receive-annotation-export.mjs';

const tmpRoot = process.env.ANNOFORGE_TEST_TMP_DIR || tmpdir();
assert.ok(isAbsolute(tmpRoot), 'ANNOFORGE_TEST_TMP_DIRには絶対パスを指定してください');
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

test('PNGとJSONの実バイト列を保存し、絶対パスを返し、準備済み出力を解放する', async t => {
  const outputDirectory = await outputRoot(t);
  const tools = mockTools();
  const result = await receiveAnnotationExport({ callTool: tools.callTool, expectedRevision: 7, outputDirectory });
  assert.equal(result.outcome, 'files_verified');
  assert.equal(result.annotationCount, 1);
  assert.deepEqual(await readFile(result.files.png.path), png);
  assert.deepEqual(await readFile(result.files.json.path), json);
  assert.equal(tools.calls.at(-1).name, 'release_annotation_export');
  assert.ok(tools.calls.every(call => !call.name.includes('download')));
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
  assert.deepEqual(await readFile(result.files.png.path), png);
});

test('相対パスはツール実行前に拒否する', async () => {
  const tools = mockTools();
  await assert.rejects(receiveAnnotationExport({ callTool: tools.callTool, expectedRevision: 7, outputDirectory: 'relative' }));
  assert.equal(tools.calls.length, 0);
});
