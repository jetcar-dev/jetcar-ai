import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { z } from 'zod';
import { oauthConfig } from './config.js';

type OAuthConfig = ReturnType<typeof oauthConfig>;
const tokenSchema = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
  expiresAt: z.number(),
});
type Token = z.infer<typeof tokenSchema>;
const responseSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1).optional(),
  expires_in: z.coerce.number().positive(),
});

async function requestToken(config: OAuthConfig, fields: Record<string, string>) {
  const response = await fetch('https://nid.naver.com/oauth2.0/token', {
    method: 'POST',
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      ...fields,
    }),
    redirect: 'error',
    signal: AbortSignal.timeout(15_000),
  });
  const token = responseSchema.safeParse(await response.json().catch(() => null));
  if (!response.ok || !token.success) {
    throw new Error(`네이버 토큰 요청 실패(HTTP ${response.status}). 앱 설정을 확인한 뒤 npm run login을 실행하세요.`);
  }
  return token.data;
}

export async function completeLogin(config: OAuthConfig, code: string, state: string) {
  const result = await requestToken(config, { grant_type: 'authorization_code', code, state });
  if (!result.refresh_token) throw new Error('네이버가 갱신 토큰을 반환하지 않았습니다.');
  const token: Token = {
    accessToken: result.access_token,
    refreshToken: result.refresh_token,
    expiresAt: Date.now() + result.expires_in * 1000,
  };
  await mkdir(dirname(config.tokenPath), { recursive: true, mode: 0o700 });
  const temporaryPath = `${config.tokenPath}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, JSON.stringify(token), { flag: 'wx', mode: 0o600 });
    await rename(temporaryPath, config.tokenPath);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

export function createTokenProvider() {
  let cached: { login: string; accessToken: string; expiresAt: number } | undefined;
  let inFlight: Promise<string> | undefined;

  async function getToken() {
    const config = oauthConfig();
    let raw: string;
    try {
      raw = await readFile(config.tokenPath, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      throw new Error('먼저 npm run login으로 네이버 계정을 연결하세요.');
    }
    const saved = tokenSchema.parse(JSON.parse(raw));
    const minimumExpiry = Date.now() + 60_000;
    if (saved.expiresAt > minimumExpiry) return saved.accessToken;
    if (cached?.login === saved.accessToken && cached.expiresAt > minimumExpiry) return cached.accessToken;

    const result = await requestToken(config, { grant_type: 'refresh_token', refresh_token: saved.refreshToken });
    cached = {
      login: saved.accessToken,
      accessToken: result.access_token,
      expiresAt: Date.now() + result.expires_in * 1000,
    };
    return cached.accessToken;
  }

  return () => {
    inFlight ??= getToken().finally(() => { inFlight = undefined; });
    return inFlight;
  };
}
