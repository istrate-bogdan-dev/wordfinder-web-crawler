output "wordfinder_url" {
  description = "Public WordFinder URL."
  value       = "https://${var.domain_name}"
}

output "instance_id" {
  description = "WordFinder EC2 instance ID. Use this with SSM Session Manager and SSM Run Command."
  value       = aws_instance.wordfinder.id
}

output "instance_public_ip" {
  description = "Elastic IP attached to the WordFinder instance. Direct HTTP should be blocked unless the source is CloudFront."
  value       = aws_eip.wordfinder.public_ip
}

output "cloudfront_distribution_id" {
  description = "CloudFront distribution ID."
  value       = aws_cloudfront_distribution.wordfinder.id
}

output "cloudfront_domain_name" {
  description = "CloudFront distribution domain name."
  value       = aws_cloudfront_distribution.wordfinder.domain_name
}

output "route53_record_name" {
  description = "Route 53 record created for WordFinder."
  value       = var.create_route53_record ? aws_route53_record.wordfinder[0].fqdn : null
}

output "ec2_instance_role_name" {
  description = "EC2 IAM role name."
  value       = aws_iam_role.ec2.name
}

output "github_actions_deploy_role_arn" {
  description = "Optional GitHub Actions deploy role ARN."
  value       = var.create_github_actions_deploy_role ? aws_iam_role.github_deploy[0].arn : null
}
