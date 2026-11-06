# Staging (CICD-04): synthetic data and provider sandboxes only.
environment       = "staging"
region            = "eu-madrid-1"
backup_region     = "eu-frankfurt-1"
vcn_cidr          = "10.21.0.0/16"
server_ocpus      = 1
server_memory_gbs = 6
boot_volume_gbs   = 50
