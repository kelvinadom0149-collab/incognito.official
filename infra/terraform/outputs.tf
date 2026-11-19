output "api_url" {
  value = aws_apigatewayv2_api.main.api_endpoint
}
output "media_url" {
  value = "https://${aws_cloudfront_distribution.media.domain_name}"
}
output "database_endpoint" {
  value     = aws_db_instance.main.address
  sensitive = true
}
output "database_identifier" {
  value = aws_db_instance.main.identifier
}
output "developer_role_arn" {
  value = aws_iam_role.developer.arn
}
output "ssm_tunnel_instance_id" {
  value = aws_instance.tunnel.id
}
output "ecr_repository_url" {
  value = aws_ecr_repository.api.repository_url
}
output "ecs_cluster" {
  value = aws_ecs_cluster.main.name
}
output "ecs_service" {
  value = aws_ecs_service.api.name
}
output "secret_arns" {
  value = {
    auth          = aws_secretsmanager_secret.auth.arn
    admin         = aws_secretsmanager_secret.admin.arn
    otp_pepper    = aws_secretsmanager_secret.otp.arn
    whatsapp_token = aws_secretsmanager_secret.whatsapp.arn
  }
  sensitive = true
}
