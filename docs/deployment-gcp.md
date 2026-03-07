# GCP Deployment

Deploy WebClaw to Google Cloud Platform using either the quick deploy script or Terraform for full infrastructure-as-code management.

## Prerequisites

| Requirement | Purpose | Installation |
|:------------|:--------|:-------------|
| GCP Account | Cloud hosting | [cloud.google.com](https://cloud.google.com) |
| `gcloud` CLI | GCP management | [Install guide](https://cloud.google.com/sdk/docs/install) |
| Docker | Container builds | [docker.com](https://docker.com) |
| Terraform | Infrastructure-as-code (Option B) | `brew install terraform` |
| Gemini API Key | AI model access | [AI Studio](https://aistudio.google.com/apikey) |

### GCP Setup

```bash
# Authenticate
gcloud auth login

# Create or select a project
gcloud projects create webclaw-prod --name="WebClaw"
gcloud config set project webclaw-prod

# Enable billing (required for Cloud Run)
# Visit: https://console.cloud.google.com/billing

# Configure Docker for Artifact Registry
gcloud auth configure-docker us-central1-docker.pkg.dev
```

---

## Option A: Quick Deploy (Shell Script)

The fastest way to deploy. One command handles everything.

```bash
cd infra
chmod +x deploy.sh
./deploy.sh YOUR_PROJECT_ID us-central1
```

### What It Does

1. **Builds** the Docker image from `gateway/Dockerfile`
2. **Pushes** to Artifact Registry (`us-central1-docker.pkg.dev/PROJECT/webclaw/gateway:latest`)
3. **Deploys** to Cloud Run with:
   - Session affinity (required for WebSocket)
   - 2 vCPUs, 1GB RAM
   - Auto-scaling 0-10 instances
   - Public access (unauthenticated)
4. **Outputs** the public gateway URL

### Set the API Key

After deployment, set the Gemini API key:

```bash
gcloud run services update webclaw-gateway \
  --region us-central1 \
  --set-env-vars "GOOGLE_API_KEY=your_key_here"
```

Or use Secret Manager (recommended for production):

```bash
# Create secret
echo -n "your_key_here" | gcloud secrets create gemini-api-key --data-file=-

# Grant Cloud Run access
gcloud secrets add-iam-policy-binding gemini-api-key \
  --member="serviceAccount:$(gcloud iam service-accounts list --format='value(email)' --filter='Cloud Run')" \
  --role="roles/secretmanager.secretAccessor"

# Update service to use secret
gcloud run services update webclaw-gateway \
  --region us-central1 \
  --set-secrets "GOOGLE_API_KEY=gemini-api-key:latest"
```

### Verify Deployment

```bash
# Get the URL
GATEWAY_URL=$(gcloud run services describe webclaw-gateway \
  --region us-central1 --format 'value(status.url)')

# Health check
curl $GATEWAY_URL/health
# → {"status":"ok","service":"webclaw-gateway"}

# List sites
curl $GATEWAY_URL/api/sites
```

---

## Option B: Terraform (Recommended)

Full infrastructure-as-code with reproducible deployments.

### Setup

```bash
cd infra
cp terraform.tfvars.example terraform.tfvars
```

Edit `terraform.tfvars`:

```hcl
project_id     = "webclaw-prod"
region         = "us-central1"
gemini_api_key = "your_gemini_api_key_here"
```

### Deploy

```bash
# Initialize Terraform
terraform init

# Preview changes
terraform plan

# Apply
terraform apply
```

### Resources Created

| Resource | Type | Purpose |
|:---------|:-----|:--------|
| `google_project_service.apis` | API enablement | Enables Cloud Run, Artifact Registry, Firestore, Cloud Build |
| `google_artifact_registry_repository.webclaw` | Docker registry | Stores gateway container images |
| `google_firestore_database.webclaw` | Database | Site configs, sessions, knowledge bases (Native mode) |
| `google_cloud_run_v2_service.gateway` | Compute | Gateway container (auto-scaling 0-10, session affinity) |
| `google_cloud_run_v2_service_iam_member.public` | IAM | Allows unauthenticated access |

### Terraform Outputs

After `terraform apply`, you will see:

```
Outputs:

gateway_url       = "https://webclaw-gateway-abc123-uc.a.run.app"
artifact_registry = "us-central1-docker.pkg.dev/webclaw-prod/webclaw"
```

### Build and Push the Image

Terraform creates the infrastructure but does not build the Docker image. After `terraform apply`:

```bash
cd ../gateway

# Build
docker build -t us-central1-docker.pkg.dev/webclaw-prod/webclaw/gateway:latest .

# Push
docker push us-central1-docker.pkg.dev/webclaw-prod/webclaw/gateway:latest

# Cloud Run will automatically pick up the new image
```

### Updating

```bash
# Rebuild and push
docker build -t us-central1-docker.pkg.dev/webclaw-prod/webclaw/gateway:latest .
docker push us-central1-docker.pkg.dev/webclaw-prod/webclaw/gateway:latest

# Redeploy Cloud Run
gcloud run services update webclaw-gateway --region us-central1
```

### Teardown

```bash
terraform destroy
```

This removes all resources. Data in Firestore will be deleted.

---

## Cloud Run Configuration

### Container Specification

The `gateway/Dockerfile` builds a production container:

```dockerfile
FROM python:3.12-slim
WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .
EXPOSE 8080

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8080"]
```

**Important:** Cloud Run requires port 8080 (the default). The Dockerfile's CMD exposes this port. Locally, we use 8081 to avoid conflicts.

### Resource Limits

| Setting | Value | Reason |
|:--------|:------|:-------|
| CPU | 2 vCPUs | WebSocket handling + ADK agent processing |
| Memory | 1 GB | Gemini SDK + audio processing buffers |
| Min instances | 0 | Scale to zero when idle (cost savings) |
| Max instances | 10 | Handles ~100 concurrent WebSocket sessions |
| Session affinity | Enabled | WebSocket frames must route to same instance |

### Session Affinity

**Critical for WebSocket connections.** Without session affinity, Cloud Run may route subsequent WebSocket frames to different instances, breaking the streaming session.

Terraform enables this with:

```hcl
template {
  session_affinity = true
}
```

The deploy script enables it with:

```bash
gcloud run deploy ... --session-affinity
```

### Health Check

Cloud Run uses the `/health` endpoint as a startup probe:

```hcl
startup_probe {
  http_get {
    path = "/health"
  }
  initial_delay_seconds = 5
  period_seconds        = 10
}
```

The gateway returns `{"status":"ok"}` within milliseconds of startup.

---

## Embed Script Inclusion

After deployment, the embed script is served from the Cloud Run URL:

```html
<script src="https://webclaw-gateway-abc123-uc.a.run.app/embed.js"
        data-site-id="your_site_id"
        data-gateway="https://webclaw-gateway-abc123-uc.a.run.app">
</script>
```

### Custom Domain (Optional)

Map a custom domain to your Cloud Run service:

```bash
gcloud run domain-mappings create \
  --service webclaw-gateway \
  --domain gateway.webclaw.dev \
  --region us-central1
```

Then update DNS records as instructed by gcloud.

---

## Cost Estimate

### Cloud Run

| Metric | Free Tier | Beyond Free |
|:-------|:----------|:-----------|
| Requests | 2M/month | $0.40/million |
| CPU | 180,000 vCPU-sec/month | $0.00002400/vCPU-sec |
| Memory | 360,000 GiB-sec/month | $0.00000250/GiB-sec |
| Networking | 1 GB/month | $0.12/GB (North America) |

### Firestore

| Metric | Free Tier | Beyond Free |
|:-------|:----------|:-----------|
| Document reads | 50K/day | $0.036/100K |
| Document writes | 20K/day | $0.108/100K |
| Storage | 1 GiB | $0.108/GiB |

### Gemini API

| Model | Free Tier | Beyond Free |
|:------|:----------|:-----------|
| Gemini 2.0 Flash | 15 RPM, 1M TPM | $0.10/1M input tokens, $0.40/1M output tokens |

For a low-traffic deployment (< 1000 sessions/month), total cost is likely **under $5/month** after free tier.

---

## Production Checklist

- [ ] **API key in Secret Manager** (not environment variable)
- [ ] **CORS restricted** to registered site domains
- [ ] **Custom domain** mapped with SSL
- [ ] **Monitoring** enabled (Cloud Run metrics + logging)
- [ ] **Alerting** for error rates and latency
- [ ] **Firestore** replacing in-memory session store
- [ ] **Rate limiting** per IP and per session
- [ ] **WebSocket authentication** for registered sites
- [ ] **Backup** for Firestore data
- [ ] **Load testing** with concurrent WebSocket connections
