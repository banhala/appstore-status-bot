import type { AscClient } from './client.js';
import type { AppStatus, PhasedState, VersionState } from '../state/types.js';
import { isPhasedState, isVersionState } from '../state/types.js';

// JSON:API 최소 타입
interface Resource {
  type: string;
  id: string;
  attributes?: Record<string, unknown>;
  relationships?: Record<string, { data?: { type: string; id: string } | null } | undefined>;
}
interface AppsResponse {
  data: Resource[];
}
interface VersionsResponse {
  data: Resource[];
  included?: Resource[];
  meta?: { paging?: { total?: number } };
}

// appVersionState 신규 표기 → 내부(appStoreState) 표기 정규화
const RENAMED: Record<string, VersionState> = {
  READY_FOR_DISTRIBUTION: 'READY_FOR_SALE',
  PROCESSING_FOR_DISTRIBUTION: 'PROCESSING_FOR_APP_STORE',
};

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined;

const asNumber = (value: unknown): number | undefined =>
  typeof value === 'number' ? value : undefined;

const normalizeState = (raw: string | undefined): VersionState | undefined => {
  if (raw === undefined) {
    return undefined;
  }
  const mapped = RENAMED[raw] ?? raw;
  return isVersionState(mapped) ? mapped : undefined;
};

const resolveIncluded = (
  included: Resource[] | undefined,
  ref: { type: string; id: string } | null | undefined,
): Resource | undefined => {
  if (!ref || !included) {
    return undefined;
  }
  return included.find(item => item.type === ref.type && item.id === ref.id);
};

// build.iconAssetToken.templateUrl → 340x340 png URL (없으면 빈 문자열)
const buildIconUrl = (build: Resource | undefined): string => {
  const token = build?.attributes?.['iconAssetToken'] as { templateUrl?: string } | undefined;
  const template = token?.templateUrl;
  if (template === undefined) {
    return '';
  }
  return template.replace('{w}', '340').replace('{h}', '340').replace('{f}', 'png');
};

// DEBUG=true일 때 버전 목록을 슬림 요약(raw JSON 대신 필요한 필드만)
const logVersionsSummary = (versions: VersionsResponse): void => {
  const total = versions.meta?.paging?.total;
  console.log(`[ASC:debug] 버전 ${versions.data.length}개 (총 ${total ?? '?'})`);
  for (const version of versions.data) {
    const attributes = version.attributes ?? {};
    const state =
      asString(attributes['appStoreState']) ?? asString(attributes['appVersionState']) ?? '?';
    const phased = resolveIncluded(
      versions.included,
      version.relationships?.['appStoreVersionPhasedRelease']?.data,
    )?.attributes;
    const phasedPart = phased
      ? `${asString(phased['phasedReleaseState']) ?? '?'}(${asNumber(phased['currentDayNumber']) ?? 0})`
      : 'none';
    const buildVersion = asString(
      resolveIncluded(versions.included, version.relationships?.['build']?.data)?.attributes?.[
        'version'
      ],
    );
    console.log(
      `  ${asString(attributes['versionString']) ?? '?'}  ${state}  phased=${phasedPart}  build=${buildVersion ?? '-'}`,
    );
  }
};

const fetchOne = async (
  client: AscClient,
  bundleId: string,
  debug: boolean,
): Promise<AppStatus | undefined> => {
  const apps = await client.get<AppsResponse>('/v1/apps', { 'filter[bundleId]': bundleId });
  const app = apps.data[0];
  if (app === undefined) {
    console.warn(`[ASC] 번들 ${bundleId}에 해당하는 앱 없음 — 건너뜀`);
    return undefined;
  }
  const name = asString(app.attributes?.['name']) ?? bundleId;
  if (debug) {
    console.log(`[ASC:debug] 앱 ${name} (${app.id})`);
  }

  const versions = await client.get<VersionsResponse>(`/v1/apps/${app.id}/appStoreVersions`, {
    'filter[platform]': 'IOS',
    include: ['build', 'appStoreVersionPhasedRelease'],
    limit: '20',
  });
  if (debug) {
    logVersionsSummary(versions);
  }

  // 최신 생성 순 정렬
  const sorted = [...versions.data].sort((a, b) =>
    (asString(b.attributes?.['createdDate']) ?? '').localeCompare(
      asString(a.attributes?.['createdDate']) ?? '',
    ),
  );

  const candidates = sorted
    .map(version => {
      const raw =
        asString(version.attributes?.['appStoreState']) ??
        asString(version.attributes?.['appVersionState']);
      const state = normalizeState(raw);
      if (raw !== undefined && state === undefined) {
        console.warn(`[ASC] 알 수 없는 상태값 '${raw}' — 무시(정규화 맵 갱신 필요)`);
      }
      return { version, state };
    })
    .filter((entry): entry is { version: Resource; state: VersionState } => entry.state !== undefined);

  // 최신 생성 버전을 report 대상으로 채택. 정상 릴리즈 플로우에선 in-flight 버전이 곧 최신.
  // ⚠️ 알려진 한계: 핫픽스가 이전 버전 phased rollout 중에 진행되면 핫픽스(최신)만 추적.
  const primary = candidates[0];
  if (primary === undefined) {
    console.warn(`[ASC] ${bundleId}: iOS App Store 버전이 하나도 없음 — 건너뜀`);
    return undefined;
  }

  const { version, state } = primary;

  const phased = resolveIncluded(
    versions.included,
    version.relationships?.['appStoreVersionPhasedRelease']?.data,
  );
  const phasedRaw = asString(phased?.attributes?.['phasedReleaseState']);
  const phasedState: PhasedState =
    phasedRaw !== undefined && isPhasedState(phasedRaw) ? phasedRaw : 'NOT_EXIST';
  const phasedCurrentDay = asNumber(phased?.attributes?.['currentDayNumber']) ?? 0;

  const build = resolveIncluded(versions.included, version.relationships?.['build']?.data);

  return {
    appId: app.id,
    name,
    version: asString(version.attributes?.['versionString']) ?? '',
    state,
    iconUrl: buildIconUrl(build),
    phasedState,
    phasedCurrentDay,
  };
};

/** 번들 ID별 현재 App Store 상태 조회·정규화 */
export const fetchAppStatuses = async (
  client: AscClient,
  bundleIds: string[],
  debug = false,
): Promise<AppStatus[]> => {
  const results: AppStatus[] = [];
  for (const bundleId of bundleIds) {
    const status = await fetchOne(client, bundleId, debug);
    if (status !== undefined) {
      results.push(status);
    }
  }
  return results;
};
