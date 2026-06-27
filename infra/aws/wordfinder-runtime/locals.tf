locals {
  name_prefix       = "${var.project_name}-${var.environment}"
  hosted_zone_name  = trimsuffix(var.hosted_zone_name, ".")
  ssm_parameter_arn = "arn:aws:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter/${trimprefix(var.access_token_parameter_name, "/")}"
  ghcr_token_arn    = var.ghcr_token_parameter_name == "" ? null : "arn:aws:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter/${trimprefix(var.ghcr_token_parameter_name, "/")}"
  github_oidc_provider_arn = var.github_oidc_provider_arn != "" ? var.github_oidc_provider_arn : try(
    aws_iam_openid_connect_provider.github_actions[0].arn,
    ""
  )

  cloudfront_certificate_arn = var.cloudfront_acm_certificate_arn != "" ? var.cloudfront_acm_certificate_arn : (
    var.create_acm_certificate ? aws_acm_certificate.cloudfront[0].arn : data.aws_acm_certificate.existing[0].arn
  )

  common_tags = {
    Project     = var.project_name
    Environment = var.environment
    ManagedBy   = "terraform"
    Application = "wordfinder"
  }
}
