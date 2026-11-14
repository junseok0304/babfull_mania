#!/usr/bin/env bash

# 기말 과제 제출용 테스트 실행기
# 웹 애플리케이션과 카카오 모듈 테스트를 실제로 실행한 뒤,
# 캡처 화면에서 구분하기 쉬운 요약 결과를 출력한다.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPOSITORY_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
RESULT_DIR="$(mktemp -d -t babfull-assignment-tests.XXXXXX)"
WEB_RESULT_FILE="${RESULT_DIR}/web-tests.log"
KAKAO_RESULT_FILE="${RESULT_DIR}/kakao-tests.log"

cleanup() {
  rm -rf "${RESULT_DIR}"
}
trap cleanup EXIT

cd "${REPOSITORY_ROOT}"

printf '\n=============================================\n'
printf ' 밥풀매니아 자동 테스트 실행\n'
printf ' 웹 애플리케이션 · 카카오 모듈 검증\n'
printf '=============================================\n\n'

# 두 테스트 묶음의 원본 출력은 임시 파일에 보관한다. 정상 실행 시에는
# 과제 캡처에 필요한 요약만 보여주고, 실패 시에만 상세 로그를 출력한다.
set +e
npm test >"${WEB_RESULT_FILE}" 2>&1
WEB_TEST_STATUS=$?
npm run test:kakao >"${KAKAO_RESULT_FILE}" 2>&1
KAKAO_TEST_STATUS=$?
set -e

WEB_TOTAL="$(awk '$2 == "tests" { value = $3 } END { print value + 0 }' "${WEB_RESULT_FILE}")"
WEB_PASSED="$(awk '$2 == "pass" { value = $3 } END { print value + 0 }' "${WEB_RESULT_FILE}")"
WEB_FAILED="$(awk '$2 == "fail" { value = $3 } END { print value + 0 }' "${WEB_RESULT_FILE}")"
KAKAO_TOTAL="$(awk '$2 == "tests" { value = $3 } END { print value + 0 }' "${KAKAO_RESULT_FILE}")"
KAKAO_PASSED="$(awk '$2 == "pass" { value = $3 } END { print value + 0 }' "${KAKAO_RESULT_FILE}")"
KAKAO_FAILED="$(awk '$2 == "fail" { value = $3 } END { print value + 0 }' "${KAKAO_RESULT_FILE}")"

TOTAL_TESTS=$((WEB_TOTAL + KAKAO_TOTAL))
PASSED_TESTS=$((WEB_PASSED + KAKAO_PASSED))
FAILED_TESTS=$((WEB_FAILED + KAKAO_FAILED))

printf '\n=============================================\n'
printf ' 실행 결과:\n\n'
printf ' • 웹 애플리케이션 테스트: %s개 통과\n' "${WEB_PASSED}"
printf ' • 카카오 관련 모듈 테스트: %s개 통과\n' "${KAKAO_PASSED}"
printf ' • 전체 테스트: %s개 통과\n' "${PASSED_TESTS}"
printf ' • 실패: %s개\n' "${FAILED_TESTS}"

if [[ ${WEB_TEST_STATUS} -eq 0 && ${KAKAO_TEST_STATUS} -eq 0 && ${TOTAL_TESTS} -gt 0 && ${TOTAL_TESTS} -eq ${PASSED_TESTS} ]]; then
  printf '\n PASSED - %s/%s TESTS\n' "${PASSED_TESTS}" "${TOTAL_TESTS}"
  printf '=============================================\n\n'
  exit 0
fi

printf '\n FAILED - %s PASSED / %s FAILED / %s TOTAL\n' "${PASSED_TESTS}" "${FAILED_TESTS}" "${TOTAL_TESTS}"
printf '=============================================\n\n'
printf '%s\n' '--- 웹 애플리케이션 테스트 상세 로그 ---'
cat "${WEB_RESULT_FILE}"
printf '%s\n' '--- 카카오 관련 모듈 테스트 상세 로그 ---'
cat "${KAKAO_RESULT_FILE}"
exit 1
