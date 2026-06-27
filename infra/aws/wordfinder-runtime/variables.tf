variable "aws_region" {
  description = "AWS region for runtime resources. CloudFront ACM certificates are always read or created in us-east-1."
  type        = string
  default     = "eu-central-1"
}

variable "project_name" {
  description = "Project name used in resource names and tags."
  type        = string
  default     = "wordfinder"
}

variable "environment" {
  description = "Deployment environment name."
  type        = string
  default     = "prod"
}

variable "domain_name" {
  description = "Public hostname for WordFinder."
  type        = string
  default     = "wordfinder.bogdanistrate.ro"
}

variable "hosted_zone_name" {
  description = "Route 53 public hosted zone name."
  type        = string
  default     = "bogdanistrate.ro"
}

variable "hosted_zone_private" {
  description = "Whether the selected Route 53 hosted zone is private."
  type        = bool
  default     = false
}

variable "create_route53_record" {
  description = "Whether Terraform should create the Route 53 alias record for the CloudFront distribution."
  type        = bool
  default     = true
}

variable "vpc_cidr" {
  description = "CIDR block for the dedicated WordFinder VPC."
  type        = string
  default     = "10.42.0.0/16"
}

variable "public_subnet_cidr" {
  description = "CIDR block for the single public subnet used by the WordFinder EC2 instance."
  type        = string
  default     = "10.42.1.0/24"
}

variable "availability_zone" {
  description = "Availability zone for the public subnet. Leave null to use the first available zone in aws_region."
  type        = string
  default     = null
}

variable "instance_type" {
  description = "EC2 instance type for the WordFinder runtime."
  type        = string
  default     = "t3.small"
}

variable "ami_id" {
  description = "Optional Ubuntu AMI ID. Leave empty to use the latest Canonical Ubuntu 24.04 LTS amd64 AMI."
  type        = string
  default     = ""
}

variable "root_volume_size" {
  description = "Root EBS volume size in GiB."
  type        = number
  default     = 20
}

variable "root_volume_type" {
  description = "Root EBS volume type."
  type        = string
  default     = "gp3"
}

variable "enable_detailed_monitoring" {
  description = "Whether to enable detailed EC2 monitoring."
  type        = bool
  default     = false
}

variable "cloudfront_acm_certificate_arn" {
  description = "Existing ACM certificate ARN in us-east-1 for CloudFront. If empty and create_acm_certificate is false, Terraform looks up acm_certificate_domain_name."
  type        = string
  default     = ""
}

variable "create_acm_certificate" {
  description = "Whether Terraform should create and DNS-validate a new us-east-1 ACM certificate."
  type        = bool
  default     = false
}

variable "acm_certificate_domain_name" {
  description = "Domain name to create or look up for the CloudFront certificate. Use *.bogdanistrate.ro to reuse a wildcard certificate."
  type        = string
  default     = "*.bogdanistrate.ro"
}

variable "cloudfront_price_class" {
  description = "CloudFront price class."
  type        = string
  default     = "PriceClass_100"
}

variable "cloudfront_http_version" {
  description = "CloudFront HTTP version."
  type        = string
  default     = "http2and3"
}

variable "cloudfront_origin_keepalive_timeout" {
  description = "CloudFront origin keepalive timeout in seconds."
  type        = number
  default     = 5
}

variable "cloudfront_origin_read_timeout" {
  description = "CloudFront origin read timeout in seconds."
  type        = number
  default     = 60
}

variable "ghcr_image" {
  description = "GHCR image name without tag."
  type        = string
  default     = "ghcr.io/istrate-bogdan-dev/wordfinder-web-crawler"
}

variable "ghcr_image_tag" {
  description = "Initial image tag used by Docker Compose. GitHub Actions can update this later."
  type        = string
  default     = "main"
}

variable "ghcr_username" {
  description = "Optional GHCR username used when ghcr_token_parameter_name is set."
  type        = string
  default     = ""
}

variable "ghcr_token_parameter_name" {
  description = "Optional SSM SecureString parameter containing a GHCR read token. Leave empty if the image is public."
  type        = string
  default     = ""
}

variable "access_token_parameter_name" {
  description = "SSM SecureString parameter containing WORDFINDER_ACCESS_TOKEN."
  type        = string
  default     = "/wordfinder/prod/access-token"
}

variable "kms_key_arns_for_parameters" {
  description = "Optional customer-managed KMS key ARNs needed to decrypt SecureString parameters. Leave empty when using the AWS managed SSM key."
  type        = list(string)
  default     = []
}

variable "wordfinder_port" {
  description = "Port exposed by the WordFinder app inside the Docker network."
  type        = number
  default     = 8000
}

variable "wordfinder_allowed_origins" {
  description = "Allowed browser origins for the app."
  type        = string
  default     = "https://wordfinder.bogdanistrate.ro"
}

variable "wordfinder_max_active_sessions" {
  description = "Maximum concurrent crawl sessions globally."
  type        = number
  default     = 1
}

variable "wordfinder_max_active_sessions_per_ip" {
  description = "Maximum concurrent crawl sessions per client IP."
  type        = number
  default     = 1
}

variable "wordfinder_scans_per_minute" {
  description = "Maximum crawl starts per minute per client IP."
  type        = number
  default     = 2
}

variable "wordfinder_max_concurrency" {
  description = "Maximum crawler fetch concurrency."
  type        = number
  default     = 3
}

variable "wordfinder_max_pages" {
  description = "Maximum pages per crawl."
  type        = number
  default     = 50
}

variable "wordfinder_max_depth" {
  description = "Maximum crawl depth."
  type        = number
  default     = 2
}

variable "wordfinder_max_response_bytes" {
  description = "Maximum response body size after decompression."
  type        = number
  default     = 3145728
}

variable "create_github_actions_deploy_role" {
  description = "Whether to create an IAM role that GitHub Actions can assume for SSM deploys."
  type        = bool
  default     = false
}

variable "github_oidc_provider_arn" {
  description = "Existing GitHub Actions OIDC provider ARN. Required if create_github_actions_deploy_role is true."
  type        = string
  default     = ""
}

variable "github_repository" {
  description = "GitHub repository allowed to assume the deploy role."
  type        = string
  default     = "istrate-bogdan-dev/wordfinder-web-crawler"
}

variable "github_deploy_branch" {
  description = "GitHub branch allowed to assume the deploy role."
  type        = string
  default     = "main"
}
