# Credentials are never in the code: locally from the owner's OCI CLI profile, in CI from short-lived
# tokens (CICD-12, OIDC; added in a later PR).
provider "oci" {
  region = var.region
}

# Off-site copies live in another EU region (CICD-07 FR2, NFR-16).
provider "oci" {
  alias  = "backup"
  region = var.backup_region
}
