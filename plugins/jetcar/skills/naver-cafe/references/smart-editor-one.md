# 스마트에디터 ONE 입력 형식

`save_cafe_draft`에 새 임시글의 `title`과 `blocks`를 전달한다. 대상 게시판 링크는 `boardUrl`에 넣는다. 블록은 배열 순서대로 본문에 추가된다. `text` 값은 일반 문자열이며, 줄바꿈은 JSON의 `\n`으로 표현한다.

## 서식을 블록으로 옮기기

- 원고에서 사진이나 인용구가 들어갈 위치를 먼저 파악하고 해당 순서에 맞게 블록을 넣는다.
- 정렬이나 굵기가 바뀌는 문단부터 새 `text` 블록을 만든다. 서식이 같은 여러 문단은 한 블록에서 줄바꿈으로 이어 쓸 수 있다.
- 사진 번호는 사진만 세고 문단과 인용구는 건너뛴다. 파일명으로 대표사진을 지정했다면 최종 본문 순서에서 그 사진의 번호를 계산한다.
- 도구 입력 스키마에 있는 필드만 전달한다. HTML·마크다운 서식 기호는 `text`에서 문자 그대로 다뤄진다.

## MCP에서 입력할 수 있는 항목

| 항목 | 입력 예시 | 적용 범위 |
| --- | --- | --- |
| 문단 | `{"type":"text","text":"캐스퍼 입고 안내\n차량 사진을 확인해 주세요."}` | 줄바꿈마다 새 문단을 만든다. |
| 정렬 | `{"type":"text","text":"캐스퍼 입고","align":"center"}` | `left`는 왼쪽, `center`는 가운데, `right`는 오른쪽. 같은 블록의 모든 문단에 적용된다. |
| 굵게 | `{"type":"text","text":"캐스퍼 입고","bold":true}` | 문단 블록의 글자 전체에 적용된다. 특정 단어만 굵게 하려면 카페 에디터에서 해당 단어를 선택한다. |
| 사진 | `{"type":"image","file":"casper-front.jpg"}` | 사진 한 장당 블록 하나를 넣는다. `file`은 사진 폴더 안의 파일 이름이다. |
| 대표사진 | `"representativeImage": 2` | `blocks`와 같은 수준의 옵션이다. 기존 사진까지 포함해 본문의 두 번째 사진을 선택한다. |
| 인용구 | `{"type":"quote","text":"신규 입고 차량","style":3}` | 1 기본, 2 세로선, 3 말풍선, 4 밑줄, 5 포스트잇, 6 모서리. 생략하면 2번이다. |

사진은 플러그인의 기본 사진 폴더 `%LOCALAPPDATA%\Jetcar\NaverCafeMcp\photos` 또는 설정된 `NAVER_IMAGE_DIR`에서 읽는다. JPG, JPEG, PNG, GIF를 지원한다. 한 번에 사진 20장, 한 장당 5 MiB, 합계 25 MiB까지 첨부할 수 있다.

### 새 임시글

아래 값은 형식 예시다. 실제 요청에 맞는 게시판 링크와 사진 파일 이름으로 바꾼다.

```json
{
  "boardUrl": "https://cafe.naver.com/f-e/cafes/12345/menus/10",
  "title": "캐스퍼 입고 안내",
  "blocks": [
    {"type": "text", "text": "캐스퍼 입고", "align": "center", "bold": true},
    {"type": "quote", "text": "신규 입고 차량", "style": 3},
    {"type": "image", "file": "casper-front.jpg"},
    {"type": "image", "file": "casper-interior.jpg"},
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
| 표 | 도구 막대에서 **표**를 선택하고 각 셀에 입력한다. 표 가장자리에서 행·열을 추가하고 셀을 선택해 병합이나 색을 설정한다. [표 도움말](https://help.naver.com/service/5622/contents/15278?osType=PC) |
| 스티커 | **스티커**를 누르고 목록에서 원하는 스티커를 고른다. [스티커 도움말](https://help.naver.com/service/5622/contents/15332?osType=PC) |
| 동영상 | **동영상**에서 파일을 업로드한다. 외부 영상은 본문에 URL을 붙여넣어 첨부할 수 있다. [동영상 도움말](https://help.naver.com/service/5622/contents/15317?osType=PC) |
| 구분선 | **구분선**을 넣고 삽입한 선을 선택해 디자인과 정렬을 바꾼다. [구분선 도움말](https://help.naver.com/service/5622/contents/15315?osType=PC) |
| 장소 | **장소**에서 상호나 지명을 검색해 지도에 추가한다. [장소 도움말](https://help.naver.com/service/5622/contents/15302?osType=PC) |
| 링크 | **링크**에서 URL을 입력하고 미리보기를 확인한 뒤 삽입한다. MCP의 `text`로 URL을 적으면 문자열만 전달된다. [링크 도움말](https://help.naver.com/service/5622/contents/15300?osType=PC) |
| 글꼴·글자 크기·색·배경색·취소선·기울임·밑줄·일부 글자만 굵게 | 바꿀 글자를 선택하고 속성 도구 막대에서 서식을 지정한다. [에디터 기본 인터페이스](https://help.naver.com/service/5622/contents/12223?osType=PC) |
| 사진 크기·정렬·캡션·링크 | 삽입된 사진을 선택하고 속성 도구 막대에서 바꾼다. 캡션은 사진 아래 설명란에 입력한다. [사진 속성 도움말](https://help.naver.com/service/5622/contents/15338?osType=PC) |

스마트에디터 ONE의 파일, 일정, 투표, 글감, 소스코드, 수식도 에디터에서 직접 첨부한다. [네이버 카페 스마트에디터 ONE 도움말](https://help.naver.com/service/5622/category/3171?lang=ko)
