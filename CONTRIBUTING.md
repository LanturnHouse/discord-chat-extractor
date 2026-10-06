# 기여 가이드

[Discord Chat Extractor](README.md)에 관심을 가져 주셔서 고맙습니다. 버그 신고, 문서 수정, 코드 기여 모두 환영합니다.
English version: [Contributing guide](#contributing-guide).

- [먼저 알아 둘 것](#먼저-알아-둘-것)
- [개발 환경](#개발-환경)
- [품질 기준](#품질-기준)
- [코드 규칙](#코드-규칙)
- [자주 하는 작업](#자주-하는-작업)
- [커밋과 풀 리퀘스트](#커밋과-풀-리퀘스트)
- [보안 문제](#보안-문제) · [행동 강령](#행동-강령) · [라이선스](#라이선스)

## 먼저 알아 둘 것

> [!WARNING]
> 이 도구는 개인 대화 기록을 다룹니다. **토큰, 실제 대화 내용, 실제 서버·채널·DM이 보이는 스크린샷, 내보낸 파일**은 커밋, 이슈, PR, 로그 어디에도 올리지 마세요. 테스트와 문서 이미지는 가상 데이터(데모 모드)만 사용합니다.

- **읽기 전용 내보내기 도구입니다.** 메시지 입력창, 검색, 프로필 같은 기능은 의도적으로 뺐습니다. 무엇을 지원하고 무엇을 제외했는지는 [docs/DECISIONS.md](docs/DECISIONS.md)에 있습니다.
- **네트워크는 Discord로만 나갑니다.** 확장 프로그램 CSP가 `connect-src 'self' https://discord.com` 으로 막고 있고 `npm run verify` 가 이를 검사합니다. 새 권한, 새 호스트, 원격 코드, 분석 도구는 먼저 이슈로 논의해 주세요.
- **런타임 의존성은 4개뿐입니다.** 확장 프로그램 번들과 공급망 위험을 작게 유지하려고 강한 이유 없이는 추가하지 않습니다.
- 큰 변경(새 기능, 구조 변경, 새 언어)은 코드를 쓰기 전에 이슈를 먼저 열어 방향을 맞춰 주세요.
- 이슈를 올릴 때는 템플릿을 사용하고, 비밀번호·토큰이 섞이지 않았는지 한 번 더 확인해 주세요.

## 개발 환경

필요: Node.js 22.12 이상, Chrome 116 이상.

```bash
git clone https://github.com/LanturnHouse/discord-chat-extractor.git
cd discord-chat-extractor
npm ci
npm run dev        # http://localhost:5173/app.html?mock=1
```

`?mock=1` 은 데모 모드입니다. 가상의 서버·채널·DM·메시지로 Discord 계정 없이 화면 전체와 내보내기를 쓸 수 있습니다. 개발 중 대부분의 작업은 이 모드로 충분합니다.

실제 확장 프로그램으로 확인하려면 `npm run build` 후 `chrome://extensions` 에서 **개발자 모드**를 켜고 **압축해제된 확장 프로그램을 로드합니다** 로 `dist` 폴더를 선택합니다.

## 품질 기준

PR을 올리기 전에 아래 네 가지가 모두 통과해야 합니다. CI가 Ubuntu와 Windows에서 같은 명령을 실행합니다.

| 명령 | 확인하는 것 |
| --- | --- |
| `npm run typecheck` | `tsc --noEmit` (strict) |
| `npm test` | Vitest 단위·컴포넌트 테스트 |
| `npm run build` | 타입체크 + `dist/` 생성 |
| `npm run verify` | `dist/` 가 확장 프로그램으로 로드 가능한지 정적 검사(매니페스트 참조, CSP, 원격 리소스·`eval` 없음) |

`npm run e2e` 는 빌드한 확장 프로그램을 실제 Chrome에 올려 가짜 Discord 서버로 검증합니다. Chrome이 필요해서 CI에서는 돌지 않습니다. 토큰 캡처, 매니페스트, CSP, 서비스 워커를 건드렸다면 직접 실행해 주세요([e2e/README.md](e2e/README.md)).

## 코드 규칙

먼저 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)를 읽어 주세요. 모듈 지도, 데이터 흐름, 보안 규칙이 정리되어 있습니다.

- **TypeScript strict.** `any` 는 쓰지 않고, 불가피하면 이유를 주석으로 남깁니다. 죽은 코드와 `TODO` 자리표시자는 남기지 않습니다. 주석은 *왜*가 분명하지 않을 때만 답니다.
- **동작을 바꾸면 테스트를 함께.** `tests/` 는 `src/` 구조를 그대로 따릅니다. DOM이 필요한 파일은 맨 위에 `// @vitest-environment jsdom` 을 둡니다.
- **테스트는 가짜 데이터와 모킹된 네트워크만 씁니다.** 테스트가 Discord에 접속해서는 안 됩니다. 픽스처는 `src/lib/discord/mock/` 를 쓰거나 인라인으로 만듭니다.
- **메시지·사용자 이름·임베드·파일명·채널명은 모두 공격자가 조작할 수 있는 입력입니다.**
  - React에서 `dangerouslySetInnerHTML` 금지. HTML 내보내기는 전부 이스케이프하고 `href`/`src` 는 `http:`, `https:`, `mailto:` 만 허용합니다.
  - CSV/XLSX 셀의 수식 주입을 막고, 파일·ZIP 항목 이름의 경로 구분자·예약어·`..` 를 정리합니다.
  - 토큰은 플랫폼의 `getToken()` 만 다룹니다. 로그, URL, `localStorage`, `chrome.storage.local`, 내보낸 파일에 쓰지 않습니다.
  - Discord 공식 클라이언트를 흉내 내지 않습니다(가짜 `X-Super-Properties`, User-Agent 등). 요청은 순차로, `Retry-After`/`X-RateLimit-*` 를 지켜서 보냅니다.
- **접근성 기본.** 실제 `<button>` 을 쓰고, 아이콘 버튼에는 `aria-label`, 키보드 포커스와 눈에 보이는 포커스 링을 유지합니다.
- **스타일은 일반 CSS + 커스텀 프로퍼티**(`src/app/styles/theme.css`). CSS-in-JS는 쓰지 않습니다. Discord 로고와 에셋은 쓰지 않고 직접 그린 SVG를 씁니다.
- UI 코드는 상태를 `@/app/state` 에서만 가져옵니다. `@/` 는 `src/` 의 별칭입니다.
- 린터·포매터 설정은 따로 없습니다. [.editorconfig](.editorconfig)(UTF-8, LF, 2칸 들여쓰기)와 주변 코드의 스타일을 따라 주세요.

## 자주 하는 작업

### 화면 문자열 추가·수정

모든 화면 문자열은 `defineStrings({ ko, en })` 로 선언하고 `useStrings(table)` 로 읽습니다. **`ko` 와 `en` 의 키가 같아야 하고**, 어긋나면 타입 오류가 납니다([src/app/i18n/core.ts](src/app/i18n/core.ts)).

- 영역별 문자열은 컴포넌트 옆의 파일에 있습니다. 예: [topbar/strings.ts](src/app/components/topbar/strings.ts), [sidebar/strings.ts](src/app/components/sidebar/strings.ts), [rail/strings.ts](src/app/components/rail/strings.ts), [chat/chatStrings.ts](src/app/components/chat/chatStrings.ts), [state/strings.ts](src/app/state/strings.ts).
- 여러 영역이 같이 쓰는 문자열은 [src/app/i18n/common.ts](src/app/i18n/common.ts)에 둡니다.
- 개수나 이름이 들어가는 문장은 함수로 만듭니다. `ko` 쪽 매개변수에 타입을 적으면 `en` 은 추론됩니다.
- **내보낸 파일 안의 고정 문구**(머리말, 시스템 메시지 문구 등)와 내보내기 중 오류 문구는 이 표들이 아니라 [formats/text.ts](src/lib/export/formats/text.ts)(`getExportStrings`), [message/labels.ts](src/app/components/message/labels.ts), [runner.ts](src/lib/export/runner.ts)에 있습니다.

### 내보내기 형식 추가

1. [src/lib/export/types.ts](src/lib/export/types.ts)의 `EXPORT_FORMAT_IDS` 에 id를 추가합니다.
2. `src/lib/export/formats/<id>.ts` 를 만들고 `<id>Format: ExportFormat` 을 내보냅니다. 메시지는 오래된 것부터 배치로 들어옵니다. 작은 예시는 [json.ts](src/lib/export/formats/json.ts)입니다.
3. [formats/index.ts](src/lib/export/formats/index.ts)의 `loaders` 에 등록합니다. 빠뜨리면 타입 오류가 납니다.
4. 화면에 노출합니다: [topbar/formats.ts](src/app/components/topbar/formats.ts)의 `FORMAT_NAMES`·`FORMAT_CHIPS`, [ExportOptionsPopover.tsx](src/app/components/topbar/ExportOptionsPopover.tsx)의 `DESCRIPTION_KEYS`, 그리고 [topbar/strings.ts](src/app/components/topbar/strings.ts)의 설명 문구(ko/en).
5. 테스트: `tests/lib/export/formats/<id>.test.ts` 를 추가하고 [index.test.ts](tests/lib/export/formats/index.test.ts)의 `EXPECTED` 표에 한 줄 넣습니다.
6. 보안 규칙(이스케이프, 수식 주입, 파일명)을 지켰는지 확인하고 README와 사용 가이드의 형식 목록을 고칩니다.

### 언어 추가

지금은 한국어(`ko`)와 영어(`en`) 두 가지이고, 이 둘이 코드 여러 곳에 고정되어 있습니다. 언어 추가는 여러 파일을 건드리는 변경이니 **먼저 이슈로 의논해 주세요.** 대략 다음이 해당합니다.

- `Locale`, `LOCALES`, `StringTable`, `resolveLocale` ([i18n/core.ts](src/app/i18n/core.ts))와 `defineStrings` 를 쓰는 모든 문자열 표
- 설정 저장과 검증: [platform/types.ts](src/app/platform/types.ts)의 `Prefs.locale`, [platform/chrome.ts](src/app/platform/chrome.ts)의 `normalizePrefs`, 언어 선택 UI([ExportOptionsPopover.tsx](src/app/components/topbar/ExportOptionsPopover.tsx))
- 내보내기 쪽: `ExportOptions.locale`([export/types.ts](src/lib/export/types.ts)), [formats/text.ts](src/lib/export/formats/text.ts), [formats/htmlMessage.ts](src/lib/export/formats/htmlMessage.ts), [runner.ts](src/lib/export/runner.ts), [markdown/renderText.ts](src/lib/markdown/renderText.ts)
- 메시지 표시: [message/labels.ts](src/app/components/message/labels.ts), [message/format.ts](src/app/components/message/format.ts)
- 테스트와 문서

`grep -rn "'ko'" src` 와 `npm run typecheck` 가 남은 곳을 찾는 데 도움이 됩니다.

### 의존성 변경

런타임 의존성을 추가하거나 올리면 `npm run licenses` 로 [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md)를 다시 만들어 함께 커밋합니다. CI가 `npm run licenses -- --check` 로 최신 상태인지와 허용된 라이선스인지 확인합니다.

## 커밋과 풀 리퀘스트

- PR 하나에는 한 가지 목적만 담고, 작게 나눠 주세요.
- 커밋 첫 줄은 무엇을 했는지 짧은 명령형으로 씁니다(한국어/영어 모두 괜찮습니다). 이유가 필요하면 본문에 적습니다. 접두어 규칙은 강제하지 않습니다.
- PR 템플릿의 체크리스트를 채워 주세요. 화면을 바꿨다면 데모 모드 스크린샷을 첨부합니다(가상 데이터만).
- 동작이 바뀌면 README와 `docs/USAGE*.md` 도 고칩니다.
- **판단과 제외를 기록합니다.** 제품·기술상의 판단(무엇을 하고 무엇을 하지 않기로 했는지)은 [docs/DECISIONS.md](docs/DECISIONS.md)에 번호 항목으로 추가합니다. 구조와 규칙이 바뀌면 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)를 고칩니다. 아키텍처의 "Core contracts" 에 있는 시그니처를 바꿀 때는 모든 사용처와 테스트를 함께 고칩니다.
- 버전 번호와 릴리스는 메인테이너가 맡습니다. `package.json` 과 `public/manifest.json` 의 `version` 이 같아야 하고(`npm run verify` 가 검사), `vX.Y.Z` 태그를 푸시하면 GitHub Actions가 릴리스를 만듭니다. 기여자는 버전을 올리지 않아도 됩니다.

## 보안 문제

취약점은 공개 이슈에 쓰지 말고 [SECURITY.md](SECURITY.md)의 안내에 따라 비공개 보안 권고로 알려 주세요.

## 행동 강령

모든 참여자는 [행동 강령](CODE_OF_CONDUCT.md)을 지켜 주세요.

## 라이선스

이 프로젝트는 [MIT 라이선스](LICENSE)입니다. PR을 보내면 그 기여를 같은 MIT 조건으로 제공하는 데 동의한 것으로 봅니다(들어오는 라이선스 = 나가는 라이선스). 직접 쓰지 않은 코드나 자료를 가져올 때는 라이선스가 MIT와 호환되는지 확인하고 출처를 밝혀 주세요.

---

# Contributing guide

Thanks for your interest in [Discord Chat Extractor](README.en.md). Bug reports, documentation fixes and code are all welcome.
한국어 버전: [기여 가이드](#기여-가이드).

- [Before you start](#before-you-start)
- [Development setup](#development-setup)
- [Quality gates](#quality-gates)
- [Code conventions](#code-conventions)
- [Common tasks](#common-tasks)
- [Commits and pull requests](#commits-and-pull-requests)
- [Security issues](#security-issues) · [Code of conduct](#code-of-conduct) · [License](#license-of-contributions)

## Before you start

> [!WARNING]
> This tool handles private conversations. Never put **tokens, real message content, screenshots of real servers, channels or DMs, or exported files** into a commit, issue, pull request or log. Tests and documentation images use fake data only (demo mode).

- **It is a read-only export tool.** A message composer, search, profiles and similar features are left out on purpose. [docs/DECISIONS.md](docs/DECISIONS.md) (Korean) lists what is supported and what is not.
- **The network only goes to Discord.** The extension-page CSP (`connect-src 'self' https://discord.com`) enforces it and `npm run verify` checks it. Please discuss new permissions, hosts, remote code or analytics in an issue first.
- **There are only 4 runtime dependencies.** To keep the bundle and the supply-chain surface small, none are added without a strong reason.
- For big changes (a new feature, a restructuring, a new language), open an issue before writing code so we can agree on the direction.
- Use the issue templates, and double-check that no password or token slipped in.

## Development setup

You need Node.js 22.12 or newer and Chrome 116 or newer.

```bash
git clone https://github.com/LanturnHouse/discord-chat-extractor.git
cd discord-chat-extractor
npm ci
npm run dev        # http://localhost:5173/app.html?mock=1
```

`?mock=1` is demo mode: fake servers, channels, DMs and messages, so you can use every screen and every export without a Discord account. It is enough for most work.

To try the real extension, run `npm run build`, open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked** and pick the `dist` folder.

## Quality gates

All four must pass before you open a pull request. CI runs the same commands on Ubuntu and Windows.

| Command | What it checks |
| --- | --- |
| `npm run typecheck` | `tsc --noEmit` (strict) |
| `npm test` | Vitest unit and component tests |
| `npm run build` | typecheck + builds `dist/` |
| `npm run verify` | static checks that `dist/` loads as an extension (manifest references, CSP, no remote resources, no `eval`) |

`npm run e2e` loads the built extension into a real Chrome and runs it against a fake local Discord server. It needs Chrome, so CI does not run it. Please run it yourself if you touched token capture, the manifest, the CSP or the service worker (see [e2e/README.md](e2e/README.md)).

## Code conventions

Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) first: it has the module map, the data flow and the security rules.

- **Strict TypeScript.** No `any`; if it is unavoidable, say why in a comment. No dead code, no `TODO` placeholders. Comment only when the *why* is not obvious.
- **Every changed behaviour gets a test.** `tests/` mirrors the structure of `src/`. A file that needs a DOM starts with `// @vitest-environment jsdom`.
- **Tests use fake data and a mocked network only.** A test must never contact Discord. Use the fixtures in `src/lib/discord/mock/` or build them inline.
- **Message text, usernames, embeds, file names and channel names are attacker-controlled input.**
  - No `dangerouslySetInnerHTML` in React. The HTML export escapes everything and allows only `http:`, `https:` and `mailto:` in `href`/`src`.
  - Neutralise formula injection in CSV/XLSX cells, and sanitise file and ZIP entry names (path separators, reserved names, `..`).
  - Only the platform's `getToken()` touches the token. It never goes to logs, URLs, `localStorage`, `chrome.storage.local` or exported files.
  - Do not imitate the official Discord client (no fake `X-Super-Properties`, User-Agent and so on). Send requests sequentially and honour `Retry-After` / `X-RateLimit-*`.
- **Accessibility basics.** Real `<button>` elements, an `aria-label` on icon buttons, keyboard focus and a visible focus ring.
- **Styles are plain CSS with custom properties** (`src/app/styles/theme.css`). No CSS-in-JS. Do not use Discord's logo or assets; draw your own SVG.
- UI code imports state only from `@/app/state`. `@/` is an alias for `src/`.
- There is no linter or formatter config. Follow [.editorconfig](.editorconfig) (UTF-8, LF, 2-space indent) and the style of the surrounding code.

## Common tasks

### Add or change a UI string

Every UI string is declared with `defineStrings({ ko, en })` and read with `useStrings(table)`. **`ko` and `en` must have the same keys**; a mismatch is a compile error ([src/app/i18n/core.ts](src/app/i18n/core.ts)).

- Strings of one area live in a file next to its components, for example [topbar/strings.ts](src/app/components/topbar/strings.ts), [sidebar/strings.ts](src/app/components/sidebar/strings.ts), [rail/strings.ts](src/app/components/rail/strings.ts), [chat/chatStrings.ts](src/app/components/chat/chatStrings.ts) or [state/strings.ts](src/app/state/strings.ts).
- Strings used by several areas go to [src/app/i18n/common.ts](src/app/i18n/common.ts).
- Sentences with a count or a name are functions. Annotate the parameter types in `ko`; `en` infers them.
- **Fixed text inside exported files** (headers, system-message wording) and the error texts shown during an export are not in these tables. They live in [formats/text.ts](src/lib/export/formats/text.ts) (`getExportStrings`), [message/labels.ts](src/app/components/message/labels.ts) and [runner.ts](src/lib/export/runner.ts).

### Add an export format

1. Add the id to `EXPORT_FORMAT_IDS` in [src/lib/export/types.ts](src/lib/export/types.ts).
2. Create `src/lib/export/formats/<id>.ts` exporting `<id>Format: ExportFormat`. Messages arrive oldest first, in batches. [json.ts](src/lib/export/formats/json.ts) is a small example.
3. Register it in `loaders` in [formats/index.ts](src/lib/export/formats/index.ts). Forgetting it is a type error.
4. Expose it in the UI: `FORMAT_NAMES` and `FORMAT_CHIPS` in [topbar/formats.ts](src/app/components/topbar/formats.ts), `DESCRIPTION_KEYS` in [ExportOptionsPopover.tsx](src/app/components/topbar/ExportOptionsPopover.tsx), and the description strings (ko/en) in [topbar/strings.ts](src/app/components/topbar/strings.ts).
5. Tests: add `tests/lib/export/formats/<id>.test.ts` and one line in the `EXPECTED` table of [index.test.ts](tests/lib/export/formats/index.test.ts).
6. Check the security rules (escaping, formula injection, file names) and update the format lists in the README and the usage guide.

### Add a language

There are two languages today, Korean (`ko`) and English (`en`), and both are hard-wired in many places. Adding one touches many files, so **please discuss it in an issue first.** Roughly:

- `Locale`, `LOCALES`, `StringTable` and `resolveLocale` ([i18n/core.ts](src/app/i18n/core.ts)) and every string table that uses `defineStrings`
- Stored preferences and the picker: `Prefs.locale` in [platform/types.ts](src/app/platform/types.ts), `normalizePrefs` in [platform/chrome.ts](src/app/platform/chrome.ts), the language options in [ExportOptionsPopover.tsx](src/app/components/topbar/ExportOptionsPopover.tsx)
- Exports: `ExportOptions.locale` ([export/types.ts](src/lib/export/types.ts)), [formats/text.ts](src/lib/export/formats/text.ts), [formats/htmlMessage.ts](src/lib/export/formats/htmlMessage.ts), [runner.ts](src/lib/export/runner.ts), [markdown/renderText.ts](src/lib/markdown/renderText.ts)
- Message display: [message/labels.ts](src/app/components/message/labels.ts), [message/format.ts](src/app/components/message/format.ts)
- Tests and documentation

`grep -rn "'ko'" src` and `npm run typecheck` help you find the places that are left.

### Change dependencies

If you add or bump a runtime dependency, run `npm run licenses` to regenerate [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md) and commit it with the change. CI runs `npm run licenses -- --check` to make sure the file is current and every license is on the allow-list.

## Commits and pull requests

- One purpose per pull request, and keep it small.
- Start the commit message with a short imperative summary (Korean or English is fine) and explain the *why* in the body when it is not obvious. No prefix convention is enforced.
- Fill in the checklist of the pull request template. For visible changes attach demo-mode screenshots (fake data only).
- If behaviour changes, update the README and `docs/USAGE*.md` too.
- **Record decisions.** Product and technical judgement calls (what is built and what is deliberately left out) go into [docs/DECISIONS.md](docs/DECISIONS.md) as a numbered item. If structure or rules change, update [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). When you change a signature listed under "Core contracts" there, update every consumer and test in the same pull request.
- Versions and releases are handled by the maintainer: `version` in `package.json` and `public/manifest.json` must match (`npm run verify` checks it), and pushing a `vX.Y.Z` tag makes GitHub Actions build the release. Contributors do not need to bump the version.

## Security issues

Do not post vulnerabilities in a public issue. Follow [SECURITY.md](SECURITY.md) and report them as a private security advisory.

## Code of conduct

Everyone taking part is expected to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## License of contributions

The project is under the [MIT License](LICENSE). By submitting a pull request you agree to license your contribution under the same MIT terms (inbound = outbound). If you bring in code or material you did not write yourself, make sure its license is compatible with MIT and say where it came from.
