locals {
  prefix_norm = var.output_prefix == "" ? "" : (
    substr(var.output_prefix, -1, 1) == "/" ? var.output_prefix : "${var.output_prefix}/"
  )
  s3_objects_arn = "arn:${data.aws_partition.current.partition}:s3:::${var.output_bucket}/${local.prefix_norm}*"
}

data "aws_partition" "current" {}
data "aws_caller_identity" "current" {}

# Lambdaコードをzip化（lambda ディレクトリ）
data "archive_file" "lambda_zip" {
  type        = "zip"
  source_dir  = "${path.module}/../../lambda"
  output_path = "${path.module}/build/lambda.zip"
}

# IAMロール
resource "aws_iam_role" "lambda" {
  name               = "${var.function_name}-exec"
  assume_role_policy = jsonencode({
    Version = "2012-10-17",
    Statement = [{
      Effect = "Allow",
      Principal = { Service = "lambda.amazonaws.com" },
      Action = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "basic_logs" {
  role       = aws_iam_role.lambda.name
  policy_arn = "arn:${data.aws_partition.current.partition}:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "s3_put_get" {
  name = "${var.function_name}-s3-put-get"
  role = aws_iam_role.lambda.id
  policy = jsonencode({
    Version = "2012-10-17",
    Statement = [
      {
        Sid      = "S3PutGetObject",
        Effect   = "Allow",
        Action   = ["s3:PutObject", "s3:GetObject"],
        Resource = local.s3_objects_arn
      }
    ]
  })
}

# Pillowレイヤー（既存or新規）
resource "aws_lambda_layer_version" "pillow" {
  count               = var.existing_layer_arn == "" ? 1 : 0
  layer_name          = "${var.function_name}-pillow"
  filename            = var.pillow_layer_zip_path
  compatible_runtimes = ["python3.13"]
  compatible_architectures = [var.architecture]
  description         = "Pillow runtime layer"
}

locals {
  layer_arn = var.existing_layer_arn != "" ? var.existing_layer_arn : aws_lambda_layer_version.pillow[0].arn
}

# CloudWatch Logs（保持日数）
resource "aws_cloudwatch_log_group" "fn" {
  name              = "/aws/lambda/${var.function_name}"
  retention_in_days = var.log_retention_days
}

# Lambda本体（SnapStart: PublishedVersions）
resource "aws_lambda_function" "api" {
  function_name = var.function_name
  role          = aws_iam_role.lambda.arn
  runtime       = "python3.13"
  handler       = "handler.handler"

  filename         = data.archive_file.lambda_zip.output_path
  source_code_hash = data.archive_file.lambda_zip.output_base64sha256

  publish = true

  timeout      = var.lambda_timeout_seconds
  memory_size  = var.lambda_memory_mb
  layers       = [local.layer_arn]
  architectures = [var.architecture]

  ephemeral_storage {
    size = var.lambda_tmp_mb
  }

  environment {
    variables = {
      OUTPUT_BUCKET                  = var.output_bucket
      OUTPUT_PREFIX                  = var.output_prefix
      RESULT_FORMAT                  = var.result_format
      PRESIGN_TTL_DEFAULT_SECONDS    = tostring(var.presign_ttl_default_seconds)
      PRESIGN_TTL_MAX_SECONDS        = tostring(var.presign_ttl_max_seconds)
      TTL_SAFETY_MARGIN_SECONDS      = tostring(var.ttl_safety_margin_seconds)
      IMAGE_URL_ALLOW_REGEX          = var.image_url_allow_regex
      MAX_IMAGE_BYTES                = tostring(var.max_image_bytes)
      CORS_ALLOW_ORIGINS             = join(",", var.cors_allow_origins)
      INTERNAL_CORS_ENABLED          = tostring(var.internal_cors_enabled)
    }
  }

  snap_start {
    apply_on = "PublishedVersions"
  }
}

# 公開用エイリアス（SnapStartは公開版で有効化）
resource "aws_lambda_alias" "prod" {
  name             = var.alias_name
  function_name    = aws_lambda_function.api.function_name
  function_version = aws_lambda_function.api.version
}

# Function URL（公開、CORS）
resource "aws_lambda_function_url" "url" {
  function_name      = aws_lambda_function.api.function_name
  qualifier          = aws_lambda_alias.prod.name
  authorization_type = "NONE"

  cors {
    allow_origins     = var.cors_allow_origins
    allow_methods     = ["POST"]
    allow_headers     = ["Content-Type", "Origin"]
    allow_credentials = false
    max_age           = 600
  }
}

# 出力用S3バケット（SSE-S3/AES256, PublicAccessBlock, force_destroy）
resource "aws_s3_bucket" "output" {
  bucket        = var.output_bucket
  force_destroy = true
}

resource "aws_s3_bucket_public_access_block" "output" {
  bucket = aws_s3_bucket.output.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "output" {
  bucket = aws_s3_bucket.output.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}
