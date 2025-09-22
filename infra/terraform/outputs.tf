output "function_url" {
  description = "Lambda Function URL（エイリアスに紐付け）"
  value       = aws_lambda_function_url.url.function_url
}

output "function_arn" {
  description = "Lambda 関数ARN"
  value       = aws_lambda_function.api.arn
}

output "alias_arn" {
  description = "Lambda エイリアスARN"
  value       = aws_lambda_alias.prod.arn
}

output "layer_arn" {
  description = "使用中のPillowレイヤーARN"
  value       = local.layer_arn
}

