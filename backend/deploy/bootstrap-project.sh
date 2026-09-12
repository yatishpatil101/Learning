#!/usr/bin/env bash

# Bootstraps a GCP project so the backend job in .github/workflows/deploy.yml can deploy into it: APIs,
# registry, service accounts and IAM, Workload Identity, secrets. Idempotent. Run with bash. docs/DEPLOY.md §5.

set -euo pipefail

# ---------------------------------------------------------------------------------------------
# Configuration. PROJECT_ID and GITHUB_REPO are the only two that change between projects.
# ---------------------------------------------------------------------------------------------
PROJECT_ID="${PROJECT_ID:-draazy-sandbox}"
GITHUB_REPO="${GITHUB_REPO:-yatishpatil101/Learning}"

# Must match `env.REGION` and `env.AR_REPOSITORY` in deploy.yml. They are duplicated rather
# than read from the workflow because parsing YAML in bash to save one edit is a worse trade.
REGION="${REGION:-asia-south1}"
AR_REPOSITORY="${AR_REPOSITORY:-draazy}"
SERVICE="${SERVICE:-draazy-api-sandbox}"

RUNTIME_SA="draazy-api-sandbox"
DEPLOYER_SA="github-deployer"
WIF_POOL="github-actions"
WIF_PROVIDER="github"

# MUST MATCH `jobs.backend.environment` IN deploy.yml, EXACTLY, INCLUDING CASE: GitHub puts it
# verbatim into the OIDC subject both checks below compare — docs/DEPLOY.md §5.1.
GITHUB_ENVIRONMENT="${GITHUB_ENVIRONMENT:-sandbox}"

RUNTIME="${RUNTIME_SA}@${PROJECT_ID}.iam.gserviceaccount.com"
DEPLOYER="${DEPLOYER_SA}@${PROJECT_ID}.iam.gserviceaccount.com"

say() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }

# ---------------------------------------------------------------------------------------------
say "Checking prerequisites"
# ---------------------------------------------------------------------------------------------
command -v gcloud >/dev/null || { echo "gcloud not on PATH." >&2; exit 1; }

gcloud projects describe "$PROJECT_ID" >/dev/null 2>&1 || {
  echo "Project '$PROJECT_ID' not found, or the active account cannot see it." >&2
  echo "Create it first: gcloud projects create $PROJECT_ID" >&2
  exit 1
}

# Billing is checked before anything else because `services enable` fails on an unlinked project
# with a message about the API rather than about billing, which sends you to the wrong console page.
if [ "$(gcloud billing projects describe "$PROJECT_ID" --format='value(billingEnabled)' 2>/dev/null)" != "True" ]; then
  echo "Billing is not enabled on '$PROJECT_ID'. Link an account before continuing:" >&2
  echo "  gcloud billing projects link $PROJECT_ID --billing-account=XXXXXX-XXXXXX-XXXXXX" >&2
  exit 1
fi

gcloud config set project "$PROJECT_ID" --quiet
PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"

# ---------------------------------------------------------------------------------------------
say "Enabling APIs"
# ---------------------------------------------------------------------------------------------
# One call so the round trips happen in parallel server-side. iamcredentials is the one people
# forget: it mints the token at the end of the Workload Identity exchange.
gcloud services enable \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com \
  cloudbuild.googleapis.com \
  iamcredentials.googleapis.com \
  sts.googleapis.com \
  --quiet

# ---------------------------------------------------------------------------------------------
say "Artifact Registry"
# ---------------------------------------------------------------------------------------------
# Co-located with the service: pulling across regions adds latency to the cold start, which is
# already the slowest request the service serves.
if ! gcloud artifacts repositories describe "$AR_REPOSITORY" --location "$REGION" >/dev/null 2>&1; then
  gcloud artifacts repositories create "$AR_REPOSITORY" \
    --repository-format=docker --location="$REGION" \
    --description="Draazy API images" --quiet
fi

# The free tier is 0.5 GB and one image is 250-400 MB, so without a policy the third deploy fails on
# quota — surfacing as a push error that looks like a permissions problem.
say "Artifact Registry cleanup policy (keep 5 most recent)"
POLICY_FILE="$(mktemp "${TMPDIR:-/tmp}/draazy-cleanup-policy.XXXXXX")"
trap 'rm -f "$POLICY_FILE"' EXIT
cat > "$POLICY_FILE" <<'JSON'
[
  {
    "name": "keep-recent",
    "action": {"type": "Keep"},
    "mostRecentVersions": {"keepCount": 5}
  },
  {
    "name": "delete-old",
    "action": {"type": "Delete"},
    "condition": {"olderThan": "30d"}
  }
]
JSON
gcloud artifacts repositories set-cleanup-policies "$AR_REPOSITORY" \
  --location="$REGION" --policy="$POLICY_FILE" --quiet

# ---------------------------------------------------------------------------------------------
say "Service accounts"
# ---------------------------------------------------------------------------------------------
# Two identities, deliberately: only the runtime one may read secrets. Cloud Run checks the runtime
# identity's grant when it starts the container, so secretAccessor on the deployer buys nothing.
for pair in "$RUNTIME_SA:Draazy API runtime" "$DEPLOYER_SA:GitHub Actions deployer"; do
  sa_id="${pair%%:*}"
  sa_desc="${pair#*:}"
  if ! gcloud iam service-accounts describe "${sa_id}@${PROJECT_ID}.iam.gserviceaccount.com" >/dev/null 2>&1; then
    gcloud iam service-accounts create "$sa_id" --display-name="$sa_desc" --quiet
  fi
done

gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:$RUNTIME" --role=roles/secretmanager.secretAccessor \
  --condition=None --quiet >/dev/null

# Scoped to the runtime service account, NOT the project: at project level serviceAccountUser confers
# actAs on the default Compute Engine account, which carries Editor — docs/DEPLOY.md §5.
gcloud iam service-accounts add-iam-policy-binding "$RUNTIME" \
  --member="serviceAccount:$DEPLOYER" --role=roles/iam.serviceAccountUser --quiet >/dev/null

gcloud artifacts repositories add-iam-policy-binding "$AR_REPOSITORY" --location="$REGION" \
  --member="serviceAccount:$DEPLOYER" --role=roles/artifactregistry.writer --quiet >/dev/null

# The one grant that stays project-wide, knowingly: Cloud Run IAM cannot be scoped to a service that
# does not exist yet. Tighten it after the first successful deploy — DEPLOY.md §5.
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:$DEPLOYER" --role=roles/run.admin \
  --condition=None --quiet >/dev/null

# ---------------------------------------------------------------------------------------------
say "Workload Identity Federation"
# ---------------------------------------------------------------------------------------------
if ! gcloud iam workload-identity-pools describe "$WIF_POOL" --location=global >/dev/null 2>&1; then
  gcloud iam workload-identity-pools create "$WIF_POOL" \
    --location=global --display-name="GitHub Actions" --quiet
fi

# THE ATTRIBUTE CONDITION AND SUBJECT ARE THE WHOLE SECURITY BOUNDARY, and the numeric IDs in the
# subject are not optional for a repository created after 2026-07-15 — docs/DEPLOY.md §5.1.
GITHUB_OWNER="${GITHUB_REPO%%/*}"
GITHUB_REPO_NAME="${GITHUB_REPO##*/}"

# Looked up live where `gh` is present, so repointing GITHUB_REPO cannot silently keep the previous
# repository's IDs. The pinned fallbacks are public identifiers, not secrets.
if command -v gh >/dev/null 2>&1; then
  ids="$(gh api "repos/${GITHUB_REPO}" --jq '.owner.id, .id' 2>/dev/null || true)"
  if [ -n "$ids" ]; then
    GITHUB_OWNER_ID="$(printf '%s\n' "$ids" | sed -n 1p)"
    GITHUB_REPO_ID="$(printf '%s\n' "$ids" | sed -n 2p)"
  fi
fi
GITHUB_OWNER_ID="${GITHUB_OWNER_ID:-59443747}"
GITHUB_REPO_ID="${GITHUB_REPO_ID:-1311579190}"

# Override wholesale for a repository old enough to still use `repo:OWNER/REPO:environment:NAME`, or
# one whose org customised the subject template. Any `:` inside an environment name becomes `%3A`.
GITHUB_SUBJECT="${GITHUB_SUBJECT:-repo:${GITHUB_OWNER}@${GITHUB_OWNER_ID}/${GITHUB_REPO_NAME}@${GITHUB_REPO_ID}:environment:${GITHUB_ENVIRONMENT}}"

# The repository clause is kept alongside the subject even though the subject identifies the repo,
# because it is checked against a claim the subject template cannot rewrite.
ATTR_CONDITION="assertion.repository == '${GITHUB_REPO}' && assertion.sub == '${GITHUB_SUBJECT}'"
ATTR_MAPPING="google.subject=assertion.sub,attribute.repository=assertion.repository"

if ! gcloud iam workload-identity-pools providers describe "$WIF_PROVIDER" \
      --location=global --workload-identity-pool="$WIF_POOL" >/dev/null 2>&1; then
  gcloud iam workload-identity-pools providers create-oidc "$WIF_PROVIDER" \
    --location=global --workload-identity-pool="$WIF_POOL" \
    --display-name="GitHub OIDC" \
    --issuer-uri="https://token.actions.githubusercontent.com" \
    --attribute-mapping="$ATTR_MAPPING" \
    --attribute-condition="$ATTR_CONDITION" \
    --quiet
else
  # Re-applied rather than skipped: the guard above asks whether a provider exists, not whether it
  # carries the current condition, and a stale one would keep a weaker rule in place.
  gcloud iam workload-identity-pools providers update-oidc "$WIF_PROVIDER" \
    --location=global --workload-identity-pool="$WIF_POOL" \
    --attribute-mapping="$ATTR_MAPPING" \
    --attribute-condition="$ATTR_CONDITION" \
    --quiet
fi

echo "  provider trusts subject: ${GITHUB_SUBJECT}"

# Second half of the same boundary: `principal://...subject/`, not `principalSet://...repository/`,
# so the binding is scoped to the same one job the provider condition trusts.
gcloud iam service-accounts add-iam-policy-binding "$DEPLOYER" \
  --role=roles/iam.workloadIdentityUser \
  --member="principal://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${WIF_POOL}/subject/${GITHUB_SUBJECT}" \
  --quiet >/dev/null

# ---------------------------------------------------------------------------------------------
say "Secret Manager"
# ---------------------------------------------------------------------------------------------
# All six must exist before the first `services replace`: cloudrun-sandbox.yaml holds a secretKeyRef
# to each. `printf '%s'`, or a trailing newline joins the value and reads later as a bad password.
SECRETS=(
  "draazy-sandbox-db-password:Supabase database password"
  "draazy-sandbox-jwt-secret:JWT signing key (openssl rand -base64 48)"
  "draazy-sandbox-referral-signal-salt:Referral signal salt (openssl rand -base64 32)"
  "draazy-sandbox-cashfree-webhook-secret:Cashfree webhook secret (any placeholder while disabled)"
  "draazy-sandbox-cashfree-app-id:Cashfree app id (any placeholder while disabled)"
  "draazy-sandbox-cashfree-secret-key:Cashfree secret key (any placeholder while disabled)"
)

for entry in "${SECRETS[@]}"; do
  name="${entry%%:*}"
  desc="${entry#*:}"

  if ! gcloud secrets describe "$name" >/dev/null 2>&1; then
    gcloud secrets create "$name" --replication-policy=automatic --quiet
  fi

  # Only prompts when the secret has no version, so a re-run neither asks for six values again nor
  # adds a redundant version — every version counts against the free tier's six.
  if gcloud secrets versions list "$name" --limit=1 --format='value(name)' 2>/dev/null | grep -q .; then
    echo "  $name — already has a version, skipping"
    continue
  fi

  printf '  %s\n    %s: ' "$name" "$desc"
  read -rs value
  printf '\n'
  [ -n "$value" ] || { echo "Empty value refused — the container would start and fail on first use." >&2; exit 1; }
  printf '%s' "$value" | gcloud secrets versions add "$name" --data-file=- --quiet >/dev/null
  unset value
done

# ---------------------------------------------------------------------------------------------
say "Done. Set these on the GitHub environment '${GITHUB_ENVIRONMENT}'"
# ---------------------------------------------------------------------------------------------
cat <<EOF

  Settings > Environments > ${GITHUB_ENVIRONMENT}

  Create the environment with that name EXACTLY, including case. It is not decoration: the deploy
  job's GCP credentials are only issued to a token whose subject names it, so a mismatch fails
  every deploy with a permission error that mentions neither the environment nor the case.

    trusted subject  ${GITHUB_SUBJECT}

  Variables (not secrets — these are identifiers, and the workflow file is public anyway):
    GCP_PROJECT_ID    ${PROJECT_ID}
    GCP_WIF_PROVIDER  projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${WIF_POOL}/providers/${WIF_PROVIDER}
    GCP_DEPLOYER_SA   ${DEPLOYER}

  Secrets (carry over unchanged from the previous project — Supabase is a separate vendor):
    SANDBOX_DB_URL         transaction pooler, port 6543
    SANDBOX_FLYWAY_DB_URL  session pooler, port 5432
    SANDBOX_DB_USER        postgres.<project-ref>

  If GCP_SA_KEY is still present from the key-based setup, DELETE IT — it is now unused, and an
  unused permanent credential is strictly worse than no credential. Then delete the key itself:
    gcloud iam service-accounts keys list --iam-account=${DEPLOYER}

  After the first deploy, repoint Cloudflare Pages at the new service or the site 502s:
    gcloud run services describe ${SERVICE} --region ${REGION} --format='value(status.url)'
  Pages > draazy > Settings > Environment variables > API_ORIGIN

EOF
