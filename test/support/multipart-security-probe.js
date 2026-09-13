'use strict';

// Runs in a separate bounded process: historical multer versions can hang or
// crash while parsing hostile field names. The probe never writes a file.
const http = require('node:http');
const multer = require(process.env.MULTIPART_PROBE_MULTER || 'multer');
const upload = multer({ limits: { fieldArrayIndexLimit: 100, fieldNestingDepth: 4,
    fields: 4, fieldSize: 1024, parts: 4, files: 0 } }).none();
const server = http.createServer((request, response) => {
    upload(request, response, error => {
        response.writeHead(error ? 400 : 200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ code: error?.code || null }));
    });
});

server.listen(0, '127.0.0.1', async () => {
    try {
        const form = new FormData();
        form.append('items[4294967294]', 'x');
        form.append('items[name]', 'y');
        const response = await fetch(`http://127.0.0.1:${server.address().port}`, { method: 'POST', body: form });
        const result = await response.json();
        process.stdout.write(JSON.stringify({ status: response.status, ...result }));
    } catch {
        process.exitCode = 1;
    } finally { server.closeAllConnections(); server.close(); }
});
