variable "aws_region" {
  description = "AWSリージョン"
  type        = string
}

variable "function_name" {
  description = "Lambda関数名"
  type        = string
  default     = "annoforge-api"
}

variable "alias_name" {
  description = "公開に使うエイリアス名。SnapStartは公開版で有効です。"
  type        = string
  default     = "prod"
}

variable "output_bucket" {
  description = "出力先S3バケット名。必須です。"
  type        = string
}

variable "output_prefix" {
  description = "出力プレフィックス。任意です。末尾スラッシュは不要です。"
  type        = string
  default     = ""
}

variable "result_format" {
  description = "出力画像形式。png または jpeg。"
  type        = string
  default     = "png"
}

variable "presign_ttl_default_seconds" {
  description = "presigned URLの既定TTL。単位は秒です。"
  type        = number
  default     = 3600
}

variable "presign_ttl_max_seconds" {
  description = "presigned URLの最大TTL。単位は秒です。604800以下にしてください。"
  type        = number
  default     = 86400
}

variable "ttl_safety_margin_seconds" {
  description = "資格情報残存時間から差し引く安全マージン。単位は秒です。"
  type        = number
  default     = 300
}

variable "image_url_allow_regex" {
  description = "画像URL許可の正規表現。未設定時は https のみ許可します。"
  type        = string
  default     = ""
}

variable "max_image_bytes" {
  description = "入力画像の最大バイト数。既定は10MiBです。"
  type        = number
  default     = 10485760
}

variable "lambda_timeout_seconds" {
  description = "Lambdaタイムアウト。単位は秒です。"
  type        = number
  default     = 30
}

variable "lambda_memory_mb" {
  description = "Lambdaメモリ。単位はMBです。"
  type        = number
  default     = 1024
}

variable "lambda_tmp_mb" {
  description = "/tmpサイズ。単位はMBです。SnapStartは512MB超と非互換です。"
  type        = number
  default     = 512
}

variable "architecture" {
  description = "Lambdaアーキテクチャ。arm64 または x86_64。既定は arm64 です。Graviton を推奨します。"
  type        = string
  default     = "arm64"
  validation {
    condition     = contains(["arm64", "x86_64"], var.architecture)
    error_message = "architecture は arm64 か x86_64 を指定してください。"
  }
}

variable "log_retention_days" {
  description = "CloudWatch Logsの保持日数"
  type        = number
  default     = 14
}

variable "cors_allow_origins" {
  description = "Function URLのCORS許可オリジン"
  type        = list(string)
  default     = ["*"]
}

variable "internal_cors_enabled" {
  description = "関数内でCORSヘッダを返すか。URL側に寄せる場合は false を推奨します。"
  type        = bool
  default     = false
}

variable "existing_layer_arn" {
  description = "既存のPillowレイヤーARN。指定時は新規作成せずこれを使用。"
  type        = string
  default     = ""
}

variable "pillow_layer_zip_path" {
  description = "Pillowレイヤーzipのローカルパス。existing_layer_arn未指定時に使用。"
  type        = string
  default     = ""
}
