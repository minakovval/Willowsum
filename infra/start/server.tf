data "oci_identity_availability_domains" "all" {
  compartment_id = var.tenancy_ocid
}

data "oci_core_images" "ubuntu" {
  compartment_id           = var.tenancy_ocid
  operating_system         = "Canonical Ubuntu"
  operating_system_version = "24.04"
  shape                    = "VM.Standard.A1.Flex"
  sort_by                  = "TIMECREATED"
  sort_order               = "DESC"
}

# One server per environment (ARC «Старт»: one VM from the free tier, containers under Docker Compose).
# No SSH keys: nobody logs in with a key from the internet (CICD-08).
resource "oci_core_instance" "server" {
  compartment_id                      = oci_identity_compartment.env.id
  availability_domain                 = data.oci_identity_availability_domains.all.availability_domains[0].name
  display_name                        = "${local.name}-server"
  shape                               = "VM.Standard.A1.Flex"
  is_pv_encryption_in_transit_enabled = true
  freeform_tags                       = local.tags

  shape_config {
    ocpus         = var.server_ocpus
    memory_in_gbs = var.server_memory_gbs
  }

  create_vnic_details {
    subnet_id        = oci_core_subnet.public.id
    assign_public_ip = true
    display_name     = "${local.name}-server"
    hostname_label   = "server"
  }

  source_details {
    source_type             = "image"
    source_id               = data.oci_core_images.ubuntu.images[0].id
    boot_volume_size_in_gbs = var.boot_volume_gbs
    kms_key_id              = oci_kms_key.storage.id
  }

  metadata = {
    user_data = base64encode(file("${path.module}/cloud-init.yaml"))
  }

  lifecycle {
    # A newer base image must not replace the running server; the server is rebuilt on purpose only.
    ignore_changes = [source_details[0].source_id]
  }

  depends_on = [oci_identity_policy.services]
}
