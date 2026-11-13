# 스마트에디터 ONE 입력 형식

`save_cafe_draft`에 새 임시글의 `title`과 `blocks`를 전달한다. 대상 게시판 링크는 `boardUrl`에 넣는다. 블록은 배열 순서대로 본문에 추가된다. `text` 값은 일반 문자열이며, 줄바꿈은 JSON의 `\n`으로 표현한다.

## 서식을 블록으로 옮기기

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
| 대표사진 | `"representativeImage": 2` | `blocks`와 같은 수준의 옵션이다. 기존 사진까지 포함해 본문의 두 번째 사진을 선택한다. |
| 인용구 | `{"type":"quote","text":"신규 입고 차량","style":3,"source":"제트카"}` | 1 기본, 2 세로선, 3 말풍선, 4 밑줄, 5 포스트잇, 6 모서리. 생략하면 2번이다. `source`는 출처다. |

글꼴 값은 `system`(기본), `nanumgothic`(나눔고딕), `nanummyeongjo`(나눔명조), `nanumbarungothic`(나눔바른고딕), `nanumsquare`(나눔스퀘어), `nanummaruburi`(마루부리), `nanumdasisijaghae`(다시 시작해), `nanumbareunhipi`(바른히피), `nanumuriddalsongeulssi`(우리딸손글씨)다.

표 디자인은 `style` 0~7 중에 고른다. 셀 객체의 `cellColor`는 셀 전체 배경색이다. `rowSpan`은 세로 병합, `colSpan`은 가로 병합에 쓴다. 병합된 자리의 셀은 배열에서 빼고 행을 구성한다. 병합하지 않은 빈 셀은 빈 문자열을 넣는다.

사진은 플러그인의 기본 사진 폴더 `%LOCALAPPDATA%\Jetcar\NaverCafeMcp\photos` 또는 설정된 `NAVER_IMAGE_DIR`에서 읽는다. JPG, JPEG, PNG, GIF를 지원한다. 한 번에 사진 20장, 한 장당 5 MiB, 합계 25 MiB까지 첨부할 수 있다.

### 새 임시글

아래 값은 형식 예시다. 실제 요청에 맞는 게시판 링크와 파일 이름으로 바꾼다.

```json
{
  "boardUrl": "https://cafe.naver.com/f-e/cafes/12345/menus/10",
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

### 기존 임시글

`list_cafe_drafts`에서 얻은 `temporaryArticleId`와 `boardUrl`을 전달한다. `title`을 생략하면 기존 제목이 유지된다. `blocks`를 넣으면 기존 본문 뒤에 추가된다. 아래는 본문과 제목을 그대로 두고 대표사진만 바꾸는 예시다.

```json
{
  "boardUrl": "https://cafe.naver.com/f-e/cafes/12345/menus/10",
  "temporaryArticleId": "123456",
  "representativeImage": 2
}
```

## 카페 글쓰기 화면에서 추가하는 항목

아래 항목의 생성·변경은 현재 MCP에서 지원되지 않는다. 사용자가 직접 추가할 때는 카페 글쓰기의 **임시등록**에서 글을 열고 원하는 위치에 삽입한다.

| 항목 | PC 스마트에디터 ONE에서 입력하는 방법 |
| --- | --- |
| 스티커 | **스티커**를 누르고 목록에서 원하는 스티커를 고른다. [스티커 도움말](https://help.naver.com/service/5622/contents/15332?osType=PC) |
| 외부 동영상 미리보기 | 외부 영상 URL을 본문에 붙여넣는다. [동영상 도움말](https://help.naver.com/service/5622/contents/15317?osType=PC) |
| 장소 | **장소**에서 상호나 지명을 검색해 지도에 추가한다. [장소 도움말](https://help.naver.com/service/5622/contents/15302?osType=PC) |
| 링크 미리보기 카드 | **링크**에서 URL을 입력하고 미리보기를 확인한 뒤 삽입한다. [링크 도움말](https://help.naver.com/service/5622/contents/15300?osType=PC) |
| 사진 크기 | 삽입된 사진을 선택하고 속성 도구 막대에서 바꾼다. [사진 속성 도움말](https://help.naver.com/service/5622/contents/15338?osType=PC) |

스마트에디터 ONE의 파일, 일정, 투표, 글감, 소스코드, 수식도 에디터에서 직접 첨부한다. [네이버 카페 스마트에디터 ONE 도움말](https://help.naver.com/service/5622/category/3171?lang=ko)
