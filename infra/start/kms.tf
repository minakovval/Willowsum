# Keys live in the managed KMS of the hosting cloud (OCI Vault) and never leave it (ARC-06, CICD-12,
# NFR-16). Keys are HSM-protected. Annual rotation follows the procedure in ARC-06 (rewrapping in the
# background), not this file.
resource "oci_kms_vault" "main" {
  compartment_id = oci_identity_compartment.env.id
  display_name   = "${local.name}-vault"
  vault_type     = "DEFAULT"
  freeform_tags  = local.tags

  # Destroying this would make every encrypted copy unreadable or lose data; removing it takes a
  # deliberate code change first (review of PR #70).
  lifecycle {
    prevent_destroy = true
  }
}

# Master key of the application: wraps the per-space data keys (ARC-06 FR1). Used only through the
# application's KMS adapter.
resource "oci_kms_key" "master" {
  compartment_id      = oci_identity_compartment.env.id
  display_name        = "${local.name}-master"
  management_endpoint = oci_kms_vault.main.management_endpoint
  protection_mode     = "HSM"
  freeform_tags       = local.tags

  key_shape {
    algorithm = "AES"
    length    = 32
  }

  # Destroying this would make every encrypted copy unreadable or lose data; removing it takes a
  # deliberate code change first (review of PR #70).
  lifecycle {
    prevent_destroy = true
  }
}

# Encryption at rest of the server's disk and the files bucket.
resource "oci_kms_key" "storage" {
  compartment_id      = oci_identity_compartment.env.id
  display_name        = "${local.name}-storage"
  management_endpoint = oci_kms_vault.main.management_endpoint
  protection_mode     = "HSM"
  freeform_tags       = local.tags

  key_shape {
    algorithm = "AES"
    length    = 32
  }

  # Destroying this would make every encrypted copy unreadable or lose data; removing it takes a
  # deliberate code change first (review of PR #70).
  lifecycle {
    prevent_destroy = true
  }
}
