# web-to-figma

웹페이지(로그인이 필요한 페이지 포함)의 HTML/CSS 요소를 Figma 프레임으로 옮기는 에이전트 스킬입니다.
Auto Layout, 색상 Variables, 텍스트 스타일까지 만들어 줍니다. 이미지와 SVG는 옮기지 않습니다.

```
agent-browser(1440px) ─ extract.js ─> page.json (~/.web-to-figma)
   ─ carrier.js ─> Figma MCP upload_assets ─> use_figma(bootstrap) ─> Figma 프레임
```

317개 노드 페이지 기준으로 추출에 약 2초, Figma 그리기에 약 20초가 걸립니다.

## 설치

```bash
git clone <repo> ~/.claude/skills/web-to-figma      # Claude Code
# Codex: ~/.codex/skills/web-to-figma
```

필요한 것:

| | |
|---|---|
| Node.js 18+ | 스크립트 실행 |
| agent-browser | `npm i -g agent-browser && agent-browser install` |
| Figma MCP | 에이전트에 Figma MCP 서버를 연결하고 **각자 자기 계정으로** 인증 |

agent-browser와 Figma MCP가 없으면 스킬이 처음 실행될 때 **설치해 드릴지 묻습니다.** 직접 확인하려면:

```bash
node ~/.claude/skills/web-to-figma/scripts/preflight.js
```

## 사용

에이전트에게 이렇게 요청하면 됩니다: "https://example.com 피그마로 그려줘", "지금 브라우저 화면 Figma에 옮겨줘".

- 처음 실행하면 URL과 Figma 파일(기존 URL 또는 새 파일)을 묻습니다. 다음부터는 지난 입력을 재사용할지 묻습니다.
- 로그인 화면이 감지되면 별도 Chromium 창이 뜹니다. 그 창에서 직접 로그인하고 원하는 화면을 맞춘 뒤 "준비됐어"라고 말하면 됩니다. 로그인 상태는 다음에도 유지됩니다.

## 사용자별 데이터

스킬 폴더에는 아무것도 쓰지 않습니다. 모든 데이터는 각자의 `~/.web-to-figma/`에 저장됩니다(`W2F_HOME` 환경변수로 위치를 바꿀 수 있습니다).

| 경로 | 내용 |
|---|---|
| `history.json` | 최근 입력 (재사용 여부를 물을 때 사용) |
| `pages/<host>/*.json` | 추출 결과, 사이트별 최근 5개만 보관 |
| `browser-profile/` | agent-browser 로그인 상태 — **공유하지 마세요** |

## 구조

```
SKILL.md                 에이전트 워크플로
schema.md                page.json 형식
scripts/
  preflight.js           설치 점검
  state.js               ~/.web-to-figma 기록·보관
  capture.js             agent-browser 제어 (open / extract, 로그인 감지)
  expand.js              페이지 안에서 실행: 스크롤 영역을 끝까지 불러오고 한 페이지로 펼침
  extract.js             페이지 안에서 실행: DOM → Figma 구조 JSON
  figma-runtime.js       Figma 렌더러 (모든 그리기 경로가 공유)
  carrier.js             렌더러+데이터를 SVG로 묶어 Figma MCP로 업로드
  build.js               --payload 전체 데이터 / --scripts use_figma 스크립트 (fallback)
figma/bootstrap.js       use_figma로 보내는 고정 부트스트랩
```

## 제한

- 기본값은 **페이지 전체**입니다. 문서와 안쪽 스크롤 영역을 끝까지 스크롤해서 지연 로딩 콘텐츠까지 불러온 뒤, 한 장의 긴 페이지로 펼쳐서 옮깁니다. 무한 스크롤은 영역마다 30000px에서 멈춥니다. 화면에 보이는 항목만 렌더링하는 가상화 목록(virtualized list)은 펼쳐도 일부만 남을 수 있습니다.
- 이미지, SVG 아이콘, 비디오, 캔버스는 옮기지 않습니다. 아이콘이 있던 자리에는 배경 박스만 남습니다.
- 폰트는 Inter로 통일됩니다. 원래 폰트와 글자 폭이 달라서, 줄바꿈 위치가 원본과 다를 수 있습니다.
- 브라우저는 agent-browser만 지원합니다. Orca, Claude 데스크톱 내장 브라우저, Codex 인앱 브라우저는 1440px 폭을 맞출 수 없거나 비효율적이라 지원하지 않습니다.
- 기본 그리기 방식은 Figma MCP의 문서화되지 않은 동작 두 가지에 의존합니다: SVG `id`가 레이어 이름으로 보존되는 것, `use_figma`에서 `new Function`을 쓸 수 있는 것. 이게 막히면 use_figma에 데이터를 직접 넣는 느린 방식(수 분)으로 넘어갑니다.
