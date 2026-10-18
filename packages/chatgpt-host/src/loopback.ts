import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { CALLBACK_PATH } from './constants';

export interface CallbackListener {
  redirectUri: string;
  result: Promise<URLSearchParams>;
  close(): void;
}

export function listenForCallback(timeoutMs = 10 * 60 * 1000): Promise<CallbackListener> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const server = createServer((request: IncomingMessage, response: ServerResponse) => {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      if (request.method !== 'GET' || url.pathname !== CALLBACK_PATH) {
        response.writeHead(404, { 'content-type': 'text/plain' });
        response.end('Not found');
        return;
      }
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end('<!doctype html><title>Nudge</title><p>You can close this window and return to Nudge.</p>');
      if (settled) return;
      settled = true;
      finish(url.searchParams);
    });
    const timer = setTimeout(() => {
      if (!settled) fail(new Error('ChatGPT sign-in timed out. Try Continue with ChatGPT again.'));
    }, timeoutMs);
    const finish = (params: URLSearchParams) => {
      clearTimeout(timer);
      server.close();
      resolveResult(params);
    };
    const fail = (error: Error) => {
      clearTimeout(timer);
      server.close();
      rejectResult(error);
    };
    let resolveResult: (params: URLSearchParams) => void = () => undefined;
    let rejectResult: (error: Error) => void = () => undefined;
    const result = new Promise<URLSearchParams>((resolveWait, rejectWait) => {
      resolveResult = resolveWait;
      rejectResult = rejectWait;
    });
    server.once('error', (error) => {
      if (!settled) reject(error);
    });
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Could not listen for the ChatGPT callback.'));
        return;
      }
      resolve({
        redirectUri: `http://127.0.0.1:${address.port}${CALLBACK_PATH}`,
        result,
        close() {
          if (!settled) fail(new Error('ChatGPT sign-in was cancelled.'));
        },
      });
    });
  });
}
