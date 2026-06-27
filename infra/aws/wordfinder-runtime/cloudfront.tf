resource "aws_cloudfront_distribution" "wordfinder" {
  enabled         = true
  aliases         = [var.domain_name]
  price_class     = var.cloudfront_price_class
  http_version    = var.cloudfront_http_version
  is_ipv6_enabled = true
  comment         = "${local.name_prefix} WordFinder distribution"

  origin {
    domain_name = aws_eip.wordfinder.public_dns
    origin_id   = "wordfinder-ec2-origin"

    custom_origin_config {
      http_port                = 80
      https_port               = 443
      origin_protocol_policy   = "http-only"
      origin_ssl_protocols     = ["TLSv1.2"]
      origin_keepalive_timeout = var.cloudfront_origin_keepalive_timeout
      origin_read_timeout      = var.cloudfront_origin_read_timeout
    }
  }

  default_cache_behavior {
    target_origin_id       = "wordfinder-ec2-origin"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true

    forwarded_values {
      query_string = true
      headers      = ["*"]

      cookies {
        forward = "all"
      }
    }

    min_ttl     = 0
    default_ttl = 0
    max_ttl     = 0
  }

  viewer_certificate {
    acm_certificate_arn      = local.cloudfront_certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  tags = {
    Name = "${local.name_prefix}-cf"
  }

  depends_on = [aws_acm_certificate_validation.cloudfront]
}
