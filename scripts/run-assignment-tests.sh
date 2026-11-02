#!/usr/bin/env bash

# 11주차 과제 제출용 테스트 실행기
# Node.js 기본 출력의 체크 표시뿐 아니라 캡처 화면에 PASSED/FAILED가
# 분명히 남도록 최종 결과 배너를 추가한다.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPOSITORY_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
RESULT_FILE="$(mktemp -t babfull-assignment-tests.XXXXXX)"

cleanup() {
  rm -f "${RESULT_FILE}"
}
trap cleanup EXIT

cd "${REPOSITORY_ROOT}"

printf '\n=============================================\n'
printf ' 밥풀매니아 11주차 과제 테스트 실행\n'
printf ' 정상값 · 경계값 · 예외 · Mock 검증\n'
printf '=============================================\n\n'

# tee로 상세 결과를 화면에 보여주면서 최종 테스트 수를 계산한다.
# PIPESTATUS[0]을 사용해 tee가 아닌 Node 테스트 자체의 종료 코드를 보존한다.
set +e
node --test --test-reporter=spec tests/assignment-edge-cases.test.mjs 2>&1 | tee "${RESULT_FILE}"
TEST_STATUS=${PIPESTATUS[0]}
set -e

TOTAL_TESTS="$(awk '$2 == "tests" { value = $3 } END { print value + 0 }' "${RESULT_FILE}")"
PASSED_TESTS="$(awk '$2 == "pass" { value = $3 } END { print value + 0 }' "${RESULT_FILE}")"
FAILED_TESTS="$(awk '$2 == "fail" { value = $3 } END { print value + 0 }' "${RESULT_FILE}")"

printf '\n=============================================\n'
if [[ ${TEST_STATUS} -eq 0 && ${TOTAL_TESTS} -gt 0 && ${TOTAL_TESTS} -eq ${PASSED_TESTS} ]]; then
  printf ' PASSED - %s/%s TESTS\n' "${PASSED_TESTS}" "${TOTAL_TESTS}"
  printf ' 모든 정상·예외·경계값 테스트를 통과했습니다.\n'
  printf '=============================================\n\n'
  exit 0
fi

printf ' FAILED - %s PASSED / %s FAILED / %s TOTAL\n' "${PASSED_TESTS}" "${FAILED_TESTS}" "${TOTAL_TESTS}"
printf ' 실패한 테스트 내용을 위 출력에서 확인하세요.\n'
printf '=============================================\n\n'
exit "${TEST_STATUS:-1}"
