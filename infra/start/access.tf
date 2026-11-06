# Access rules (CICD-12, CICD-08). The server authenticates as itself (instance principal); it holds
# no stored cloud keys.
resource "oci_identity_dynamic_group" "server" {
  compartment_id = var.tenancy_ocid
  name           = "${local.name}-server"
  description    = "Willowsum ${var.environment} server (managed by OpenTofu)"
  matching_rule  = "ALL {instance.id = '${oci_core_instance.server.id}'}"
  freeform_tags  = local.tags
}

locals {
  server_group = "dynamic-group ${oci_identity_dynamic_group.server.name}"
  compartment  = "compartment id ${oci_identity_compartment.env.id}"
}

resource "oci_identity_policy" "server" {
  compartment_id = oci_identity_compartment.env.id
  name           = "${local.name}-server"
  description    = "What the Willowsum ${var.environment} server may do (managed by OpenTofu)"
  freeform_tags  = local.tags

  statements = [
    # The KMS adapter wraps and unwraps space keys with the master key; the key never leaves KMS.
    "Allow ${local.server_group} to use keys in ${local.compartment} where target.key.id = '${oci_kms_key.master.id}'",
    # Users' files: read and write through the file-storage adapter.
    "Allow ${local.server_group} to manage objects in ${local.compartment} where target.bucket.name = '${oci_objectstorage_bucket.files.name}'",
    # Off-site copies: the server may add and read copies, never delete or overwrite history, so a
    # compromised server cannot destroy the backups. Expiry is done by the lifecycle policy.
    "Allow ${local.server_group} to manage objects in ${local.compartment} where all {any {target.bucket.name = '${oci_objectstorage_bucket.backups.name}', target.bucket.name = '${oci_objectstorage_bucket.secrets_backup.name}'}, any {request.permission = 'OBJECT_CREATE', request.permission = 'OBJECT_INSPECT', request.permission = 'OBJECT_READ'}}",
  ]
}

# Cloud services that need the keys or run the lifecycle rules.
resource "oci_identity_policy" "services" {
  compartment_id = oci_identity_compartment.env.id
  name           = "${local.name}-services"
  description    = "Cloud services used by Willowsum ${var.environment} (managed by OpenTofu)"
  freeform_tags  = local.tags

  statements = [
    "Allow service blockstorage, objectstorage-${var.region} to use keys in ${local.compartment} where target.key.id = '${oci_kms_key.storage.id}'",
    "Allow service objectstorage-${var.region}, objectstorage-${var.backup_region} to manage object-family in ${local.compartment}",
  ]
}
