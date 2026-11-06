locals {
  name               = "willowsum-${var.environment}"
  parent_compartment = var.parent_compartment_ocid != "" ? var.parent_compartment_ocid : var.tenancy_ocid
  tags               = { "willowsum-environment" = var.environment, "willowsum-managed-by" = "opentofu" }
}

# One compartment per environment: separate resources, keys and access rules (CICD-04).
resource "oci_identity_compartment" "env" {
  compartment_id = local.parent_compartment
  name           = local.name
  description    = "Willowsum ${var.environment} (CICD-07, managed by OpenTofu)"
  enable_delete  = false
  freeform_tags  = local.tags
}

resource "oci_core_vcn" "main" {
  compartment_id = oci_identity_compartment.env.id
  cidr_blocks    = [var.vcn_cidr]
  display_name   = "${local.name}-vcn"
  dns_label      = "ws${substr(var.environment, 0, 4)}"
  freeform_tags  = local.tags
}

resource "oci_core_internet_gateway" "main" {
  compartment_id = oci_identity_compartment.env.id
  vcn_id         = oci_core_vcn.main.id
  display_name   = "${local.name}-igw"
  enabled        = true
  freeform_tags  = local.tags
}

resource "oci_core_route_table" "public" {
  compartment_id = oci_identity_compartment.env.id
  vcn_id         = oci_core_vcn.main.id
  display_name   = "${local.name}-public"
  freeform_tags  = local.tags

  route_rules {
    destination       = "0.0.0.0/0"
    destination_type  = "CIDR_BLOCK"
    network_entity_id = oci_core_internet_gateway.main.id
  }
}

# Only HTTP and HTTPS come in. There is no SSH from the internet: people reach the server only through
# the cloud console and managed access, agents never (CICD-08).
resource "oci_core_security_list" "public" {
  compartment_id = oci_identity_compartment.env.id
  vcn_id         = oci_core_vcn.main.id
  display_name   = "${local.name}-public"
  freeform_tags  = local.tags

  egress_security_rules {
    destination = "0.0.0.0/0"
    protocol    = "all"
  }

  dynamic "ingress_security_rules" {
    for_each = { for pair in setproduct(var.public_ingress_cidrs, [80, 443]) : "${pair[0]}-${pair[1]}" => pair }
    content {
      protocol = "6" # TCP
      source   = ingress_security_rules.value[0]
      tcp_options {
        min = ingress_security_rules.value[1]
        max = ingress_security_rules.value[1]
      }
    }
  }

  # Path MTU discovery.
  ingress_security_rules {
    protocol = "1" # ICMP
    source   = "0.0.0.0/0"
    icmp_options {
      type = 3
      code = 4
    }
  }
}

resource "oci_core_subnet" "public" {
  compartment_id             = oci_identity_compartment.env.id
  vcn_id                     = oci_core_vcn.main.id
  cidr_block                 = cidrsubnet(var.vcn_cidr, 8, 1)
  display_name               = "${local.name}-public"
  dns_label                  = "public"
  route_table_id             = oci_core_route_table.public.id
  security_list_ids          = [oci_core_security_list.public.id]
  prohibit_public_ip_on_vnic = false
  freeform_tags              = local.tags
}
