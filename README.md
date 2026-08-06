# appstore-status-bot

> update date: 2026-08-06

App Store Connect의 **앱 심사·배포 상태 변화를 감지해 Slack으로 알리는 봇**입니다.
순수 TypeScript로 App Store Connect REST API(JWT 인증)를 직접 호출하며, 런타임 의존성이 없습니다.

## 동작 방식

트리거: cron(명목 5분, GitHub 스로틀로 실제 ~30-50분) / iOS 릴리즈 직후 repository_dispatch / 수동 실행

1. App Store Connect 조회 → 최신 버전의 심사 상태·점진적 배포 상태 정규화
2. 직전 상태(secret gist)와 비교(diff) — 변화가 있을 때만 알림
3. Slack 전송 (심사 단계 / 점진적 배포 진행률)
4. 상태 저장(gist)

세 트리거가 모두 같은 일을 합니다. dispatch는 릴리즈 직후 한 번을 앞당길 뿐이고,
들어오지 않아도 cron이 계속 추적합니다. 상태가 그대로면 조회만 하고 조용히 끝나므로
알림 노이즈는 diff가 걸러 줍니다.

### 알림 메시지

- **심사 단계**: 제출 준비 중 / 심사 대기 중 / 심사 중 / 거부됨 / 메타데이터 거부됨 등
- **점진적 배포**: 1% → 2% → 5% → 10% → 20% → 50% → 100% 진행률, 완료/중단
- 메시지 앞에 지정한 Slack subteam을 멘션하고, App Store Connect 카드(버전·상태·아이콘)를 첨부

## 환경변수 / 시크릿

GitHub Actions Secrets에 등록합니다.

| 키 | 설명 | 필수 |
|---|---|---|
| `KEY_ID` | App Store Connect API Key ID | ✅ |
| `ISSUER_ID` | App Store Connect Issuer ID | ✅ |
| `PRIVATE_KEY` | `.p8` 키 본문 (여러 줄 또는 `\n` 이스케이프 모두 지원) | ✅ |
| `BUNDLE_ID` | 대상 번들 ID (콤마로 여러 개 지정 가능) | ✅ |
| `SLACK_WEB_CLIENT_API_KEY` | Slack Bot 토큰 | ✅ |
| `CHANNEL_R` | 알림 채널 ID | ✅ |
| `GIST_ID` | 상태 저장용 secret gist ID | ✅ |
| `GH_TOKEN` | gist 접근 PAT (`gist` 스코프) | ✅ |
| `MENTION_GROUP_IDS` | 멘션할 subteam ID 목록(콤마). 없으면 `GROUP_ID_P` 사용 | 선택 |
| `DRY_RUN` | `true`면 Slack 미발송(조회·판정만) | 선택 |
| `SUMMARY` | ASC 응답 로그. 기본 슬림 요약, `false`면 전체 raw 출력 | 선택 |

## 상태 저장

직전 상태는 **secret gist**(`GIST_ID`)에 `status.json` 파일로 저장합니다. 변화가 있을 때만 CI에서
gist를 갱신하며, **로컬 실행 시에는 쓰지 않습니다**(읽기만, 없으면 기본값). gist ID가 시크릿이라
레포가 public이어도 심사 상태가 레포에 노출되지 않습니다. `apps` 키가 없는 내용은 기본값으로
폴백 후 첫 실행에 재기록됩니다.

gist 쓰기는 소유자만 가능합니다. `GH_TOKEN`은 반드시 해당 gist를 소유한 계정에서 발급해야 합니다.

## 로컬 실행 / 디버그

```bash
npm install

# dry 실행 (Slack 미발송, ASC 응답 슬림 요약 출력)
DRY_RUN=true \
KEY_ID=... ISSUER_ID=... PRIVATE_KEY="$(cat AuthKey_XXXX.p8)" \
BUNDLE_ID=com.example.app \
SLACK_WEB_CLIENT_API_KEY=dummy CHANNEL_R=dummy \
npm start
# 전체 raw 응답을 보려면 SUMMARY=false 추가
```

`DRY_RUN=true`면 알림은 콘솔에만 출력됩니다. 로컬 실행은 gist를 읽기만 하고 쓰지 않습니다.

## 개발

```bash
npm run typecheck   # 타입 체크 (tsc --noEmit)
npm test            # 단위·통합 테스트 (vitest)
```

## 구조

```
src/
  index.ts          # 오케스트레이션 (조회 → diff → 알림 → 저장)
  config/env.ts     # 환경변수 로딩·검증
  asc/
    jwt.ts          # ES256 JWT 발급
    client.ts       # ASC REST 클라이언트
    appStatus.ts    # 버전 조회 + 상태 정규화
  diff/diff.ts      # 직전 상태 대비 변화 판정
  notify/
    messages.ts     # 상태 → 한국어 문구·라벨·색상
    slack.ts        # Slack 전송
  state/
    types.ts        # 상태 타입·enum
    store.ts        # 상태 gist 로드/저장
.github/workflows/poll.yml
```

상태(`status.json`)는 레포가 아니라 secret gist에 보관됩니다.
