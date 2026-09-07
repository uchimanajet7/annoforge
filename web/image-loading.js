// UIとWebMCPで共有する画像入力。通常のfile://利用でも読み込める形式にする。
globalThis.AnnoForgeImageLoading = (() => {
  const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
  const MAX_DATA_URL_LENGTH = 12 * 1024 * 1024;
  const IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

  function parseImageUrl(value) {
    let parsed;
    try {
      if (typeof value !== 'string' || !value.trim()) throw new TypeError();
      parsed = new URL(value.trim());
    } catch {
      throw new TypeError('画像URLには有効な絶対URLを入力してください');
    }
    if (parsed.username || parsed.password) {
      throw new TypeError('画像URLにユーザー名またはパスワードを含めることはできません');
    }
    if (parsed.protocol === 'https:') return parsed;
    const pageUrl = new URL(globalThis.location.href);
    if (parsed.protocol === 'http:' && pageUrl.protocol === 'http:' &&
        ['127.0.0.1', 'localhost', '[::1]'].includes(pageUrl.hostname) && parsed.origin === pageUrl.origin) {
      return parsed;
    }
    throw new TypeError('画像URLにはHTTPSを使用してください。ローカルHTTPページでは同一オリジンの画像も開けます');
  }

  function validateDataUrl(value) {
    if (typeof value !== 'string' || value.length === 0) throw new TypeError('dataUrl は空でないData URL文字列である必要があります');
    if (value.length > MAX_DATA_URL_LENGTH) throw new RangeError('dataUrl は12 × 1024 × 1024文字以下である必要があります');
    const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]*={0,2})$/.exec(value);
    if (!match) throw new TypeError('dataUrl はPNG、JPEG、WebPのbase64 Data URLである必要があります');
    let size;
    try { size = atob(match[2]).length; }
    catch { throw new TypeError('dataUrl のbase64データが不正です'); }
    if (!size) throw new TypeError('dataUrl の画像データが空です');
    if (size > MAX_IMAGE_BYTES) throw new RangeError('dataUrl の画像データは12 MiB以下である必要があります');
    return value;
  }

  function throwIfAborted(signal) {
    if (signal?.aborted) throw signal.reason || new DOMException('画像の読み込みをキャンセルしました', 'AbortError');
  }

  function decodeImage(source, signal) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      const cleanup = () => {
        image.onload = null;
        image.onerror = null;
        signal?.removeEventListener('abort', onAbort);
      };
      const onAbort = () => {
        cleanup();
        image.src = '';
        reject(signal.reason);
      };
      image.onload = () => {
        cleanup();
        if (!image.naturalWidth || !image.naturalHeight) reject(new Error('画像の寸法を取得できません'));
        else resolve(image);
      };
      image.onerror = () => {
        cleanup();
        reject(new Error('取得したデータを画像としてデコードできません'));
      };
      if (signal?.aborted) { onAbort(); return; }
      signal?.addEventListener('abort', onAbort, { once: true });
      image.src = source;
    });
  }

  async function fetchImageBlob(url, signal) {
    let response;
    try {
      response = await fetch(url.href, {
        method: 'GET', mode: 'cors', credentials: 'omit',
        referrerPolicy: 'no-referrer', cache: 'no-store', signal
      });
    } catch {
      throwIfAborted(signal);
      throw new Error('画像URLを取得できません。URL、ネットワーク、または配信元のCORS設定を確認してください');
    }
    throwIfAborted(signal);
    if (!response.ok) throw new Error(`画像URLの取得に失敗しました（HTTP ${response.status}）`);
    parseImageUrl(response.url || url.href);
    const contentType = (response.headers.get('content-type') || '').split(';', 1)[0].trim().toLowerCase();
    if (!IMAGE_MIME_TYPES.has(contentType)) throw new TypeError('画像URLはPNG、JPEG、WebPの画像を直接返す必要があります');
    if (Number(response.headers.get('content-length')) > MAX_IMAGE_BYTES) throw new RangeError('画像URLのデータは12 MiB以下である必要があります');
    const blob = await response.blob();
    throwIfAborted(signal);
    if (!blob.size) throw new TypeError('画像URLから空のデータが返されました');
    if (blob.size > MAX_IMAGE_BYTES) throw new RangeError('画像URLのデータは12 MiB以下である必要があります');
    return blob;
  }

  function createLoader({ getVersion, commitImage }) {
    let active = null;
    function assertVersion(expectedVersion) {
      if (getVersion() !== expectedVersion) throw new Error('作業内容が変更されたため画像を開きませんでした。現在の作業を確認して、もう一度実行してください');
    }
    function cancel() {
      active?.abort(new DOMException('画像の読み込みをキャンセルしました', 'AbortError'));
    }
    async function load(source, { expectedVersion = getVersion(), signal } = {}) {
      // 不正入力や事前の競合・取消しでは、進行中の有効な読込みを妨げない。
      let input;
      if (source.kind === 'url') input = parseImageUrl(source.value);
      else if (source.kind === 'data_url') input = validateDataUrl(source.value);
      else if (source.kind === 'file' && source.value instanceof Blob && (source.value.type || '').startsWith('image/')) input = source.value;
      else throw new TypeError('画像ファイルを選択してください');
      throwIfAborted(signal);
      assertVersion(expectedVersion);

      active?.abort(new DOMException('別の画像の読み込みを開始したため、この読み込みをキャンセルしました', 'AbortError'));
      const operation = new AbortController();
      active = operation;
      const onAbort = () => operation.abort(signal.reason);
      signal?.addEventListener('abort', onAbort, { once: true });
      let objectUrl;
      try {
        let imageSource = input;
        if (source.kind !== 'data_url') {
          const blob = source.kind === 'url' ? await fetchImageBlob(input, operation.signal) : input;
          throwIfAborted(operation.signal);
          objectUrl = URL.createObjectURL(blob);
          imageSource = objectUrl;
        }
        const image = await decodeImage(imageSource, operation.signal);
        throwIfAborted(operation.signal);
        assertVersion(expectedVersion);
        return commitImage(image, source.kind === 'file' ? input.name || '' : '');
      } finally {
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        signal?.removeEventListener('abort', onAbort);
        if (active === operation) active = null;
      }
    }
    return { load, cancel };
  }

  return { createLoader, parseImageUrl, decodeImage, MAX_DATA_URL_LENGTH };
})();
