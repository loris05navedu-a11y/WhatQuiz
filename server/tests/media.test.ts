import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { detectMedia, isValidMediaUrl, mediaProblem, youtubeId } from '../../shared/media';
import type { Quiz } from '../../shared/types';
import { registerTeacher, SAMPLE_QUIZ, startTestServer, type ApiClient, type TestServer } from './helpers';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
const MP3 = new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
const MP4 = new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 0, 0]);
const WEBM = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);

describe('formats et limites des médias', () => {
  it('reconnaît le format réel d’un fichier', () => {
    assert.equal(detectMedia(PNG)?.mime, 'image/png');
    assert.equal(detectMedia(MP3)?.kind, 'audio');
    assert.equal(detectMedia(MP4)?.kind, 'video');
    assert.equal(detectMedia(WEBM)?.mime, 'video/webm');
    assert.equal(detectMedia(new TextEncoder().encode('<html><script>alert(1)')), null);
  });

  it('applique des limites de taille par type, plus strictes sans serveur', () => {
    assert.equal(mediaProblem(detectMedia(MP4), 20 * 1024 * 1024, false), null);
    assert.match(mediaProblem(detectMedia(MP4), 20 * 1024 * 1024, true)!, /trop lourd/);
    assert.match(mediaProblem(null, 10, false)!, /Format non reconnu/);
  });

  it('reconnaît les liens YouTube et refuse les liens non sécurisés', () => {
    assert.equal(youtubeId('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10'), 'dQw4w9WgXcQ');
    assert.equal(youtubeId('https://youtu.be/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
    assert.equal(youtubeId('https://evil.example/watch?v=dQw4w9WgXcQ'), null);
    assert.equal(isValidMediaUrl({ kind: 'video', url: 'http://example.com/a.mp4' }, false), false);
    assert.equal(isValidMediaUrl({ kind: 'audio', url: 'asset:0123456789abcdef' }, false), false, 'fichier du navigateur refusé par le serveur');
    assert.equal(isValidMediaUrl({ kind: 'audio', url: 'asset:0123456789abcdef' }, true), true);
  });
});

describe('envoi de fichiers sur le serveur', () => {
  let server: TestServer;
  let teacher: ApiClient;

  before(async () => {
    server = await startTestServer();
    teacher = await registerTeacher(server);
  });
  after(() => server.close());

  const upload = (bytes: Uint8Array, type: string, cookie = teacher.cookie) =>
    fetch(`${server.url}/api/uploads/file`, { method: 'POST', headers: { 'content-type': type, cookie }, body: new Blob([bytes as BlobPart]) });

  it('accepte une image, un son et une vidéo, et les sert ensuite', async () => {
    for (const [bytes, type, kind] of [
      [PNG, 'image/png', 'image'],
      [MP3, 'audio/mpeg', 'audio'],
      [MP4, 'video/mp4', 'video'],
    ] as const) {
      const response = await upload(bytes, type);
      assert.equal(response.status, 201);
      const data = (await response.json()) as { url: string; kind: string };
      assert.equal(data.kind, kind);
      const served = await fetch(server.url + data.url);
      assert.equal(served.status, 200);
      assert.deepEqual(new Uint8Array(await served.arrayBuffer()), bytes);
    }
  });

  it('refuse un faux fichier, un fichier trop lourd ou un envoi anonyme', async () => {
    const fake = await upload(new TextEncoder().encode('<script>alert(1)</script>xxxxxxxxxxxx'), 'image/png');
    assert.equal(fake.status, 400);
    assert.match(((await fake.json()) as { error: string }).error, /Format non reconnu/);
    const big = new Uint8Array(6 * 1024 * 1024);
    big.set(PNG);
    const tooBig = await upload(big, 'image/png');
    assert.equal(tooBig.status, 400);
    assert.match(((await tooBig.json()) as { error: string }).error, /trop lourd/);
    assert.equal((await upload(PNG, 'image/png', '')).status, 401);
  });

  it('enregistre les médias d’une question et refuse ceux d’un autre appareil', async () => {
    const sound = (await (await upload(MP3, 'audio/mpeg')).json()) as { url: string };
    const question = { ...SAMPLE_QUIZ.questions[0], media: [{ kind: 'audio', url: sound.url }, { kind: 'video', url: 'https://youtu.be/dQw4w9WgXcQ' }] };
    const { status, data } = await teacher.post<{ quiz: Quiz }>('/api/quizzes', { ...SAMPLE_QUIZ, questions: [question] });
    assert.equal(status, 201);
    assert.deepEqual(data.quiz.questions[0].media, question.media);
    const local = { ...question, media: [{ kind: 'audio', url: 'asset:0123456789abcdef' }] };
    assert.equal((await teacher.post('/api/quizzes', { ...SAMPLE_QUIZ, questions: [local] })).status, 400);
  });
});
