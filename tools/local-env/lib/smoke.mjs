// Smoke checks against a running local stack: each service answers with the expected technology and
// rejects access without the generated credentials. Only synthetic values are written.
import crypto from 'node:crypto';
import net from 'node:net';
import { compose } from './docker.mjs';
import { s3Request, s3Url } from './s3.mjs';

/** Runs SQL inside the postgres container; returns trimmed stdout. */
export function psql(envPath, values, sql) {
  const res = compose(
    envPath,
    ['exec', '-T', 'postgres', 'psql', '-v', 'ON_ERROR_STOP=1', '-U', values.WS_LOCAL_PG_USER, '-d', values.WS_LOCAL_PG_DB, '-tA', '-c', sql],
    { capture: true },
  );
  if (res.status !== 0) throw new Error(`psql failed: ${res.stderr.trim()}`);
  return res.stdout.trim();
}

/**
 * Sends one message over SMTP with AUTH PLAIN. Resolves with the final server reply code.
 * Rejects with the failing reply when a step is refused.
 */
export function sendMail(values, { user, password, from, to, subject, text }) {
  const auth = Buffer.from(`\0${user}\0${password}`).toString('base64');
  const steps = [
    ['EHLO willowsum-local', 250],
    [`AUTH PLAIN ${auth}`, 235],
    [`MAIL FROM:<${from}>`, 250],
    [`RCPT TO:<${to}>`, 250],
    ['DATA', 354],
    [`From: <${from}>\r\nTo: <${to}>\r\nSubject: ${subject}\r\n\r\n${text}\r\n.`, 250],
    ['QUIT', 221],
  ];
  return new Promise((resolve, reject) => {
    const socket = net.connect(Number(values.WS_LOCAL_SMTP_PORT), '127.0.0.1');
    let buffer = '';
    let step = -1; // -1: waiting for the 220 greeting
    socket.setTimeout(10_000, () => socket.destroy(new Error('SMTP timeout')));
    socket.on('error', reject);
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      // A complete reply ends with a line "NNN text" (no dash after the code).
      const lines = buffer.split('\r\n');
      const last = lines.findLast((l) => /^\d{3} /.test(l));
      if (!last) return;
      buffer = '';
      const code = Number(last.slice(0, 3));
      const expected = step === -1 ? 220 : steps[step][1];
      if (code !== expected) {
        socket.end();
        reject(new Error(`SMTP step ${step === -1 ? 'greeting' : steps[step][0].split(' ')[0]} got ${code}`));
        return;
      }
      step += 1;
      if (step === steps.length) {
        socket.end();
        resolve(code);
        return;
      }
      socket.write(`${steps[step][0]}\r\n`);
    });
  });
}

export function mailAuthHeader(values) {
  const login = `${values.WS_LOCAL_MAIL_UI_USER}:${values.WS_LOCAL_MAIL_UI_PASSWORD}`;
  return { authorization: `Basic ${Buffer.from(login).toString('base64')}` };
}

export function mailApiUrl(values, pathAndQuery) {
  return `http://127.0.0.1:${values.WS_LOCAL_MAIL_UI_PORT}${pathAndQuery}`;
}

export async function mailCount(values, query) {
  const url = mailApiUrl(values, `/api/v1/search?query=${encodeURIComponent(query)}`);
  const res = await fetch(url, { headers: mailAuthHeader(values) });
  if (!res.ok) throw new Error(`Mail API HTTP ${res.status}`);
  return (await res.json()).messages_count;
}

/**
 * Opens a TCP connection to the published PostgreSQL port, sends a protocol 3.0 StartupMessage and
 * returns the server's first authentication request (code and, for SASL, the offered mechanisms).
 * No password is sent; the connection is closed right after.
 */
export function pgAuthRequest(values) {
  const params = Buffer.from(`user\0${values.WS_LOCAL_PG_USER}\0database\0${values.WS_LOCAL_PG_DB}\0\0`);
  const startup = Buffer.alloc(8 + params.length);
  startup.writeInt32BE(startup.length, 0);
  startup.writeInt32BE(196608, 4); // protocol 3.0
  params.copy(startup, 8);
  return new Promise((resolve, reject) => {
    const socket = net.connect(Number(values.WS_LOCAL_PG_PORT), '127.0.0.1', () => socket.write(startup));
    let buffer = Buffer.alloc(0);
    socket.setTimeout(10_000, () => socket.destroy(new Error('PostgreSQL timeout')));
    socket.on('error', reject);
    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length < 5) return;
      const length = buffer.readInt32BE(1);
      if (buffer.length < 1 + length) return;
      socket.destroy();
      const type = String.fromCharCode(buffer[0]);
      if (type !== 'R') return reject(new Error(`unexpected PostgreSQL message ${type}`));
      const code = buffer.readInt32BE(5);
      const mechanisms = code === 10 ? buffer.subarray(9, 1 + length).toString('utf8').split('\0').filter(Boolean) : [];
      resolve({ code, mechanisms });
    });
  });
}

export const token = () => crypto.randomBytes(6).toString('hex');

export { s3Request, s3Url };
