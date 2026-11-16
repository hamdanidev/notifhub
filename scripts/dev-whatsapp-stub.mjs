import http from 'node:http';

const port = Number(process.env.WHATSAPP_STUB_PORT ?? 2526);
const host = '127.0.0.1';
let counter = 0;

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => resolve(Buffer.concat(chunks)));
    request.on('error', reject);
  });
}

const server = http.createServer(async (request, response) => {
  if (request.method === 'GET' && request.url === '/health') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ status: 'ok' }));
    return;
  }

  if (request.method === 'POST' && request.url?.includes('/messages')) {
    const raw = await readBody(request);
    let body;

    try {
      body = JSON.parse(raw.toString('utf8'));
    } catch {
      response.writeHead(400, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: { message: 'invalid json' } }));
      return;
    }

    counter += 1;
    const wamid = `wamid.stub.${Date.now()}.${counter}`;

    console.log(
      JSON.stringify({
        event: 'whatsapp.stub.message',
        to: body.to,
        type: body.type,
        body: body.text?.body,
        wamid,
      }),
    );

    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(
      JSON.stringify({
        messaging_product: 'whatsapp',
        contacts: [{ input: body.to, wa_id: body.to?.replace('+', '') }],
        messages: [{ id: wamid }],
      }),
    );
    return;
  }

  response.writeHead(404, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ error: { message: 'not found' } }));
});

server.listen(port, host, () => {
  console.log(`WhatsApp stub listening on http://${host}:${port}`);
});

function shutdown() {
  server.close(() => process.exit(0));
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
