import 'dotenv/config';

import { buildApp } from './app';
import { loadConfig } from './config';

const config = loadConfig(process.env);
const app = buildApp({ logger: true });

try {
  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  app.log.error(error);
  process.exitCode = 1;
}
