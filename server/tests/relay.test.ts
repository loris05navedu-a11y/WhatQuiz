import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRelayKeys, deriveChannel, Mailbox, seal, unseal } from '../../client/src/standalone/relayChannel';

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(check: () => boolean, timeoutMs = 5_000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error('délai dépassé');
    await wait(5);
  }
}

/**
 * Deux boîtes reliées comme par Firestore : chaque écriture remplace le document, le lecteur est prévenu après un
 * délai variable et ne voit que la dernière version (les versions intermédiaires peuvent être manquées).
 */
function pair(options: { maxDelayMs?: number; failEvery?: number } = {}) {
  const received: Record<'a' | 'b', unknown[]> = { a: [], b: [] };
  const closed: Record<'a' | 'b', boolean> = { a: false, b: false };
  const writes: Record<'a' | 'b', number> = { a: 0, b: 0 };
  const latest: Record<'a' | 'b', string | null> = { a: null, b: null };
  const pending: Record<'a' | 'b', boolean> = { a: false, b: false };
  let attempts = 0;
  const boxes = {} as Record<'a' | 'b', Mailbox>;
  const make = (self: 'a' | 'b', peer: 'a' | 'b') =>
    new Mailbox({
      minGapMs: 5,
      write: async (plain) => {
        attempts += 1;
        if (options.failEvery && attempts % options.failEvery === 0) throw new Error('réseau');
        writes[self] += 1;
        latest[self] = plain;
        if (pending[self]) return;
        pending[self] = true;
        setTimeout(() => {
          pending[self] = false;
          const version = latest[self];
          if (version !== null) boxes[peer].receive(version);
        }, Math.random() * (options.maxDelayMs ?? 20));
      },
      deliver: (message) => received[self].push(message),
      onClosed: () => (closed[self] = true),
    });
  boxes.a = make('a', 'b');
  boxes.b = make('b', 'a');
  return { boxes, received, closed, writes };
}

describe('relais en ligne : canal', () => {
  it('livre tous les messages, dans l’ordre, même quand des versions du document sont manquées', async () => {
    const { boxes, received } = pair();
    for (let i = 0; i < 200; i++) {
      boxes.a.send({ i });
      if (i % 7 === 0) boxes.b.send({ back: i });
      if (i % 20 === 0) await wait(3);
    }
    await until(() => received.b.length === 200 && received.a.length === 29);
    assert.deepEqual(
      received.b.map((m) => (m as { i: number }).i),
      Array.from({ length: 200 }, (_, i) => i),
    );
    assert.deepEqual(
      received.a.map((m) => (m as { back: number }).back),
      Array.from({ length: 29 }, (_, i) => i * 7),
    );
  });

  it('un état remplacé n’est pas envoyé deux fois, le dernier arrive toujours', async () => {
    const { boxes, received } = pair();
    boxes.a.send({ t: 'ack', id: 1 });
    for (let i = 0; i < 50; i++) boxes.a.send({ t: 'state', i }, { replace: 'state' });
    boxes.a.send({ t: 'ack', id: 2 });
    await until(() => received.b.some((m) => (m as { id?: number }).id === 2) && received.b.some((m) => (m as { i?: number }).i === 49));
    const states = received.b.filter((m) => (m as { t: string }).t === 'state').map((m) => (m as { i: number }).i);
    assert.equal(states[states.length - 1], 49);
    assert.ok(states.length < 50, 'les états intermédiaires sont regroupés');
    assert.deepEqual(states, [...states].sort((x, y) => x - y));
  });

  it('transmet un gros fichier par morceaux sans retarder les petits messages', async () => {
    const { boxes, received } = pair();
    const big = 'data:video/mp4;base64,' + 'A'.repeat(3_000_000);
    boxes.a.send({ t: 'ack', id: 7, r: { ok: true, data: big } });
    boxes.a.send({ t: 'evt', e: 'game:state', p: { phase: 'question' } }, { replace: 'state' });
    await until(() => received.b.some((m) => (m as { e?: string }).e === 'game:state'));
    assert.equal(received.b.length, 1, 'l’état de la partie arrive avant la fin du fichier');
    await until(() => received.b.length === 2, 10_000);
    const ack = received.b[1] as { id: number; r: { data: string } };
    assert.equal(ack.id, 7);
    assert.equal(ack.r.data.length, big.length);
    assert.equal(ack.r.data, big);
  });

  it('un message différé part avec la prochaine écriture, ou à son échéance', async () => {
    const { boxes, received, writes } = pair();
    const start = Date.now();
    // Signe de vie remplacé toutes les 10 ms, différé de 150 ms : il doit partir malgré les remplacements.
    const timer = setInterval(() => boxes.a.send({ beat: Date.now() }, { replace: 'beat', lazyMs: 150 }), 10);
    await until(() => received.b.length >= 2, 3_000);
    clearInterval(timer);
    const elapsed = Date.now() - start;
    assert.ok(elapsed >= 140, `pas d'envoi avant l'échéance (${elapsed} ms)`);
    assert.ok(writes.a <= 6, `peu d'écritures (${writes.a})`);
    boxes.a.send({ urgent: true });
    await until(() => received.b.some((m) => (m as { urgent?: boolean }).urgent === true), 1_000);
  });

  it('reprend après des écritures refusées', async () => {
    const { boxes, received } = pair({ failEvery: 3 });
    for (let i = 0; i < 30; i++) {
      boxes.a.send({ i });
      await wait(2);
    }
    await until(() => received.b.length === 30, 30_000);
    assert.deepEqual(
      received.b.map((m) => (m as { i: number }).i),
      Array.from({ length: 30 }, (_, i) => i),
    );
  });

  it('la fermeture prévient l’autre côté et mesure l’aller-retour', async () => {
    const { boxes, received, closed } = pair();
    boxes.a.send({ hello: true });
    await until(() => received.b.length === 1);
    boxes.b.send({ welcome: true });
    await until(() => received.a.length === 1);
    boxes.a.send({ again: true });
    await until(() => received.b.length === 2);
    assert.notEqual(boxes.b.rttMs, null);
    assert.ok((boxes.b.rttMs ?? 0) < 1_000);
    boxes.a.close();
    await until(() => closed.b);
    boxes.b.send({ ignored: true });
    await wait(50);
    assert.equal(received.a.length, 1, 'plus rien après la fermeture');
  });
});

describe('relais en ligne : chiffrement', () => {
  it('élève et professeur obtiennent la même clé et la même boîte ; un tiers ne peut rien lire', async () => {
    const host = await createRelayKeys();
    const student = await createRelayKeys();
    const intruder = await createRelayKeys();
    const onHost = await deriveChannel(host.privateKey, student.publicKey, '123456');
    const onStudent = await deriveChannel(student.privateKey, host.publicKey, '123456');
    const forIntruder = await deriveChannel(intruder.privateKey, host.publicKey, '123456');
    assert.equal(onHost.box, onStudent.box);
    assert.notEqual(forIntruder.box, onHost.box);
    const sealed = await seal(onStudent.key, JSON.stringify({ answer: 'é ✓ 42' }));
    assert.ok(!sealed.includes('answer'));
    assert.equal(await unseal(onHost.key, sealed), JSON.stringify({ answer: 'é ✓ 42' }));
    assert.equal(await unseal(forIntruder.key, sealed), null);
    assert.equal(await unseal(onHost.key, sealed.slice(0, -4) + 'AAAA'), null, 'contenu modifié refusé');
    assert.equal(await unseal(onHost.key, 42), null);
    // Même clés, autre code de partie : autre boîte.
    const otherCode = await deriveChannel(host.privateKey, student.publicKey, '654321');
    assert.notEqual(otherCode.box, onHost.box);
  });
});
