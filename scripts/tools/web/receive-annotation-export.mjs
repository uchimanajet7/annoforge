import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, open, readFile, realpath, rmdir, unlink } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { crc32 } from 'node:zlib';

const CHUNK_BYTES = 256 * 1024;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}

function validateManifest(result, expectedRevision) {
  requireValue(result?.outcome === 'export_prepared', 'PNG/JSONの出力準備結果ではありません');
  requireValue(typeof result.exportId === 'string' && result.exportId.length > 0, 'exportIdがありません');
  requireValue(result.revision === expectedRevision, '出力のrevisionが要求と一致しません');
  requireValue(Number.isSafeInteger(result.annotationCount) && result.annotationCount >= 0, '注釈数が不正です');
  for (const format of ['png', 'json']) {
    const artifact = result.artifacts?.[format];
    requireValue(artifact?.mimeType === (format === 'png' ? 'image/png' : 'application/json'), `${format}のMIME型が不正です`);
    requireValue(Number.isSafeInteger(artifact.byteLength) && artifact.byteLength > 0, `${format}のバイト数が不正です`);
    requireValue(typeof artifact.sha256 === 'string' && /^[a-f0-9]{64}$/.test(artifact.sha256), `${format}のSHA-256が不正です`);
    // サイト由来の名前で、指定された出力ディレクトリの外へ書き込ませない。
    requireValue(typeof artifact.filename === 'string' && artifact.filename.length > 0 &&
      !/[\\/:\x00-\x1f\x7f<>"|?*]/.test(artifact.filename) &&
      artifact.filename.toLowerCase().endsWith(`.${format}`), `${format}のファイル名が不正です`);
  }
  const png = result.artifacts.png;
  requireValue(Number.isSafeInteger(png.width) && png.width > 0 && Number.isSafeInteger(png.height) && png.height > 0, 'PNGの寸法が不正です');
}

function validateChunk(chunk, manifest, format, offset) {
  const artifact = manifest.artifacts[format];
  requireValue(chunk?.exportId === manifest.exportId && chunk.revision === manifest.revision && chunk.format === format, '取得したデータの出力識別子が一致しません');
  requireValue(chunk.offset === offset && Number.isSafeInteger(chunk.nextOffset) &&
    chunk.nextOffset > offset && chunk.nextOffset <= Math.min(offset + CHUNK_BYTES, artifact.byteLength), '取得したデータのバイト範囲が不正です');
  requireValue(chunk.eof === (chunk.nextOffset === artifact.byteLength), '取得したデータの終端が不正です');
  requireValue(typeof chunk.base64 === 'string' && chunk.base64.length <= Math.ceil(CHUNK_BYTES / 3) * 4, 'base64データが不正です');
  const bytes = Buffer.from(chunk.base64, 'base64');
  requireValue(bytes.toString('base64') === chunk.base64 && bytes.length === chunk.nextOffset - offset, 'データの切り詰めまたはbase64の破損を検出しました');
  return bytes;
}

function validateFile(bytes, artifact, format, annotationCount) {
  requireValue(bytes.length === artifact.byteLength, `${format}の保存後バイト数が一致しません`);
  requireValue(createHash('sha256').update(bytes).digest('hex') === artifact.sha256, `${format}の保存後SHA-256が一致しません`);
  if (format === 'png') {
    requireValue(bytes.length >= 45 && bytes.subarray(0, 8).equals(PNG_SIGNATURE) &&
      bytes.readUInt32BE(8) === 13 && bytes.toString('ascii', 12, 16) === 'IHDR' &&
      bytes.subarray(-12).equals(Buffer.from('0000000049454e44ae426082', 'hex')), 'PNGのヘッダーまたは終端が不正です');
    requireValue(bytes.readUInt32BE(16) === artifact.width && bytes.readUInt32BE(20) === artifact.height, '保存PNGの寸法が一致しません');
    let offset = 8;
    let hasImageData = false;
    while (offset < bytes.length) {
      requireValue(offset + 12 <= bytes.length, 'PNGチャンクが切り詰められています');
      const length = bytes.readUInt32BE(offset);
      const end = offset + length + 12;
      requireValue(end <= bytes.length, 'PNGチャンクの長さが不正です');
      const type = bytes.toString('ascii', offset + 4, offset + 8);
      requireValue(crc32(bytes.subarray(offset + 4, end - 4)) === bytes.readUInt32BE(end - 4), 'PNGチャンクのCRCが一致しません');
      if (type === 'IDAT') hasImageData = true;
      if (type === 'IEND') requireValue(end === bytes.length, 'PNG終端の後に余分なデータがあります');
      offset = end;
    }
    requireValue(hasImageData, 'PNGの画像データがありません');
  } else {
    const document = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    requireValue(document !== null && Array.isArray(document.draw) && document.draw.length === annotationCount, '保存JSONのdraw配列と注釈数が一致しません');
  }
}

/**
 * WebMCPの戻り値をモデルへ全文展開せず、同じ実行環境で保存する受信処理。
 * callToolには、接続済みページの公開Site tools呼出しを渡す。
 * ブラウザー接続、任意URLへの通信、クリップボード、設定変更は行わない。
 */
export async function receiveAnnotationExport({ callTool, expectedRevision, outputDirectory }) {
  requireValue(typeof callTool === 'function', '公開Site toolsを呼び出す関数が必要です');
  requireValue(Number.isSafeInteger(expectedRevision) && expectedRevision >= 0, 'expectedRevisionが不正です');
  requireValue(typeof outputDirectory === 'string' && isAbsolute(outputDirectory), '明示的な出力先の絶対パスが必要です');
  let manifest;
  let directory;
  let result;
  let failure;
  const createdFiles = [];
  try {
    manifest = await callTool('prepare_annotation_export', { expectedRevision });
    validateManifest(manifest, expectedRevision);
    await mkdir(outputDirectory, { recursive: true });
    directory = await mkdtemp(join(await realpath(outputDirectory), 'annoforge-export-'));
    const files = {};
    for (const format of ['png', 'json']) {
      const artifact = manifest.artifacts[format];
      const path = join(directory, artifact.filename);
      const file = await open(path, 'wx', 0o600);
      createdFiles.push(path);
      try {
        let offset = 0;
        while (offset < artifact.byteLength) {
          const chunk = await callTool('read_annotation_export', {
            exportId: manifest.exportId, format, offset, maxBytes: CHUNK_BYTES
          });
          const bytes = validateChunk(chunk, manifest, format, offset);
          await file.writeFile(bytes);
          offset = chunk.nextOffset;
        }
      } finally {
        await file.close();
      }
      validateFile(await readFile(path), artifact, format, manifest.annotationCount);
      files[format] = { ...artifact, path };
    }
    result = {
      outcome: 'files_verified', revision: manifest.revision,
      annotationCount: manifest.annotationCount, directory, files
    };
  } catch (error) {
    failure = error;
    // 削除するのは、この呼出しが新規作成した不完全ファイルだけ。
    const cleanupErrors = [];
    for (const path of createdFiles) {
      try { await unlink(path); } catch (cleanupError) { cleanupErrors.push(cleanupError); }
    }
    if (directory) {
      try { await rmdir(directory); } catch (cleanupError) { cleanupErrors.push(cleanupError); }
    }
    if (cleanupErrors.length) failure = new AggregateError([error, ...cleanupErrors], '出力の取得に失敗し、一時ファイルの削除も完了していません');
  } finally {
    if (typeof manifest?.exportId === 'string' && manifest.exportId) {
      try {
        const release = await callTool('release_annotation_export', { exportId: manifest.exportId });
        requireValue(release?.exportId === manifest.exportId && typeof release.released === 'boolean', '出力の解放結果が不正です');
      } catch (releaseError) {
        // ファイル取得の成否と、ページ内バッファの解放失敗を混同しない。
        if (failure) failure = new AggregateError([failure, releaseError], '出力取得と準備済みデータの解放に失敗しました');
        else result.releaseWarning = String(releaseError);
      }
    }
  }
  if (failure) throw failure;
  // 会話への添付は呼出し側がこの絶対パスを使用して行う。保存だけで添付済みとはしない。
  return result;
}
