resource "aws_iam_role" "ec2" {
  name = "${local.name_prefix}-ec2-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = {
        Service = "ec2.amazonaws.com"
      }
    }]
  })

  tags = {
    Name = "${local.name_prefix}-ec2-role"
  }
}

resource "aws_iam_role_policy_attachment" "ssm_core" {
  role       = aws_iam_role.ec2.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_role_policy" "runtime_parameters" {
  name = "${local.name_prefix}-runtime-parameters"
  role = aws_iam_role.ec2.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = concat(
      [
        {
          Effect = "Allow"
          Action = [
            "ssm:GetParameter",
            "ssm:GetParameters"
          ]
          Resource = compact([
            local.ssm_parameter_arn,
            local.ghcr_token_arn
          ])
        }
      ],
      length(var.kms_key_arns_for_parameters) == 0 ? [] : [
        {
          Effect   = "Allow"
          Action   = "kms:Decrypt"
          Resource = var.kms_key_arns_for_parameters
        }
      ]
    )
  })
}

resource "aws_iam_instance_profile" "ec2" {
  name = "${local.name_prefix}-ec2-profile"
  role = aws_iam_role.ec2.name
}

resource "aws_iam_role" "github_deploy" {
  count = var.create_github_actions_deploy_role ? 1 : 0
  name  = "${local.name_prefix}-github-deploy-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = "sts:AssumeRoleWithWebIdentity"
      Principal = {
        Federated = var.github_oidc_provider_arn
      }
      Condition = {
        StringEquals = {
          "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
        }
        StringLike = {
          "token.actions.githubusercontent.com:sub" = "repo:${var.github_repository}:ref:refs/heads/${var.github_deploy_branch}"
        }
      }
    }]
  })

  lifecycle {
    precondition {
      condition     = var.github_oidc_provider_arn != ""
      error_message = "github_oidc_provider_arn is required when create_github_actions_deploy_role is true."
    }
  }

  tags = {
    Name = "${local.name_prefix}-github-deploy-role"
  }
}

resource "aws_iam_role_policy" "github_deploy" {
  count = var.create_github_actions_deploy_role ? 1 : 0
  name  = "${local.name_prefix}-github-deploy"
  role  = aws_iam_role.github_deploy[0].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "ssm:SendCommand"
        ]
        Resource = [
          aws_instance.wordfinder.arn,
          "arn:aws:ssm:${var.aws_region}::document/AWS-RunShellScript"
        ]
      },
      {
        Effect = "Allow"
        Action = [
          "ssm:GetCommandInvocation"
        ]
        Resource = "*"
      }
    ]
  })
}
