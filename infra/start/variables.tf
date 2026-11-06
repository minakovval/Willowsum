variable "environment" {
  description = "Environment this state describes (CICD-04): staging or production. Each has its own state, keys and buckets."
  type        = string
  validation {
    condition     = contains(["staging", "production"], var.environment)
    error_message = "environment must be staging or production."
  }
}

variable "tenancy_ocid" {
  description = "OCID of the tenancy. Passed as TF_VAR_tenancy_ocid; not stored in the repository."
  type        = string
  validation {
    condition     = can(regex("^ocid1\\.tenancy\\.", var.tenancy_ocid))
    error_message = "tenancy_ocid must be a tenancy OCID."
  }
}

variable "parent_compartment_ocid" {
  description = "Compartment under which the environment's compartment is created. Empty means the tenancy root."
  type        = string
  default     = ""
}

variable "region" {
  description = "Primary region: application, database and files. EU only (NFR-17: Madrid)."
  type        = string
  validation {
    condition     = can(regex("^eu-[a-z]+-[0-9]+$", var.region))
    error_message = "region must be an EU region (eu-*)."
  }
}

variable "backup_region" {
  description = "Region for off-site backups: another EU region (CICD-07 FR2)."
  type        = string
  validation {
    condition     = can(regex("^eu-[a-z]+-[0-9]+$", var.backup_region))
    error_message = "backup_region must be an EU region (eu-*)."
  }
}

variable "vcn_cidr" {
  description = "Address range of the environment's network."
  type        = string
}

variable "public_ingress_cidrs" {
  description = "Sources allowed to reach HTTP and HTTPS on the server. Narrowed to the CDN's ranges once the CDN is chosen."
  type        = list(string)
  default     = ["0.0.0.0/0"]
}

variable "server_ocpus" {
  description = "OCPUs of the Ampere A1 server (Always Free allows 4 in total across all servers)."
  type        = number
}

variable "server_memory_gbs" {
  description = "Memory of the server in GB (Always Free allows 24 in total)."
  type        = number
}

variable "boot_volume_gbs" {
  description = "Boot volume size in GB; it also holds the PostgreSQL data (Always Free allows 200 in total)."
  type        = number
  default     = 100
}

variable "backup_retention_days" {
  description = "How long off-site copies are kept (CICD-07 FR2: 35 days)."
  type        = number
  default     = 35
  validation {
    condition     = var.backup_retention_days == 35
    error_message = "CICD-07 fixes the backup retention at 35 days."
  }
}

variable "state_passphrase" {
  description = "Passphrase for state encryption. From the secrets store via TF_VAR_state_passphrase; at least 32 characters."
  type        = string
  sensitive   = true

  # null only for `tofu validate` without a backend; init and plan with a backend need the real value.
  default = null
  validation {
    condition     = var.state_passphrase == null || length(coalesce(var.state_passphrase, "")) >= 32
    error_message = "state_passphrase must be at least 32 characters."
  }
}
