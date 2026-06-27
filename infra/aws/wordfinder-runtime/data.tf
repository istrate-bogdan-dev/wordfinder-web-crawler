data "aws_caller_identity" "current" {}

data "aws_availability_zones" "available" {
  state = "available"
}

data "aws_route53_zone" "selected" {
  name         = "${local.hosted_zone_name}."
  private_zone = var.hosted_zone_private
}

data "aws_ami" "ubuntu" {
  count       = var.ami_id == "" ? 1 : 0
  most_recent = true
  owners      = ["099720109477"]

  filter {
    name   = "name"
    values = ["ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-amd64-server-*"]
  }

  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }

  filter {
    name   = "architecture"
    values = ["x86_64"]
  }
}

data "aws_ec2_managed_prefix_list" "cloudfront" {
  name = "com.amazonaws.global.cloudfront.origin-facing"
}

data "aws_acm_certificate" "existing" {
  count       = var.cloudfront_acm_certificate_arn == "" && !var.create_acm_certificate ? 1 : 0
  provider    = aws.us_east_1
  domain      = var.acm_certificate_domain_name
  statuses    = ["ISSUED"]
  most_recent = true
}
