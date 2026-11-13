# 네이버 카페 MCP

Chrome 또는 Edge의 네이버 로그인 세션을 사용해 카페 게시판과 임시글을 조회하고 글을 임시저장합니다.

## 플러그인에서 사용하기

1. [제트카 플러그인](../../README.md#설치-및-업데이트)과 [Node.js](https://nodejs.org/) 22 이상을 설치합니다.
2. 평소 네이버에 로그인하는 Chrome 또는 Edge 프로필에 [Playwright Extension](https://chromewebstore.google.com/detail/playwright-extension/mmlmfjhmonkocbjadbfplnigmagldckm)을 설치합니다.
3. Codex에 “네이버 카페 로그인 상태 확인해줘”라고 요청합니다. 처음 연결할 때는 Codex가 안내하는 `--setup-browser` 명령을 PowerShell에서 실행합니다.
4. 사용할 브라우저 프로필을 고르고, 그 프로필의 Playwright Extension 화면에서 복사한 토큰을 PowerShell에 붙여넣습니다. 토큰을 재발급하거나 프로필을 바꿨다면 이 연결 단계를 다시 진행합니다.

사진은 `%LOCALAPPDATA%\Jetcar\NaverCafeMcp\photos`에 넣고 파일 이름을 알려주세요. 저장한 글은 네이버 카페 글쓰기 화면의 **임시등록**에서 확인할 수 있습니다.

## 도구

| 도구 | 기능 |
| --- | --- |
| `check_cafe_login` | 연결된 브라우저 프로필의 네이버 로그인 상태 확인 |
| `list_cafe_boards` | 게시판 이름, 번호, 그룹, 링크 조회 |
| `list_cafe_drafts` | 현재 계정의 카페 임시글 조회 |
| `save_cafe_draft` | 사진과 인용구가 포함된 글의 임시저장 또는 기존 임시글에 내용 추가 |

게시판은 이름, 번호, 링크로 지정할 수 있습니다. 본문의 문단, 사진, 인용구 순서를 지정할 수 있고, 인용구 스타일은 스마트에디터 기준 1~6번을 지원합니다. 대표사진 번호는 기존 사진을 포함한 본문 순서로 셉니다.

## 개발

이 폴더에서 `npm ci`와 `npm run build`를 실행합니다. 단독 MCP로 테스트하려면 PowerShell에서 아래 명령을 실행합니다.

```powershell
codex mcp add naver-cafe -- node (Resolve-Path ./dist/server.js).Path
npm run setup:browser
```

단독 MCP 설정은 이 폴더의 `.env`에 입력합니다. `NAVER_CAFE_ID`는 기본 카페, `NAVER_BOARD_URL`은 기본 게시판입니다. 사진을 첨부하려면 `NAVER_IMAGE_DIR`에 폴더의 절대 경로를 입력합니다. 기본 설치 경로와 다른 브라우저는 `NAVER_PLAYWRIGHT_EXECUTABLE_PATH`로 지정할 수 있습니다.

플러그인에 변경한 MCP를 넣으려면 `npm run package:plugin`을 실행합니다. 배포 파일은 [플러그인의 네이버 카페 폴더](../../plugins/jetcar/mcps/naver-cafe/)에 생성됩니다.

## 코드 구조

- `src/auth/` — Chrome·Edge 연결 설정, Playwright 세션, 로그인 확인
- `src/boards/` — 카페·게시판 링크 처리, 게시판 목록과 그룹
- `src/drafts/` — 임시글 조회·저장, 스마트에디터와 사진 처리
- `src/shared/` — 로컬 설정, 네이버 요청과 MCP 응답
- `src/scripts/` — 별도로 실행하는 테스트 명령
- `src/server.ts` — MCP 도구 등록

## 공식 카페 API HTML 테스트

`npm run test:official`로 HTML을 확인하려면 이 폴더의 `examples/official-api-test.html`에 테스트용 HTML을 먼저 준비합니다. 네이버가 일부 HTML 스타일을 변경할 수 있습니다.

`.env`에 네이버 앱의 `NAVER_CLIENT_ID`, `NAVER_CLIENT_SECRET`을 설정하고 앱의 Callback URL에 `http://127.0.0.1:43127/oauth/naver/callback`을 등록하세요. `npm run test:official -- --login-only`로 공식 OAuth 로그인만 확인할 수 있습니다.

`--publish --board-url <테스트 게시판 URL>`을 전달하면 지정한 게시판에 멤버 공개 글을 바로 게시합니다.
