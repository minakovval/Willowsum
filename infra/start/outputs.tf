output "server_public_ip" {
  description = "Public address of the server (behind the CDN once it is set up)."
  value       = oci_core_instance.server.public_ip
}

output "object_storage_namespace" {
  value = local.namespace
}

output "buckets" {
  description = "Bucket names: files in the primary region, copies in the backup region."

  value = {
    files          = oci_objectstorage_bucket.files.name
    backups        = oci_objectstorage_bucket.backups.name
    secrets_backup = oci_objectstorage_bucket.secrets_backup.name
  }
}

output "master_key_id" {
  description = "Master key for the application's KMS adapter (an identifier, not key material)."
  value       = oci_kms_key.master.id
}

output "kms_crypto_endpoint" {
  value = oci_kms_vault.main.crypto_endpoint
}
