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

  lifecycle {
    prevent_destroy = true
  }
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
# No versioning on the copy buckets: the server cannot overwrite or delete copies (access.tf), and
# without versions a copy expires exactly after the retention period (ARC-06 FR5: within 35 days).
resource "oci_objectstorage_bucket" "backups" {
  provider       = oci.backup
  compartment_id = oci_identity_compartment.env.id
  namespace      = local.namespace
  name           = "${local.name}-backups"
  access_type    = "NoPublicAccess"
  versioning     = "Disabled"
  freeform_tags  = local.tags

  # While this rule is in place nobody can delete or change a copy before it is 35 days old. Only someone
  # who can manage the bucket can remove the rule first; the server cannot. The rule is not locked, so it
  # can still be adjusted by a reviewed PR.
  retention_rules {
    display_name = "keep-${var.backup_retention_days}-days"
    duration {
      time_amount = var.backup_retention_days
      time_unit   = "DAYS"
    }
  }

  # Destroying this would make every encrypted copy unreadable or lose data; removing it takes a
  # deliberate code change first (review of PR #70).
  lifecycle {
    prevent_destroy = true
  }
}

# The secrets package (NFR-16): a separate bucket, encrypted with the owner's public key before upload.
resource "oci_objectstorage_bucket" "secrets_backup" {
  provider       = oci.backup
  compartment_id = oci_identity_compartment.env.id
  namespace      = local.namespace
  name           = "${local.name}-secrets-backup"
  access_type    = "NoPublicAccess"
  versioning     = "Disabled"
  freeform_tags  = local.tags

  # While this rule is in place nobody can delete or change a copy before it is 35 days old. Only someone
  # who can manage the bucket can remove the rule first; the server cannot. The rule is not locked, so it
  # can still be adjusted by a reviewed PR.
  retention_rules {
    display_name = "keep-${var.backup_retention_days}-days"
    duration {
      time_amount = var.backup_retention_days
      time_unit   = "DAYS"
    }
  }

  # Destroying this would make every encrypted copy unreadable or lose data; removing it takes a
  # deliberate code change first (review of PR #70).
  lifecycle {
    prevent_destroy = true
  }
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

  depends_on = [oci_identity_policy.services]
}
