import { mkdtempSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { io as connect, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, QuizInput, ServerToClientEvents } from '../../shared/types';
import { createApp, type WhatQuizApp } from '../src/app';

export const TEST_PAGES_ORIGIN = 'https://prof.github.io';

export interface TestServer {
  app: WhatQuizApp;
  url: string;
  close(): Promise<void>;
}

export async function startTestServer(): Promise<TestServer> {
  const app = createApp({
    port: 0,
    host: '127.0.0.1',
    databasePath: ':memory:',
    uploadDir: mkdtempSync(path.join(tmpdir(), 'whatquiz-test-')),
    sessionDays: 1,
    cookieSecure: false,
    maxPlayers: 100,
    publicUrl: null,
    adminEmails: ['admin@test.fr'],
    corsOrigins: [TEST_PAGES_ORIGIN],
    trustProxy: 'loopback',
    isProduction: false,
  });
  await new Promise<void>((resolve) => app.httpServer.listen(0, '127.0.0.1', resolve));
  const { port } = app.httpServer.address() as AddressInfo;
  return {
    app,
    url: `http://127.0.0.1:${port}`,
    async close() {
      await app.close();
      await new Promise<void>((resolve) => app.httpServer.close(() => resolve()));
    },
  };
}

/** Petit client HTTP qui conserve le cookie de session, comme un navigateur. */
export class ApiClient {
  cookie = '';

  constructor(private readonly baseUrl: string) {}

  async request<T = Record<string, unknown>>(method: string, url: string, body?: unknown): Promise<{ status: number; data: T }> {
    const response = await fetch(this.baseUrl + url, {
      method,
      headers: { 'content-type': 'application/json', cookie: this.cookie },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) this.cookie = setCookie.split(';')[0];
    return { status: response.status, data: (await response.json()) as T };
  }

  get<T = Record<string, unknown>>(url: string) {
    return this.request<T>('GET', url);
  }

  post<T = Record<string, unknown>>(url: string, body: unknown = {}) {
    return this.request<T>('POST', url, body);
  }

  put<T = Record<string, unknown>>(url: string, body: unknown) {
    return this.request<T>('PUT', url, body);
  }

  delete<T = Record<string, unknown>>(url: string) {
    return this.request<T>('DELETE', url);
  }
}

export async function registerTeacher(server: TestServer, email = 'prof@test.fr'): Promise<ApiClient> {
  const client = new ApiClient(server.url);
  const { status } = await client.post('/api/auth/register', { email, password: 'motdepasse', displayName: 'Prof', role: 'teacher' });
  if (status !== 201) throw new Error(`Inscription impossible (${status})`);
  return client;
}

export type TestSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export function connectSocket(server: TestServer, cookie = ''): Promise<TestSocket> {
  const socket: TestSocket = connect(server.url, { transports: ['websocket'], extraHeaders: { cookie }, forceNew: true });
  return new Promise((resolve, reject) => {
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', reject);
  });
}

export function nextEvent<E extends keyof ServerToClientEvents>(
  socket: TestSocket,
  event: E,
  predicate: (...args: Parameters<ServerToClientEvents[E]>) => boolean = () => true,
): Promise<Parameters<ServerToClientEvents[E]>[0]> {
  return new Promise((resolve) => {
    const listener = (...args: Parameters<ServerToClientEvents[E]>) => {
      if (!predicate(...args)) return;
      socket.off(event, listener as never);
      resolve(args[0]);
    };
    socket.on(event, listener as never);
  });
}

export const SAMPLE_QUIZ: QuizInput = {
  title: 'Quiz de test',
  description: 'Pour les tests',
  imageUrl: null,
  category: 'Sciences',
  questions: [
    {
      type: 'single',
      text: '2 + 2 ?',
      imageUrl: null,
      timeLimit: 20,
      points: 1000,
      pointsEnabled: true,
      answers: [
        { text: '3', isCorrect: false },
        { text: '4', isCorrect: true },
      ],
    },
    {
      type: 'text',
      text: 'Capitale de la France ?',
      imageUrl: null,
      timeLimit: 30,
      points: 1000,
      pointsEnabled: true,
      answers: [{ text: 'Paris', isCorrect: true }],
    },
  ],
};
