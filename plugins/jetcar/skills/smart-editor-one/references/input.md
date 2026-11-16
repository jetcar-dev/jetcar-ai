# 스마트에디터 ONE 입력 형식

두 원고 도구에는 글 제목인 `title`이 필요하다. 둘 다 `structuredContent.draft`에 `title`, `blocks`, 지정된 경우 `representativeImage`를 반환한다. 저장할 때 필요한 플랫폼과 게시판은 [플랫폼에 넘기기](../SKILL.md#플랫폼에-넘기기)를 참고한다.

## 원본 파일 가져오기

`import_smart_editor_file`에는 사용자 파일의 절대 경로인 `filePath`를 전달한다. 파일 형식은 확장자로 결정한다. `title`을 생략하면 파일에서 읽은 제목 또는 파일 이름을 쓴다. 반환된 `preview`와 `warnings`를 확인한다. 같은 원본과 옵션이면 기존 `documentId`를 돌려준다.

- `.txt`, `.md`·`.markdown`, `.html`·`.htm`, `.csv`·`.tsv`는 UTF-8 또는 BOM이 있는 UTF-16을 자동 인식한다. 다른 인코딩이면 `encoding`에 `utf-16le`, `utf-16be`, `euc-kr` 등을 지정한다.
- JSON은 `{"title":"글 제목","blocks":[...]}` 또는 같은 객체를 담은 `draft`를 받는다. 다른 JSON 양식은 `jsonFields`에 `{"title":"post.subject","body":"post.content","bodyFormat":"markdown"}`처럼 경로를 지정한다. 본문이 스마트에디터 블록 배열이면 `body` 대신 `blocks` 경로를 지정한다.
- `.docx`와 `.hwpx`는 문단, 일부 글자 서식, 정렬, 표와 병합, 내장 JPG·PNG·GIF를 가져온다. 페이지 배치와 고정 위치 개체는 변환 안내를 확인한다. HWPX의 표 셀 안 사진은 표 다음에 배치한다.
- HTML은 화면에 표시되는 문단, 인라인 글자 서식과 정렬, 표, 링크 등을 가져온다. 외부 스타일시트와 스크립트는 실행하지 않는다. URL로 연결된 사진은 대체 텍스트나 링크로 옮기고, 지원하는 데이터 URL 사진은 원고에 보관한다.
- CSV·TSV와 `.xlsx`는 한 원고에 표를 만든다. 표가 크면 최대 30행 × 20열씩 나눈다. 엑셀의 `sheet`를 생략하면 첫 표시 시트를 읽는다. 수식에 저장된 결과가 있으면 그 값을 가져오고, 날짜·통화 표시 서식과 차트는 별도로 확인한다. CSV에서 세미콜론이나 탭을 쓰면 `delimiter`에 `";"`나 `"\t"`를 지정한다.
- PDF의 특정 쪽만 가져오려면 `pdfPages: {"from": 2, "to": 4}`처럼 양쪽을 포함해 지정한다. 한 번에 최대 120쪽, 본문 30,000자를 가져온다. 스캔본은 OCR 처리한 뒤 가져올 수 있다. 표, 사진, 다단 배치와 글자 서식은 변환되지 않는다.
- `.doc`, `.hwp`, `.xls`는 각각 `.docx`, `.hwpx`, `.xlsx`로 저장한 뒤 가져온다. Markdown·JSON·HTML의 로컬 이미지나 동영상 참조는 대상 플랫폼의 첨부 폴더에 둔다. 가져온 내장 사진은 원고 ID로 새 임시글을 만들 때 함께 처리한다.

TXT·Markdown·JSON·HTML·CSV·TSV 원본은 최대 2 MiB, DOCX·HWPX·XLSX·PDF 원본은 최대 64 MiB다. 변환한 원고에는 최대 100개 블록과 30,000자를 담을 수 있다.

## 원문 변환

`convert_smart_editor_source`에 `source`와 `format`을 전달한다. `text`가 기본값이며 원문과 줄바꿈을 유지한다. `markdown`은 본문 제목, 굵게·기울임·취소선, HTTP·HTTPS 링크, 표, 인용구, 구분선을 바꾼다. 사진은 `![엔진룸](engine.jpg)`처럼 지원하는 로컬 파일명을 별도 문단에 적었을 때 첨부 항목이 된다. 인용구의 디자인이나 글자 서식은 변환 뒤 `quote` 블록 전체에 지정할 수 있다.

```json
{
  "title": "캐스퍼 입고 안내",
  "format": "markdown",
  "source": "## 차량 정보\n\n**캐스퍼**가 입고되었습니다.\n\n> 출고 일정은 상담 시 안내합니다."
}
```

## 서식을 블록으로 옮기기

`prepare_smart_editor_document`에는 `title`과 표시 순서대로 구성한 `blocks`를 전달한다. 줄바꿈은 JSON의 `\n`으로 표현한다. 최대 100개 블록, 제목 300자, 본문 30,000자를 입력할 수 있다.

- 사진, 동영상, 인용구, 표, 구분선은 원고에서 해당 항목이 나오는 순서대로 넣는다.
- 정렬이 바뀌면 새 `text` 블록을 만든다. 같은 문단 안에서 글자 서식만 바뀌면 `runs`에 구간을 나눠 넣는다. 필요한 띄어쓰기는 구간의 `text`에 포함한다.
- 사진 번호는 사진만 센다. 파일명으로 대표사진을 지정했다면 최종 본문 순서에서 그 사진의 번호를 계산한다.
- 도구 입력 스키마에 있는 필드만 전달한다. HTML·마크다운 서식 기호는 `text`에서 문자 그대로 다뤄진다.

## MCP에서 입력할 수 있는 항목

| 항목 | 입력 예시 | 적용 범위 |
| --- | --- | --- |
| 문단 | `{"type":"text","text":"캐스퍼 입고 안내\n차량 사진을 확인해 주세요."}` | 줄바꿈마다 새 문단을 만든다. |
| 정렬 | `{"type":"text","text":"캐스퍼 입고","align":"center"}` | `left`는 왼쪽, `center`는 가운데, `right`는 오른쪽. 같은 블록의 모든 문단에 적용된다. |
| 글꼴과 크기 | `{"type":"text","text":"캐스퍼 입고","fontFamily":"nanumgothic","fontSize":24}` | `fontSize`는 10~40의 정수다. |
| 글자 서식과 색 | `{"type":"text","text":"캐스퍼 입고","bold":true,"fontColor":"#173E72"}` | `italic`, `underline`, `strikeThrough`도 `true`로 켠다. `backgroundColor`는 글자 뒤 강조색이다. 색은 6자리 HEX다. |
| 문장 일부 서식 | `{"type":"text","runs":[{"text":"지금 입고","bold":true},{"text":"된 차량입니다."}]}` | 블록의 기본 글자 서식을 상속하며 구간의 값이 우선한다. |
| 글자 링크 | `{"type":"text","text":"차량 보기","link":"https://example.com/car"}` | `runs`의 구간과 표 셀에도 적용한다. |
| 표 | `{"type":"table","rows":[["항목","내용"],["차종","캐스퍼"]]}` | 문자열 셀과 개별 서식을 지정한 객체 셀을 섞을 수 있다. |
| 구분선 | `{"type":"divider","style":2,"align":"center"}` | `style`은 0~7이다. 0이 기본이다. |
| 사진 | `{"type":"image","file":"casper-front.jpg","caption":"캐스퍼 전면","align":"center"}` | 사진 한 장당 블록 하나를 넣는다. `file`은 사진 폴더 안의 파일 이름이다. `link`로 사진을 눌렀을 때 열 주소를 지정한다. |
| 동영상 | `{"type":"video","file":"casper-walkaround.mp4","title":"캐스퍼 둘러보기","align":"center"}` | MP4 파일은 사진과 같은 폴더에 넣는다. `title`과 `align`은 선택이다. 한 글에 최대 10개를 첨부할 수 있다. |
| 대표사진 | `"representativeImage": 2` | `blocks`와 같은 수준의 옵션이다. 준비하는 원고에 들어 있는 사진 중 두 번째 사진을 선택한다. 기존 임시글을 수정할 때는 저장 도구에서 기존 사진까지 포함해 센다. |
| 인용구 | `{"type":"quote","text":"신규 입고 차량","style":3,"source":"제트카"}` | 1 기본, 2 세로선, 3 말풍선, 4 밑줄, 5 포스트잇, 6 모서리. 생략하면 2번이다. `source`는 출처다. |

글꼴 값은 `system`(기본), `nanumgothic`(나눔고딕), `nanummyeongjo`(나눔명조), `nanumbarungothic`(나눔바른고딕), `nanumsquare`(나눔스퀘어), `nanummaruburi`(마루부리), `nanumdasisijaghae`(다시 시작해), `nanumbareunhipi`(바른히피), `nanumuriddalsongeulssi`(우리딸손글씨)다.

표 디자인은 `style` 0~7 중에 고른다. 셀 객체의 `cellColor`는 셀 전체 배경색이다. `rowSpan`은 세로 병합, `colSpan`은 가로 병합에 쓴다. 병합된 자리의 셀은 배열에서 빼고 행을 구성한다. 병합하지 않은 빈 셀은 빈 문자열을 넣는다.

사진은 JPG, JPEG, PNG, GIF를 지원한다. 저장할 때 한 요청에 사진 20장, 한 장당 5 MiB, 합계 25 MiB까지 첨부할 수 있다. 사진·영상에 사용할 폴더는 저장하는 플랫폼에서 정한다. 네이버 카페는 [첨부와 임시저장 안내](../../naver-cafe/SKILL.md#새-글-임시저장)를 참고한다.

### 서식 입력 예시

아래는 `prepare_smart_editor_document` 입력 예시다. 실제 요청에 맞는 파일 이름으로 바꾼다.

```json
{
  "title": "캐스퍼 입고 안내",
  "blocks": [
    {"type": "text", "text": "캐스퍼 입고", "align": "center", "bold": true, "fontSize": 24},
    {"type": "divider", "style": 2},
    {"type": "quote", "text": "신규 입고 차량", "style": 3},
    {"type": "image", "file": "casper-front.jpg"},
    {"type": "image", "file": "casper-interior.jpg"},
    {"type": "video", "file": "casper-walkaround.mp4", "title": "캐스퍼 둘러보기", "align": "center"},
    {"type": "table", "rows": [
      [{"text": "차량 정보", "colSpan": 2, "align": "center", "bold": true, "cellColor": "#E7EEF8"}],
      ["차종", "캐스퍼"],
      ["상태", "입고 완료"]
    ]},
    {"type": "text", "text": "차량 사진을 확인해 주세요.\n문의는 댓글로 남겨주세요."}
  ],
  "representativeImage": 2
}
```

## 지원 범위

붙여넣은 원문은 일반 텍스트 또는 Markdown으로 변환한다. 파일 첨부를 받으면 [원본 파일 가져오기](#원본-파일-가져오기)를 사용한다. 아래 항목을 추가하려면 카페 글쓰기의 **임시등록**에서 초안을 연 뒤 직접 편집한다.

| 항목 | PC 스마트에디터 ONE에서 입력하는 방법 |
| --- | --- |
| 스티커 | **스티커**를 누르고 목록에서 원하는 스티커를 고른다. [스티커 도움말](https://help.naver.com/service/5622/contents/15332?osType=PC) |
| 외부 동영상 미리보기 | 외부 영상 URL을 본문에 붙여넣는다. [동영상 도움말](https://help.naver.com/service/5622/contents/15317?osType=PC) |
| 장소 | **장소**에서 상호나 지명을 검색해 지도에 추가한다. [장소 도움말](https://help.naver.com/service/5622/contents/15302?osType=PC) |
| 링크 미리보기 카드 | **링크**에서 URL을 입력하고 미리보기를 확인한 뒤 삽입한다. [링크 도움말](https://help.naver.com/service/5622/contents/15300?osType=PC) |
| 사진 크기 | 삽입된 사진을 선택하고 속성 도구 막대에서 바꾼다. [사진 속성 도움말](https://help.naver.com/service/5622/contents/15338?osType=PC) |

스마트에디터 ONE의 파일, 일정, 투표, 글감, 소스코드, 수식도 에디터에서 직접 첨부한다. [네이버 카페 스마트에디터 ONE 도움말](https://help.naver.com/service/5622/category/3171?lang=ko)
