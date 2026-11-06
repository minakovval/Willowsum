// What `pnpm local:up` and `pnpm local:status` print: where to connect. Never prints secret values
// (SECRET_KEYS); credentials stay in the generated env file.
export function connectionInfo(values, envFileLabel) {
  return [
    `PostgreSQL 17  127.0.0.1:${values.WS_LOCAL_PG_PORT}  db=${values.WS_LOCAL_PG_DB} user=${values.WS_LOCAL_PG_USER}`,
    `SMTP           127.0.0.1:${values.WS_LOCAL_SMTP_PORT}  user=${values.WS_LOCAL_SMTP_USER} (AUTH PLAIN; mail never leaves the machine)`,
    `Mail web UI    http://127.0.0.1:${values.WS_LOCAL_MAIL_UI_PORT}  user=${values.WS_LOCAL_MAIL_UI_USER}`,
    `S3             http://127.0.0.1:${values.WS_LOCAL_S3_PORT}  bucket=${values.WS_LOCAL_S3_BUCKET} region=${values.WS_LOCAL_S3_REGION} (path-style)`,
    `Credentials    ${envFileLabel} (generated, git-ignored)`,
  ].join('\n');
}
