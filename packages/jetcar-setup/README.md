# 제트카 Codex 설치 프로그램

Windows에서 제트카 플러그인을 등록합니다. ChatGPT 데스크톱 앱에서 Codex를 한 번 열고, Node.js 22 이상을 설치한 뒤 PowerShell에서 실행합니다.

```powershell
npx --yes --prefer-online jetcar-setup@latest
```

안내에 따라 설치 비밀번호를 입력하고 Enter를 누릅니다. 입력 내용은 화면에 표시되지 않습니다. 설치가 완료되면 Codex를 다시 열고 새 채팅에서 **제트카**를 선택합니다.

네이버 카페를 처음 사용한다면 평소 쓰는 Chrome 또는 Edge에 [Playwright Extension](https://chromewebstore.google.com/detail/playwright-extension/mmlmfjhmonkocbjadbfplnigmagldckm)을 설치합니다. 네이버에 로그인한 뒤 Codex에 “제트카 카페 게시판 목록 보여줘”라고 입력하고, 브라우저 연결 화면에서 카페 탭을 선택해 **Allow**를 누릅니다.

새 버전을 설치하려면 같은 명령을 다시 실행합니다. 자세한 사용법은 [제트카 저장소](https://github.com/jetcar-dev/jetcar-ai)를 참고하세요.

## 배포

제트카 플러그인과 이 패키지의 버전을 맞추고, 저장소 루트에서 `npm pack ./packages/jetcar-setup`으로 패키지에 포함되는 파일을 확인합니다. 게시자 계정으로 인증한 뒤 `npm publish ./packages/jetcar-setup --access public`으로 배포합니다.
