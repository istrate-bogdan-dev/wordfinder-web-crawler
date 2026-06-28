const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const infraDir = __dirname;
const userData = fs.readFileSync(path.join(infraDir, "user_data.sh.tftpl"), "utf8");
const dataTf = fs.readFileSync(path.join(infraDir, "data.tf"), "utf8");
const ec2Tf = fs.readFileSync(path.join(infraDir, "ec2.tf"), "utf8");

assert.doesNotMatch(
  userData,
  /\$proxy_add_x_forwarded_for/,
  "nginx must overwrite X-Forwarded-For instead of appending spoofable viewer input"
);

assert.match(
  userData,
  /set_real_ip_from \$\{cidr\};[\s\S]*real_ip_header X-Forwarded-For;[\s\S]*real_ip_recursive on;/,
  "nginx must trust CloudFront CIDRs through realip before deriving the client IP"
);

assert.match(
  userData,
  /proxy_set_header X-Forwarded-For \$remote_addr;[\s\S]*proxy_set_header X-Real-IP \$remote_addr;/,
  "nginx must forward a single cleaned viewer IP to the app"
);

assert.match(
  userData,
  /map \$http_upgrade \$connection_upgrade[\s\S]*default upgrade;[\s\S]*'' close;/,
  "nginx should use a canonical connection upgrade map"
);

assert.doesNotMatch(
  userData,
  /proxy_set_header Connection "upgrade";/,
  "nginx should not force Connection: upgrade on every request"
);

for (const header of [
  "Strict-Transport-Security",
  "Content-Security-Policy",
  "X-Content-Type-Options",
  "X-Frame-Options",
  "Referrer-Policy",
]) {
  assert.match(userData, new RegExp(`add_header ${header}`), `${header} should be set by nginx`);
}

assert.match(
  dataTf,
  /data "aws_ip_ranges" "cloudfront"[\s\S]*services\s*=\s*\["CLOUDFRONT"\][\s\S]*regions\s*=\s*\["GLOBAL"\]/,
  "Terraform should resolve CloudFront public CIDRs for nginx realip"
);

assert.match(
  ec2Tf,
  /cloudfront_origin_cidr_blocks\s*=\s*data\.aws_ip_ranges\.cloudfront\.cidr_blocks/,
  "EC2 user_data should receive CloudFront CIDRs"
);

console.log("user data tests passed");
