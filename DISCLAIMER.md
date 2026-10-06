# 면책조항 · Disclaimer

> 최종 수정 / Last updated: **2026-10-06** · 적용 대상 / Applies to: Discord Chat Extractor v0.1.0 and later

**[한국어](#한국어) · [English](#english)**

관련 문서 / Related: [이용약관 · Terms of Use](TERMS.md) · [개인정보 처리방침 · Privacy Policy](PRIVACY.md) · [보안 · Security](SECURITY.md) · [LICENSE](LICENSE)

---

## 한국어

> [!WARNING]
> **먼저 읽어 주세요**
>
> - 이 프로젝트는 Discord와 **관계없는 비공식 도구**입니다. Discord Inc.가 만들거나 후원하거나 보증한 것이 아닙니다.
> - 로그인한 계정의 **사용자 토큰으로 Discord API를 직접 호출**합니다. Discord의 이용약관과 개발자 정책은 이런 사용을 허용하지 않으므로 **경고, 기능 제한, 계정 정지·삭제**를 받을 수 있습니다. 쓸지 말지와 그 결과는 전적으로 **본인 책임**입니다.
> - 소프트웨어는 **"있는 그대로(AS IS)"** 제공되며 어떤 보증도 없습니다. 계정 조치, 데이터 손실, 불완전하거나 부정확한 내보내기에 대해 작성자는 책임지지 않습니다.
> - 내보낸 파일에는 **다른 사람의 메시지와 개인정보**가 들어 있습니다. 그 보관·공유·사용이 적법한지는 사용자가 책임집니다.
> - 이 문서를 포함해 프로젝트의 어떤 문서도 **법률 자문이 아닙니다.**

### 1. 비공식 도구이며 Discord와 관계없습니다

- Discord Chat Extractor는 Discord Inc.와 제휴하거나 Discord Inc.의 후원·승인·보증을 받은 프로젝트가 아닙니다.
- "Discord"는 Discord Inc.의 상표입니다. 이 프로젝트에서 그 이름은 이 도구가 읽는 서비스를 가리키는 데에만 쓰입니다.
- 익숙하게 쓸 수 있도록 화면 구성과 색상을 Discord 다크 테마와 비슷하게 만들었지만, Discord의 로고·워드마크 같은 **Discord의 자산은 사용하지 않았습니다.** 아이콘은 직접 그렸습니다.

### 2. Discord 이용약관 위반 가능성과 계정 위험

- 이 도구는 이미 열려 있는 Discord 웹 클라이언트가 보내는 요청에서 로그인 토큰(`Authorization` 헤더)을 읽고, 그 토큰으로 사용자의 브라우저가 Discord API를 직접 호출합니다.
- Discord의 [이용약관](https://discord.com/terms)과 [개발자 정책](https://discord.com/developers/docs/policies-and-agreements/developer-policy), 그리고 일반 사용자 계정의 자동화("셀프봇")에 대한 Discord의 안내는 이런 사용을 허용하지 않습니다. 자동화된 수단으로 서비스에 접근하는 것도 제한합니다. 조항의 현재 내용은 Discord의 문서를 직접 확인하세요. 약관은 바뀔 수 있습니다.
- 그 결과 Discord가 **경고, 기능 제한, 계정 정지 또는 삭제**를 할 수 있습니다. 이 프로젝트는 실제로 제재를 받을 확률을 알지 못하며, 가능성이 0이라고 말할 수 없습니다.
- 이 위험을 이해하고 감수할 수 있을 때만 사용하세요. 잃고 싶지 않은 계정(오래 쓴 계정, 서버 관리 계정, 결제나 Nitro가 걸린 계정 등)이라면 특히 신중하세요.

### 3. 코드에 실제로 있는 위험 완화 장치와 그 한계

`src/lib/discord/api.ts`에 구현되어 있는 내용입니다.

- **읽기(GET) 요청만** 보냅니다. 메시지를 보내거나 고치거나 지우지 않습니다.
- 요청은 **한 번에 하나씩 순서대로** 보냅니다.
- Discord가 알려 주는 **속도 제한을 따릅니다**(`429`, `Retry-After`, `X-RateLimit-*`). 일시적인 오류는 지수 백오프로 몇 번 재시도합니다. 60초를 넘겨 기다려야 하는 제한을 만나면 계속 두드리지 않고 멈추며, 내보내는 중이었다면 그때까지 끝난 채널만 저장합니다.
- **공식 클라이언트인 척하지 않습니다.** 요청에는 `Authorization` 헤더만 붙이고(쿠키는 보내지 않습니다), `X-Super-Properties` 같은 헤더나 User-Agent를 흉내 내지 않습니다.
- **필요할 때만 요청합니다.** 시작할 때는 계정 확인, 서버 목록, DM 목록만 가져옵니다. 서버의 채널 목록은 그 서버를 처음 열 때, 메시지는 채널을 열거나 내보낼 때만 가져옵니다.
- 토큰은 Discord API 주소(`https://discord.com/api/…`) 밖으로는 보내지 않습니다.

한계도 분명합니다.

- 이 장치들은 위험을 **줄일 뿐 없애지 못합니다.** Discord는 이 요청이 공식 클라이언트에서 온 것이 아니라는 점을 알아볼 수 있다고 가정하세요.
- 요청 사이에 일부러 넣는 대기 시간은 없습니다. 직렬 처리와 Discord가 알려 주는 대기 시간만 따릅니다. 메시지 100개마다 요청이 한 번 나가므로, 기록이 긴 채널이나 많은 채널을 한꺼번에 내보내면 요청 수가 크게 늘어납니다.
- **실제 Discord 계정으로는 테스트하지 않았습니다.** 토큰을 다루지 않기 위해서입니다. 모킹한 요청 테스트, 데모 모드, 로컬의 가짜 Discord 서버를 쓴 end-to-end 시험으로 확인했으며, 실제 Discord에서는 동작이 다를 수 있습니다.

### 4. 보증 없음 (AS IS)

이 소프트웨어는 "있는 그대로" 제공됩니다. 상품성, 특정 목적에의 적합성, 제3자 권리의 비침해를 포함해 명시적이든 묵시적이든 어떤 보증도 하지 않습니다. 오류 없이, 중단 없이, 또는 Discord가 바뀐 뒤에도 계속 동작한다는 보증도 없습니다. 법적 효력이 있는 문구는 [LICENSE](LICENSE)(MIT)의 영문 조항입니다.

### 5. 책임의 제한

관련 법률이 허용하는 최대 범위에서, 작성자와 기여자는 이 소프트웨어를 쓰거나 쓰지 못해서 생긴 어떤 손해에도 책임지지 않습니다. 예를 들면 다음과 같습니다.

- Discord 계정에 대한 조치(경고, 기능 제한, 정지, 삭제 등)
- 데이터의 손실이나 훼손, 내보내기 실패, 불완전하거나 부정확한 내보내기
- 오용, 또는 본인 것이 아닌 계정이나 데이터에 쓴 일
- 내보낸 파일을 유출·공유·게시해서 생긴 결과(개인정보 침해, 명예훼손, 분쟁, 법적 책임 포함)
- 토큰 노출(예: 공개 이슈에 토큰을 올린 경우)과 그로 인한 계정 탈취
- Discord나 제3자와의 분쟁

법률로 제한하거나 배제할 수 없는 책임은 이 조항으로 달라지지 않습니다.

### 6. 내보내기 결과의 한계

내보낸 파일이 Discord에 있는 기록과 같다는 보증은 없습니다. 알려진 한계는 다음과 같습니다. 자세한 내용은 [docs/DECISIONS.md](docs/DECISIONS.md)(한국어)를 보세요.

- **스냅샷입니다.** 내보내는 시점의 기록이며 실시간으로 갱신하지 않습니다.
- **첨부파일은 내려받지 않고 링크만 기록합니다.** Discord CDN 링크는 시간이 지나면 만료되어 이미지와 파일이 열리지 않을 수 있습니다.
- **스레드가 빠집니다.** 사용자 토큰으로는 포럼/미디어 채널의 활성 게시글(채널당 최대 100개)만 찾을 수 있습니다. 일반 텍스트 채널 아래의 스레드는 나열되지 않고, 보관(archived)된 스레드는 제외됩니다.
- **권한에 따라 못 가져옵니다.** 계정이 볼 수 없는 채널은 내보낼 수 없습니다. 접근 권한은 역할과 채널 권한 덮어쓰기로 계산한 추정치라서 실제와 다를 수 있습니다.
- **중간에 멈출 수 있습니다.** 속도 제한(60초 초과 대기), 세션 만료(401), 저장 실패 같은 상황에서는 그때까지 끝난 채널만 저장되거나 일부 채널이 실패 목록에 남을 수 있습니다. 취소하면 자동으로 저장되지 않습니다.
- **형식별 제약이 있습니다.** CSV를 엑셀에서 열면 긴 ID가 `1.42E+18`처럼 보이고 저장하면 뒷자리가 깨질 수 있습니다. XLSX는 채널 하나를 통째로 메모리에 올려 만들기 때문에 메시지가 아주 많은 채널에는 맞지 않습니다. 한 번에 내보내는 ZIP은 약 3.75GB / 65,535개 파일까지입니다.
- **모든 요소를 재현하지는 않습니다.** 투표와 전달 메시지는 간단히만 표현하고, 서버 폴더·역할 색상 같은 것은 지원하지 않습니다.

중요한 내용은 Discord의 원본과 대조해 확인하세요.

### 7. 백업·법적 증거·컴플라이언스 도구가 아닙니다

- 개인이 편의로 쓰는 도구입니다. 공식 백업·보존 도구도, 법적 증거 수집 도구도, 규정 준수(컴플라이언스·감사·전자증거개시 등)를 위한 도구도 아닙니다.
- 내보낸 파일은 누구나 고칠 수 있는 평범한 파일입니다. 서명, 해시, 무결성 증명, 보관 이력이 없어서 **완전성과 진본성을 보장하지 않습니다.**
- 소송, 분쟁, 감사 같은 곳에 쓰려면 그에 맞는 절차와 전문가(변호사 등)의 도움이 필요하며, 필요하면 Discord가 제공하는 공식 절차를 이용하세요.

### 8. 다른 사람의 데이터와 사용자의 책임

- 내보낸 파일에는 본인의 메시지뿐 아니라 **다른 사람의 메시지, 닉네임과 사용자 이름, 사용자 ID, 아바타·첨부파일 링크** 같은 개인정보가 들어 있습니다. JSON은 Discord가 돌려준 메시지 원본 데이터 전체를 담습니다.
- 이를 어떻게 모으고, 보관하고, 보호하고, 공유·공개·삭제할지는 **사용자가 전적으로 책임집니다.** 적용될 수 있는 개인정보 보호 법령(예: 한국의 개인정보 보호법, EU의 GDPR), 서버와 커뮤니티의 규칙, 대화 상대의 동의 여부를 사용자가 스스로 확인하고 지켜야 합니다.
- 파일을 보관하거나 보낼 때는 암호화와 접근 제한 같은 안전 조치를 하세요. 내보낸 HTML 파일은 열 때 Discord의 이미지 서버에 요청을 보냅니다. 자세한 내용은 [PRIVACY.md](PRIVACY.md)를 보세요.
- 다른 사람의 대화를 공개 게시하거나 판매하거나 괴롭힘·감시에 쓰는 것은 프로젝트가 지원하지 않는 사용입니다([TERMS.md](TERMS.md)).

### 9. 법률 자문이 아닙니다

이 문서와 이용약관, 개인정보 처리방침은 작성자가 선의로 쓴 안내입니다. 법률 자문이 아니며, 사용자가 사는 곳의 법률에 맞는다는 보장도 없습니다. 법적 판단이 필요하면 전문가와 상의하세요.

### 10. 지원의 한계

- 작성자와 기여자는 Discord 계정에 대한 조치(제재 해제, 이의 제기 등)를 도울 수 없고, Discord와 대신 연락해 줄 수도 없습니다. 계정 문제는 Discord 지원 센터에 문의하세요.
- 무상으로 제공하는 프로젝트이며 지원이나 업데이트를 약속하지 않습니다. Discord가 API나 웹 클라이언트를 바꾸면 이 도구는 언제든 동작하지 않을 수 있습니다([TERMS.md](TERMS.md) 6조).

### 11. 다른 문서와의 관계, 변경

- 소스 코드의 이용 조건은 [LICENSE](LICENSE)(MIT)가 정합니다. 이 문서는 그 권리를 제한하지 않으며, 위험과 책임의 범위를 알리는 문서입니다.
- [이용약관](TERMS.md), [개인정보 처리방침](PRIVACY.md)과 함께 읽어 주세요. 코드의 사용·복제·수정·배포 권리에 관해 내용이 충돌하면 LICENSE가 우선합니다.
- 이 문서는 바뀔 수 있습니다. 최종 수정일은 맨 위에 적고, 변경 이력은 저장소의 git 기록으로 확인할 수 있습니다.
- 문의는 [GitHub Issues](https://github.com/LanturnHouse/discord-chat-extractor/issues)로 해 주세요. 토큰이나 개인적인 대화 내용은 올리지 마세요.

---

## English

> [!WARNING]
> **Please read this first**
>
> - This project is an **unofficial tool and has no connection to Discord**. It was not made, sponsored or endorsed by Discord Inc.
> - It calls the Discord API directly **with the user token of the account you are logged in with**. Discord's Terms of Service and Developer Policy do not allow this, so you can receive **warnings, restrictions, or have your account suspended or terminated**. Whether to use it, and what follows, is **entirely your own risk**.
> - The software is provided **"AS IS"** without warranty of any kind. The authors are not responsible for account actions, data loss, or incomplete or inaccurate exports.
> - Exported files contain **other people's messages and personal data**. You alone are responsible for keeping, sharing and using them lawfully.
> - Nothing in this document, or in any other document of the project, is **legal advice**.

### 1. Unofficial tool, not affiliated with Discord

- Discord Chat Extractor is not affiliated with, and is not sponsored or endorsed by, Discord Inc.
- "Discord" is a trademark of Discord Inc. In this project the name is used only to refer to the service this tool reads from.
- The screens are laid out and coloured to look like Discord's dark theme so that they feel familiar, but **no Discord assets are used**: no Discord logo, wordmark or other artwork. The icons were drawn for this project.

### 2. Possible breach of Discord's Terms and risk to your account

- The tool reads your login token (the `Authorization` header) from requests that an already-open Discord web client sends, and your browser then calls the Discord API directly with that token.
- Discord's [Terms of Service](https://discord.com/terms), its [Developer Policy](https://discord.com/developers/docs/policies-and-agreements/developer-policy) and its guidance on automating regular user accounts ("self-bots") do not allow this, and the Terms also restrict accessing the service by automated means. Check Discord's documents yourself for the current wording; they can change.
- As a result Discord may issue **warnings, restrict features, or suspend or delete your account**. The project does not know how likely it is that anyone is actually sanctioned, and cannot say that the chance is zero.
- Use the tool only if you understand and accept that risk. Be especially careful with an account you cannot afford to lose (a long-standing account, a server-admin account, an account with payments or Nitro).

### 3. Mitigations that really exist in the code, and their limits

These are implemented in `src/lib/discord/api.ts`.

- **Read-only (GET) requests.** The tool never sends, edits or deletes messages.
- Requests are sent **one at a time, in order**.
- **Rate limits are honoured** (`429`, `Retry-After`, `X-RateLimit-*`). Transient errors are retried a few times with exponential back-off. If Discord asks for a wait longer than 60 seconds the tool stops instead of hammering the API; during an export, only the channels finished by then are saved.
- **It does not pretend to be the official client.** Requests carry the `Authorization` header only (no cookies are sent), and nothing imitates headers such as `X-Super-Properties` or a User-Agent.
- **It only asks for what it needs.** At start-up it fetches the account check, the server list and the DM list. A server's channel list is fetched the first time you open that server, and messages only when you open a channel or export it.
- The token is never sent outside the Discord API address (`https://discord.com/api/...`).

The limits are just as clear.

- These measures **reduce the risk; they do not remove it.** Assume that Discord can tell these requests do not come from its own client.
- There is no deliberate pause between requests; the tool relies on serial processing and on the waits Discord announces. One request goes out for every 100 messages, so exporting a long channel or many channels at once means a large number of requests.
- **The tool has not been tested with a real Discord account**, so that no token had to be handled. It was checked with mocked-request tests, the demo mode, and an end-to-end test against a local fake Discord server. Behaviour on real Discord may differ.

### 4. No warranty (AS IS)

The software is provided "as is". There is no warranty of any kind, express or implied, including merchantability, fitness for a particular purpose and non-infringement. There is also no warranty that it works without errors or interruption, or that it keeps working after Discord changes. The legally operative wording is the English text of the [LICENSE](LICENSE) (MIT).

### 5. Limitation of liability

To the maximum extent permitted by applicable law, the authors and contributors are not liable for any loss arising from using or not being able to use this software. This includes, for example:

- action against your Discord account (warning, restriction, suspension, deletion, and so on)
- loss or corruption of data, failed exports, and incomplete or inaccurate exports
- misuse, or use on accounts or data that are not yours
- the consequences of leaking, sharing or publishing exported files (including privacy violations, defamation, disputes and legal liability)
- exposure of your token (for example by posting it in a public issue) and any account takeover that follows
- disputes with Discord or with third parties

Liability that cannot be limited or excluded by law is not changed by this section.

### 6. Limits of the export

There is no guarantee that an exported file matches what is stored on Discord. The known limits are listed below; the details are in [docs/DECISIONS.md](docs/DECISIONS.md) (Korean).

- **It is a snapshot.** The export reflects the moment you run it and is not updated live.
- **Attachments are not downloaded; only their links are recorded.** Discord CDN links expire after a while, so images and files may stop opening.
- **Threads are missing.** With a user token only the active posts of forum/media channels can be found (at most 100 per channel). Threads under ordinary text channels are not listed, and archived threads are excluded.
- **Permissions limit what can be fetched.** Channels your account cannot see cannot be exported. Access is estimated from roles and channel permission overwrites and can differ from reality.
- **An export can stop part-way.** A rate limit (a wait over 60 seconds), an expired session (401) or a failed save may leave only the channels finished so far saved, or some channels on the failure list. Cancelling saves nothing automatically.
- **Formats have limits.** Opened in Excel, a CSV shows long IDs as `1.42E+18` and saving can corrupt their trailing digits. XLSX is built with a whole channel in memory, so it is not suitable for channels with a very large number of messages. A single ZIP can hold about 3.75 GB / 65,535 files.
- **Not every element is reproduced.** Polls and forwarded messages are shown in a simplified form, and things such as server folders and role colours are not supported.

Check anything important against the original on Discord.

### 7. Not a backup, legal-evidence or compliance tool

- It is a convenience tool for individuals. It is not an official backup or archiving tool, not a tool for collecting legal evidence, and not a tool for compliance, audit or e-discovery.
- An exported file is an ordinary file anyone can edit. It has no signature, hash, integrity proof or chain of custody, so **completeness and authenticity are not guaranteed.**
- For litigation, disputes or audits you need proper procedures and professional help (a lawyer, for example), and where appropriate the official processes Discord itself offers.

### 8. Other people's data and your responsibility

- Exported files contain not only your own messages but also **other people's messages, nicknames and usernames, user IDs, and avatar and attachment links**. The JSON export contains the full raw message data as Discord returned it.
- **You alone are responsible** for how you collect, store, protect, share, publish and delete this data. You must find out for yourself, and comply with, any data-protection laws that may apply (for example Korea's Personal Information Protection Act or the EU GDPR), the rules of the servers and communities concerned, and whether the people involved have consented.
- Protect files you keep or send, for example with encryption and access control. An exported HTML file contacts Discord's image servers when it is opened; see [PRIVACY.md](PRIVACY.md).
- Publishing or selling other people's conversations, or using them for harassment or surveillance, is a use the project does not support ([TERMS.md](TERMS.md)).

### 9. Not legal advice

This document, the Terms of Use and the Privacy Policy are good-faith information written by the authors. They are not legal advice, and there is no guarantee that they fit the law where you live. Ask a professional if you need a legal opinion.

### 10. Limits of support

- The authors and contributors cannot help with actions against your Discord account (lifting a sanction, appeals) and cannot contact Discord on your behalf. Take account problems to Discord's support.
- This is a free project with no promise of support or updates. If Discord changes its API or web client the tool may stop working at any time ([TERMS.md](TERMS.md), section 6).

### 11. Relation to other documents, changes

- The terms for using the source code are set by the [LICENSE](LICENSE) (MIT). This document does not restrict those rights; it explains the risks and the limits of responsibility.
- Read it together with the [Terms of Use](TERMS.md) and the [Privacy Policy](PRIVACY.md). If they conflict on the rights to use, copy, modify and distribute the code, the LICENSE prevails.
- This document may change. The date of the last change is at the top, and the history is in the repository's git log.
- Questions go to [GitHub Issues](https://github.com/LanturnHouse/discord-chat-extractor/issues). Never post tokens or private conversations there.
