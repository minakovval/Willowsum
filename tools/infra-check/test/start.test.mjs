// Static rules for the «Старт» infrastructure (infra/start). `tofu fmt` and `tofu validate` run in CI.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { REPO_ROOT, START_DIR, allBlocks, code, resources, tfFiles, tfvars } from '../lib/hcl.mjs';

const ENVS = ['staging', 'production'];
const envVars = Object.fromEntries(ENVS.map((e) => [e, tfvars(path.join(START_DIR, 'env', `${e}.tfvars`))]));
const versions = fs.readFileSync(path.join(START_DIR, 'versions.tf'), 'utf8');

test('CICD-03 FR3/FR4: OpenTofu and the OCI provider are pinned to exact versions', () => {
  assert.match(versions, /required_version\s*=\s*"= \d+\.\d+\.\d+"/);
  assert.match(versions, /source\s*=\s*"oracle\/oci"\s*\n\s*version\s*=\s*"= \d+\.\d+\.\d+"/);
});

test('CICD-07 FR1: both environments are described by the same code, each with its own values', () => {
  for (const env of ENVS) assert.equal(envVars[env].environment, env);
  assert.notEqual(envVars.staging.vcn_cidr, envVars.production.vcn_cidr);
});

test('NFR-17 / CICD-07 FR2: data in an EU region, off-site copies in another EU region', () => {
  for (const env of ENVS) {
    const v = envVars[env];
    assert.equal(v.region, 'eu-madrid-1', `${env}: primary region is Madrid (NFR-17)`);
    assert.match(v.backup_region, /^eu-[a-z]+-\d+$/, `${env}: backup region is in the EU`);
    assert.notEqual(v.backup_region, v.region, `${env}: copies are in another region`);
  }
  const backupBuckets = resources('oci_objectstorage_bucket').filter((b) => /provider\s*=\s*oci\.backup/.test(b.body));
  assert.deepEqual(backupBuckets.map((b) => b.labels[1]).sort(), ['backups', 'secrets_backup']);
});

test('ARC «Старт»: the free tier is enough for both servers (4 OCPU, 24 GB, 200 GB disk in total)', () => {
  const sum = (k) => ENVS.reduce((s, e) => s + envVars[e][k], 0);
  assert.ok(sum('server_ocpus') <= 4);
  assert.ok(sum('server_memory_gbs') <= 24);
  assert.ok(sum('boot_volume_gbs') <= 200);
});

test('CICD-07 FR2 / NFR-16: copies and old file versions are kept 35 days, then expire', () => {
  assert.match(fs.readFileSync(path.join(START_DIR, 'variables.tf'), 'utf8'), /backup_retention_days == 35/);
  const policies = resources('oci_objectstorage_object_lifecycle_policy');
  assert.ok(policies.length >= 2);
  for (const p of policies) {
    for (const rule of p.body.split(/\n\s*rules\s*\{/).slice(1)) {
      assert.match(rule, /time_amount\s*=\s*var\.backup_retention_days/, `${p.labels[1]}: retention`);
      assert.match(rule, /time_unit\s*=\s*"DAYS"/);
    }
  }
  const backups = policies.find((p) => p.labels[1] === 'backups');
  assert.match(backups.body, /target\s*=\s*"objects"/);
  const files = policies.find((p) => p.labels[1] === 'files');
  assert.match(files.body, /target\s*=\s*"previous-object-versions"/);
});

test('ARC-06 FR5 / CICD-07 FR2: copy buckets keep no hidden versions, so a copy is gone after exactly 35 days', () => {
  for (const b of resources('oci_objectstorage_bucket').filter((x) => /provider\s*=\s*oci\.backup/.test(x.body))) {
    assert.match(b.body, /versioning\s*=\s*"Disabled"/, b.labels[1]);
  }
});

test('ARC-06 FR4: every bucket is private; the files bucket is encrypted with the storage key', () => {
  const buckets = resources('oci_objectstorage_bucket');
  assert.equal(buckets.length, 3);
  for (const b of buckets) {
    assert.match(b.body, /access_type\s*=\s*"NoPublicAccess"/, b.labels[1]);
  }
  const files = buckets.find((b) => b.labels[1] === 'files');
  assert.match(files.body, /kms_key_id\s*=\s*oci_kms_key\.storage\.id/);
  assert.match(files.body, /versioning\s*=\s*"Enabled"/, 'deleted user files stay recoverable for the retention period');
});

test('ARC-06 FR1 / CICD-12 FR4: the master key lives in managed KMS, HSM-protected, AES-256', () => {
  const keys = resources('oci_kms_key');
  assert.deepEqual(keys.map((k) => k.labels[1]).sort(), ['master', 'storage']);
  for (const k of keys) {
    assert.match(k.body, /protection_mode\s*=\s*"HSM"/, k.labels[1]);
    assert.match(k.body, /algorithm\s*=\s*"AES"/);
    assert.match(k.body, /length\s*=\s*32/);
  }
});

test('ARC-06: the server disk is encrypted with the KMS key and in transit', () => {
  const [server] = resources('oci_core_instance');
  assert.match(server.body, /kms_key_id\s*=\s*oci_kms_key\.storage\.id/);
  assert.match(server.body, /is_pv_encryption_in_transit_enabled\s*=\s*true/);
});

test('CICD-08 FR2: no SSH from the internet and no SSH keys on the server', () => {
  const lists = resources('oci_core_security_list');
  for (const l of lists) {
    assert.doesNotMatch(code(l.body), /min\s*=\s*22\b/);
    assert.doesNotMatch(code(l.body), /protocol\s*=\s*"all"[^}]*source/s, 'no allow-all ingress');
  }
  // The only TCP ports opened to the internet are 80 and 443.
  assert.match(code(lists[0].body), /setproduct\(var\.public_ingress_cidrs, \[80, 443\]\)/);
  for (const f of tfFiles()) assert.doesNotMatch(code(f.text), /ssh_authorized_keys/, f.name);
  // The VCN's default security list (SSH from anywhere by default) is managed and emptied.
  const [def] = resources('oci_core_default_security_list');
  assert.ok(def, 'default security list is managed');
  assert.match(def.body, /manage_default_resource_id\s*=\s*oci_core_vcn\.main\.default_security_list_id/);
  assert.doesNotMatch(code(def.body), /ingress_security_rules|egress_security_rules/, 'no rules at all');
  const cloudInit = fs.readFileSync(path.join(START_DIR, 'cloud-init.yaml'), 'utf8');
  assert.match(cloudInit, /^ssh_pwauth: false$/m);
});

test('CICD-07 FR2 / ARC-06 FR1: the vault, keys, buckets and the server cannot be destroyed by a plan', () => {
  const guarded = [
    ['oci_kms_vault', 'main'],
    ['oci_kms_key', 'master'],
    ['oci_kms_key', 'storage'],
    ['oci_objectstorage_bucket', 'files'],
    ['oci_objectstorage_bucket', 'backups'],
    ['oci_objectstorage_bucket', 'secrets_backup'],
    ['oci_core_instance', 'server'],
  ];
  for (const [type, name] of guarded) {
    const r = resources(type).find((x) => x.labels[1] === name);
    assert.ok(r, `${type}.${name} exists`);
    assert.match(r.body, /lifecycle\s*\{[^}]*prevent_destroy\s*=\s*true/s, `${type}.${name} has prevent_destroy`);
  }
  const [server] = resources('oci_core_instance');
  assert.match(server.body, /preserve_boot_volume\s*=\s*true/, 'the database disk outlives the instance');
});

test('CICD-12: the server serves only IMDS v2, so a request forgery cannot take its cloud identity', () => {
  const [server] = resources('oci_core_instance');
  assert.match(server.body, /instance_options\s*\{\s*are_legacy_imds_endpoints_disabled\s*=\s*true\s*\}/);
});

test('CICD-12 FR1: no credentials, tenancy identifiers or OCIDs in the code', () => {
  for (const f of [...tfFiles(), ...ENVS.map((e) => ({ name: `${e}.tfvars`, text: fs.readFileSync(path.join(START_DIR, 'env', `${e}.tfvars`), 'utf8') }))]) {
    const body = code(f.text);
    assert.doesNotMatch(body, /ocid1\.[a-z]+\.oc1\./, `${f.name}: no hard-coded OCID`);
    assert.doesNotMatch(body, /(private_key|fingerprint|user_ocid|password)\s*=/i, `${f.name}: no credentials`);
  }
  const provider = fs.readFileSync(path.join(START_DIR, 'providers.tf'), 'utf8');
  assert.doesNotMatch(code(provider), /tenancy_ocid|user_ocid|private_key|fingerprint/);
});

test('CICD-12: state and plans are encrypted on the client, enforced, with a passphrase from outside', () => {
  assert.match(versions, /key_provider "pbkdf2" "state"\s*\{\s*passphrase\s*=\s*var\.state_passphrase/);
  assert.match(versions, /state\s*\{\s*method\s*=\s*method\.aes_gcm\.state\s*enforced\s*=\s*true/);
  assert.match(versions, /plan\s*\{\s*method\s*=\s*method\.aes_gcm\.state\s*enforced\s*=\s*true/);
  const variables = fs.readFileSync(path.join(START_DIR, 'variables.tf'), 'utf8');
  assert.match(variables, /variable "state_passphrase"[^]*?sensitive\s*=\s*true/);
  assert.match(versions, /backend "s3" \{\}/, 'backend details are not in the code');
});

test('NFR-16 / CICD-07 FR2: the server can add and read copies but cannot delete them', () => {
  const [policy] = resources('oci_identity_policy').filter((p) => p.labels[1] === 'server');
  const statements = [...policy.body.matchAll(/^\s*"(Allow [^\n]*)",?$/gm)].map((m) => m[1]);
  const backup = statements.filter((s) => /backups\.name|secrets_backup\.name/.test(s));
  assert.equal(backup.length, 1);
  assert.match(backup[0], /request\.permission = 'OBJECT_CREATE'/);
  assert.doesNotMatch(backup[0], /OBJECT_DELETE|OBJECT_OVERWRITE/);
  for (const s of statements) assert.match(s, / where /, `scoped: ${s.slice(0, 60)}`);
  for (const s of statements) assert.doesNotMatch(s, /\bin tenancy\b/, 'never tenancy-wide');
});

test('CICD-07 FR1: every resource is tagged with its environment and «managed by OpenTofu»', () => {
  const taggable = allBlocks().filter(
    (b) => b.kind === 'resource' && !/lifecycle_policy$/.test(b.labels[0]) && b.labels[0] !== 'oci_identity_policy' && b.labels[0] !== 'oci_core_route_table',
  );
  for (const r of taggable) assert.match(r.body, /freeform_tags\s*=\s*local\.tags/, `${r.labels.join('.')}`);
  assert.match(fs.readFileSync(path.join(START_DIR, 'network.tf'), 'utf8'), /"willowsum-managed-by" = "opentofu"/);
});

test('CICD-12 FR1: filled-in backend configs, state and plans are git-ignored', () => {
  for (const file of ['infra/start/env/production.s3.tfbackend', 'infra/start/.terraform/x', 'infra/start/x.tfstate', 'infra/start/x.tfplan']) {
    assert.equal(spawnSync('git', ['check-ignore', '-q', file], { cwd: REPO_ROOT }).status, 0, file);
  }
});

test('CICD-03 FR3: the CI job installs OpenTofu with an action pinned to a full commit hash and the same version', () => {
  const wf = fs.readFileSync(path.join(REPO_ROOT, '.github/workflows/pr-checks.yml'), 'utf8');
  assert.match(wf, /uses: opentofu\/setup-opentofu@[0-9a-f]{40} # v\d+\.\d+\.\d+/);
  const version = /required_version\s*=\s*"= ([\d.]+)"/.exec(versions)[1];
  assert.match(wf, new RegExp(`tofu_version: "${version.replaceAll('.', '\\.')}"`));
});
