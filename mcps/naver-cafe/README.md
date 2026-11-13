# 네이버 카페 MCP

네이버 카페 게시판, 게시글, 임시글을 조회하고 글을 임시저장합니다. 로그인이 필요한 작업은 Chrome 또는 Edge에 연결된 네이버 계정을 사용합니다.

## 플러그인에서 사용하기

1. [제트카 플러그인](../../README.md#설치-및-업데이트)을 설치합니다.
2. Windows용 **Node.js LTS** 설치 파일(`.msi`)을 내려받아 실행하고 Codex를 다시 엽니다. 이미 Node.js 22 이상이 설치되어 있으면 이 단계는 건너뜁니다. [Node.js 다운로드](https://nodejs.org/en/download)
3. 평소 쓰는 Chrome 또는 Edge에서 네이버에 로그인하고 카페를 열어둡니다. 같은 브라우저에 확장을 설치합니다. Edge가 다른 스토어의 확장을 허용할지 물으면 **허용**을 누릅니다. [Playwright Extension 설치](https://chromewebstore.google.com/detail/playwright-extension/mmlmfjhmonkocbjadbfplnigmagldckm)
4. Codex에서 **제트카** 플러그인을 선택하고 “제트카 카페 게시판 목록 보여줘”라고 입력합니다. 브라우저 연결 화면이 뜨면 로그인된 네이버 카페 탭을 선택하고 **Allow**(허용)를 누릅니다.

게시판 목록에는 로그인한 계정이 볼 수 있는 게시판이 표시됩니다. 연결이 끊겨 허용 화면이 다시 열리면 같은 방식으로 승인합니다.

사진과 MP4는 `%LOCALAPPDATA%\Jetcar\NaverCafeMcp\photos`에 넣고 파일 이름을 알려주세요. 저장한 글은 네이버 카페 글쓰기 화면의 **임시등록**에서 확인할 수 있습니다.

## 도구

| 도구 | 기능 |
| --- | --- |
| `check_cafe_login` | 연결된 브라우저 프로필의 네이버 로그인 상태 확인 |
| `list_cafe_boards` | 게시판 이름, 번호, 그룹, 링크 조회 |
| `list_cafe_articles` | 특정 게시판의 최신 글 목록과 본문 조회 |
| `list_cafe_drafts` | 현재 계정의 카페 임시글 조회 |
| `save_cafe_draft` | 표·사진·MP4·인용구·구분선과 글자 서식을 넣어 임시저장하거나 기존 임시글에 내용 추가 |

“중고차 장기렌트카 입고 게시판 최근 20개 글을 본문까지 보여줘”처럼 요청할 수 있습니다. 제목과 날짜만 요청하거나 미리보기로 요청하면 본문을 별도로 조회하지 않습니다. 한 페이지에 최대 50개이며, 더 필요하면 `nextPage`로 이어서 조회합니다. 공개 글은 로그인 연결 없이 읽습니다.

게시판은 이름, 번호, 링크로 지정할 수 있습니다. 문단과 사진, 표, 구분선, 인용구 1~6번을 원하는 순서로 넣을 수 있습니다. 글꼴·크기·색·굵기·기울임·밑줄·취소선·정렬은 본문과 표 셀에 지정할 수 있습니다. 대표사진 번호는 기존 사진을 포함한 본문 순서로 셉니다. [스마트에디터 ONE 입력 예시](../../plugins/jetcar/skills/naver-cafe/references/smart-editor-one.md)

## 개발

이 폴더에서 `npm ci`와 `npm run build`를 실행합니다. 단독 MCP로 테스트하려면 PowerShell에서 아래 명령을 실행합니다.

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
- `src/drafts/` — 임시글 조회·저장, 스마트에디터와 사진·동영상 처리
- `src/shared/` — 로컬 설정, 네이버 요청과 MCP 응답
- `src/server.ts` — MCP 도구 등록
