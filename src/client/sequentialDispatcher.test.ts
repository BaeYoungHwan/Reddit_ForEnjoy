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
});
