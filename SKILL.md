---
name: web-to-figma
description: 웹페이지(로그인이 필요한 페이지 포함)를 1440px 데스크톱 화면으로 읽어 HTML/CSS 요소를 Figma 프레임으로 옮긴다 — Auto Layout, 색상 Variables, 텍스트 스타일까지. "이 페이지 피그마로 그려줘", "웹 화면을 Figma로 옮겨줘", "사이트를 피그마 디자인으로", "현재 브라우저 화면 Figma에", "web to figma", "capture page into Figma" 같은 요청에 사용한다. "web-to-figma 업데이트해줘", "web-to-figma 버전 확인" 같은 스킬 업데이트·버전 요청에도 사용한다.
metadata:
  version: "0.4.0"
---

# web-to-figma

> **업데이트·버전 요청이면** 아래 워크플로를 실행하지 말고 맨 아래 [업데이트](#업데이트) 절만 따른다.

웹페이지의 **HTML/CSS 박스만** Figma로 옮긴다: 배경, 그라디언트, 테두리, 그림자, 모서리, 텍스트, Auto Layout, 색상 Variables, 텍스트 스타일.
옮기지 않는 것: `<img>`, `<svg>`, `<video>`, `<canvas>`, `background-image: url()`. 폰트는 Figma 기본 폰트(Inter)를 쓰고 굵기만 맞춘다.

`<skill>`은 이 SKILL.md가 있는 폴더다. 사용자별 데이터는 `~/.web-to-figma/`에 저장되고 스킬 폴더에는 쓰지 않는다.

**질문하는 법:** 이 문서에서 "묻는다"는 선택지 질문 도구를 쓴다는 뜻이다. Claude Code는 `AskUserQuestion`, Codex는 `request_user_input`(Plan 모드에서만 동작)을 쓴다. 이런 도구가 없거나 동작하지 않으면 **선택지를 번호로 적은 일반 메시지로 묻고, 답을 받을 때까지 그 턴을 끝낸다.** 답을 못 받았는데 기본값을 골라 진행하면 안 된다. 특히 설치 여부는 반드시 답을 받는다.

**컨텍스트 원칙:** 추출 JSON(`page.json`)이나 carrier SVG 내용을 읽거나 출력하지 않는다. 스크립트가 출력하는 한 줄 요약만 사용한다.

## 0. 사전 점검

```bash
node <skill>/scripts/preflight.js
```

빠진 것이 있으면 설치해 줄지 **묻는다**. 선택지는 「설치해 주세요」와 「직접 설치할게요」. 직접 설치를 고르면 명령어만 알려주고 멈춘다.

**agent-browser**: `agentBrowser.installed: false`이면 설치할지 묻는다. 설치를 고르면 아래를 실행하고 `preflight.js`를 다시 돌린다.
```bash
npm i -g agent-browser && agent-browser install    # CLI + 전용 Chromium
```
설치는 돼 있는데 2단계 `open`이 브라우저 실행 오류로 실패하면, Chromium이 빠진 것이다. `agent-browser install`만 실행할지 묻는다.

**Node.js**: `node.ok: false`이면 자동으로 설치하지 않는다. 18 이상으로 설치하라고 안내하고 멈춘다.

**Figma MCP**: `use_figma`와 `upload_assets` 도구가 있는지 확인한다. 지연 로드 도구라면 ToolSearch로 불러온다.
- **도구가 없으면** 연결할지 묻는다. 연결을 고르면:
  - Claude Code: `claude mcp add --transport http -s user figma https://mcp.figma.com/mcp`를 실행한다. 그리고 "`/mcp`에서 figma를 인증하거나 세션을 다시 시작한 뒤, 같은 요청을 다시 해 주세요"라고 안내하고 멈춘다. 새 MCP 도구는 지금 세션에 바로 나타나지 않는다.
  - 그 밖의 에이전트: 그 에이전트의 MCP 설정에 `https://mcp.figma.com/mcp`(HTTP)를 추가하라고 안내한다.
- **도구는 있지만 인증 전이면**(도구 대신 `authenticate`만 있거나, `whoami`가 실패하면): `authenticate`를 호출해서 받은 인증 링크를 사용자에게 **최종 답변으로** 전달하고 기다린다. 작업 중간에 쓴 메시지는 사용자에게 보이지 않을 수 있다.
- **도구가 있으면** `whoami`로 인증을 확인하고, `plans`의 `tier`와 `seat`를 보고 아래처럼 안내한다(막지는 않는다):
  - **plan이 없으면**: 새 파일을 만들 수 없다. "Figma 팀에 속해 있지 않습니다. 작업 중인 파일 URL을 주시거나 Figma에서 팀을 만들어 주세요"라고 안내한다.
  - **Starter 플랜이거나 View/Collab 좌석뿐이면**: "Figma MCP 사용량이 월 20회로 제한된 계정입니다. 그리기에 쓰는 호출(`upload_assets`, `use_figma`)이 제한에 포함되는지는 Figma 문서에 명시돼 있지 않습니다. 결과 확인용 스크린샷(`get_screenshot`)은 제한에 포함됩니다"라고 한 줄로 알린다.
  - **실행 중에 사용량 제한 오류가 나면**: 상향 방법을 안내한다. Starter → Professional 이상 + Full/Dev 좌석, View/Collab → Full/Dev 좌석.
  - 참고: [Figma MCP 사용량 제한](https://developers.figma.com/docs/figma-mcp-server/rate-limits-access/)

## 1. 입력 받기

```bash
node <skill>/scripts/state.js history
```

`last`가 있으면 재사용 여부를 묻는다.
- 「지난 입력 재사용」: 설명에 `last.url`과 `last.figma`를 그대로 보여준다.
- 「새로 입력」

새로 입력할 때 필요한 것은 아래 두 가지다. 사용자가 이미 말한 항목은 다시 묻지 않는다.

1. **URL**: 또는 "web-to-figma 브라우저 창에 지금 열려 있는 화면 그대로". 이 경우 2단계 `open`을 건너뛴다.

2. **어느 Figma 파일에 그릴지** 묻는다:
   - 「새 파일 만들기」
   - 「작업 중인 파일에 그리기」 → 파일 URL을 받는다(`figma.com/design/<fileKey>/...`).
   - `history.recent`에 Figma 파일이 있으면 「지난번 파일: <URL>」도 선택지에 넣는다(최대 2개).

   **새 파일**: `figma-create-new-file` 스킬을 로드한다. `whoami`의 plan이 하나면 그것을 쓰고, 여러 개면 어느 팀/조직에 만들지 묻는다. 파일 이름은 `web-to-figma · <host>`로 `create_new_file`을 호출한다.

   **작업 중인 파일**: URL에서 `fileKey`를 뽑는다. `/design/` URL만 된다. `/board/`, `/slides/`, `/make/`이면 다시 받는다. 아래 코드로 `use_figma`를 호출해서 편집할 수 있는지 확인한다. 빈 프레임을 만들었다가 바로 지우므로 파일 내용은 그대로다. 읽기만 하는 호출은 보기 전용 파일에서도 성공하기 때문에 이렇게 확인한다.
   ```js
   const probe = figma.createFrame(); probe.remove();
   return { editor: figma.editorType, page: figma.currentPage.name };
   ```
   권한 오류가 나면(보기 전용 파일, View 좌석 등) 다른 파일을 받거나 새 파일을 만들지 묻는다. 결과는 **해당 파일의 현재 페이지에서 기존 내용 오른쪽**에 새 프레임으로 그려진다. 기존 레이어는 건드리지 않는다.

## 2. 페이지 열기

브라우저는 **agent-browser만** 쓴다(자체 Chromium, 뷰포트 1440×900 고정). Orca나 인앱 브라우저는 폭을 맞출 수 없어서 쓰지 않는다.

```bash
node <skill>/scripts/capture.js open --url <url> [--login] [--width 1440 --height 900]
```

- 먼저 화면 없이(headless) 연다. **로그인 화면이 감지되면**(비밀번호 입력칸이 보이거나 `/login` 같은 경로) 자동으로 **별도 Chromium 창**으로 다시 연다.
- 로그인 상태는 `~/.web-to-figma/browser-profile`에 남아서, 다음부터는 로그인 없이 바로 열린다.
- 결과가 `waitForUser: true`이면 이렇게 말하고 기다린다: "열린 Chromium 창에서 로그인하고 원하는 화면을 맞춘 다음 알려주세요. 계정 정보는 채팅에 보내지 말고 창에 직접 입력해 주세요."
- 로그인은 필요 없지만 특정 화면 상태(탭, 필터, 모달)를 직접 맞춰야 하면 `--login`으로 창을 띄운다.

## 3. 추출

```bash
node <skill>/scripts/capture.js extract [--viewport-only]
```

출력 예시: `{"ok":true,"file":"~/.web-to-figma/pages/<host>/<ts>.json","nodes":317,"page":{"w":1440,"h":4210},"expanded":{...}}`. 이후 단계에서는 이 `file` 경로를 쓴다.
- 기본값은 **페이지 전체**를 옮기는 것이다. 문서와 안쪽 스크롤 영역(앱처럼 화면 높이가 고정되고 안쪽만 스크롤되는 레이아웃)을 끝까지 스크롤해서 지연 로딩 콘텐츠를 불러온다. 그런 다음 높이 제한을 풀어 한 장의 긴 페이지로 펼친 상태에서 추출하고, 끝나면 페이지를 원래대로 되돌린다.
- `expanded.heightAfter`가 펼친 뒤의 높이다. 무한 스크롤은 영역마다 30000px에서 멈춘다.
- 사용자가 "지금 보이는 화면만"을 원하거나, 모달처럼 스크롤하면 바뀌는 화면 상태를 유지해야 하면 `--viewport-only`를 쓴다.
- 결과의 `url`이 요청한 URL과 다르면(예: 로그인 후 다른 화면으로 이동함), 그리기 전에 사용자에게 알린다. 그리고 `open --url <원래 URL>`로 다시 연 뒤 추출한다. 저장된 로그인 덕분에 이번에는 창 없이 열린다.
- `ok:false`면 `error`를 사용자에게 보여준다. 예: 브라우저가 열려 있지 않음 → 2단계로 돌아간다.

## 4. Figma에 그리기 (Figma MCP 업로드 방식, 기본)

`use_figma`를 호출하기 전에 `figma-use` 스킬을 로드한다(환경 요구사항). 그리고 `skillNames: "figma-use"`를 함께 보낸다.

1. `upload_assets({ fileKey, count: 1 })`를 호출해서 `submitUrl`을 받는다.
2. 그리는 코드와 데이터를 SVG에 담아 업로드한다:
   ```bash
   node <skill>/scripts/carrier.js <file> --post '<submitUrl>'
   ```
3. `<skill>/figma/bootstrap.js`를 Read해서 **내용을 그대로** `use_figma`의 `code`로 보낸다. 수정하지 않는다.
   결과 예시: `{ rootId, nodes, ms }`

부트스트랩은 업로드된 carrier 레이어를 찾아 디코딩하고, 레이어를 지운 뒤 페이지를 한 번에 그린다. 같은 페이지·같은 추출 결과를 다시 그리면 이전 프레임을 교체한다.

### 실패했을 때

- **`carrier.js`가 실패하면**(payload/source 검증 오류): 스크립트 버그다. fallback으로 넘어가지 말고 오류를 그대로 사용자에게 보여준다. `carrier.js`는 업로드 전에 데이터와 코드를 검증하므로, 업로드에 성공했다면 데이터는 온전하다.
- **업로드는 됐는데 부트스트랩이 실패하면**(`new Function`/`eval` 차단, carrier를 찾지 못함 등): 원인을 추측하지 말고 오류 메시지를 그대로 사용자에게 보여준다. 그다음 use_figma에 직접 입력하는 방식으로 넘어간다. 느리다(수 분). 시작하기 전에 사용자에게 알린다.
  ```bash
  node <skill>/scripts/build.js <file> --scripts ~/.web-to-figma/figma-scripts
  ```
  생성된 `00-setup.js`, `01-*.js` …를 **순서대로** 각각 Read해서 그대로 `use_figma`의 `code`로 보낸다. 실패하면 같은 파일을 다시 실행해도 안전하다(멱등).
- **Figma 권한 오류**(View 좌석 등): 사용자가 편집할 수 있는 파일인지 확인한다.

## 5. 마무리

```bash
node <skill>/scripts/state.js remember --url <url> --figma <figmaFileUrl> [--login]
```

결과 링크 `https://www.figma.com/design/<fileKey>?node-id=<rootId의 ':'를 '-'로>`와 노드 수를 알려준다.
**스크린샷 비교 같은 결과 확인은 하지 않는다.** 사용자가 요청할 때만 `get_screenshot`으로 확인한다.

## 참고

- 데이터 구조: [`schema.md`](schema.md)
- 지원하지 않는 브라우저: Orca, Claude 데스크톱 내장 브라우저, Codex 인앱 브라우저. 폭을 1440으로 맞출 수 없거나, 결과가 에이전트 컨텍스트를 거쳐야 한다.

## 업데이트

사용자가 "web-to-figma 업데이트해줘" 또는 "버전 확인"을 요청한 경우만 해당한다.

1. 현재 버전: 이 파일 frontmatter의 `metadata.version`.
2. 업데이트(`npx skills add`로 설치한 경우):
   ```bash
   npx -y skills update web-to-figma -g -y
   ```
   git clone이나 심볼릭 링크로 설치했다면 `git -C <skill> pull`을 쓴다.
3. `<skill>/SKILL.md`를 다시 읽어 새 버전 번호를 확인하고, `<skill>/CHANGELOG.md`에서 이전 버전 이후의 변경 사항을 요약해 알린다.
4. "새 버전은 **새 세션**에서 적용됩니다. 지금 세션은 이전 SKILL.md를 기억하고 있습니다"라고 안내한다.
