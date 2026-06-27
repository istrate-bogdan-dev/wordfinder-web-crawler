resource "aws_route53_record" "wordfinder" {
  count   = var.create_route53_record ? 1 : 0
  zone_id = data.aws_route53_zone.selected.zone_id
  name    = var.domain_name
  type    = "A"

  alias {
    name                   = aws_cloudfront_distribution.wordfinder.domain_name
    zone_id                = aws_cloudfront_distribution.wordfinder.hosted_zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "wordfinder_ipv6" {
  count   = var.create_route53_record ? 1 : 0
  zone_id = data.aws_route53_zone.selected.zone_id
  name    = var.domain_name
  type    = "AAAA"

  alias {
    name                   = aws_cloudfront_distribution.wordfinder.domain_name
    zone_id                = aws_cloudfront_distribution.wordfinder.hosted_zone_id
    evaluate_target_health = false
  }
}
