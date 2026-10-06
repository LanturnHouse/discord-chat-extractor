# 개인정보 처리방침 · Privacy Policy

> 시행일 / Effective: **2026-10-06** · 적용 대상 / Applies to: Discord Chat Extractor v0.1.0 and later

**[한국어](#한국어) · [English](#english)**

관련 문서 / Related: [이용약관 · Terms of Use](TERMS.md) · [면책조항 · Disclaimer](DISCLAIMER.md) · [보안 · Security](SECURITY.md) · [LICENSE](LICENSE)

---

## 한국어

> [!NOTE]
> **요약**
>
> - 이 확장 프로그램은 작성자에게도, 어떤 제3자에게도 **아무것도 수집하거나 전송하지 않습니다.** 분석, 원격 측정, 계정, 서버가 없습니다.
> - 데이터는 **사용자의 브라우저와 Discord 사이에서만** 오갑니다.
> - Discord 로그인 토큰은 **메모리 전용 저장소**(`chrome.storage.session`)에만 보관하며 디스크에 쓰지 않습니다. 디스크에 저장되는 것은 내보내기 형식·HTML 테마·언어 설정뿐입니다.
> - 내보낸 **HTML 파일을 나중에 열면** 그 파일이 Discord의 이미지 서버에 요청을 보냅니다. Discord는 그 요청을 볼 수 있습니다([6조](#6-내보낸-파일)).

### 1. 프로젝트가 수집하는 것: 없음

이 프로젝트는 서버를 운영하지 않으며, 확장 프로그램은 작성자나 제3자에게 데이터를 보내는 코드를 포함하지 않습니다. 확장 프로그램 페이지의 콘텐츠 보안 정책(CSP)이 이를 기술적으로도 막습니다([4조](#4-네트워크-통신)).

| 항목 | 내용 |
| --- | --- |
| 수집·저장·전송 | 없음 |
| 분석, 원격 측정, 오류 보고 | 없음 |
| 계정, 로그인, 프로젝트 서버 | 없음 |
| 쿠키와 추적 기술 | 없음. 확장 프로그램은 쿠키를 읽거나 쓰지 않고, Discord API 요청에도 쿠키를 싣지 않습니다. |
| 제3자 제공, 처리 위탁, 국외 이전 | 없음. 프로젝트가 가진 데이터가 없습니다. |
| 광고, 판매 | 없음 |
| 작성자 쪽 보유 기간 | 해당 없음 |

### 2. 확장 프로그램이 접근하는 정보

**Discord 로그인 토큰.** 사용자의 크롬에서 이미 열려 있는 Discord 웹 클라이언트(`discord.com`, `ptb.discord.com`, `canary.discord.com`, `discordapp.com`)가 자기 API(`/api/*`)로 보내는 요청의 `Authorization` 헤더를 `chrome.webRequest`로 **읽기만** 합니다.

- 요청을 막거나 고치지 않습니다. 크롬은 콜백에 요청 헤더 전체를 넘겨 주지만, 코드는 `Authorization` 헤더 하나만 사용합니다.
- Discord 페이지가 보낸 요청만 봅니다. 확장 프로그램 자신, 다른 확장 프로그램, 다른 사이트의 요청은 무시합니다.
- 일반 사용자 토큰 형태가 아닌 값(`Bearer …`, `Bot …` 등 공백이 들어간 값)은 버립니다.
- 콘텐츠 스크립트가 없으므로 Discord 화면의 내용(메시지, 입력 중인 글 등)을 읽지 않습니다.

**Discord에서 가져오는 데이터.** 사용자의 브라우저가 Discord API(`https://discord.com/api/v9`)에서 아래를 읽기(GET) 전용으로 가져옵니다.

- 계정 확인용 사용자 정보(`users/@me`, 화면에 "연결된 계정"으로 표시), 서버 목록(이름·아이콘), DM 목록(상대 이름·아바타)
- 서버를 처음 열 때: 카테고리와 채널 목록, 채널 접근 권한을 계산하는 데 쓰는 역할 및 내 멤버 정보, 포럼/미디어 채널의 활성 게시글(스레드)
- 채널을 열거나 내보낼 때만: 그 채널의 메시지

가져온 데이터는 화면에 표시하거나 사용자가 요청한 내보내기 파일을 만드는 데에만 씁니다.

**접근하지 않는 것.** 쿠키, 비밀번호, 브라우징 기록, Discord 이외 사이트의 내용, 사용자의 파일.

### 3. 저장하는 정보

| 무엇 | 어디에 | 키 | 언제까지 |
| --- | --- | --- | --- |
| Discord 로그인 토큰, 토큰을 잡은 시각 | `chrome.storage.session` (**메모리 전용, 디스크에 쓰이지 않음**) | `dce.token`, `dce.tokenCapturedAt` | 크롬을 종료하거나 확장 프로그램을 끄거나·다시 로드하거나·업데이트하거나·제거할 때까지. Discord가 토큰을 거부(401)하면 앱이 지웁니다. |
| 설정: 내보내기 형식(`html`/`txt`/`md`/`xlsx`/`csv`/`json`), HTML 테마(`dark`/`light`), 언어(`auto`/`ko`/`en`) | `chrome.storage.local` (디스크, 크롬 프로필 안) | `dce.prefs` | 확장 프로그램을 제거할 때까지 |
| 불러온 서버·채널·메시지, 내보내기 진행 상태 | 앱 탭의 메모리 | (해당 없음) | 앱 탭을 닫거나 새로고침할 때까지 |

- 토큰은 `chrome.storage.local`, `localStorage`, URL, 로그, 내보낸 파일 어디에도 쓰지 않습니다.
- 설정은 민감하지 않은 값뿐이며, 크롬 동기화(`storage.sync`)를 쓰지 않으므로 다른 기기로 동기화되지 않습니다.
- 확장 프로그램 밖에서 개발 서버(`npm run dev`)로 앱을 직접 띄우는 개발자는 같은 설정이 그 브라우저의 `localStorage`(키 `dce.prefs`)에 저장됩니다. 데모 모드(`app.html?mock=1`)는 Discord에 접속하지 않고 토큰도 쓰지 않습니다.

### 4. 네트워크 통신

확장 프로그램 페이지의 콘텐츠 보안 정책은 `public/manifest.json`에 다음과 같이 적혀 있습니다. 여기에 없는 곳으로는 브라우저가 요청을 막습니다. `npm run verify`가 이 정책이 느슨해지지 않았는지 검사합니다.

```text
default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' https://discord.com; img-src 'self' data: blob: https://cdn.discordapp.com https://media.discordapp.net https://*.discordapp.net https://*.discordapp.com; media-src 'self' blob: https://cdn.discordapp.com https://media.discordapp.net https://*.discordapp.net; font-src 'none'; frame-src 'none'; form-action 'none'; object-src 'none'; base-uri 'none'
```

| 목적지 | 무엇을 | 언제 |
| --- | --- | --- |
| `https://discord.com/api/v9/…` | 읽기(GET) 요청. `Authorization` 헤더에 토큰만 싣고, 쿠키는 보내지 않습니다(`credentials: 'omit'`). 토큰은 이 주소 아래로만 보냅니다. | 계정 확인, 서버·DM 목록, 서버를 열 때, 채널을 열거나 내보낼 때 |
| Discord 미디어 서버(`cdn.discordapp.com`, `media.discordapp.net` 등 위 정책이 허용한 주소) | 아바타, 서버 아이콘, 이모지, 스티커, 이미지·영상 미리보기. 요청은 `no-referrer`로 보내므로 확장 프로그램 페이지 주소는 전달되지 않습니다. | 화면에 표시할 때 |
| `https://discord.com/app` | 안내 화면에서 "Discord 열기"를 눌렀을 때 새 탭으로 열기만 합니다. | 사용자가 눌렀을 때 |

- Discord는 이 요청들을 받으므로, 계정, 시각, IP 주소, 요청한 주소(어느 채널의 메시지인지 포함)를 볼 수 있다고 보아야 합니다. Discord의 일반적인 이용과 다르지 않지만, 이 확장 프로그램이 그 요청을 보낸다는 점은 알아 두세요. Discord가 정보를 어떻게 다루는지는 [Discord의 개인정보 처리방침](https://discord.com/privacy)을 따릅니다.
- 메시지 속 링크는 사용자가 눌러야 새 탭으로 열립니다(`noopener noreferrer`). 그 사이트는 프로젝트와 무관합니다.
- 메시지 속 이미지나 임베드가 Discord 이외의 호스트를 가리키면 자동으로 불러오지 않고 링크로만 보여 줍니다.
- 그 밖의 곳(분석 서비스, 광고, 외부 글꼴, 원격 코드, 제3자 서버)으로는 어떤 요청도 보내지 않습니다.

### 5. 권한과 그 이유

`public/manifest.json`에 선언한 것이 전부입니다.

| 권한 | 왜 필요한가 |
| --- | --- |
| `webRequest` | Discord 웹 클라이언트가 보내는 API 요청의 `Authorization` 헤더를 읽어 토큰을 얻습니다. 읽기 전용이며 요청을 막거나 바꾸지 않습니다. |
| `storage` | 토큰을 `chrome.storage.session`에, 설정을 `chrome.storage.local`에 보관합니다. |
| 호스트: `https://discord.com/*`, `https://ptb.discord.com/*`, `https://canary.discord.com/*`, `https://discordapp.com/*` | ① 위 `webRequest`가 볼 수 있는 주소의 범위, ② 확장 프로그램 페이지가 `discord.com`의 API를 호출할 수 있게 하는 권한, ③ 열려 있는 Discord 탭을 찾아 새로고침(토큰을 다시 잡기 위해)하는 권한입니다. 크롬은 설치할 때 이를 "해당 사이트의 데이터 읽기 및 변경" 같은 경고로 보여 줄 수 있습니다. 이 확장 프로그램은 그 사이트의 페이지나 요청을 바꾸지 않습니다. |

요청하지 않는 권한: `tabs`, `cookies`, `history`, `downloads`, `scripting`, `activeTab`, `<all_urls>`. 콘텐츠 스크립트도 없습니다.

### 6. 내보낸 파일

- 파일은 앱 탭이 **사용자의 브라우저 안에서** 만들어 브라우저의 일반 다운로드로 저장합니다. 어디에도 업로드하지 않습니다.
- 파일에는 메시지 내용, 작성자의 이름·사용자 이름·ID, 시각, 아바타·첨부파일·임베드의 링크, 서버·채널·DM 이름 등이 들어 있습니다. JSON은 Discord가 돌려준 메시지 원본 데이터 전체를 담습니다. **다른 사람의 개인정보**가 포함되어 있으므로 그 관리는 사용자의 책임입니다([DISCLAIMER.md](DISCLAIMER.md) 8조). 토큰은 파일에 들어가지 않습니다.
- **HTML 파일을 열 때 생기는 일.** 내보낸 HTML은 스크립트가 없는 단일 파일이지만, 아바타·서버 아이콘·이모지·스티커·이미지·영상·오디오를 파일 안에 담지 않고 Discord의 미디어 서버(`discordapp.com`, `discordapp.net`, `discord.com`, `discordcdn.com` 계열) 주소로 가리킵니다. 그래서 **나중에 그 파일을 여는 사람의 브라우저가 해당 이미지를 Discord에서 불러오며, Discord는 그 요청(IP 주소, 시각, 요청한 주소, 브라우저 정보)을 볼 수 있습니다.** 파일을 다른 사람에게 보내면 그 사람이 열 때도 마찬가지입니다. 파일에는 `no-referrer` 설정과 엄격한 CSP가 들어 있어 출처 주소는 전달되지 않고 스크립트도 실행되지 않으며, 이미지는 `https:`와 `data:`, 영상·오디오는 `https:`만 불러옵니다.
- 첨부파일 링크에는 한시적인 서명 값이 붙어 있을 수 있어서, 파일을 가진 사람은 링크가 만료되기 전까지 그 첨부파일을 열 수 있을 수 있습니다.
- **Markdown 파일**도 Discord 이미지 주소를 `![](…)` 형태로 담고 있어서, 이미지를 그려 주는 Markdown 뷰어로 열면 같은 요청이 생길 수 있습니다. TXT·CSV·XLSX·JSON은 링크를 글자로만 담으며, 사용자가 링크를 눌러야 요청이 갑니다.
- 요청이 일어나지 않게 하려면 네트워크를 끊은 상태에서 열거나 TXT·CSV·XLSX·JSON 형식을 쓰세요.

### 7. 아동과 민감한 정보

- 이 확장 프로그램은 어린이를 대상으로 하지 않으며, 누구에 대해서도 작성자에게 정보를 모으지 않습니다. Discord의 이용 연령은 Discord의 약관을 따릅니다.
- 내보낸 대화에는 미성년자를 포함한 다른 사람의 정보나 건강·정치·종교·성생활 같은 민감한 내용이 들어 있을 수 있습니다. 도구는 이를 구별하거나 걸러 내지 않습니다. 이런 내용이 들어 있는 파일은 특히 조심해서 보관하고 공유하지 마세요.

### 8. 데이터 지우는 방법

| 대상 | 방법 |
| --- | --- |
| 불러온 메시지(앱 탭의 메모리) | 앱 탭을 닫거나 새로고침합니다. |
| 토큰 | 앱 탭을 닫아도 `chrome.storage.session`의 토큰은 남습니다. **크롬을 완전히 종료**하거나, `chrome://extensions`에서 확장 프로그램을 **끄거나 다시 로드하거나 제거**하면 지워집니다. 토큰 자체를 무효화하려면 Discord에서 로그아웃하거나 비밀번호를 바꾸세요. |
| 설정 | 확장 프로그램을 제거하면 `chrome.storage.local`의 데이터도 함께 지워집니다. |
| 내보낸 파일 | 직접 지웁니다. 다운로드 폴더, 압축 파일, 백업·클라우드 동기화된 사본, 다른 사람에게 보낸 사본을 모두 확인하세요. 크롬의 다운로드 기록(`chrome://downloads`)에 파일 이름이 남아 있을 수 있습니다. |

작성자 쪽에는 지울 데이터가 없습니다. Discord가 가진 데이터의 삭제나 열람은 Discord에 요청하세요.

### 9. 다른 주체의 개인정보 처리

- Discord가 요청을 받고 데이터를 다루는 방식은 Discord의 약관과 [개인정보 처리방침](https://discord.com/privacy)을 따르며 이 프로젝트와 무관합니다.
- 크롬 자체의 동작(동기화, 다운로드 기록, 오류 보고 등)은 사용자의 크롬 설정과 해당 제공자의 방침을 따릅니다.
- GitHub Issues 등 GitHub에 올린 내용은 공개되며 GitHub의 방침을 따릅니다. 토큰이나 개인적인 대화 내용은 올리지 마세요.

### 10. 변경

이 방침은 바뀔 수 있습니다. 시행일은 맨 위에 적고, 변경 이력은 저장소의 git 기록으로 확인할 수 있습니다. 확장 프로그램이 새로운 데이터를 다루거나 새로운 곳과 통신하게 되면 이 문서도 함께 고칩니다.

### 11. 문의

[GitHub Issues](https://github.com/LanturnHouse/discord-chat-extractor/issues)로 문의해 주세요. 비공개 이메일 창구는 없습니다. 보안 취약점은 [SECURITY.md](SECURITY.md)의 비공개 제보를 이용하세요.

---

## English

> [!NOTE]
> **Summary**
>
> - The extension does **not collect or transmit anything** to the authors or to any third party. There is no analytics, telemetry, account or server.
> - Data moves **only between your browser and Discord.**
> - Your Discord login token is kept **only in memory-only storage** (`chrome.storage.session`) and is never written to disk. The only things saved to disk are your export format, HTML theme and language preferences.
> - **Opening an exported HTML file later** makes that file request images from Discord's media servers. Discord can see those requests ([section 6](#6-exported-files)).

### 1. What the project collects: nothing

The project runs no server, and the extension contains no code that sends data to the authors or to third parties. The content security policy (CSP) of the extension pages also blocks it technically ([section 4](#4-network-traffic)).

| Item | Status |
| --- | --- |
| Collection, storage, transmission | None |
| Analytics, telemetry, error reporting | None |
| Accounts, sign-in, project servers | None |
| Cookies and tracking | None. The extension neither reads nor writes cookies, and sends no cookies with its Discord API requests. |
| Disclosure to third parties, processors, transfers abroad | None. The project holds no data. |
| Advertising, sale of data | None |
| Retention by the authors | Not applicable |

### 2. What the extension accesses

**Your Discord login token.** The extension **only reads** the `Authorization` header of the requests that a Discord web client already open in your Chrome (`discord.com`, `ptb.discord.com`, `canary.discord.com`, `discordapp.com`) sends to its own API (`/api/*`), using `chrome.webRequest`.

- It does not block or modify requests. Chrome hands the callback all request headers, but the code uses the `Authorization` header only.
- It looks only at requests sent by a Discord page. Requests from the extension itself, from other extensions and from other sites are ignored.
- Values that do not look like an ordinary user token (anything containing whitespace, such as `Bearer ...` or `Bot ...`) are discarded.
- There is no content script, so it never reads what is shown on a Discord page (messages, text you are typing, and so on).

**Data fetched from Discord.** Your browser reads the following from the Discord API (`https://discord.com/api/v9`), using read-only (GET) requests.

- The user record used to check the account (`users/@me`, shown on screen as the connected account), the server list (names, icons) and the DM list (names, avatars of the other people)
- The first time you open a server: its categories and channels, the roles and your own member record used to work out which channels you can read, and the active posts (threads) of forum/media channels
- Only when you open or export a channel: that channel's messages

The data is used only to show it on screen or to build the export files you ask for.

**What it does not access.** Cookies, passwords, browsing history, the content of sites other than Discord, and your files.

### 3. What is stored

| What | Where | Key | Until |
| --- | --- | --- | --- |
| Discord login token, and the time it was captured | `chrome.storage.session` (**memory only, never written to disk**) | `dce.token`, `dce.tokenCapturedAt` | Chrome is quit, or the extension is disabled, reloaded, updated or removed. The app also deletes it when Discord rejects the token (401). |
| Preferences: export format (`html`/`txt`/`md`/`xlsx`/`csv`/`json`), HTML theme (`dark`/`light`), language (`auto`/`ko`/`en`) | `chrome.storage.local` (disk, inside your Chrome profile) | `dce.prefs` | Until the extension is removed |
| Loaded servers, channels and messages, export progress | Memory of the app tab | (not applicable) | Until the app tab is closed or reloaded |

- The token is never written to `chrome.storage.local`, `localStorage`, URLs, logs or exported files.
- Preferences are non-sensitive values only. The extension does not use Chrome sync (`storage.sync`), so they are not synced to other devices.
- A developer who runs the app outside the extension with the dev server (`npm run dev`) gets the same preferences stored in that browser's `localStorage` (key `dce.prefs`). The demo mode (`app.html?mock=1`) does not connect to Discord and uses no token.

### 4. Network traffic

The content security policy of the extension pages is written in `public/manifest.json` as shown below. The browser blocks requests to anywhere not listed. `npm run verify` checks that the policy has not been loosened.

```text
default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' https://discord.com; img-src 'self' data: blob: https://cdn.discordapp.com https://media.discordapp.net https://*.discordapp.net https://*.discordapp.com; media-src 'self' blob: https://cdn.discordapp.com https://media.discordapp.net https://*.discordapp.net; font-src 'none'; frame-src 'none'; form-action 'none'; object-src 'none'; base-uri 'none'
```

| Destination | What | When |
| --- | --- | --- |
| `https://discord.com/api/v9/...` | Read-only (GET) requests. The token is sent only in the `Authorization` header, and no cookies are sent (`credentials: 'omit'`). The token is sent only to addresses under this path. | Account check, server and DM lists, opening a server, opening or exporting a channel |
| Discord media servers (`cdn.discordapp.com`, `media.discordapp.net` and the other addresses the policy above allows) | Avatars, server icons, emoji, stickers, image and video previews. Requests use `no-referrer`, so the address of the extension page is not passed on. | When something is shown on screen |
| `https://discord.com/app` | Only opened in a new tab when you press "Open Discord" on the help screen. | When you press it |

- Discord receives these requests, so assume it can see the account, time, IP address and requested address (including which channel's messages were fetched). That is no different from using Discord normally, but you should know that this extension is the one sending them. How Discord handles the information is governed by [Discord's Privacy Policy](https://discord.com/privacy).
- A link inside a message opens in a new tab only when you click it (`noopener noreferrer`). That site has nothing to do with the project.
- If an image or embed in a message points to a host other than Discord, it is not loaded automatically; it is shown as a link only.
- No request is sent anywhere else: no analytics service, ads, external fonts, remote code or third-party servers.

### 5. Permissions and why

Everything declared in `public/manifest.json`:

| Permission | Why it is needed |
| --- | --- |
| `webRequest` | To read the `Authorization` header of API requests that the Discord web client sends, and so obtain the token. It is read-only; requests are not blocked or changed. |
| `storage` | To keep the token in `chrome.storage.session` and the preferences in `chrome.storage.local`. |
| Hosts: `https://discord.com/*`, `https://ptb.discord.com/*`, `https://canary.discord.com/*`, `https://discordapp.com/*` | (1) The range of addresses `webRequest` may observe, (2) permission for the extension page to call the API on `discord.com`, (3) permission to find and reload open Discord tabs so the token can be captured again. When you install it, Chrome may show this as a warning such as "read and change your data on these sites". The extension does not change those sites' pages or requests. |

Permissions it does not request: `tabs`, `cookies`, `history`, `downloads`, `scripting`, `activeTab`, `<all_urls>`. There are no content scripts either.

### 6. Exported files

- The app tab builds the files **inside your browser** and saves them through the browser's ordinary download. Nothing is uploaded anywhere.
- A file contains message content, the authors' names, usernames and IDs, timestamps, links to avatars, attachments and embeds, and server, channel and DM names. The JSON export contains the full raw message data as Discord returned it. It holds **other people's personal data**, and looking after it is your responsibility (section 8 of the [DISCLAIMER.md](DISCLAIMER.md)). The token is never written into a file.
- **What happens when an HTML file is opened.** An exported HTML file is a single file without scripts, but it does not embed avatars, server icons, emoji, stickers, images, video or audio; it points to addresses on Discord's media servers (the `discordapp.com`, `discordapp.net`, `discord.com` and `discordcdn.com` families). So **whenever someone opens the file later, their browser loads those images from Discord, and Discord can see those requests (IP address, time, requested address, browser information).** The same applies when you send the file to someone else and they open it. The file carries a `no-referrer` setting and a strict CSP, so no source address is passed on and no script can run; images load only from `https:` and `data:`, and video and audio only from `https:`.
- Attachment links may carry a temporary signature, so someone who has the file may be able to open that attachment until the link expires.
- **Markdown files** also contain Discord image addresses in the form `![](...)`, so opening one in a Markdown viewer that draws images can cause the same requests. TXT, CSV, XLSX and JSON files contain links as text only, and a request happens only if you click a link.
- To avoid these requests, open the file with the network disconnected, or use TXT, CSV, XLSX or JSON.

### 7. Children and sensitive information

- The extension is not directed at children and collects no information about anyone for the authors. The minimum age for using Discord is governed by Discord's terms.
- Exported conversations may contain information about other people, including minors, and sensitive content such as health, politics, religion or sex life. The tool neither recognises nor filters it. Store files containing such content with particular care and do not share them.

### 8. How to delete your data

| What | How |
| --- | --- |
| Loaded messages (memory of the app tab) | Close or reload the app tab. |
| Token | Closing the app tab does not remove the token from `chrome.storage.session`. It is cleared when you **quit Chrome completely**, or **disable, reload or remove** the extension at `chrome://extensions`. To invalidate the token itself, log out of Discord or change your password. |
| Preferences | Removing the extension also deletes its `chrome.storage.local` data. |
| Exported files | Delete them yourself. Check your Downloads folder, archives, backup and cloud-synced copies, and copies you sent to others. Chrome's download history (`chrome://downloads`) may still list the file names. |

The authors hold no data, so there is nothing to delete on their side. To access or delete data that Discord holds, ask Discord.

### 9. Other parties' handling of personal data

- How Discord receives requests and handles data is governed by Discord's terms and [Privacy Policy](https://discord.com/privacy), and has nothing to do with this project.
- Chrome's own behaviour (sync, download history, error reporting and so on) follows your Chrome settings and the policies of its provider.
- What you post on GitHub, for example in GitHub Issues, is public and subject to GitHub's policies. Never post tokens or private conversations.

### 10. Changes

This policy may change. The effective date is at the top, and the history is in the repository's git log. If the extension ever handles new data or talks to a new destination, this document will be updated with it.

### 11. Contact

Use [GitHub Issues](https://github.com/LanturnHouse/discord-chat-extractor/issues). There is no private email channel. For security vulnerabilities use the private reporting in [SECURITY.md](SECURITY.md).
