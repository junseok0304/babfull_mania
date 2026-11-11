/**
 * 터치 시작·종료 좌표를 날짜 이동 방향(-1/1)으로 변환합니다.
 * 짧은 이동과 세로 스크롤은 0으로 반환해 일반 페이지 스크롤을 방해하지 않습니다.
 */
export const getHorizontalSwipeDirection = ({ startX, startY, endX, endY, threshold = 48 }) => {
  const deltaX = Number(endX) - Number(startX);
  const deltaY = Number(endY) - Number(startY);
  if (!Number.isFinite(deltaX) || !Number.isFinite(deltaY)) return 0;
  if (Math.abs(deltaX) < threshold || Math.abs(deltaX) <= Math.abs(deltaY) * 1.25) return 0;
  return deltaX < 0 ? 1 : -1;
};
