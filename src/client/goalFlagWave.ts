// 골인 깃발 천 메쉬의 정점 x좌표를 계산하는 순수 함수. game.tsx의 updateGoalFlagWave가
// 매 프레임 이 함수를 호출해 결과를 Mesh2D 정점 배열에 그대로 써넣는다 — Phaser/WebGL 없이도
// 파동 수식 자체(순증가 여부, 양 끝 고정 여부)를 단위 테스트할 수 있도록 분리해뒀다.
//
// 칸 사이 "간격"에 사인파를 곱하는 방식이라(음수가 될 수 없는 factor), 반환값은 항상
// 순증가한다 — 정점 순서가 뒤집히거나 겹칠 수 없다. 마지막에 양 끝(0, width)을 원래 폭으로
// 재조정(rescale)하므로 깃대 부착점과 천 전체 길이가 파동 중에도 드리프트하지 않는다.
export function computeClothWaveX(
  cols: number,
  cyclesAcrossWidth: number,
  amplitude: number,
  speed: number,
  elapsedSeconds: number,
  width: number
): number[] {
  const baseSpacing = width / cols;
  const rawX: number[] = [0];
  for (let col = 1; col <= cols; col++) {
    const phase = (col / cols) * Math.PI * 2 * cyclesAcrossWidth - elapsedSeconds * speed;
    const factor = 1 + amplitude * Math.sin(phase);
    rawX.push(rawX[col - 1]! + baseSpacing * factor);
  }

  const rescale = width / rawX[cols]!;
  return rawX.map((x) => x * rescale);
}
