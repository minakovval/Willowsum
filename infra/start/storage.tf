data "oci_objectstorage_namespace" "main" {
  compartment_id = var.tenancy_ocid
}

locals {
  namespace = data.oci_objectstorage_namespace.main.namespace
}

# Users' files (ARC-06 FR4): private, encrypted with the storage key. The application additionally
# encrypts every file with the space's key and serves it only through short-lived signed links.
resource "oci_objectstorage_bucket" "files" {
  compartment_id = oci_identity_compartment.env.id
  namespace      = local.namespace
  name           = "${local.name}-files"
  access_type    = "NoPublicAccess"
  kms_key_id     = oci_kms_key.storage.id
  versioning     = "Enabled"
  freeform_tags  = local.tags

  depends_on = [oci_identity_policy.services]
}

resource "oci_objectstorage_object_lifecycle_policy" "files" {
  namespace = local.namespace
  bucket    = oci_objectstorage_bucket.files.name

  rules {
    name        = "drop-old-versions"
    action      = "DELETE"
    target      = "previous-object-versions"
    is_enabled  = true
    time_amount = var.backup_retention_days
    time_unit   = "DAYS"
  }

  depends_on = [oci_identity_policy.services]
}

# Off-site copies in another EU region (CICD-07 FR2, NFR-16): WAL segments, daily base copies and the
# incremental copy of files. Encrypted by the backup tool before they are sent; kept 35 days.
resource "oci_objectstorage_bucket" "backups" {
  provider       = oci.backup
  compartment_id = oci_identity_compartment.env.id
  namespace      = local.namespace
  name           = "${local.name}-backups"
  access_type    = "NoPublicAccess"
  versioning     = "Enabled"
  freeform_tags  = local.tags
}

# The secrets package (NFR-16): a separate bucket, encrypted with the owner's public key before upload.
resource "oci_objectstorage_bucket" "secrets_backup" {
  provider       = oci.backup
  compartment_id = oci_identity_compartment.env.id
  namespace      = local.namespace
  name           = "${local.name}-secrets-backup"
  access_type    = "NoPublicAccess"
  versioning     = "Enabled"
  freeform_tags  = local.tags
}

resource "oci_objectstorage_object_lifecycle_policy" "backups" {
  for_each = {
    backups        = oci_objectstorage_bucket.backups.name
    secrets_backup = oci_objectstorage_bucket.secrets_backup.name
  }

  provider  = oci.backup
  namespace = local.namespace
  bucket    = each.value

  rules {
    name        = "expire-copies"
    action      = "DELETE"
    target      = "objects"
    is_enabled  = true
    time_amount = var.backup_retention_days
    time_unit   = "DAYS"
  }

  # An overwritten or deleted copy stays recoverable for the same period.
  rules {
    name        = "expire-old-versions"
    action      = "DELETE"
    target      = "previous-object-versions"
    is_enabled  = true
    time_amount = var.backup_retention_days
    time_unit   = "DAYS"
  }

  depends_on = [oci_identity_policy.services]
}
