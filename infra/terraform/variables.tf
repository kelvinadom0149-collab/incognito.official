variable "aws_region" {
  type        = string
  default     = "af-south-1"
  description = "Initial default region: Africa (Cape Town)."
}

variable "developer_principal_arn" {
  type        = string
  description = "Exact IAM user or role ARN allowed to assume developer database access. No default is provided."
}

variable "frontend_origin" {
  type        = string
  description = "HTTPS origin of the deployed Next.js storefront, allowed to upload product media to S3. Example: https://market.example.com"
  validation {
    condition     = can(regex("^https://[^/]+$", var.frontend_origin))
    error_message = "Use the storefront's HTTPS origin only, without a path."
  }
}

variable "project_name" {
  type    = string
  default = "incognito-market"
  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{2,24}$", var.project_name))
    error_message = "Use 3-25 lowercase letters, numbers, or hyphens; start with a letter."
  }
}

variable "db_instance_class" {
  type        = string
  default     = "db.t4g.micro"
  description = "RDS instance class; increase for production traffic."
}

variable "api_desired_count" {
  type        = number
  default     = 0
  description = "Keep at zero until secrets, image, and schema are ready; then set to 1 or more."
  validation {
    condition     = var.api_desired_count >= 0 && var.api_desired_count <= 10
    error_message = "Use a desired count between 0 and 10."
  }
}

variable "whatsapp_phone_number_id" {
  type        = string
  default     = ""
  description = "WhatsApp Business Cloud API phone number ID."
}

variable "whatsapp_template_name" {
  type        = string
  default     = ""
  description = "Approved WhatsApp template name with an OTP body parameter."
}
variable "whatsapp_graph_version" {
  type        = string
  default     = "v27.0"
  description = "Meta Graph API version used by the WhatsApp Cloud API integration."
}
