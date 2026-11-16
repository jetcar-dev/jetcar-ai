# 네이버 카페 MCP

네이버 카페 게시판, 게시글, 임시글을 조회하고 글을 임시저장합니다. 로그인이 필요한 작업은 Chrome 또는 Edge에 연결된 네이버 계정을 사용합니다.

## 플러그인에서 사용하기

1. [제트카 플러그인](../../README.md#설치-및-업데이트)을 설치합니다.
2. Windows용 **Node.js LTS** 설치 파일(`.msi`)을 내려받아 실행하고 Codex를 다시 엽니다. 이미 Node.js 22 이상이 설치되어 있으면 이 단계는 건너뜁니다. [Node.js 다운로드](https://nodejs.org/en/download)
3. 평소 쓰는 Chrome 또는 Edge에서 네이버에 로그인하고 카페를 열어둡니다. 같은 브라우저에 확장을 설치합니다. Edge가 다른 스토어의 확장을 허용할지 물으면 **허용**을 누릅니다. [Playwright Extension 설치](https://chromewebstore.google.com/detail/playwright-extension/mmlmfjhmonkocbjadbfplnigmagldckm)
4. Codex에서 **제트카** 플러그인을 선택하고 “제트카 카페 게시판 목록 보여줘”라고 입력합니다. 브라우저 연결 화면이 뜨면 로그인된 네이버 카페 탭을 선택하고 **Allow**(허용)를 누릅니다.

게시판 목록에는 로그인한 계정이 볼 수 있는 게시판이 표시됩니다. 연결이 끊겨 허용 화면이 다시 열리면 같은 방식으로 승인합니다.

사진과 MP4는 `%LOCALAPPDATA%\Jetcar\NaverCafeMcp\photos`에 넣고 파일 이름을 알려주세요. 저장한 글은 네이버 카페 글쓰기 화면의 **임시등록**에서 확인할 수 있습니다.

“이 글을 중고차 장기렌트카 입고 게시판에 같은 내용으로 5개 임시저장해줘”처럼 여러 건을 한 번에 요청할 수 있습니다. 동일한 글 5건을 요청해 임시글 5개가 생성되는 것을 확인했습니다. MCP는 저장을 순서대로 처리합니다.

“첨부한 Word 원고를 50번 게시판에 원본대로 임시저장해줘”라고 하면 스마트에디터가 파일을 가져오고 카페 MCP가 원고 ID로 저장합니다. Word·HWPX·HTML에서 가져온 내장 사진도 원고 ID로 함께 처리합니다. 파일 형식과 변환 범위는 [스마트에디터 ONE 사용법](../smart-editor-one/README.md#도구와-지원-범위)에서 확인하세요.

## 도구

| 도구 | 기능 |
| --- | --- |
| `check_cafe_login` | 연결된 브라우저 프로필의 네이버 로그인 상태 확인 |
| `list_cafe_boards` | 게시판 이름, 번호, 그룹, 링크 조회 |
| `list_cafe_articles` | 특정 게시판의 최신 글 목록과 본문 조회 |
| `list_cafe_drafts` | 현재 계정의 카페 임시글 조회 |
| `save_cafe_draft` | 가져온 원고 ID나 직접 구성한 원고로 새 임시글 저장, 기존 임시글에 내용 추가 및 대표사진 변경 |

“중고차 장기렌트카 입고 게시판 최근 20개 글을 본문까지 보여줘”처럼 요청할 수 있습니다. 제목과 날짜만 요청하거나 미리보기로 요청하면 본문을 별도로 조회하지 않습니다. 한 페이지에 최대 50개이며, 더 필요하면 `nextPage`로 이어서 조회합니다. 공개 글은 로그인 연결 없이 읽습니다.

게시판은 이름, 번호, 링크로 지정할 수 있습니다. 기존 임시글은 “캐스퍼 입고 임시글의 두 번째 사진을 대표사진으로 바꿔줘”처럼 요청하세요. 도구로 제공되는 본문 편집은 끝에 내용 추가입니다. 기존 문단이나 사진을 교체하려면 카페 글쓰기의 **임시등록**에서 글을 엽니다. [스마트에디터 ONE 본문 입력 형식](../../plugins/jetcar/skills/smart-editor-one/references/input.md)

## 개발

카페 MCP를 빌드하기 전에 이 폴더와 `../smart-editor-one`에서 각각 `npm ci`를 실행합니다. 이 폴더에서 `npm run build`를 실행한 뒤 PowerShell에서 단독 MCP로 등록할 수 있습니다.

```powershell
codex mcp add naver-cafe -- node (Resolve-Path ./dist/server.js).Path
```

단독 MCP 설정은 이 폴더의 `.env`에 입력합니다. `NAVER_CAFE_ID`는 기본 카페, `NAVER_BOARD_URL`은 기본 게시판입니다. 사진을 첨부하려면 `NAVER_IMAGE_DIR`에 폴더의 절대 경로를 입력합니다. 기본 설치 경로와 다른 브라우저는 `NAVER_PLAYWRIGHT_EXECUTABLE_PATH`로 지정할 수 있습니다.

개발 환경에서 브라우저 재연결 시 허용 화면을 건너뛰려면 `npm run setup:browser`로 Playwright Extension 토큰을 등록할 수 있습니다.

플러그인에 변경한 MCP를 넣으려면 `npm run package:plugin`을 실행합니다. 배포 파일은 [플러그인의 네이버 카페 폴더](../../plugins/jetcar/mcps/naver-cafe/)에 생성됩니다.

## 코드 구조

- `src/auth/` — Chrome·Edge 연결 설정, Playwright 세션, 로그인 확인
- `src/boards/` — 카페·게시판 링크 처리, 게시판 목록과 그룹
- `src/articles/` — 게시글 목록과 본문 조회
- `src/drafts/` — 카페 글쓰기 권한 요청과 임시글 조회·저장
- `src/shared/` — 로컬 설정, 네이버 요청과 MCP 응답
- `src/server.ts` — MCP 도구 등록
