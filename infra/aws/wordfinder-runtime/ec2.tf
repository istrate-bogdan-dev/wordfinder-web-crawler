resource "aws_instance" "wordfinder" {
  ami                         = var.ami_id != "" ? var.ami_id : data.aws_ami.ubuntu[0].id
  instance_type               = var.instance_type
  subnet_id                   = aws_subnet.public.id
  vpc_security_group_ids      = [aws_security_group.wordfinder.id]
  iam_instance_profile        = aws_iam_instance_profile.ec2.name
  associate_public_ip_address = true
  monitoring                  = var.enable_detailed_monitoring

  user_data_replace_on_change = true
  user_data = templatefile("${path.module}/user_data.sh.tftpl", {
    aws_region                            = var.aws_region
    domain_name                           = var.domain_name
    ghcr_image                            = var.ghcr_image
    ghcr_image_tag                        = var.ghcr_image_tag
    ghcr_username                         = var.ghcr_username
    ghcr_token_parameter_name             = var.ghcr_token_parameter_name
    access_token_parameter_name           = var.access_token_parameter_name
    wordfinder_port                       = var.wordfinder_port
    wordfinder_allowed_origins            = var.wordfinder_allowed_origins
    wordfinder_max_active_sessions        = var.wordfinder_max_active_sessions
    wordfinder_max_active_sessions_per_ip = var.wordfinder_max_active_sessions_per_ip
    wordfinder_scans_per_minute           = var.wordfinder_scans_per_minute
    wordfinder_max_concurrency            = var.wordfinder_max_concurrency
    wordfinder_max_pages                  = var.wordfinder_max_pages
    wordfinder_max_depth                  = var.wordfinder_max_depth
    wordfinder_max_response_bytes         = var.wordfinder_max_response_bytes
  })

  root_block_device {
    volume_size = var.root_volume_size
    volume_type = var.root_volume_type
    encrypted   = true
  }

  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required"
    http_put_response_hop_limit = 1
  }

  tags = {
    Name = "${local.name_prefix}-ec2"
  }
}

resource "aws_eip" "wordfinder" {
  instance = aws_instance.wordfinder.id
  domain   = "vpc"

  tags = {
    Name = "${local.name_prefix}-eip"
  }
}
