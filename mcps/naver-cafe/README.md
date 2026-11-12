# 네이버 카페 MCP

네이버 카페 글을 미리보고 게시하는 로컬 MCP 서버입니다.

## 설치 및 로그인

1. Node.js 22 이상을 설치하고 이 폴더에서 `npm ci`와 `npm run build`를 실행합니다.
2. `.env.example`을 `.env`로 복사하고 `NAVER_CLIENT_ID`와 `NAVER_CLIENT_SECRET`을 입력합니다.
3. 개발자 앱에서 `네이버 로그인`과 `카페`를 선택합니다. PC 웹 서비스 URL은 `http://127.0.0.1:43127`, 콜백 URL은 `http://127.0.0.1:43127/oauth/naver/callback`입니다.
4. `npm run login`을 실행하고, 게시 권한이 있는 네이버 계정으로 로그인합니다.

## MCP 클라이언트 연결

이 폴더에서 PowerShell로 등록합니다.

```powershell
codex mcp add naver-cafe -- node (Resolve-Path ./dist/server.js).Path
```

`preview_cafe_post`에 제목, 본문, 게시판 링크를 전달합니다. MCP가 링크에서 카페와 게시판 ID를 읽고, 대상을 특정할 수 없으면 게시판 링크를 요청합니다. 자주 쓰는 게시판 링크는 `.env`의 `NAVER_BOARD_URL`에 저장할 수 있습니다.

내용을 확인한 뒤 `publish_cafe_post`에 `previewId`와 `confirmed: true`를 전달하면 게시글 URL을 반환합니다. 본문은 텍스트와 HTML을 지원하며, 사진은 `NAVER_IMAGE_DIR`에 둔 파일의 이름으로 첨부합니다.

[네이버 카페 API](https://developers.naver.com/docs/login/cafe-api/cafe-api.md) · [네이버 로그인 검수 가이드](https://developers.naver.com/docs/login/verify/verify.md) · [Codex MCP 연결](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)
