# 스마트에디터 ONE MCP

원문을 스마트에디터 ONE에서 쓰는 형식으로 바꾸고, 표·사진·영상과 글자 서식을 넣어 원고를 구성합니다. 제트카 플러그인을 설치하면 스마트에디터 ONE과 네이버 카페 도구를 함께 쓸 수 있습니다. [플러그인 설치](../../README.md#설치-및-업데이트)

## Codex에서 요청하기

| 하고 싶은 일 | 요청 예시 |
| --- | --- |
| 원문을 서식 있는 원고로 변환 | “아래 Markdown에서 제목, 표, 인용구를 살려 스마트에디터용 원고로 바꿔줘.” |
| 파일을 원고로 가져오기 | “첨부한 Word 파일을 문구와 표, 사진 순서 그대로 가져와줘.” |
| 엑셀 표 가져오기 | “첨부한 엑셀에서 ‘입고’ 시트만 본문 표로 만들어줘.” |
| PDF 일부 가져오기 | “첨부한 PDF 2~4쪽의 텍스트를 원고로 가져와줘.” |
| 원고에 서식 추가 | “문단은 가운데 정렬하고, 계약 기간과 월 렌트료는 표로 넣어줘. 본문 소제목은 굵게 해줘.” |
| 카페 임시저장 | “이 원고에 `car.jpg`를 넣고 중고차 장기렌트카 입고 게시판에 임시저장해줘.” |

원고 구성과 미리보기는 네이버 로그인 없이 할 수 있습니다. 카페 임시저장까지 요청하면 Codex가 스마트에디터에서 준비한 원고를 네이버 카페 도구에 넘깁니다. 로그인 연결과 사진·영상 폴더는 [네이버 카페 사용법](../naver-cafe/README.md#플러그인에서-사용하기)을 확인하세요.

## 도구와 지원 범위

| 도구 | 기능 |
| --- | --- |
| `list_smart_editor_features` | 적용할 수 있는 기능과 입력 항목 조회 |
| `convert_smart_editor_source` | 일반 텍스트 또는 Markdown 원문을 스마트에디터용 본문으로 변환 |
| `prepare_smart_editor_document` | 표·사진·MP4·인용구·구분선·문단과 글자 서식을 입력해 원고 구성 |
| `import_smart_editor_file` | 아래 파일을 원고로 변환하고 원고 ID, 미리보기와 변환 안내 반환 |
| `read_smart_editor_document` | 가져온 원고의 전체 본문과 서식 읽기 |

| 파일 | 가져오는 내용 |
| --- | --- |
| TXT | 문구, 띄어쓰기, 줄바꿈 |
| Markdown | 문단, 본문 제목, 굵게·기울임·취소선, 링크, 표, 인용구, 구분선, 로컬 사진 참조 |
| JSON | 스마트에디터의 `title`·`blocks`, 또는 지정한 JSON 필드의 원문 |
| Word `.docx` | 본문, 줄바꿈, 글자 서식, 정렬, 표와 병합, Word에 포함된 JPG·PNG·GIF 사진 |
| HTML `.html`, `.htm` | 본문 제목, 문단, 일부 인라인 서식, 링크, 인용구, 표, 내장 사진과 로컬 사진 참조 |
| 한글 `.hwpx` | 본문, 줄바꿈, 정렬, 일부 글자 서식, 표와 병합, 내장 JPG·PNG·GIF 사진 |
| `.csv`, `.tsv` | 구분된 셀을 편집 가능한 본문 표로 변환. CSV는 쉼표, TSV는 탭이 기본 |
| 엑셀 `.xlsx` | 첫 번째 표시 시트 또는 지정한 시트의 셀 값, 병합과 일부 셀 서식을 본문 표로 변환 |
| PDF `.pdf` | 전체 문서 또는 지정한 쪽 범위의 선택 가능한 텍스트 |

CSV와 엑셀은 파일 하나를 원고 하나로 가져옵니다. 행·열이 많은 표는 원고 안에서 최대 30행 × 20열씩 나눕니다. PDF의 표·사진·페이지 배치는 직접 재구성해야 하고, 스캔본은 먼저 OCR로 텍스트를 만들어야 합니다. `.doc`, `.hwp`, `.xls` 파일은 최신 형식으로 저장한 뒤 가져올 수 있습니다.

변환 결과의 `warnings`에 다른 형식으로 옮기기 어려운 항목이 표시됩니다. 지원하는 내장 사진은 원본 파일 데이터를 재사용합니다. Markdown·JSON·HTML에서 이름으로 첨부한 파일은 저장 플랫폼의 첨부 폴더에서 찾습니다. [입력 형식과 지원 범위](../../plugins/jetcar/skills/smart-editor-one/references/input.md)

## 변환 속도와 원고 재사용

같은 원본과 옵션이면 파싱과 첨부 추출을 건너뛰고 기존 원고 ID를 돌려줍니다. 같은 원고를 여러 건 임시저장할 때는 ID만 다시 전달하면 됩니다.

Windows와 Node.js 22에서 아래 샘플을 설치용 MCP로 각 5회 호출한 중앙값입니다. 시간에는 로컬 파일 읽기와 MCP 응답이 포함됩니다.

| 샘플 | 새 원고 변환 | 직후 같은 요청 |
| --- | ---: | ---: |
| TXT·Markdown·JSON 약 5~6 KB | 2.1~5.5 ms | 0.6~0.9 ms |
| HTML·CSV·TSV·XLSX 약 0.03~1.9 KB | 2.1~3.7 ms | 0.6~0.7 ms |
| HWPX 약 99 KB, 표 4개와 사진 3장 | 13.8 ms | 1.1 ms |
| DOCX 약 2.7 MB | 42.6 ms | 2.9 ms |
| PDF 3쪽 약 1 KB | 3.7 ms | 0.6 ms |

MCP를 실행한 뒤 PDF를 처음 읽을 때는 PDF 모듈을 불러오는 시간까지 포함해 약 65 ms가 걸렸습니다. 카페 임시저장과 첨부 업로드 시간은 별도입니다.

## 개발

저장소 루트에서 아래 명령으로 스마트에디터 MCP를 빌드합니다.

```powershell
npm ci --prefix mcps/smart-editor-one
npm run package:plugin --prefix mcps/smart-editor-one
```

빌드 결과는 `plugins/jetcar/mcps/smart-editor-one/server.cjs`입니다. 제트카 플러그인의 `mcp.json`이 이 서버를 실행합니다.

붙여넣은 원문 변환과 서식 입력 도구는 `structuredContent.draft`를 반환합니다. 파일 가져오기는 같은 PC에서 재사용할 수 있는 `structuredContent.documentId`를 반환합니다. 카페에 원본 그대로 새 임시글을 저장할 때는 `save_cafe_draft`에 `preparedDocumentId`와 `boardUrl`을 전달합니다. 파일을 다시 읽거나 전체 본문을 채팅에 가져올 필요가 없습니다. 원본 파일이나 변환 옵션이 달라지면 새 원고 ID를 사용합니다.

`src/imports/`는 파일 변환, `src/prepared-documents.ts`는 공용 원고 ID 보관, `src/editor-blocks.ts`와 `src/editor-document.ts`는 본문 형식과 조립, `src/uploads/`는 첨부 업로드를 담당합니다. Windows에서 변환 결과와 내장 사진은 `%LOCALAPPDATA%\Jetcar\SmartEditorOne\documents`에 보관합니다. 개발 환경에서 폴더를 바꾸려면 두 MCP에 같은 `JETCAR_SMART_EDITOR_DOCUMENT_DIR`을 지정합니다. 업로드는 플랫폼에서 받은 글쓰기 권한으로 저장 시 실행됩니다.
