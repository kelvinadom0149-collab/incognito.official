terraform {
  required_version = ">= 1.8.0"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 6.0" }
  }
}

provider "aws" {
  region = var.aws_region
  default_tags { tags = { Project = var.project_name, ManagedBy = "Terraform" } }
}

data "aws_caller_identity" "current" {}
data "aws_availability_zones" "available" { state = "available" }
data "aws_ssm_parameter" "al2023_arm64" { name = "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-arm64" }

locals {
  name = var.project_name
  azs = slice(data.aws_availability_zones.available.names, 0, 2)
  public_cidrs = ["10.42.0.0/24", "10.42.1.0/24"]
  private_cidrs = ["10.42.16.0/20", "10.42.32.0/20"]
  db_cidrs = ["10.42.64.0/24", "10.42.65.0/24"]
}

resource "aws_vpc" "main" {
  cidr_block = "10.42.0.0/16"
  enable_dns_hostnames = true
  enable_dns_support = true
  tags = { Name = "${local.name}-vpc" }
}
resource "aws_internet_gateway" "main" { vpc_id = aws_vpc.main.id }
resource "aws_subnet" "public" {
  count = 2
  vpc_id = aws_vpc.main.id
  availability_zone = local.azs[count.index]
  cidr_block = local.public_cidrs[count.index]
  map_public_ip_on_launch = false
  tags = { Name = "${local.name}-public-${count.index + 1}" }
}
resource "aws_subnet" "private" {
  count = 2
  vpc_id = aws_vpc.main.id
  availability_zone = local.azs[count.index]
  cidr_block = local.private_cidrs[count.index]
  map_public_ip_on_launch = false
  tags = { Name = "${local.name}-private-${count.index + 1}" }
}
resource "aws_subnet" "database" {
  count = 2
  vpc_id = aws_vpc.main.id
  availability_zone = local.azs[count.index]
  cidr_block = local.db_cidrs[count.index]
  map_public_ip_on_launch = false
  tags = { Name = "${local.name}-database-${count.index + 1}" }
}
resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id
  route { cidr_block = "0.0.0.0/0", gateway_id = aws_internet_gateway.main.id }
}
resource "aws_route_table_association" "public" {
  count = 2
  subnet_id = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}
resource "aws_eip" "nat" { domain = "vpc" }
resource "aws_nat_gateway" "main" {
  allocation_id = aws_eip.nat.id
  subnet_id = aws_subnet.public[0].id
  depends_on = [aws_internet_gateway.main]
}
resource "aws_route_table" "private" {
  vpc_id = aws_vpc.main.id
  route { cidr_block = "0.0.0.0/0", nat_gateway_id = aws_nat_gateway.main.id }
}
resource "aws_route_table_association" "private" {
  count = 2
  subnet_id = aws_subnet.private[count.index].id
  route_table_id = aws_route_table.private.id
}
resource "aws_route_table" "database" { vpc_id = aws_vpc.main.id }
resource "aws_route_table_association" "database" {
  count = 2
  subnet_id = aws_subnet.database[count.index].id
  route_table_id = aws_route_table.database.id
}

resource "aws_security_group" "vpc_link" {
  name = "${local.name}-apigw-link"
  description = "API Gateway VPC link only"
  vpc_id = aws_vpc.main.id
  egress { from_port = 0, to_port = 0, protocol = "-1", cidr_blocks = ["0.0.0.0/0"] }
}
resource "aws_security_group" "alb" {
  name = "${local.name}-internal-alb"
  vpc_id = aws_vpc.main.id
  ingress { from_port = 8000, to_port = 8000, protocol = "tcp", security_groups = [aws_security_group.vpc_link.id] }
}
resource "aws_security_group" "app" {
  name = "${local.name}-api-tasks"
  vpc_id = aws_vpc.main.id
  ingress { from_port = 8000, to_port = 8000, protocol = "tcp", security_groups = [aws_security_group.alb.id] }
}
resource "aws_security_group" "developer_tunnel" {
  name = "${local.name}-developer-ssm"
  vpc_id = aws_vpc.main.id
}
resource "aws_security_group" "db" {
  name = "${local.name}-private-postgres"
  vpc_id = aws_vpc.main.id
  ingress { from_port = 5432, to_port = 5432, protocol = "tcp", security_groups = [aws_security_group.app.id, aws_security_group.developer_tunnel.id] }
}

resource "aws_db_subnet_group" "main" {
  name = "${local.name}-db-subnets"
  subnet_ids = aws_subnet.database[*].id
}
resource "aws_db_parameter_group" "postgres" {
  name = "${local.name}-postgres17"
  family = "postgres17"
  parameter { name = "rds.force_ssl", value = "1" }
}
resource "aws_db_instance" "main" {
  identifier = "${local.name}-postgres"
  engine = "postgres"
  engine_version = "17"
  instance_class = var.db_instance_class
  allocated_storage = 20
  max_allocated_storage = 100
  storage_type = "gp3"
  storage_encrypted = true
  db_name = "marketplace"
  username = "marketplace_owner"
  manage_master_user_password = true
  iam_database_authentication_enabled = true
  db_subnet_group_name = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.db.id]
  parameter_group_name = aws_db_parameter_group.postgres.name
  publicly_accessible = false
  multi_az = false
  backup_retention_period = 7
  copy_tags_to_snapshot = true
  auto_minor_version_upgrade = true
  deletion_protection = true
  skip_final_snapshot = false
  final_snapshot_identifier = "${local.name}-final-snapshot"
  apply_immediately = false
}

resource "aws_s3_bucket" "media" { bucket = "${local.name}-media-${data.aws_caller_identity.current.account_id}-${var.aws_region}" }
resource "aws_s3_bucket_public_access_block" "media" {
  bucket = aws_s3_bucket.media.id
  block_public_acls = true
  block_public_policy = true
  ignore_public_acls = true
  restrict_public_buckets = true
}
resource "aws_s3_bucket_server_side_encryption_configuration" "media" {
  bucket = aws_s3_bucket.media.id
  rule { apply_server_side_encryption_by_default { sse_algorithm = "AES256" } }
}
resource "aws_s3_bucket_versioning" "media" { bucket = aws_s3_bucket.media.id
   versioning_configuration { status = "Enabled" } }
resource "aws_s3_bucket_cors_configuration" "media" {
  bucket = aws_s3_bucket.media.id
  cors_rule { allowed_methods = ["POST"]
  allowed_origins = [var.frontend_origin]
   allowed_headers = ["*"]
   expose_headers = ["ETag"]
   max_age_seconds = 300 }
}
resource "aws_cloudfront_origin_access_control" "media" {
  name = "${local.name}-media-oac"
  origin_access_control_origin_type = "s3"
  signing_behavior = "always"
  signing_protocol = "sigv4"
}
resource "aws_cloudfront_distribution" "media" {
  enabled = true
  comment = "Approved Incognito product images"
  default_root_object = ""
  origin {
    domain_name = aws_s3_bucket.media.bucket_regional_domain_name
    origin_id = "private-media"
    origin_access_control_id = aws_cloudfront_origin_access_control.media.id
  }
  default_cache_behavior {
    target_origin_id = "private-media"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods = ["GET", "HEAD", "OPTIONS"]
    cached_methods = ["GET", "HEAD"]
    compress = true
    forwarded_values { query_string = false
   cookies { forward = "none" } }
  }
  restrictions { geo_restriction { restriction_type = "none" } }
  viewer_certificate { cloudfront_default_certificate = true }
}
resource "aws_s3_bucket_policy" "media_cloudfront" {
  bucket = aws_s3_bucket.media.id
  policy = jsonencode({ Version = "2012-10-17", Statement = [{ Sid = "AllowCloudFrontRead", Effect = "Allow", Principal = { Service = "cloudfront.amazonaws.com" }, Action = "s3:GetObject", Resource = "${aws_s3_bucket.media.arn}/*", Condition = { StringEquals = { "AWS:SourceArn" = aws_cloudfront_distribution.media.arn } } }] })
  depends_on = [aws_s3_bucket_public_access_block.media]
}

resource "aws_ecr_repository" "api" {
  name = "${local.name}-api"
  image_tag_mutability = "IMMUTABLE"
  image_scanning_configuration { scan_on_push = true }
  encryption_configuration { encryption_type = "AES256" }
}
resource "aws_cloudwatch_log_group" "api" { name = "/ecs/${local.name}-api"
   retention_in_days = 30 }
resource "aws_ecs_cluster" "main" { name = "${local.name}-cluster" }
resource "aws_iam_role" "execution" {
  name = "${local.name}-ecs-execution"
  assume_role_policy = jsonencode({ Version = "2012-10-17", Statement = [{ Effect = "Allow", Principal = { Service = "ecs-tasks.amazonaws.com" }, Action = "sts:AssumeRole" }] })
}
resource "aws_iam_role_policy_attachment" "execution_base" {
  role = aws_iam_role.execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}
resource "aws_iam_role" "app" {
  name = "${local.name}-api-runtime"
  assume_role_policy = jsonencode({ Version = "2012-10-17", Statement = [{ Effect = "Allow", Principal = { Service = "ecs-tasks.amazonaws.com" }, Action = "sts:AssumeRole" }] })
}
resource "aws_iam_role_policy" "app_permissions" {
  name = "${local.name}-runtime-minimum"
  role = aws_iam_role.app.id
  policy = jsonencode({ Version = "2012-10-17", Statement = [
    { Effect = "Allow", Action = ["rds-db:connect"], Resource = "arn:aws:rds-db:${var.aws_region}:${data.aws_caller_identity.current.account_id}:dbuser:${aws_db_instance.main.resource_id}/marketplace_api" },
    { Effect = "Allow", Action = ["s3:PutObject"], Resource = "${aws_s3_bucket.media.arn}/products/*" }
  ] })
}
resource "aws_iam_role_policy" "execution_secrets" {
  name = "${local.name}-read-runtime-secrets"
  role = aws_iam_role.execution.id
  policy = jsonencode({ Version = "2012-10-17", Statement = [{ Effect = "Allow", Action = ["secretsmanager:GetSecretValue"], Resource = [aws_secretsmanager_secret.auth.arn, aws_secretsmanager_secret.admin.arn, aws_secretsmanager_secret.otp.arn, aws_secretsmanager_secret.whatsapp.arn] }] })
}
resource "aws_secretsmanager_secret" "auth" { name = "${local.name}/auth-secret" }
resource "aws_secretsmanager_secret" "admin" { name = "${local.name}/developer-admin-token" }
resource "aws_secretsmanager_secret" "otp" { name = "${local.name}/otp-pepper" }
resource "aws_secretsmanager_secret" "whatsapp" { name = "${local.name}/whatsapp-access-token" }

resource "aws_lb" "internal" {
  name = "${local.name}-internal"
  internal = true
  load_balancer_type = "application"
  subnets = aws_subnet.private[*].id
  security_groups = [aws_security_group.alb.id]
}
resource "aws_lb_target_group" "api" {
  name = "${local.name}-api-tg"
  port = 8000
  protocol = "HTTP"
  vpc_id = aws_vpc.main.id
  target_type = "ip"
  health_check { path = "/healthz"
   matcher = "200"
   interval = 30 }
}
resource "aws_lb_listener" "api" {
  load_balancer_arn = aws_lb.internal.arn
  port = 8000
  protocol = "HTTP"
  default_action { type = "forward"
   target_group_arn = aws_lb_target_group.api.arn }
}
resource "aws_apigatewayv2_vpc_link" "main" {
  name = "${local.name}-private-link"
  subnet_ids = aws_subnet.private[*].id
  security_group_ids = [aws_security_group.vpc_link.id]
}
resource "aws_apigatewayv2_api" "main" {
  name = "${local.name}-https-api"
  protocol_type = "HTTP"
  cors_configuration { allow_origins = ["*"]
   allow_methods = ["GET", "POST", "PATCH", "DELETE", "OPTIONS"]
   allow_headers = ["Authorization", "Content-Type", "X-Admin-Token", "Idempotency-Key"]
   max_age = 300 }
}
resource "aws_apigatewayv2_integration" "private_alb" {
  api_id = aws_apigatewayv2_api.main.id
  integration_type = "HTTP_PROXY"
  integration_method = "ANY"
  integration_uri = aws_lb_listener.api.arn
  connection_type = "VPC_LINK"
  connection_id = aws_apigatewayv2_vpc_link.main.id
  payload_format_version = "1.0"
  timeout_milliseconds = 29000
}
resource "aws_apigatewayv2_route" "default" {
  api_id = aws_apigatewayv2_api.main.id
  route_key = "$default"
  target = "integrations/${aws_apigatewayv2_integration.private_alb.id}"
}
resource "aws_apigatewayv2_stage" "default" {
  api_id = aws_apigatewayv2_api.main.id
  name = "$default"
  auto_deploy = true
}

resource "aws_ecs_task_definition" "api" {
  family = "${local.name}-api"
  requires_compatibilities = ["FARGATE"]
  network_mode = "awsvpc"
  cpu = "256"
  memory = "512"
  execution_role_arn = aws_iam_role.execution.arn
  task_role_arn = aws_iam_role.app.arn
  container_definitions = jsonencode([{
    name = "api", image = "${aws_ecr_repository.api.repository_url}:initial"
    essential = true
    portMappings = [{ containerPort = 8000, protocol = "tcp" }]
    environment = [
      { name = "ENVIRONMENT", value = "production" }, { name = "DB_IAM_AUTH", value = "true" },
      { name = "DB_HOST", value = aws_db_instance.main.address }, { name = "DB_NAME", value = "marketplace" }, { name = "DB_USER", value = "marketplace_api" },
      { name = "AWS_REGION", value = var.aws_region }, { name = "MEDIA_BUCKET", value = aws_s3_bucket.media.bucket },
      { name = "MEDIA_PUBLIC_BASE_URL", value = "https://${aws_cloudfront_distribution.media.domain_name}" },
      { name = "CORS_ORIGINS", value = "*" }, { name = "ENABLE_DOCS", value = "false" },
      { name = "WHATSAPP_PHONE_NUMBER_ID", value = var.whatsapp_phone_number_id }, { name = "WHATSAPP_TEMPLATE_NAME", value = var.whatsapp_template_name }
      , { name = "WHATSAPP_GRAPH_VERSION", value = var.whatsapp_graph_version }
    ]
    secrets = [
      { name = "AUTH_SECRET", valueFrom = aws_secretsmanager_secret.auth.arn },
      { name = "ADMIN_TOKEN", valueFrom = aws_secretsmanager_secret.admin.arn },
      { name = "OTP_PEPPER", valueFrom = aws_secretsmanager_secret.otp.arn },
      { name = "WHATSAPP_ACCESS_TOKEN", valueFrom = aws_secretsmanager_secret.whatsapp.arn }
    ]
    logConfiguration = { logDriver = "awslogs", options = { "awslogs-group" = aws_cloudwatch_log_group.api.name, "awslogs-region" = var.aws_region, "awslogs-stream-prefix" = "api" } }
    healthCheck = { command = ["CMD-SHELL", "python -c \"import urllib.request
   urllib.request.urlopen('http://127.0.0.1:8000/healthz')\""], interval = 30, timeout = 5, retries = 3, startPeriod = 30 }
  }])
  depends_on = [aws_iam_role_policy.execution_secrets]
}
resource "aws_ecs_service" "api" {
  name = "${local.name}-api"
  cluster = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.api.arn
  desired_count = var.api_desired_count
  launch_type = "FARGATE"
  health_check_grace_period_seconds = 60
  network_configuration { subnets = aws_subnet.private[*].id
   security_groups = [aws_security_group.app.id]
   assign_public_ip = false }
  load_balancer { target_group_arn = aws_lb_target_group.api.arn
   container_name = "api"
   container_port = 8000 }
}

resource "aws_iam_role" "developer" {
  name = "${local.name}-developer-access"
  assume_role_policy = jsonencode({ Version = "2012-10-17", Statement = [{ Effect = "Allow", Principal = { AWS = var.developer_principal_arn }, Action = "sts:AssumeRole" }] })
}
resource "aws_iam_role_policy" "developer_access" {
  name = "${local.name}-private-db-admin"
  role = aws_iam_role.developer.id
  policy = jsonencode({ Version = "2012-10-17", Statement = [
    { Effect = "Allow", Action = ["ssm:StartSession"], Resource = [aws_instance.tunnel.arn, "arn:aws:ssm:${var.aws_region}::document/AWS-StartPortForwardingSessionToRemoteHost"] },
    { Effect = "Allow", Action = ["ssm:TerminateSession", "ssm:ResumeSession"], Resource = "arn:aws:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:session/$${aws:username}-*" },
    { Effect = "Allow", Action = ["ec2:DescribeInstances", "ssm:DescribeSessions"], Resource = "*" },
    { Effect = "Allow", Action = ["rds-db:connect"], Resource = "arn:aws:rds-db:${var.aws_region}:${data.aws_caller_identity.current.account_id}:dbuser:${aws_db_instance.main.resource_id}/marketplace_dev" },
    { Effect = "Allow", Action = ["secretsmanager:GetSecretValue"], Resource = [aws_db_instance.main.master_user_secret[0].secret_arn, aws_secretsmanager_secret.admin.arn] }
  ] })
}
resource "aws_iam_role" "tunnel" {
  name = "${local.name}-ssm-tunnel"
  assume_role_policy = jsonencode({ Version = "2012-10-17", Statement = [{ Effect = "Allow", Principal = { Service = "ec2.amazonaws.com" }, Action = "sts:AssumeRole" }] })
}
resource "aws_iam_role_policy_attachment" "tunnel_ssm" {
  role = aws_iam_role.tunnel.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}
resource "aws_iam_instance_profile" "tunnel" { name = "${local.name}-ssm-tunnel"
   role = aws_iam_role.tunnel.name }
resource "aws_instance" "tunnel" {
  ami = data.aws_ssm_parameter.al2023_arm64.value
  instance_type = "t4g.nano"
  subnet_id = aws_subnet.private[0].id
  vpc_security_group_ids = [aws_security_group.developer_tunnel.id]
  iam_instance_profile = aws_iam_instance_profile.tunnel.name
  associate_public_ip_address = false
  metadata_options { http_tokens = "required"
   http_endpoint = "enabled" }
  root_block_device { encrypted = true
   volume_size = 8
   volume_type = "gp3" }
  tags = { Name = "${local.name}-developer-ssm-tunnel" }
}
