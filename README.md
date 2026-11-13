# 제트카 업무 도구

제트카에서 사용하는 MCP 서버와 업무 스킬을 Codex 데스크톱 플러그인으로 배포합니다.

## 설치 및 업데이트

### 제트카 플러그인 설치

Windows PowerShell에서 아래 두 줄을 실행합니다.

```powershell
codex plugin marketplace add jetcar-dev/jetcar-ai
codex plugin add jetcar@jetcar-tools
```

Codex를 다시 열고 새 채팅에서 **제트카** 플러그인을 선택합니다. 사용할 MCP의 초기 설정은 아래 **MCP 목록**에서 확인합니다.

#### 처음 설치하는 PC

- ChatGPT 데스크톱 앱을 설치하고 로그인한 뒤 **Codex**를 엽니다. [Windows 앱 다운로드](https://learn.chatgpt.com/docs/windows/windows-app#download-the-chatgpt-desktop-app)
- PowerShell에서 `git --version`을 입력합니다. Git이 없다면 `winget install --id Git.Git --exact --source winget`으로 설치하고 PowerShell을 다시 엽니다. [Git 설치 파일](https://git-scm.com/install/windows)

#### Codex CLI 설치

PowerShell에서 `codex --version`을 입력합니다. 버전이 표시되면 위의 플러그인 설치 두 줄을 실행하면 됩니다. `codex` 명령을 찾을 수 없다고 나오면 아래 명령으로 CLI를 설치합니다. [OpenAI 공식 Windows 설치 안내](https://learn.chatgpt.com/docs/enterprise/windows-deployment#choose-an-installation-method)

```powershell
$codexInstaller = Join-Path $env:TEMP 'codex-install.ps1'
Invoke-WebRequest -UseBasicParsing -Uri 'https://chatgpt.com/codex/install.ps1' -OutFile $codexInstaller
powershell.exe -NoProfile -ExecutionPolicy Bypass -File $codexInstaller
```

설치가 끝나면 PowerShell을 닫았다가 다시 엽니다. `codex --version`으로 확인한 뒤 위의 플러그인 설치 두 줄을 실행합니다.

### 업데이트

새 버전을 받으려면 PowerShell에서 아래 명령을 실행하고 Codex를 다시 엽니다.

```powershell
codex plugin marketplace upgrade jetcar-tools
```

## MCP 목록

| 도구 | 기능 | 문서 |
| --- | --- | --- |
| 네이버 카페 | 로그인 확인, 게시판·임시글 조회, 글 임시저장 | [설정 및 사용법](mcps/naver-cafe/README.md) |

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
