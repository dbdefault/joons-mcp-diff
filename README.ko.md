# JOONS MCP Diff

AI 에이전트가 중단되기 전에 MCP 도구와 스키마의 변경을 감지합니다.

![Preview](https://img.shields.io/badge/status-Preview-orange) [![CI](https://github.com/dbdefault/joons-mcp-diff/actions/workflows/ci.yml/badge.svg)](https://github.com/dbdefault/joons-mcp-diff/actions/workflows/ci.yml) ![License](https://img.shields.io/badge/license-Apache--2.0-blue)

[JOONS 생태계](https://github.com/dbdefault/joons-ecosystem)의 일부입니다. 자매 제품인 [JOONS MCP Probe](https://github.com/dbdefault/joons-mcp-probe)는 MCP 서버 하나의 현재 상태를 살펴보고, Diff는 두 시점의 계약을 비교합니다. Diff는 독립 제품이며 Probe가 필요하지 않습니다.

에이전트는 도구 이름과 입력 스키마에 의존합니다. 서버가 업데이트되면 이전에 유효했던 호출이 거부될 수 있습니다. 스냅샷을 비교하면 호출이 실패하기 전에 호환성 위험을 살펴볼 수 있습니다.

## 호환성 분류 예시

| 분류 | 예시 |
| --- | --- |
| BREAKING | 도구가 삭제되었습니다. |
| BREAKING | 입력 속성이 필수가 되었습니다. |
| NON_BREAKING | 도구가 추가되었습니다. |
| NON_BREAKING | 선택 입력 속성이 추가되었습니다. |
| UNKNOWN | 출력 스키마가 변경되었습니다. |
| UNKNOWN | 변경된 `oneOf`의 호환성을 안전하게 분류할 수 없습니다. |

BREAKING은 이전에 유효했던 호출이 이제 거부될 수 있다는 뜻입니다. UNKNOWN은 안전하게 분류할 수 없다는 뜻이며 안전하다는 뜻이 아닙니다. 이름 변경 힌트는 제안일 뿐 자동으로 적용되지 않습니다.

## 설치

Node.js 20 이상이 필요합니다.

```sh
npm install -g github:dbdefault/joons-mcp-diff#v0.1.0
```

저장소를 복제하여 사용하려면 다음과 같이 실행합니다.

```sh
git clone https://github.com/dbdefault/joons-mcp-diff.git
cd joons-mcp-diff
npm ci
node bin/joons-mcp-diff.js --help
```

## 빠른 시작

```sh
node bin/joons-mcp-diff.js snapshot stdio --label before -o before.json -- node test/fixtures/servers/v1-stdio.js
node bin/joons-mcp-diff.js snapshot stdio --label after -o after.json -- node test/fixtures/servers/v2-stdio.js
node bin/joons-mcp-diff.js compare before.json after.json --format terminal --fail-on none
node bin/joons-mcp-diff.js compare before.json after.json --format markdown --fail-on none
node bin/joons-mcp-diff.js compare before.json after.json --format json --fail-on none
node bin/joons-mcp-diff.js compare before.json after.json --fail-on breaking
```

위 명령은 복제본의 테스트 서버를 사용하며 마지막 명령은 종료 코드 1을 반환합니다. 실제 터미널 출력은 다음과 같습니다.

```text
Risk: high | added 1, removed 1, changed 3, unchanged 0 | breaking 4, non-breaking 3, unknown 1
BREAKING create_item /properties/kind/enum: enum values removed
```

Markdown은 MCP Diff 제목과 Risk: high를 출력합니다. JSON에는 after.label 값 after가 들어갑니다. HTTP 서버 주소와 헤더 환경 변수를 지정하는 예시는 다음과 같습니다.

```sh
joons-mcp-diff snapshot http https://example.com/mcp --header Authorization=TOKEN_ENV --label after -o after.json
```

헤더 값은 지정한 환경 변수에서 읽습니다. 표준 입출력 방식에서는 비밀이 아닌 추가 환경 변수에 `--env NAME`, 비밀 값에는 `--secret-env NAME`을 사용합니다. `.cmd`와 `.bat`의 직접 실행은 거부됩니다. Windows에서 셸 래퍼가 꼭 필요하면 `cmd.exe /d /s /c`를 명시적으로 선택할 수 있습니다. 신뢰하는 명령과 인수만 사용하십시오.

`--fail-on`의 기본값은 `breaking`입니다. `unknown`은 BREAKING 또는 UNKNOWN, `any`는 모든 변경에서 실패하며 `none`은 변경 때문에 실패하지 않습니다. [CI 예시](examples/github-actions.md)를 참고하십시오.

## CLI 사용법

`snapshot stdio`는 `--env NAME`, `--secret-env NAME`, `--cwd DIR`, `--label TEXT`, `-o FILE`과 `--` 뒤의 명령을 받습니다. `snapshot http URL`은 `--header NAME=ENVVAR`, 라벨과 출력 파일을 받습니다. 제한과 시간 옵션은 [API 기본값](docs/API.md)의 이름을 하이픈 형식으로 사용합니다. 출력 파일을 지정하지 않으면 표준 출력으로 기록합니다.

`compare BEFORE AFTER`는 `--format terminal|markdown|json`, `--json-out FILE`, `--md-out FILE`, `--fail-on breaking|unknown|any|none`, `--all`, `--no-rename-hints`, `--quiet`, `--color`를 지원합니다. 색상은 터미널에서만 사용됩니다.

실제 확인한 종료 코드는 다음과 같습니다.

| 변경 | breaking | unknown | any | none |
| --- | ---: | ---: | ---: | ---: |
| 없음 | 0 | 0 | 0 | 0 |
| NON_BREAKING | 0 | 0 | 1 | 0 |
| UNKNOWN | 0 | 1 | 1 | 0 |
| BREAKING | 1 | 1 | 1 | 0 |

입력 파일을 읽을 수 없으면 코드 2, 배치 파일 직접 실행 거부나 잘못된 인수는 코드 3, 출력 오류는 코드 4입니다.

## 스냅샷 형식

버전 1은 `format: "joons-mcp-diff/snapshot"`, `schemaVersion`, `createdAt`, `tool`, `label`, `server`, `tools`, `stats`를 가진 JSON입니다. 도구는 이름순으로 정렬하고 스키마 객체의 키는 재귀적으로 정렬합니다. 같은 서버 응답은 `createdAt`을 제외하면 동일한 바이트로 기록됩니다. 서버가 중복 도구 이름을 반환하면 첫 번째만 유지하고 `stats.duplicateNames`에 기록합니다. 입력 스냅샷 검증은 중복 이름을 거부합니다. [스냅샷 예시](examples/before.json)를 확인하십시오.

명령, 인수, 작업 디렉터리, 환경 변수 이름과 값, URL, 헤더, 토큰, 표준 오류, 시간 측정값 및 호스트 이름은 저장하지 않습니다. 라벨은 사용자가 입력하는 텍스트이므로 비밀을 넣지 마십시오. 비밀 값과 URL 인코딩 및 base64 형태는 신뢰할 수 없는 텍스트에서 마스킹합니다. `--env` 값은 비밀로 취급하지 않습니다.

## 종료 코드

| 코드 | 의미 |
| --- | --- |
| 0 | 성공 또는 선택한 기준 미만의 변경 |
| 1 | 선택한 기준 이상의 변경 |
| 2 | 실행 오류 또는 읽을 수 없거나 유효하지 않은 스냅샷 |
| 3 | 사용법 오류 |
| 4 | 출력 오류 |

## 제한과 안전

스냅샷 기본 제한은 도구 10,000개, 메시지당 4 MiB, 전체 32 MiB, 깊이 64, 문자열당 100,000자, 50페이지입니다. 긴 문자열 값은 표시와 함께 잘리며 객체 키가 너무 길거나 다른 제한을 넘으면 부분 스냅샷을 쓰지 않고 실패합니다. 입력 스냅샷 파일은 최대 64 MiB입니다. 기본 단계, 전체, 종료 대기 시간은 각각 15초, 60초, 3초입니다.

수집은 MCP 프로토콜 수준에서 읽기 전용입니다. 허용 목록은 `initialize`, `notifications/initialized`, `tools/list`, `ping`만 허용하며 도구를 호출하지 않습니다. 다만 서버 시작 자체는 사용자가 지정한 명령을 실행합니다. 복잡한 스키마 및 출력 스키마 변경은 UNKNOWN으로 분류될 수 있습니다. Diff는 호환성 검토를 돕는 도구이며 서버의 동작을 보증하지 않습니다.

[아키텍처](docs/ARCHITECTURE.md), [API](docs/API.md), [기여 안내](CONTRIBUTING.md), [보안](SECURITY.md), [변경 내역](CHANGELOG.md), [영문 README](README.md)를 참고하십시오.
