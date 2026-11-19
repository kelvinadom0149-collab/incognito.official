# Backend and private AWS database

## Architecture

- FastAPI provides the site and `/api` routes. PostgreSQL stores customer/seller accounts, product listings, orders, OTP challenges and audit events.
- The HTTPS API Gateway URL is public because customers need the storefront. It connects through a private VPC Link and internal load balancer to ECS Fargate tasks in private subnets.
- RDS PostgreSQL has no public endpoint. Its security group accepts PostgreSQL only from the API task and the SSM tunnel instance. The API connects using short-lived RDS IAM auth tokens, not a database password.
- Developer access uses one exact IAM user/role ARN (`developer_principal_arn`) to assume the developer role, then AWS Systems Manager port forwarding to the database. The tunnel has no inbound SSH port. Give `sts:AssumeRole` for this role to your own IAM identity only.
- Product uploads use short-lived S3 presigned POSTs. The bucket blocks public access; CloudFront reads the objects for approved public product images. The RDS database and its backups are encrypted. RDS deletion protection is enabled.
- The API accepts customer and seller traffic, but user data endpoints require signed account tokens. Developer moderation endpoints require the admin token stored in Secrets Manager. Never put that token in the browser.

## Local development

Requires Docker Desktop. From this directory:

```powershell
docker compose -f backend/docker-compose.yml up --build
```

Open `http://localhost:8000`; API reference is at `http://localhost:8000/api/docs`. The compose credentials are local demo values only. WhatsApp OTP, S3 uploads and developer moderation are not configured in local mode. `backend/sql/001_init.sql` runs only when the PostgreSQL volume is first initialized.

## AWS deployment

This directory contains infrastructure code; no AWS resource has been created by this task. AWS credentials, the developer's exact IAM ARN and WhatsApp Business API credentials were not available in this workspace. Resource creation will incur AWS charges (NAT Gateway, RDS, ECS, load balancing, SSM instance, API Gateway, S3 and CloudFront). Review a Terraform plan and monthly estimate in your account before applying.

1. Install AWS CLI, Terraform 1.8+, Docker and the AWS Session Manager plugin. Sign in with the AWS account that should own the production data.
2. Set `developer_principal_arn` to your exact IAM user or assumed-role ARN and `frontend_origin` to the Next.js storefront HTTPS origin. Keep Terraform state in an encrypted, access-restricted S3 backend with versioning and locking before applying; the supplied Terraform root intentionally has no local state backend configured.
3. Run `terraform init`, `terraform plan`, and `terraform apply` in `infra/terraform`. Review every resource and cost before applying. The ECS service starts at desired count zero and the ECR image tag is immutable (`initial`), so no app is exposed until bootstrap completes.
4. Store strong random values in the four Secrets Manager secrets Terraform creates: `auth-secret`, `developer-admin-token`, `otp-pepper`, and `whatsapp-access-token`. Configure the approved WhatsApp phone number ID and template name in Terraform variables. The template must accept the OTP in the expected body parameter.
5. Build and push the image from this folder with Docker to the ECR repository output, tagged `initial`. Do not put secrets into the image or source tree.
6. Assume the developer role and start an SSM port-forward session to the private RDS endpoint (output `ssm_tunnel_instance_id` and sensitive `database_endpoint`). Connect local `psql` through `127.0.0.1:5432`, using the actual RDS hostname as the TLS `host`/SNI name and the RDS CA bundle. Retrieve the RDS-managed master credential through the developer role, run `backend/sql/001_init.sql`, then `002_product_listing_details.sql`, `003_stripe_reputation.sql`, and `004_verification_inventory.sql`, then run `infra/terraform/grant-rds-iam.sql`. These migrations provision account, listing, payment and reservation fields used by the API and create the `marketplace_api` / `marketplace_dev` IAM database users with DML permissions. Migrations 002–004 are safe to rerun.
7. Set the API task count to one and apply again. Open the output API URL; it uses API Gateway's HTTPS endpoint. Confirm phone verification, seller moderation, product media upload, backup and restore procedures before inviting customers.

For the developer tunnel, use AWS's `AWS-StartPortForwardingSessionToRemoteHost` SSM document. The database SG has no public CIDR rule. The developer role trust names only the supplied developer principal; only that principal should receive `sts:AssumeRole` permission.

## Important limits before real data

- `index.html` is a legacy, browser-only prototype. It is not the production frontend and its local demo data is not connected to the PostgreSQL database.
- For the Next.js storefront, set its server environment variable `MARKETPLACE_API_URL` to the API Gateway URL. The same-origin Next.js proxy keeps API requests same-origin; Terraform's `frontend_origin` allows the seller browser to upload media to the private S3 bucket using its short-lived signed form.
- Register the data controller and complete Ghana DPC compliance before collecting customer/seller personal data. Have a Ghana-qualified adviser review the privacy notice, seller terms, retention schedule, payment settlement arrangement and consumer checkout disclosures.
- OTP sending needs a reviewed WhatsApp Business template and real credentials. Until then, registration deliberately cannot verify a phone.
- Seller approval and product approval are private developer API routes; build a private admin interface or use a controlled developer client. No public admin UI is included.
- Stripe Checkout and signed webhooks are implemented as an integration foundation. Configure Stripe keys and the webhook, run the SQL migrations, and use Stripe Connect or another approved settlement arrangement before live payouts. Delivery quotes, refunds and actual seller disbursements still require production operations.
- Ghana Card numbers and card images are intentionally absent. Add NIA IVSP only after approved onboarding and legal review; retain no raw identity value unless NIA and counsel expressly confirm the permitted design.

## API outline

- `POST /api/auth/register`, `POST /api/auth/verify`, `POST /api/auth/login`, `GET /api/account/me`
- `GET /api/products` (live products only)
- `POST /api/seller/uploads`, `GET/POST /api/seller/products`, `PATCH/DELETE /api/seller/products/{id}`
- `POST/GET /api/orders` (authenticated customer; awaiting payment only)
- `GET /api/admin/pending-sellers`, `POST /api/admin/sellers/{id}/approve`, `GET /api/admin/pending-products`, `POST /api/admin/products/{id}/approve` (`X-Admin-Token`)

The application never returns a seller's private name or phone in public product responses. Product ownership is checked server-side for seller edits and removal. The RDS endpoint, database users and direct database routes are private to this AWS environment.
