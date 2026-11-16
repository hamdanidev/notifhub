#!/usr/bin/env node
/**
 * Minimal SMTP sink for local verification of the email provider.
 *
 * It is NOT part of the stack and is never started by docker-compose (which only runs
 * PostgreSQL and Redis). Use it to prove that staging redirects every message to
 * CATCH_ALL_RECIPIENT and that production targets the real recipient.
 *
 * Usage:
 *   node scripts/dev-smtp-sink.mjs            # listens on 127.0.0.1:2525
 *   SMTP_SINK_PORT=2525 node scripts/dev-smtp-sink.mjs
 */
import net from 'node:net';

const port = Number(process.env.SMTP_SINK_PORT ?? 2525);
const host = process.env.SMTP_SINK_HOST ?? '127.0.0.1';

net
  .createServer((socket) => {
    let buffer = '';
    let dataMode = false;
    let message = '';
    let envelope = { from: '', recipients: [] };

    socket.write('220 notifhub-dev-smtp-sink ESMTP\r\n');

    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');

      let index = buffer.indexOf('\r\n');
      while (index !== -1) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        handleLine(line);
        index = buffer.indexOf('\r\n');
      }
    });

    socket.on('error', () => {
      // Client disconnected; nothing to clean up.
    });

    function handleLine(line) {
      if (dataMode) {
        if (line === '.') {
          dataMode = false;
          process.stdout.write(
            `\n[SMTP SINK] message from ${envelope.from} to ${envelope.recipients.join(', ')}\n` +
              `${message}\n[/SMTP SINK]\n`,
          );
          message = '';
          envelope = { from: '', recipients: [] };
          socket.write('250 2.0.0 OK queued\r\n');
          return;
        }
        message += `${line}\n`;
        return;
      }

      const upper = line.toUpperCase();

      if (upper.startsWith('EHLO') || upper.startsWith('HELO')) {
        socket.write('250-notifhub-dev-smtp-sink\r\n250-8BITMIME\r\n250 SIZE 10485760\r\n');
        return;
      }

      if (upper.startsWith('MAIL FROM')) {
        envelope.from = line.slice(line.indexOf(':') + 1).trim();
        socket.write('250 2.1.0 OK\r\n');
        return;
      }

      if (upper.startsWith('RCPT TO')) {
        envelope.recipients.push(line.slice(line.indexOf(':') + 1).trim());
        socket.write('250 2.1.5 OK\r\n');
        return;
      }

      if (upper === 'DATA') {
        dataMode = true;
        socket.write('354 End data with <CR><LF>.<CR><LF>\r\n');
        return;
      }

      if (upper === 'QUIT') {
        socket.write('221 2.0.0 Bye\r\n');
        socket.end();
        return;
      }

      if (upper === 'RSET' || upper === 'NOOP') {
        socket.write('250 2.0.0 OK\r\n');
        return;
      }

      socket.write('250 2.0.0 OK\r\n');
    }
  })
  .listen(port, host, () => {
    process.stdout.write(`[SMTP SINK] listening on ${host}:${port}\n`);
  });
