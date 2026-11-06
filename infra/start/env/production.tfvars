# Production (CICD-04): real users; changes only through a PR with the plan, applied with the owner's approval.
environment       = "production"
region            = "eu-madrid-1"
backup_region     = "eu-frankfurt-1"
vcn_cidr          = "10.20.0.0/16"
server_ocpus      = 3
server_memory_gbs = 18
boot_volume_gbs   = 100
