"""
AWS Lambda ハンドラ（画像アノテーション生成 / SnapStart最適化）

・入力: Function URL からの POST JSON
・処理: 画像を取得し、指定のアノテーション（line/rectangle/circle/polygon/parallelogram）を描画
・出力: S3へ保存し、presignedUrl とメタデータを返却

注意:
- 依存は Pillow のみ（Lambda Layer で配布）
- boto3 はランタイム同梱
- 一意値（uuid/token）はハンドラ内で生成（SnapStart 一意性要件順守）
- CORS/SSRF/サイズ上限/TTL動的クランプに対応
"""

from __future__ import annotations

import base64
import boto3
import botocore
import io
import json
import os
import re
import secrets
import uuid
import urllib.request
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional, Tuple

from PIL import Image, ImageDraw


# ---- モジュールスコープ（SnapStart 初期化に含めるべき軽量処理） ----
s3 = boto3.client("s3")


# ---- 環境変数の取得（既定値を設定） ----
OUTPUT_BUCKET = os.environ.get("OUTPUT_BUCKET", "")
OUTPUT_PREFIX = os.environ.get("OUTPUT_PREFIX", "")
RESULT_FORMAT_DEFAULT = os.environ.get("RESULT_FORMAT", "png").lower()  # png | jpeg

PRESIGN_TTL_DEFAULT_SECONDS = int(os.environ.get("PRESIGN_TTL_DEFAULT_SECONDS", "3600"))
PRESIGN_TTL_MAX_SECONDS = min(604800, int(os.environ.get("PRESIGN_TTL_MAX_SECONDS", "86400")))  # ≤ 7日
TTL_SAFETY_MARGIN_SECONDS = int(os.environ.get("TTL_SAFETY_MARGIN_SECONDS", "300"))

CORS_ALLOW_ORIGINS = os.environ.get("CORS_ALLOW_ORIGINS", "*")
IMAGE_URL_ALLOW_REGEX = os.environ.get("IMAGE_URL_ALLOW_REGEX", "")
MAX_IMAGE_BYTES = int(os.environ.get("MAX_IMAGE_BYTES", str(10 * 1024 * 1024)))  # 10 MiB 既定

# S3の暗号化は「バケット既定のSSE（SSE-S3/AES256）」に委譲する。
# PutObject時の明示指定は行わない（ヘッダ未指定でも自動暗号化される）。
INTERNAL_CORS_ENABLED = os.environ.get("INTERNAL_CORS_ENABLED", "").lower() in ("1", "true", "yes")


def _cors_headers(origin: Optional[str]) -> Dict[str, str]:
    """CORSヘッダを生成。許可オリジンを環境変数から判定。"""
    if not INTERNAL_CORS_ENABLED:
        return {}
    allow = (CORS_ALLOW_ORIGINS or "").strip()
    headers = {
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Origin",
    }
    if allow == "*":
        headers["Access-Control-Allow-Origin"] = "*"
    elif origin and any(o.strip() == origin for o in allow.split(",")):
        headers["Access-Control-Allow-Origin"] = origin
    return headers


def _response(status: int, body: Dict[str, Any], origin: Optional[str]) -> Dict[str, Any]:
    return {
        "statusCode": status,
        "headers": {"Content-Type": "application/json", **_cors_headers(origin)},
        "body": json.dumps(body, ensure_ascii=False),
    }


def _error(status: int, code: str, message: str, origin: Optional[str]) -> Dict[str, Any]:
    return _response(status, {"error": code, "message": message}, origin)


def _is_https_url(url: str) -> bool:
    return url.startswith("https://")


def _url_allowed(url: str) -> bool:
    # 既定は https のみ許可
    if not _is_https_url(url):
        return False
    pattern = IMAGE_URL_ALLOW_REGEX.strip()
    if not pattern:
        return True
    try:
        return re.match(pattern, url) is not None
    except re.error:
        # 不正な正規表現は全拒否（設定ミス検出のため）
        return False


def _read_http_bytes_with_cap(url: str, max_bytes: int, timeout: float = 10.0) -> bytes:
    """HTTP(S)から最大 max_bytes までを読み込む。超過でエラー。"""
    req = urllib.request.Request(url, headers={
        "User-Agent": "annotation-lambda/1.0",
        "Accept": "image/*,application/octet-stream;q=0.8,*/*;q=0.5",
    })
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        total = 0
        chunks: List[bytes] = []
        while True:
            c = resp.read(64 * 1024)
            if not c:
                break
            total += len(c)
            if total > max_bytes:
                raise ValueError("image too large")
            chunks.append(c)
    return b"".join(chunks)


def _open_image(data: bytes) -> Image.Image:
    bio = io.BytesIO(data)
    im = Image.open(bio)
    # 透過処理も考慮してRGBAに統一
    return im.convert("RGBA")


def _hex_to_rgb(color: str) -> Tuple[int, int, int]:
    s = color.strip()
    if s.startswith("#"):
        s = s[1:]
    if not re.fullmatch(r"[0-9A-Fa-f]{6}", s):
        raise ValueError("invalid color")
    r = int(s[0:2], 16)
    g = int(s[2:4], 16)
    b = int(s[4:6], 16)
    return (r, g, b)


def _draw_line(draw: ImageDraw.ImageDraw, item: Dict[str, Any]) -> None:
    x1 = int(item["x1"]) ; y1 = int(item["y1"]) ; x2 = int(item["x2"]) ; y2 = int(item["y2"]) ; w = int(item["thickness"]) ;
    if w <= 0:
        raise ValueError("thickness must be > 0")
    fill = _hex_to_rgb(item["color"])
    draw.line((x1, y1, x2, y2), fill=fill, width=w)


def _draw_rectangle(draw: ImageDraw.ImageDraw, item: Dict[str, Any]) -> None:
    x = int(item["x"]) ; y = int(item["y"]) ; w = int(item["width"]) ; h = int(item["height"]) ; t = int(item["thickness"]) ;
    if t <= 0 or w <= 0 or h <= 0:
        raise ValueError("invalid rectangle params")
    fill = _hex_to_rgb(item["color"])
    draw.rectangle((x, y, x + w, y + h), outline=fill, width=t)


def _draw_circle(draw: ImageDraw.ImageDraw, item: Dict[str, Any]) -> None:
    cx = int(item["x"]) ; cy = int(item["y"]) ; r = int(item["radius"]) ; t = int(item["thickness"]) ;
    if t <= 0 or r <= 0:
        raise ValueError("invalid circle params")
    fill = _hex_to_rgb(item["color"])
    bbox = (cx - r, cy - r, cx + r, cy + r)
    draw.ellipse(bbox, outline=fill, width=t)


def _iter_pairs(points: List[int]) -> List[Tuple[int, int]]:
    return [(int(points[i]), int(points[i + 1])) for i in range(0, len(points), 2)]


def _draw_closed_polyline(draw: ImageDraw.ImageDraw, pts: List[Tuple[int, int]], color: Tuple[int, int, int], thickness: int) -> None:
    # Pillowの環境差回避のため、明示的に線を繋いで閉路を描く
    for i in range(len(pts)):
        x1, y1 = pts[i]
        x2, y2 = pts[(i + 1) % len(pts)]
        draw.line((x1, y1, x2, y2), fill=color, width=thickness)


def _draw_polygon(draw: ImageDraw.ImageDraw, item: Dict[str, Any]) -> None:
    pts = item.get("points")
    t = int(item["thickness"]) ;
    if not isinstance(pts, list) or len(pts) < 6 or len(pts) % 2 != 0 or t <= 0:
        raise ValueError("invalid polygon params")
    fill = _hex_to_rgb(item["color"]) ;
    pairs = _iter_pairs(pts)
    _draw_closed_polyline(draw, pairs, fill, t)


def _draw_parallelogram(draw: ImageDraw.ImageDraw, item: Dict[str, Any]) -> None:
    pts = item.get("points")
    t = int(item["thickness"]) ;
    if not isinstance(pts, list) or len(pts) % 2 != 0 or t <= 0:
        raise ValueError("invalid parallelogram params")
    # 3点（6要素）の場合は P4 = P3 + (P2 - P1) を自動補完
    if len(pts) == 6:
        p1 = (int(pts[0]), int(pts[1]))
        p2 = (int(pts[2]), int(pts[3]))
        p3 = (int(pts[4]), int(pts[5]))
        p4 = (p3[0] + (p2[0] - p1[0]), p3[1] + (p2[1] - p1[1]))
        pairs = [p1, p2, p4, p3]
    elif len(pts) == 8:
        pairs = _iter_pairs(pts)
    else:
        raise ValueError("invalid parallelogram points length")
    fill = _hex_to_rgb(item["color"]) ;
    _draw_closed_polyline(draw, pairs, fill, t)


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _cred_remaining_seconds() -> Optional[int]:
    """現在の認証情報の残存秒を返す（取得できない場合はNone）。"""
    try:
        # botocore セッションから expiry_time または _expiry_time を参照する。属性がない場合は None として扱う。
        session = botocore.session.get_session()
        cred = session.get_credentials()
        if cred is None:
            return None
        # 注意: FrozenCredentials では expiry_time が失われるため、非フローズンの属性を参照
        expiry = getattr(cred, "_expiry_time", None) or getattr(cred, "expiry_time", None)
        if not expiry:
            return None
        if isinstance(expiry, datetime):
            now = _now_utc()
            remain = int((expiry - now).total_seconds())
            return max(0, remain)
        return None
    except Exception:
        return None


def _clamp_ttl(request_ttl: Optional[int]) -> Tuple[int, int]:
    """要求TTLを動的クランプして (effective_ttl, expires_at_ms) を返す。"""
    req = int(request_ttl) if isinstance(request_ttl, (int, float)) else PRESIGN_TTL_DEFAULT_SECONDS
    ttl_cap = min(PRESIGN_TTL_MAX_SECONDS, 604800)
    ttl = max(1, min(req, ttl_cap))

    remain = _cred_remaining_seconds()
    if remain is not None:
        ttl = max(1, min(ttl, max(0, remain - TTL_SAFETY_MARGIN_SECONDS)))

    now = _now_utc()
    expires_at = now + timedelta(seconds=ttl)
    expires_at_ms = int(expires_at.timestamp() * 1000)
    return ttl, expires_at_ms


def _build_s3_key(ext: str) -> str:
    now = _now_utc()
    y = now.strftime("%Y")
    m = now.strftime("%m")
    d = now.strftime("%d")
    uid = uuid.uuid4().hex
    token = secrets.token_urlsafe(16)
    prefix = OUTPUT_PREFIX or ""
    if prefix and not prefix.endswith("/"):
        prefix += "/"
    return f"{prefix}{y}/{m}/{d}/{uid}_{token}.{ext}"


def _put_s3_and_presign(data: bytes, content_type: str, ext: str, ttl_seconds: int) -> Tuple[str, int]:
    if not OUTPUT_BUCKET:
        raise RuntimeError("OUTPUT_BUCKET is not configured")
    key = _build_s3_key(ext)
    put_kwargs: Dict[str, Any] = {
        "Bucket": OUTPUT_BUCKET,
        "Key": key,
        "Body": data,
        "ContentType": content_type,
    }
    s3.put_object(**put_kwargs)

    url = s3.generate_presigned_url(
        ClientMethod="get_object",
        Params={"Bucket": OUTPUT_BUCKET, "Key": key},
        ExpiresIn=ttl_seconds,
    )
    return url, len(data)


def _parse_body(event: Dict[str, Any]) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
    body = event.get("body")
    if body is None:
        return None, "empty body"
    if event.get("isBase64Encoded"):
        body = base64.b64decode(body).decode("utf-8", errors="replace")
    try:
        return json.loads(body), None
    except Exception:
        return None, "invalid json"


def _route_path(event: Dict[str, Any]) -> str:
    # Function URL イベントは rawPath が入る
    path = event.get("rawPath") or event.get("path") or "/"
    return path


def handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """Lambda エントリポイント。"""
    request_ctx = event.get("requestContext", {})
    http = request_ctx.get("http", {})
    method = http.get("method") or event.get("httpMethod", "GET")
    origin = (event.get("headers") or {}).get("origin") or (event.get("headers") or {}).get("Origin")

    # CORS: プリフライト
    if method == "OPTIONS":
        # Function URL のCORS設定に寄せるため、内部CORSを無効化時は素の204を返す
        headers = _cors_headers(origin)
        resp = {"statusCode": 204, "body": ""}
        if headers:
            resp["headers"] = {**headers, "Access-Control-Max-Age": "600"}
        return resp

    # ルーティング
    path = _route_path(event)
    if method != "POST" or not path.endswith("/annotate"):
        return _error(404, "not_found", "path not found", origin)

    # 本体パース
    body, err = _parse_body(event)
    if err:
        return _error(400, "invalid_request", err, origin)

    image_url = (body or {}).get("imageUrl")
    if not isinstance(image_url, str) or not image_url:
        return _error(400, "invalid_request", "imageUrl is required", origin)
    if not _url_allowed(image_url):
        return _error(422, "validation_error", "imageUrl is not allowed", origin)

    # draw 配列は config.draw または トップレベル draw のどちらでも可
    cfg = (body or {}).get("config") or {}
    draw_items = cfg.get("draw") or (body or {}).get("draw")
    if not isinstance(draw_items, list) or len(draw_items) == 0:
        return _error(400, "invalid_request", "draw array is required", origin)

    # 画像の取得（上限バイト強制）
    try:
        raw = _read_http_bytes_with_cap(image_url, MAX_IMAGE_BYTES)
        base = _open_image(raw)
    except ValueError as e:
        return _error(413, "payload_too_large", str(e), origin)
    except Exception:
        return _error(415, "unsupported_media_type", "failed to load image", origin)

    # 描画
    canvas = base.copy()
    draw = ImageDraw.Draw(canvas)
    try:
        for item in draw_items:
            if not isinstance(item, dict):
                continue
            shape = str(item.get("shape", "")).lower()
            if shape == "line":
                _draw_line(draw, item)
            elif shape == "rectangle":
                _draw_rectangle(draw, item)
            elif shape == "circle":
                _draw_circle(draw, item)
            elif shape == "polygon":
                _draw_polygon(draw, item)
            elif shape == "parallelogram":
                _draw_parallelogram(draw, item)
            else:
                return _error(422, "validation_error", f"unsupported shape: {shape}", origin)
    except ValueError as e:
        return _error(422, "validation_error", str(e), origin)
    except Exception:
        return _error(500, "internal_error", "draw failed", origin)

    # 出力形式の決定
    fmt = str(body.get("resultFormat") or RESULT_FORMAT_DEFAULT or "png").lower()
    if fmt not in ("png", "jpeg"):
        fmt = "png"
    ext = "png" if fmt == "png" else "jpg"
    content_type = "image/png" if fmt == "png" else "image/jpeg"
    out = io.BytesIO()
    try:
        if fmt == "jpeg":
            # JPEGは透過不可のためRGBへ変換
            canvas.convert("RGB").save(out, format="JPEG", quality=90)
        else:
            canvas.save(out, format="PNG")
    except Exception:
        return _error(500, "internal_error", "encode failed", origin)
    data = out.getvalue()

    # TTL クランプと presign
    req_ttl = body.get("ttlSeconds")
    eff_ttl, expires_at_ms = _clamp_ttl(req_ttl)
    try:
        url, size = _put_s3_and_presign(data, content_type, ext, eff_ttl)
    except Exception:
        return _error(500, "internal_error", "s3 put or presign failed", origin)

    # 成功レスポンス
    return _response(200, {
        "presignedUrl": url,
        "metadata": {
            "fileSize": size,
            "expiresAt": expires_at_ms,
            "contentType": content_type,
        }
    }, origin)
