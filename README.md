# Discord Chat Extractor

크롬에 로그인해 둔 Discord의 서버·채널·DM 대화를 HTML, TXT, Markdown, Excel, CSV, JSON 파일로 내보내는 크롬 확장 프로그램입니다.

**한국어** | [English](README.en.md)

[![CI](https://github.com/LanturnHouse/discord-chat-extractor/actions/workflows/ci.yml/badge.svg)](https://github.com/LanturnHouse/discord-chat-extractor/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Chrome Manifest V3](https://img.shields.io/badge/Chrome-Manifest%20V3-4285F4?logo=googlechrome&logoColor=white)](public/manifest.json)
[![Release](https://img.shields.io/github/v/release/LanturnHouse/discord-chat-extractor?include_prereleases)](https://github.com/LanturnHouse/discord-chat-extractor/releases/latest)

![Discord Chat Extractor: 서버 목록, 채널 목록, 메시지 화면. 화면의 서버·대화는 모두 데모 모드의 가상 데이터입니다.](docs/images/ko/01-main.png)

> [!WARNING]
> **쓰기 전에 꼭 읽어 주세요.**
>
> - **계정 제재 위험**: 이 도구는 로그인한 본인 계정의 토큰으로 Discord API를 직접 호출합니다. Discord의 이용약관과 개발자 정책은 사용자 계정의 자동화(이른바 "셀프봇")를 허용하지 않으므로 경고, 기능 제한, 계정 정지를 받을 수 있습니다. 읽기 전용·순차 요청으로 위험을 줄였을 뿐 **없애지는 못합니다.**
> - **다른 사람의 데이터**: 내보낸 파일에는 다른 사람의 메시지와 이름, 프로필 사진 링크가 들어 있습니다. 보관·공유·사용이 적법한지는 **사용자가 책임**집니다.
> - **비공식 도구**: Discord와 관계없는 개인 프로젝트이며 보증도 지원도 없습니다.
>
> 자세한 내용은 [면책조항](DISCLAIMER.md)과 [이용약관](TERMS.md)을 읽어 주세요.

## 주요 기능

- **Discord와 같은 모양의 읽기 전용 화면**: 서버 목록, 카테고리·채널 목록, 메시지를 Discord 다크 테마처럼 보여 줍니다. 메시지 입력창, 검색, 프로필 같은 기능은 일부러 넣지 않았습니다.
- **가벼운 시작**: 시작할 때는 서버 목록과 DM 목록만 가져옵니다. 서버의 채널 목록은 서버를 처음 열 때, 메시지는 채널을 열 때만 가져옵니다.
- **200개씩 보기**: 채널을 열면 최신 메시지 200개가 보이고, 위로 스크롤하면 200개씩 위에 이어 붙습니다.
- **체크박스로 선택**: 채널, DM, 카테고리, 서버 전체(일부만 선택하면 3상태)를 체크합니다. 클릭은 보기, 체크박스는 내보내기 선택입니다. 선택은 서버를 오가도 유지됩니다.
- **전체 기록 또는 일부만**: 기본은 채널의 *전체* 기록입니다. **기간**(시작일·종료일)과 **메시지 개수**(1~100,000, 채널마다 적용)로 줄일 수 있습니다.
  - 기간 없이 개수만 정하면 **최근 N개**
  - 시작일과 개수를 정하면 **시작일부터 N개**(종료일이 있으면 그 날짜를 넘지 않음)
  - 종료일과 개수만 정하면 **종료일까지의 최근 N개**
- **채널별 설정**: "N개 선택됨" 목록에서 채널마다 톱니바퀴를 눌러 그 채널만 기간·개수를 따로 정할 수 있습니다. 예를 들어 한 채널만 최근 200개, 나머지는 전체.
- **6가지 형식**: HTML(Discord 모양, 다크/라이트), TXT, Markdown, Excel(.xlsx), CSV, JSON. 채널이 2개 이상이면 폴더 구조를 갖춘 ZIP 하나로 저장합니다.
- **진행 창**: 채널별 진행 상황, 취소, 건너뛴 채널(접근 불가)과 오류 목록. 취소하면 자동 저장하지 않고, 끝난 채널은 직접 저장할 수 있습니다.
- **한국어·영어**: 화면과 내보낸 파일 안의 고정 문구가 같은 언어로 나옵니다. 기본값은 브라우저 언어를 따릅니다.
- **데모 모드**: 가상의 서버·채널·DM·수천 개의 메시지로 Discord 계정 없이 화면 전체와 내보내기를 체험할 수 있습니다.

## 빠른 시작

Chrome 116 이상이 필요합니다. 설치는 둘 중 하나로 하면 됩니다.

### A. 릴리스 ZIP으로 설치 (권장)

1. [최신 릴리스](https://github.com/LanturnHouse/discord-chat-extractor/releases/latest)에서 `discord-chat-extractor-v<버전>.zip`을 내려받습니다.
2. 압축을 풉니다. 풀린 폴더는 확장 프로그램을 쓰는 동안 지우지 마세요. Chrome은 이 폴더의 파일을 직접 읽습니다.
3. 크롬에서 `chrome://extensions`를 열고 오른쪽 위의 **개발자 모드**를 켭니다.
4. **압축해제된 확장 프로그램을 로드합니다**를 누르고, `manifest.json`이 바로 들어 있는 폴더를 선택합니다.

### B. 소스에서 빌드

Node.js 22.12 이상이 필요합니다.

```bash
git clone https://github.com/LanturnHouse/discord-chat-extractor.git
cd discord-chat-extractor
npm ci
npm run build
```

그다음 위 A의 3~4단계처럼 `chrome://extensions`에서 이 저장소의 `dist` 폴더를 선택합니다.

설치와 업데이트, 문제 해결은 [사용 가이드](docs/USAGE.md)에 더 자세히 있습니다.

## 60초 사용법

1. 같은 크롬에서 <https://discord.com/app>에 로그인해 둡니다.
2. 툴바의 **Discord Chat Extractor** 아이콘을 누르면 앱이 새 탭으로 열립니다. 로그인 정보를 아직 못 찾았다면 안내 화면의 **Discord 탭 새로고침**을 누르세요.
3. 왼쪽 서버 아이콘(맨 위 말풍선은 DM)을 누르고 채널을 눌러 내용을 확인합니다.
4. 내보낼 항목의 체크박스를 켭니다. 서버, 카테고리, 채널, DM 모두 가능하고, 오른쪽 위 **N개 선택됨**에서 목록을 확인할 수 있습니다.

   ![체크박스로 채널과 DM을 고른 모습. 오른쪽 위에 5개 선택됨 표시](docs/images/ko/02-selection.png)

5. 오른쪽 위 **다운로드**를 누르면 바로 시작합니다. 형식, 기간, 메시지 개수는 오른쪽의 **▾**에서 바꿉니다.

   ![채널별 진행 상황을 보여 주는 내보내기 진행 창](docs/images/ko/05-progress.png)

## 내보내기 형식

| 형식 | 이럴 때 | 참고 |
| --- | --- | --- |
| **HTML** (기본) | 사람이 읽을 때 | Discord처럼 보이는 파일 하나. 다크/라이트 선택. 스크립트가 없습니다. |
| **TXT** | 가장 단순한 텍스트 기록 | 어디서나 열립니다. |
| **Markdown** | Notion, Obsidian, GitHub에 옮길 때 | 메시지 속 HTML과 제목·인용 위조는 이스케이프합니다. |
| **Excel (.xlsx)** | 정렬·필터링할 때 | 모든 셀이 문자열이라 수식이 실행되지 않고, 긴 ID도 그대로 보존됩니다. 엑셀에서 열 거라면 CSV 대신 이쪽을 쓰세요. |
| **CSV** | 데이터 분석, 스크립트 처리 | UTF-8(BOM). 엑셀에서 열면 18~19자리 ID가 `1.42E+18`로 보이고, 저장하면 뒷자리가 깨질 수 있습니다. |
| **JSON** | 프로그램에서 쓰거나 원본 보관 | 메시지가 Discord API가 준 원본 그대로 들어갑니다. |

모든 형식에서 첨부파일은 내려받지 않고 **링크만** 기록합니다. Discord의 첨부파일 링크는 시간이 지나면 만료될 수 있습니다.

## 개인정보 · 보안 요약

- **로그인 정보(토큰)**: Discord 탭이 보내는 API 요청의 `Authorization` 헤더를 읽기만 하고, 브라우저를 닫으면 사라지는 `chrome.storage.session`에만 둡니다. 디스크, 로그, 내보낸 파일에는 쓰지 않습니다. 쿠키와 Discord 페이지의 내용은 읽지 않습니다.
- **네트워크**: 요청은 `discord.com`의 API로만 나갑니다. 분석 도구, 원격 코드, 외부 폰트가 없고, 확장 프로그램의 콘텐츠 보안 정책(CSP)이 이를 막습니다. 그림은 Discord의 이미지 서버에서 불러옵니다.
- **권한**: `webRequest`(Discord 페이지의 요청 헤더를 보기만 함, 요청을 막거나 바꾸지 않음), `storage`, 그리고 Discord 주소(`discord.com`, `ptb.discord.com`, `canary.discord.com`, `discordapp.com`)에 대한 호스트 권한.
- **신뢰할 수 없는 입력**: 메시지, 이름, 임베드는 모두 조작될 수 있는 값으로 취급합니다. 화면은 `dangerouslySetInnerHTML` 없이 그리고, 내보낸 HTML에는 스크립트가 없으며 엄격한 CSP가 들어 있고, CSV/Excel은 수식 주입을 막습니다.
- 내보낸 HTML 파일을 나중에 열면 파일 속 그림 주소 때문에 브라우저가 Discord의 이미지 서버에 요청을 보냅니다.

자세한 내용: [개인정보 처리방침](PRIVACY.md) · [보안 정책](SECURITY.md)

## 알려진 한계

- **실제 Discord 계정으로는 테스트하지 않았습니다**(토큰을 다루지 않기 위해). API 계층은 모킹된 요청 테스트로, 화면은 데모 모드로, 확장 프로그램 자체는 실제 크롬에 올려 로컬 가짜 Discord 서버와 주고받는 end-to-end 시험(`npm run e2e`)으로 확인했습니다. 실제 Discord API의 세부 동작은 공개 문서와 오픈소스 구현을 근거로 한 것이라 실제 계정에서는 다를 수 있습니다.
- 첨부파일 본문은 내려받지 않고 링크만 기록합니다.
- 스레드는 사용자 토큰으로 쓸 수 있는 방법의 제약 때문에 **포럼/미디어 채널의 활성 게시글(채널당 최대 100개)**만 찾을 수 있습니다. 일반 텍스트·공지 채널 아래의 스레드는 나열하지 못하고, 보관된(archived) 스레드도 지원하지 않습니다(데모 모드는 스레드를 보여 줍니다).
- 메시지 개수는 채널마다 최대 100,000개입니다. 전체가 필요하면 "전체"를 쓰세요.
- 한 번에 내보내는 ZIP은 약 3.75GB / 65,535개 파일까지입니다. 넘으면 그 채널은 실패 목록에 표시되고 나머지는 저장됩니다.
- XLSX는 채널 하나를 통째로 메모리에 올려 만들기 때문에, 수십만 개가 넘는 메시지는 CSV나 JSON이 낫습니다.
- 서버 폴더·정렬 설정, 실시간 갱신(새 메시지 자동 반영), 역할 색상은 지원하지 않습니다. 화면은 스냅샷입니다.
- 창 너비가 900px보다 좁으면 가로 스크롤이 생기며, 모바일·좁은 화면 레이아웃은 없습니다.
- 크롬(Manifest V3, 116 이상)에서만 확인했습니다.

판단으로 정한 사항과 의도적으로 제외한 기능은 [docs/DECISIONS.md](docs/DECISIONS.md)에 있습니다.

## 자주 묻는 질문

<details>
<summary><b>로그인 정보(토큰)가 감지되지 않아요</b></summary>

같은 크롬에서 Discord에 로그인해 둔 탭이 있어야 합니다. 앱의 안내 화면에서 **Discord 탭 새로고침**(열린 탭이 없으면 **Discord 열기**)을 누르고 Discord가 다 불러올 때까지 기다리세요. 그래도 안 되면 [사용 가이드의 문제 해결](docs/USAGE.md#문제-해결)을 보세요.
</details>

<details>
<summary><b>왜 Discord 탭이 열려 있어야 하나요?</b></summary>

크롬 확장 프로그램은 Discord 페이지가 API 요청을 보내는 순간에만 그 요청의 로그인 정보를 볼 수 있습니다. 확장 프로그램을 설치하기 전부터 열려 있던 탭은 새로고침해서 그 요청을 다시 일으켜야 합니다. 한 번 읽은 로그인 정보는 브라우저를 닫을 때까지 보관되므로 그 뒤에는 앱만 열려 있으면 됩니다. Discord에서 로그아웃하는 등 로그인이 무효가 되면 다시 읽어야 합니다.
</details>

<details>
<summary><b>다른 사람의 계정이나 대화도 내보낼 수 있나요?</b></summary>

아니요. 크롬에 로그인한 **본인 계정이 볼 수 있는 대화**만 내보낼 수 있습니다. 권한이 없는 채널은 자물쇠로 표시되고 선택할 수 없습니다. 본인 것이 아닌 계정에 쓰는 것은 [이용약관](TERMS.md)이 하지 말아 달라고 요청하는 사용입니다.
</details>

<details>
<summary><b>내보내기가 오래 걸려요</b></summary>

Discord API는 한 번에 메시지를 100개까지만 줍니다. 요청은 서버 부담을 줄이기 위해 하나씩 순서대로 보내므로, 메시지가 많을수록 오래 걸립니다(예: 10만 개는 요청이 1,000번 이상). 진행 창이 열려 있는 동안 **이 탭을 닫거나 새로고침하지 마세요.** Discord가 잠시 기다리라고 하면(속도 제한) 앱이 알아서 기다리고, 60초가 넘는 대기를 요구하면 그때까지 끝난 채널만 저장하고 멈춥니다.
</details>

<details>
<summary><b>엑셀로 CSV를 열었더니 ID가 이상해요</b></summary>

엑셀은 18~19자리 숫자를 숫자로 읽어 `1.42E+18`처럼 보여 주고, 저장하면 뒷자리가 깨질 수 있습니다. 엑셀에서 쓸 거라면 **Excel (.xlsx)** 형식을 고르세요. CSV를 꼭 엑셀로 열어야 한다면 "데이터 > 텍스트/CSV 가져오기"에서 ID 열을 텍스트로 지정하세요.
</details>

<details>
<summary><b>HTML 파일의 이미지가 안 보여요</b></summary>

첨부파일과 이미지는 파일에 담기지 않고 Discord 서버의 링크로만 들어 있습니다. 그 링크는 시간이 지나면 만료될 수 있어서 오래된 내보내기에서는 그림이 안 뜰 수 있습니다. 보관이 필요한 첨부파일은 따로 내려받아 두세요.
</details>

<details>
<summary><b>이걸 쓰면 계정이 정지되나요?</b></summary>

모릅니다. 가능성이 0이라고 말할 수 없습니다. 이 도구는 읽기 전용·순차 요청만 보내고 공식 클라이언트인 척하지 않지만, Discord가 사용자 계정의 자동화를 금지하고 있어서 제재 대상이 될 수 있고, 실제 확률은 이 프로젝트도 알지 못합니다. 잃고 싶지 않은 계정이라면 쓰지 않는 편이 안전합니다. [면책조항](DISCLAIMER.md)을 읽고 판단하세요.
</details>

<details>
<summary><b>데이터가 어딘가로 전송되나요?</b></summary>

아니요. 이 프로젝트는 서버가 없고, 분석 도구나 원격 코드도 없습니다. 데이터는 브라우저와 Discord 사이에서만 오가고, 내보낸 파일은 브라우저의 다운로드로 내 컴퓨터에 저장됩니다. 확장 프로그램 페이지의 CSP가 Discord 이외로의 요청을 막고, `npm run verify`가 이를 검사합니다.
</details>

## 개발

```bash
npm ci              # 의존성 설치 (package-lock.json 기준)
npm run dev         # http://localhost:5173/app.html?mock=1 (데모 모드)
npm test            # Vitest (jsdom 컴포넌트 테스트 포함)
npm run typecheck   # tsc --noEmit
npm run build       # 타입체크 + dist/ 생성
npm run verify      # dist/ 가 확장 프로그램으로 로드 가능한지 정적 검사 (CSP 포함)
npm run e2e         # 빌드한 확장을 실제 크롬에 올려 가짜 Discord 서버로 end-to-end 검증 (e2e/README.md)
npm run pack        # 빌드 + 검사 + discord-chat-extractor-v<버전>.zip 생성
npm run licenses    # 서드파티 라이선스 목록 갱신·확인 (THIRD_PARTY_LICENSES.md)
```

기술 스택: Manifest V3 · Vite · TypeScript(strict) · React 19 · Zustand · fflate (런타임 의존성 4개). XLSX 작성기와 ZIP 스트리밍은 직접 구현했습니다. 구조와 규칙은 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)를 보세요.

```
src/background/   서비스 워커: 토큰 캡처, 아이콘 클릭 → 앱 탭 열기
src/app/          웹앱: state(zustand), components(rail·sidebar·chat·topbar·message), i18n, styles, platform
src/lib/discord/  API 클라이언트·권한·트리·페이지네이션·데모(mock) 클라이언트
src/lib/markdown/ Discord 마크다운 파서 + React/HTML/텍스트 렌더러
src/lib/message/  메시지 의미 계층(시스템 메시지, 임베드, 시간, 묶음 규칙…)
src/lib/export/   실행기·ZIP·XLSX·파일명·형식(html/txt/md/csv/xlsx/json)
tests/            src/ 구조를 따르는 Vitest 테스트
e2e/              실제 크롬 end-to-end 시험과 문서 스크린샷 스크립트
docs/             사용 가이드, 설계 판단(DECISIONS), 구조(ARCHITECTURE), 이미지
```

문서 속 스크린샷은 데모 모드의 가상 데이터만 담고 있으며 `node e2e/screenshots.mjs`로 다시 만들 수 있습니다.

## 기여 · 보안 · 라이선스

- 기여하기: [CONTRIBUTING.md](CONTRIBUTING.md) · [행동 강령](CODE_OF_CONDUCT.md)
- 보안 문제 제보: [SECURITY.md](SECURITY.md). **공개 이슈에 토큰이나 실제 대화를 올리지 마세요.**
- 법적 문서: [이용약관](TERMS.md) · [면책조항](DISCLAIMER.md) · [개인정보 처리방침](PRIVACY.md)
- 라이선스: [MIT](LICENSE). 서드파티 라이선스는 [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md)에 있습니다.

## 상표

Discord는 Discord Inc.의 상표입니다. 이 프로젝트는 Discord와 무관한 비공식 도구이며, Discord의 후원이나 승인을 받지 않았고 Discord의 로고·자산을 사용하지 않습니다.
