/**
 * 앞서 dispatch된 작업이 settle(성공/실패 무관)되기 전까지는 다음 작업을 시작하지 않도록
 * 강제하는 최소 직렬화 큐.
 *
 * 용도: game.tsx의 trap.trigger처럼, 여러 번 연속 호출될 수 있지만 네트워크 요청은
 * 반드시 dispatch한 순서대로 하나씩만 in-flight 상태여야 하는 경우. 이동 애니메이션 같은
 * 화면 반응은 블로킹하지 않고, 서버로 나가는 요청의 "시작 순서"만 강제한다.
 *
 * 큐는 절대 멈추지 않는다 — 앞선 작업이 reject해도 다음 작업은 정상적으로 시작된다.
 * enqueue()가 반환하는 Promise는 해당 작업 고유의 성공/실패를 그대로 전달한다.
 */
export class SequentialDispatcher<T> {
  private tail: Promise<void> = Promise.resolve();

  enqueue(task: () => Promise<T>): Promise<T> {
    const result = this.tail.then(task);
    this.tail = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }

  /**
   * 지금까지 enqueue된 작업이 전부 settle(성공/실패 무관)될 때까지 기다린다 — 이 시점 이후에
   * 새로 enqueue되는 작업은 기다리지 않는다(호출 시점의 tail 스냅샷). 절대 reject하지 않는다
   * (enqueue의 tail 자체가 항상 성공으로 정규화됨).
   */
  whenIdle(): Promise<void> {
    return this.tail;
  }
}
