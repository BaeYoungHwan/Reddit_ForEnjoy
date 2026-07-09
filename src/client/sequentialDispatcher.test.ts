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
});
