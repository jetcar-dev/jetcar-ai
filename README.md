# 제트카 업무 도구

제트카에서 사용하는 MCP 서버와 업무 스킬을 Codex 데스크톱 플러그인으로 배포합니다.

## 설치 및 업데이트

### Windows에서 설치하기

1. ChatGPT 데스크톱 앱에서 **Codex**를 한 번 열고, **Node.js 22 이상**을 설치합니다. [Node.js 다운로드](https://nodejs.org/en/download)
2. PowerShell에서 아래 명령을 실행합니다.

   ```powershell
   cmd.exe /d /c npx --yes --prefer-online @jetcar/jetcar-ai@latest
   ```

3. 안내받은 설치 비밀번호를 입력하고 Enter를 누릅니다. 설치가 끝나면 Codex를 다시 열고 새 채팅에서 **제트카**를 선택합니다.

새 버전을 받으려면 같은 명령을 다시 실행합니다. 네이버 카페의 브라우저 연결은 [사용 안내](mcps/naver-cafe/README.md#플러그인에서-사용하기)를 확인합니다.

<details>
<summary>ZIP 및 GitHub 마켓플레이스 설치</summary>

### Codex 화면에서 설치하기

1. [제트카 ZIP 다운로드](https://github.com/jetcar-dev/jetcar-ai/archive/refs/heads/main.zip)를 누르고, 다운로드한 파일을 우클릭해 **모두 압축 풀기**를 선택합니다.
2. ChatGPT 데스크톱 앱에서 **Codex**를 열고 **프로젝트 추가**에서 압축을 푼 `jetcar-ai-main` 폴더를 선택합니다.
3. **플러그인 → 제트카 도구 → 제트카 → 플러그인 설치**를 누릅니다. 이어서 사용할 도구의 설정은 아래 **MCP 목록**에서 확인합니다.

Git과 Codex CLI는 아래 PowerShell 설치 방식에서 사용합니다.

### PowerShell에서 설치하기

#### 1. 처음 한 번 설치하기

1. ChatGPT 데스크톱 앱을 설치하고 로그인한 뒤 **Codex**를 엽니다. [Windows 앱 다운로드](https://learn.chatgpt.com/docs/windows/windows-app#download-the-chatgpt-desktop-app)
2. **Git for Windows** 설치 파일을 내려받아 실행합니다. PowerShell에서 `git --version`으로 버전이 표시되면 건너뜁니다. [Git 설치 파일](https://git-scm.com/install/windows)
3. **Codex CLI**를 설치합니다. PowerShell에서 `codex --version`으로 버전이 표시되면 건너뜁니다. [OpenAI 공식 Windows 설치 안내](https://learn.chatgpt.com/docs/enterprise/windows-deployment#choose-an-installation-method)

```powershell
$codexInstaller = Join-Path $env:TEMP 'codex-install.ps1'
Invoke-WebRequest -UseBasicParsing -Uri 'https://chatgpt.com/codex/install.ps1' -OutFile $codexInstaller
powershell.exe -NoProfile -ExecutionPolicy Bypass -File $codexInstaller
```

설치가 끝나면 PowerShell을 닫았다가 다시 열고 `git --version`과 `codex --version`으로 확인합니다.

#### 2. 제트카 플러그인 설치

Windows PowerShell에서 아래 두 줄을 순서대로 실행합니다.

```powershell
codex plugin marketplace add jetcar-dev/jetcar-ai
codex plugin add jetcar@jetcar-tools
```

Codex를 다시 열고 새 채팅에서 **제트카** 플러그인을 선택합니다. 사용할 MCP의 초기 설정은 아래 **MCP 목록**에서 확인합니다.

### 업데이트

Codex 화면에서 설치했다면 새 ZIP을 받아 압축을 푼 폴더를 열고 플러그인 화면에서 새 버전을 확인합니다.

PowerShell에서 설치했다면 아래 명령을 실행하고 Codex를 다시 엽니다.

```powershell
codex plugin marketplace upgrade jetcar-tools
```

</details>

## MCP 목록

제트카 플러그인에서 두 도구를 함께 사용합니다. 스마트에디터 ONE은 원고와 첨부를 준비하고, 네이버 카페는 계정과 게시판을 확인해 완성된 원고를 임시저장합니다.

### 네이버 카페

1. 카페 게시판과 하위 카테고리 조회
2. 특정 게시판의 글 목록과 본문 조회
3. 네이버 로그인 상태 확인 및 현재 계정의 임시글 목록 조회
4. 새 글 임시저장, 기존 임시글에 내용 추가 및 대표사진 변경
   - 여러 글을 한 번에 임시저장하도록 요청할 수 있습니다. 한 요청으로 5건이 저장되는 것을 확인했습니다.

[네이버 카페 설정 및 사용법](mcps/naver-cafe/README.md)

### 스마트에디터 ONE

1. 스마트에디터에서 적용할 수 있는 기능 조회
2. 붙여넣은 원문 또는 TXT·Markdown·JSON·Word·HTML·HWPX·CSV/TSV·엑셀·PDF 파일을 스마트에디터 원고로 변환
3. 문단, 표, 사진, MP4, 인용구, 구분선과 글자 서식을 조합해 원고 구성

“첨부한 Word 원고를 중고차 장기렌트카 입고 게시판에 같은 내용으로 5건 임시저장해줘”처럼 요청할 수 있습니다. 파일은 한 번 가져오고 같은 원고를 재사용합니다. [스마트에디터 ONE 사용법과 도구 목록](mcps/smart-editor-one/README.md)

## 추가 예정 기능

- 마케팅 콘텐츠 제작(홍보글 작성, 이미지 생성, 영상 생성)
- 네이버 블로그 등 다른 플랫폼 연동

## 프로젝트 구조

| 경로 | 내용 |
| --- | --- |
| `.agents/plugins/marketplace.json` | 제트카 플러그인을 제공하는 저장소 마켓플레이스 |
| `mcps/` | MCP 서버별 소스와 설정 안내 |
| `plugins/jetcar/plugin.json` | 제트카 플러그인 정보와 버전 |
| `plugins/jetcar/mcp.json` | 플러그인에서 사용할 MCP 서버 목록 |
| `plugins/jetcar/mcps/` | 플러그인과 함께 배포하는 로컬 MCP 실행 파일 |
| `plugins/jetcar/skills/` | Codex가 업무를 처리할 때 사용하는 스킬 |

새 MCP는 `mcps/<서버 이름>/`에 소스와 README를 두고 `mcp.json`의 `mcpServers`에 등록합니다. 로컬 실행 파일을 배포할 때는 `plugins/jetcar/mcps/<서버 이름>/`에 둡니다. 업무 절차가 필요하면 `plugins/jetcar/skills/<스킬 이름>/SKILL.md`를 추가합니다. 배포할 때 MCP 목록과 `plugin.json`의 버전을 갱신합니다.
