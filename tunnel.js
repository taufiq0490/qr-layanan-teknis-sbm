const { spawn, exec } = require('child_process');
const http = require('http');
const path = require('path');

console.log('=======================================================');
console.log('   ?? MEMULAI QR LAYANAN TEKNIS SBM ITB (ONLINE)     ');
console.log('=======================================================');

// 1. Start Server Node.js
const serverProcess = spawn('node', ['server.js'], { stdio: 'inherit' });

// 2. Start Cloudflare Tunnel
const cloudflaredPath = path.join(__dirname, 'cloudflared.exe');
const tunnelProcess = spawn(cloudflaredPath, ['tunnel', '--url', 'http://localhost:3000']);

let tunnelUrlFound = false;

function handleOutput(data) {
  const text = data.toString();
  const match = text.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/);
  if (match && !tunnelUrlFound) {
    tunnelUrlFound = true;
    const publicUrl = match[0];
    
    console.log('\n=======================================================');
    console.log('? KONEKSI ONLINE AKTIF & SIAP DIGUNAKAN!');
    console.log('?? URL Publik Cloudflare : ' + publicUrl);
    console.log('???  Halaman Cetak QR      : ' + publicUrl + '/admin/print-qr');
    console.log('?? Dashboard Admin        : ' + publicUrl + '/admin');
    console.log('=======================================================\n');

    // Notify local server of the active public URL
    setTimeout(() => {
      const postData = JSON.stringify({ url: publicUrl });
      const req = http.request({
        hostname: 'localhost',
        port: 3000,
        path: '/api/tunnel-url',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData)
        }
      });
      req.write(postData);
      req.end();

      // Open browser automatically with the PUBLIC Cloudflare URL
      const targetUrl = `${publicUrl}/admin/print-qr`;
      const openCmd = process.platform === 'win32' ? `start ${targetUrl}` : `open ${targetUrl}`;
      exec(openCmd);
    }, 1500);
  }
}

tunnelProcess.stdout.on('data', handleOutput);
tunnelProcess.stderr.on('data', handleOutput);

process.on('SIGINT', () => {
  serverProcess.kill();
  tunnelProcess.kill();
  process.exit();
});

