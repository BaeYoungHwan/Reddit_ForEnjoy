import { describe, expect, it } from 'vitest';
import { SequentialDispatcher } from './sequentialDispatcher';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('SequentialDispatcher', () => {
  it('나중에 dispatch된 작업의 응답이 먼저 도착해도, 실행 시작은 dispatch 순서를 따른다', async () => {
    const dispatcher = new SequentialDispatcher<string>();
    const startOrder: string[] = [];
    const first = deferred<string>();
    const second = deferred<string>();

    const p1 = dispatcher.enqueue(() => {
      startOrder.push('first');
      return first.promise;
    });
    const p2 = dispatcher.enqueue(() => {
      startOrder.push('second');
      return second.promise;
    });

    await Promise.resolve();
    expect(startOrder).toEqual(['first']);

    // 버그 재현 조건: 나중에 dispatch된 second의 응답이 먼저 도착.
    second.resolve('second-result');
    await Promise.resolve();
    expect(startOrder).toEqual(['first']);

    first.resolve('first-result');
    await expect(p1).resolves.toBe('first-result');
    await expect(p2).resolves.toBe('second-result');
    expect(startOrder).toEqual(['first', 'second']);
  });

  it('앞선 작업이 실패해도 큐가 멈추지 않고 다음 작업은 정상 실행된다', async () => {
    const dispatcher = new SequentialDispatcher<string>();
    const p1 = dispatcher.enqueue(() => Promise.reject(new Error('boom')));
    const p2 = dispatcher.enqueue(() => Promise.resolve('ok'));

    await expect(p1).rejects.toThrow('boom');
    await expect(p2).resolves.toBe('ok');
  });

  // 2026-07-15 실서버 QA("클리어했는데 Record not saved") 회귀 테스트 — game.tsx의
  // reportRunFinish가 run.finish를 부르기 전에 arrivalDispatcher.whenIdle()로 직전 칸의
  // move.arrive가 실제로 settle될 때까지 기다리도록 고쳤다. 그 전제가 되는 whenIdle()
  // 자체의 계약(대기 중인 작업이 끝날 때까지 대기, 이후 새로 들어온 작업은 안 기다림, 절대
  // reject 안 함)을 여기서 독립적으로 검증한다.
  describe('whenIdle', () => {
    it('큐가 비어있으면 즉시 resolve된다', async () => {
      const dispatcher = new SequentialDispatcher<string>();
      await expect(dispatcher.whenIdle()).resolves.toBeUndefined();
    });

    it('호출 시점까지 enqueue된 작업이 settle될 때까지 기다린다(성공 케이스)', async () => {
      const dispatcher = new SequentialDispatcher<string>();
      const pending = deferred<string>();
      void dispatcher.enqueue(() => pending.promise);

      let idleResolved = false;
      const idle = dispatcher.whenIdle().then(() => {
        idleResolved = true;
      });

      await Promise.resolve();
      expect(idleResolved).toBe(false);

      pending.resolve('done');
      await idle;
      expect(idleResolved).toBe(true);
    });

    it('대기 중이던 작업이 실패해도 whenIdle 자체는 reject하지 않는다', async () => {
      const dispatcher = new SequentialDispatcher<string>();
      const pending = deferred<string>();
      const task = dispatcher.enqueue(() => pending.promise);

      const idle = dispatcher.whenIdle();
      pending.reject(new Error('boom'));

      await expect(task).rejects.toThrow('boom');
      await expect(idle).resolves.toBeUndefined();
    });

    it('whenIdle() 호출 이후에 새로 enqueue된 작업은 기다리지 않는다(호출 시점 스냅샷)', async () => {
      const dispatcher = new SequentialDispatcher<string>();
      const first = deferred<string>();
      void dispatcher.enqueue(() => first.promise);

      let idleResolved = false;
      const idle = dispatcher.whenIdle().then(() => {
        idleResolved = true;
      });

      first.resolve('first-done');
      await idle;
      expect(idleResolved).toBe(true);

      // 이 시점 이후 새로 들어온 작업은 이미 resolve된 idle과 무관해야 한다.
      const second = deferred<string>();
      void dispatcher.enqueue(() => second.promise);
      expect(idleResolved).toBe(true); // 여전히 true — 새 작업이 idle을 되돌리지 않음
    });
  });

  // 2026-07-15(docs/wbs.md 95행, 원호 QA 후속) 회귀 테스트 — game.tsx의 tryMove가
  // MAX_INFLIGHT_ARRIVALS 백프레셔 가드를 걸 때 이 카운터를 참고한다. enqueue된 작업이 아직
  // settle되지 않은 개수를 정확히 추적해야 가드가 의미를 갖는다.
  describe('pendingCount', () => {
    it('아무것도 enqueue하지 않았으면 0이다', () => {
      const dispatcher = new SequentialDispatcher<string>();
      expect(dispatcher.pendingCount).toBe(0);
    });

    it('enqueue 시 즉시 증가하고, 성공적으로 settle되면 감소한다', async () => {
      const dispatcher = new SequentialDispatcher<string>();
      const pending = deferred<string>();
      const task = dispatcher.enqueue(() => pending.promise);

      expect(dispatcher.pendingCount).toBe(1);

      pending.resolve('done');
      await task;
      expect(dispatcher.pendingCount).toBe(0);
    });

    it('실패로 settle돼도 감소한다(큐는 안 멈추지만 카운트는 정확해야 함)', async () => {
      const dispatcher = new SequentialDispatcher<string>();
      const pending = deferred<string>();
      const task = dispatcher.enqueue(() => pending.promise);

      pending.reject(new Error('boom'));
      await expect(task).rejects.toThrow('boom');
      expect(dispatcher.pendingCount).toBe(0);
    });

    it('여러 개를 연달아 enqueue하면 아직 시작 안 한 작업도 카운트에 포함된다(직렬화 대기 중이라도)', async () => {
      const dispatcher = new SequentialDispatcher<string>();
      const first = deferred<string>();
      const second = deferred<string>();
      const third = deferred<string>();

      const t1 = dispatcher.enqueue(() => first.promise);
      const t2 = dispatcher.enqueue(() => second.promise);
      const t3 = dispatcher.enqueue(() => third.promise);

      expect(dispatcher.pendingCount).toBe(3);

      first.resolve('a');
      await t1;
      expect(dispatcher.pendingCount).toBe(2); // second는 아직 실행 시작도 안 했지만 카운트엔 남아있음

      second.resolve('b');
      await t2;
      third.resolve('c');
      await t3;
      expect(dispatcher.pendingCount).toBe(0);
    });
  });
});
