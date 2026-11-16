const path = require('path');
const fs = require('fs');

const dir = path.join(__dirname);

process.env.NODE_ENV = 'production';
process.chdir(dir);

const currentPort = parseInt(process.env.PORT, 10) || 3000;
const hostname = process.env.HOSTNAME || '0.0.0.0';

let keepAliveTimeout = parseInt(process.env.KEEP_ALIVE_TIMEOUT, 10);
if (
  Number.isNaN(keepAliveTimeout) ||
  !Number.isFinite(keepAliveTimeout) ||
  keepAliveTimeout < 0
) {
  keepAliveTimeout = undefined;
}

let nextConfig = undefined;
const requiredServerFilesPath = path.join(
  dir,
  '.next',
  'required-server-files.json'
);

if (fs.existsSync(requiredServerFilesPath)) {
  try {
    const requiredServerFiles = JSON.parse(
      fs.readFileSync(requiredServerFilesPath, 'utf8')
    );
    if (requiredServerFiles && requiredServerFiles.config) {
      nextConfig = requiredServerFiles.config;
      process.env.__NEXT_PRIVATE_STANDALONE_CONFIG =
        JSON.stringify(nextConfig);
    }
  } catch (err) {
    console.error('Failed to read required-server-files.json:', err);
  }
}

require('next');
const { startServer } = require('next/dist/server/lib/start-server');

startServer({
  dir,
  isDev: false,
  config: nextConfig,
  hostname,
  port: currentPort,
  allowRetry: false,
  keepAliveTimeout,
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
