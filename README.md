# 제트카 업무 도구

제트카에서 사용하는 MCP 서버와 업무 스킬을 Codex 데스크톱 플러그인으로 배포합니다.

## 설치 및 업데이트

PowerShell에서 아래 명령을 실행합니다. Codex 데스크톱을 다시 열고 새 채팅에서 **제트카** 플러그인을 선택합니다.

```powershell
codex plugin marketplace add jetcar-dev/jetcar-ai
codex plugin add jetcar@jetcar-tools
```

사용할 MCP의 요구 사항과 초기 설정은 아래 문서에서 확인합니다. GitHub에서 업데이트를 가져오려면 다음 명령을 실행합니다.

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
