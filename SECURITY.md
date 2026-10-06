# 보안 정책 · Security Policy

> 최종 수정 / Last updated: **2026-10-06**

**[한국어](#한국어) · [English](#english)**

관련 문서 / Related: [개인정보 처리방침 · Privacy Policy](PRIVACY.md) · [면책조항 · Disclaimer](DISCLAIMER.md) · [이용약관 · Terms of Use](TERMS.md) · [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)

---

## 한국어

> [!WARNING]
> **공개 이슈, 토론, 풀 리퀘스트, 스크린샷 어디에도 진짜 Discord 토큰이나 실제 비공개 메시지를 올리지 마세요.**
> 토큰은 계정 비밀번호와 같은 힘을 가집니다. 이미 올렸다면 [아래 안내](#실수로-올렸다면)를 따르세요.
> 재현이 필요하면 데모 모드(`app.html?mock=1`)의 가상 데이터나 가짜 토큰을 쓰세요.

### 지원하는 버전

보안 수정은 **최신 릴리스에만** 합니다. 오래된 버전은 최신 릴리스로 올려 주세요.

| 버전 | 보안 수정 |
| --- | --- |
| 최신 릴리스 | 지원 |
| 그 이전 릴리스 | 지원하지 않음 |

### 취약점 제보 방법 (비공개)

공개 이슈로 올리지 말고 GitHub의 비공개 취약점 제보를 이용해 주세요.

1. 저장소의 **Security** 탭으로 갑니다.
2. **Report a vulnerability**를 누릅니다. 바로 가기: <https://github.com/LanturnHouse/discord-chat-extractor/security/advisories/new>
3. 아래를 적어 주세요.
   - 영향을 받는 버전(확장 프로그램 버전과 크롬 버전)
   - 재현 절차. 가능하면 데모 모드나 가짜 데이터로 재현해 주세요.
   - 어떤 영향이 있는지(예: 토큰 유출, 스크립트 실행)
   - 해결 방법이 떠오르면 그것도

제보는 한국어나 영어로 해 주세요.

### 대응 일정 (최선의 노력)

이 프로젝트는 개인이 무상으로 운영하므로 아래는 **약속이 아니라 목표**입니다.

- 제보를 받았다는 확인: 보통 7일 이내
- 첫 평가(재현 여부, 심각도): 보통 14일 이내
- 확인된 심각한 취약점의 수정: 가능한 한 빨리. 수정한 릴리스를 낸 뒤에 공개합니다.

수정이 나오기 전에 공개하는 것은 90일 정도 기다려 주시길 부탁드립니다. 상황에 따라 더 빨리 협의할 수 있습니다.

### 범위

**범위 안**

- 토큰 처리와 유출: 토큰이 `chrome.storage.session` 밖에 쓰이거나, 로그·URL·내보낸 파일에 들어가거나, Discord API 이외의 곳으로 가는 경우
- 메시지 내용, 사용자 이름, 임베드, 파일 이름, 채널 이름 같은 **Discord 데이터를 통한 XSS나 주입**: 앱 화면에서도, 내보낸 파일(특히 HTML)에서도
- CSP 우회, 또는 확장 프로그램 페이지에서 `https://discord.com` 이외의 곳으로 요청을 보낼 수 있게 되는 것
- ZIP 항목이나 파일 이름의 경로 탈출(path traversal), 예약된 파일 이름, 덮어쓰기
- CSV·XLSX 수식 주입
- 데이터를 Discord가 아닌 호스트로 보내는 모든 동작

**범위 밖**

- Discord 약관을 어길 위험 자체. 이는 [면책조항](DISCLAIMER.md)에 이미 밝혀 두었습니다.
- 사회공학, 피싱, 사용자를 속여 토큰이나 파일을 넘기게 하는 방법
- 이미 침해된 브라우저·운영체제·다른 확장 프로그램이 있어야만 가능한 문제
- Discord 자체의 취약점(Discord에 직접 제보해 주세요), 크롬의 취약점
- [docs/DECISIONS.md](docs/DECISIONS.md)에 한계로 밝혀 둔 동작(스레드 일부 누락, 첨부파일 링크 만료, 아주 큰 채널에서의 XLSX 메모리 사용 등)
- 악용 경로가 없는 개발 의존성의 알림. 다만 알려 주시면 확인합니다.

범위가 애매하면 일단 비공개로 제보해 주세요.

### 실수로 올렸다면

토큰이나 비공개 메시지를 공개된 곳에 올렸다면 지금 바로 이렇게 하세요.

1. **토큰은 이미 유출된 것으로 보세요.** 글을 지워도 이미 누군가 복사했을 수 있으니, 지우는 것보다 아래 2번이 중요합니다.
2. **토큰을 무효화하세요.** 토큰을 얻은 Discord 세션에서 **로그아웃**하고, **비밀번호를 바꾸세요.** 비밀번호를 바꾸면 이전 토큰은 쓸 수 없게 됩니다.
3. 올린 글·댓글·이슈·첨부 이미지를 **지우세요.** 직접 지울 수 없으면 위의 비공개 제보로 알려 주세요.
4. 올린 것이 다른 사람의 메시지였다면 그 사람들에게도 알리는 것을 고려하세요.

### 보안 모델 요약

자세한 규칙은 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)의 "Security rules"에 있습니다.

- **토큰은 메모리에만.** Discord 웹 클라이언트가 보낸 요청의 `Authorization` 헤더를 읽기 전용으로 관찰해 `chrome.storage.session`(디스크에 쓰이지 않음)에만 보관합니다. 로그, URL, `localStorage`, `chrome.storage.local`, 내보낸 파일에는 쓰지 않으며, 오류 메시지에서도 가립니다.
- **토큰은 Discord API로만.** 요청 주소가 `https://discord.com/api/v9` 아래인지 주소를 해석해 확인한 뒤에만 토큰을 붙이고, 쿠키는 보내지 않으며(`credentials: 'omit'`), 리다이렉트는 따르지 않습니다.
- **엄격한 CSP.** 확장 프로그램 페이지는 `default-src 'none'`에 `connect-src 'self' https://discord.com`, `script-src 'self'`(`eval` 없음)입니다. 이미지와 영상은 Discord 도메인에서만 불러옵니다. `npm run verify`가 빌드 결과에서 이 정책을 검사합니다.
- **내용은 믿지 않습니다.** 메시지, 이름, 임베드, 파일 이름, 채널 이름은 공격자가 만든 값으로 보고 `dangerouslySetInnerHTML` 없이 렌더링합니다. 링크는 `http`/`https`/`mailto`만 허용하고, 글자와 실제 주소가 다른 링크에는 실제 도메인을 덧붙여 보여 줍니다.
- **HTML 내보내기에는 스크립트가 없습니다.** 모든 값을 이스케이프하고, 파일 안에 자체 CSP(`default-src 'none'`, 이미지 `https:`/`data:`, 영상·오디오 `https:`)와 `no-referrer`를 넣습니다. 링크에는 `rel="noopener noreferrer nofollow"`를 붙입니다.
- **스프레드시트와 파일 이름.** CSV는 `=`, `+`, `-`, `@` 등으로 시작하는 셀을 무력화하고, XLSX는 모든 셀을 문자열로만 씁니다. 파일·ZIP 항목 이름은 경로 구분자, `..`, 제어 문자, Windows 예약 이름을 정리합니다.
- **작은 공급망.** 런타임 의존성은 4개(react, react-dom, zustand, fflate)입니다. 목록과 라이선스는 [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md)에 있습니다.

---

## English

> [!WARNING]
> **Never post a real Discord token or real private messages in a public issue, discussion, pull request or screenshot.**
> A token is as powerful as your account password. If you already did, follow [the steps below](#if-you-posted-one-by-mistake).
> To reproduce a problem, use the fictional data of the demo mode (`app.html?mock=1`) or a fake token.

### Supported versions

Security fixes are made for **the latest release only**. Please update to the latest release.

| Version | Security fixes |
| --- | --- |
| Latest release | Supported |
| Any earlier release | Not supported |

### How to report a vulnerability (privately)

Do not open a public issue. Use GitHub's private vulnerability reporting.

1. Go to the **Security** tab of the repository.
2. Click **Report a vulnerability**. Shortcut: <https://github.com/LanturnHouse/discord-chat-extractor/security/advisories/new>
3. Please include:
   - the affected version (the extension version and your Chrome version)
   - steps to reproduce, preferably using the demo mode or fake data
   - the impact (for example token disclosure or script execution)
   - a suggested fix, if you have one

Reports can be written in English or Korean.

### Response times (best effort)

This is a free project run by an individual, so the following are **goals, not commitments**.

- Acknowledgement of your report: usually within 7 days
- First assessment (can it be reproduced, how severe): usually within 14 days
- Fix for a confirmed serious vulnerability: as soon as practical. Details are published after a fixed release is out.

Please allow around 90 days before disclosing publicly if no fix has been released; a shorter time can be agreed case by case.

### Scope

**In scope**

- Token handling and leaks: the token being used outside `chrome.storage.session`, appearing in logs, URLs or exported files, or going anywhere other than the Discord API
- **XSS or injection through Discord data** such as message content, usernames, embeds, file names and channel names, both in the app and in exported files (HTML in particular)
- A CSP bypass, or any way to make the extension page send requests anywhere other than `https://discord.com`
- Path traversal, reserved names or overwriting through ZIP entry names or file names
- CSV and XLSX formula injection
- Anything that sends data to a host that is not Discord

**Out of scope**

- The risk of breaching Discord's terms itself, which is already stated in the [Disclaimer](DISCLAIMER.md)
- Social engineering, phishing, or tricking a user into handing over a token or a file
- Issues that need an already compromised browser, operating system or other extension
- Vulnerabilities in Discord itself (report those to Discord) or in Chrome
- Behaviour documented as a limitation in [docs/DECISIONS.md](docs/DECISIONS.md) (some threads missing, expiring attachment links, XLSX memory use on very large channels, and so on)
- Alerts about development dependencies that have no exploitable path; but please do tell us and we will look

If you are unsure whether something is in scope, report it privately anyway.

### If you posted one by mistake

If you posted a token or private messages somewhere public, do this right now.

1. **Treat the token as leaked.** Deleting the post is not enough because someone may already have copied it; step 2 is the one that matters.
2. **Invalidate the token.** **Log out** of the Discord session the token came from and **change your password.** Changing the password makes the previous token unusable.
3. **Delete** the post, comment, issue or attached image. If you cannot delete it yourself, tell us through the private report above.
4. If what you posted were other people's messages, consider telling those people too.

### Security model in short

The detailed rules are in "Security rules" in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

- **The token lives in memory only.** The `Authorization` header of requests sent by the Discord web client is observed read-only and kept only in `chrome.storage.session` (never written to disk). It is never written to logs, URLs, `localStorage`, `chrome.storage.local` or exported files, and it is redacted from error messages.
- **The token goes to the Discord API only.** It is attached only after the request address has been parsed and confirmed to be under `https://discord.com/api/v9`; cookies are not sent (`credentials: 'omit'`) and redirects are not followed.
- **Strict CSP.** The extension pages use `default-src 'none'` with `connect-src 'self' https://discord.com` and `script-src 'self'` (no `eval`). Images and video load from Discord domains only. `npm run verify` checks this policy in the build output.
- **Content is untrusted.** Messages, names, embeds, file names and channel names are treated as attacker-controlled values and rendered without `dangerouslySetInnerHTML`. Links are limited to `http`, `https` and `mailto`, and a link whose text names a different site gets the real domain shown next to it.
- **HTML exports contain no scripts.** Every value is escaped, and the file carries its own CSP (`default-src 'none'`, images `https:`/`data:`, video and audio `https:`) and `no-referrer`. Links get `rel="noopener noreferrer nofollow"`.
- **Spreadsheets and file names.** CSV neutralises cells that start with `=`, `+`, `-`, `@` and similar; XLSX writes every cell as a string only. File and ZIP entry names are cleaned of path separators, `..`, control characters and Windows reserved names.
- **A small supply chain.** There are four runtime dependencies (react, react-dom, zustand, fflate). The list and their licenses are in [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md).
