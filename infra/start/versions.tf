# CICD-07@PoC: infrastructure of the «Старт» profile (ARC-08) as code. Versions are pinned exactly
# (CICD-03); a new version goes in through a PR, at least 7 days after its release.
terraform {
  required_version = "= 1.13.2"

  required_providers {
    oci = {
      source  = "oracle/oci"
      version = "= 9.11.0"
    }
  }

  # Remote state in Object Storage (S3-compatible API). Bucket, key and endpoint are passed at
  # `tofu init -backend-config=env/<environment>.s3.tfbackend`, so no tenancy details live in the code.
  backend "s3" {}

  # State and plans are encrypted on the client before they leave the machine (AES-GCM, key derived
  # from a passphrase kept in the secrets store, never in the repository).
  encryption {
    key_provider "pbkdf2" "state" {
      passphrase = var.state_passphrase
    }
    method "aes_gcm" "state" {
      keys = key_provider.pbkdf2.state
    }
    state {
      method   = method.aes_gcm.state
      enforced = true
    }
    plan {
      method   = method.aes_gcm.state
      enforced = true
    }
  }
}
