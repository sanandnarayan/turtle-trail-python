const SESSION_COOKIE = "turtle_session";
const MAGIC_LINK_COOKIE = "turtle_magic";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
const MAGIC_LINK_TTL_MS = 15 * 60 * 1000;
const MAX_JSON_BYTES = 600_000;
const MAX_PROGRESS_ENTRIES = 150;
const COURSE_KEYS = new Set(["turtle-basics", "clock-quest"]);

type DatabaseRunResult = {
  success: boolean;
  meta?: { changes?: number };
};

export type DatabaseStatement = {
  bind(...values: unknown[]): DatabaseStatement;
  first<T>(): Promise<T | null>;
  run(): Promise<DatabaseRunResult>;
};

export type Database = {
  prepare(query: string): DatabaseStatement;
};

export type ApiEnv = {
  DB: Database;
  RESEND_API_KEY?: string;
  RESEND_FROM_EMAIL?: string;
};

type ApiContext = {
  waitUntil(promise: Promise<unknown>): void;
};

type SessionUser = {
  id: string;
  email: string;
};

type MagicLinkRow = {
  email: string;
  return_path: string;
  expires_at: number;
  used_at: number | null;
};

type ProgressRow = {
  progress_json: string;
  updated_at: number;
};

class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const json = (body: unknown, status = 200, headers?: HeadersInit) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
      "x-content-type-options": "nosniff",
      ...headers,
    },
  });

const redirect = (location: string, cookies?: string | string[]) => {
  const headers = new Headers({
    "cache-control": "no-store",
    location,
    "referrer-policy": "no-referrer",
  });
  if (cookies) {
    for (const cookie of Array.isArray(cookies) ? cookies : [cookies]) {
      headers.append("set-cookie", cookie);
    }
  }
  return new Response(null, { status: 302, headers });
};

const magicLinkPage = (token: string | null, confirmationCookie?: string) => {
  const valid = token !== null;
  const content = valid
    ? `<p>Your email link is valid. Continue to securely sign in and synchronize your Python work.</p><form method="post" action="/api/auth/verify"><input type="hidden" name="token" value="${token}"><button type="submit">Continue to Turtle Trail</button></form>`
    : `<p>This sign-in link is invalid, expired, or has already been used.</p><a href="/">Return to Turtle Trail</a>`;
  const headers = new Headers({
    "cache-control": "no-store",
    "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    "content-type": "text/html; charset=utf-8",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
  });
  if (confirmationCookie) headers.append("set-cookie", confirmationCookie);
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${valid ? "Confirm sign-in" : "Sign-in link expired"} · Turtle Trail</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;padding:20px;box-sizing:border-box;color:#17243d;background:radial-gradient(circle at 20% 0,#e6f8eb,transparent 32rem),#f5f8ff;font-family:ui-rounded,system-ui,sans-serif}.card{width:min(460px,100%);padding:34px;box-sizing:border-box;border:1px solid #dce5f4;border-radius:24px;background:#fff;box-shadow:0 28px 70px #18233c25}.mark{width:50px;height:50px;display:grid;place-items:center;border-radius:16px;color:#20643a;background:#daf5e3;font-size:25px}h1{margin:22px 0 10px;font-size:1.8rem;letter-spacing:-.035em}p{margin:0;color:#65728a;line-height:1.65}button,a{min-height:46px;margin-top:24px;padding:12px 18px;display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box;border:1px solid #23763f;border-radius:12px;color:#fff;background:#278849;font:inherit;font-weight:800;text-decoration:none;cursor:pointer}button:hover,a:hover{background:#2e9c55}button:focus-visible,a:focus-visible{outline:3px solid #79d996;outline-offset:3px}</style></head><body><main class="card"><div class="mark" aria-hidden="true">🐢</div><h1>${valid ? "Confirm your sign-in" : "That link has expired"}</h1>${content}</main></body></html>`,
    { status: valid ? 200 : 400, headers },
  );
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isProgressId = (value: unknown): value is string =>
  typeof value === "string" && /^[a-z0-9-]{1,100}$/.test(value);

const bytesToHex = (bytes: ArrayBuffer) =>
  Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");

const hash = async (value: string) =>
  bytesToHex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));

const randomToken = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
};

const parseCookies = (request: Request) => {
  const cookies = new Map<string, string>();
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const separator = part.indexOf("=");
    if (separator < 1) continue;
    const name = part.slice(0, separator).trim();
    const rawValue = part.slice(separator + 1).trim();
    try {
      cookies.set(name, decodeURIComponent(rawValue));
    } catch {
      // Ignore malformed cookies instead of rejecting the whole request.
    }
  }
  return cookies;
};

const sessionCookie = (token: string, requestUrl: URL) => {
  const secure = requestUrl.protocol === "https:" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}${secure}`;
};

const clearSessionCookie = (requestUrl: URL) => {
  const secure = requestUrl.protocol === "https:" ? "; Secure" : "";
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
};

const magicLinkCookie = (tokenHash: string, requestUrl: URL) => {
  const secure = requestUrl.protocol === "https:" ? "; Secure" : "";
  return `${MAGIC_LINK_COOKIE}=${tokenHash}; Path=/api/auth/verify; HttpOnly; SameSite=Strict; Max-Age=${MAGIC_LINK_TTL_MS / 1000}${secure}`;
};

const clearMagicLinkCookie = (requestUrl: URL) => {
  const secure = requestUrl.protocol === "https:" ? "; Secure" : "";
  return `${MAGIC_LINK_COOKIE}=; Path=/api/auth/verify; HttpOnly; SameSite=Strict; Max-Age=0${secure}`;
};

const requireSameOrigin = (request: Request) => {
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) {
    throw new ApiError(403, "This request must come from Turtle Trail.");
  }
};

const readJson = async (request: Request) => {
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_JSON_BYTES) {
    throw new ApiError(413, "That request is too large.");
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_JSON_BYTES) {
    throw new ApiError(413, "That request is too large.");
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ApiError(400, "Send valid JSON.");
  }
};

const normalizedEmail = (value: unknown) => {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  if (
    email.length < 3 ||
    email.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  ) {
    return null;
  }
  return email;
};

const safeReturnPath = (value: unknown) =>
  value === "/clock" ? "/clock" : "/";

const clientIpHash = async (request: Request) => {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const address = request.headers.get("cf-connecting-ip") ?? forwarded ?? "unknown";
  return hash(address);
};

const getSession = async (request: Request, env: ApiEnv): Promise<SessionUser | null> => {
  const token = parseCookies(request).get(SESSION_COOKIE);
  if (!token || token.length > 200) return null;
  const tokenHash = await hash(token);
  return env.DB.prepare(
    `SELECT users.id, users.email
       FROM sessions
       JOIN users ON users.id = sessions.user_id
      WHERE sessions.token_hash = ? AND sessions.expires_at > ?`,
  )
    .bind(tokenHash, Date.now())
    .first<SessionUser>();
};

const sendMagicLink = async (
  env: ApiEnv,
  email: string,
  signInUrl: string,
) => {
  if (!env.RESEND_API_KEY || !env.RESEND_FROM_EMAIL) {
    throw new ApiError(503, "Email sign-in is not configured yet.");
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.RESEND_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from: env.RESEND_FROM_EMAIL,
      to: [email],
      subject: "Your Turtle Trail sign-in link",
      text: `Open this link to sign in to Turtle Trail and sync your Python progress:\n\n${signInUrl}\n\nThis link expires in 15 minutes and can only be used once.`,
      html: `<!doctype html><html><body style="margin:0;padding:32px;background:#f5f8ff;color:#17243d;font-family:Arial,sans-serif"><div style="max-width:520px;margin:auto;padding:30px;border:1px solid #dce5f4;border-radius:18px;background:white"><h1 style="margin:0 0 12px;font-size:24px">Continue your Python trail</h1><p style="line-height:1.6">Use this one-time link to sign in and sync your lesson answers and progress.</p><p style="margin:28px 0"><a href="${signInUrl}" style="display:inline-block;padding:13px 20px;border-radius:10px;background:#257a46;color:white;font-weight:700;text-decoration:none">Sign in to Turtle Trail</a></p><p style="color:#65728a;font-size:13px;line-height:1.5">This link expires in 15 minutes. If you did not request it, you can ignore this email.</p></div></body></html>`,
    }),
  });

  if (!response.ok) {
    console.warn("Resend rejected a Turtle Trail sign-in email", response.status);
    throw new ApiError(503, "The sign-in email could not be sent. Please try again.");
  }
};

const cleanupExpiredAuth = async (db: Database, now: number) => {
  await db.prepare("DELETE FROM sessions WHERE expires_at <= ?").bind(now).run();
  await db
    .prepare("DELETE FROM magic_links WHERE expires_at <= ? OR created_at < ?")
    .bind(now, now - 24 * 60 * 60 * 1000)
    .run();
};

const requestMagicLink = async (request: Request, env: ApiEnv, ctx: ApiContext) => {
  requireSameOrigin(request);
  const body = await readJson(request);
  const email = normalizedEmail(isRecord(body) ? body.email : null);
  if (!email) throw new ApiError(400, "Enter a valid email address.");
  const returnPath = safeReturnPath(isRecord(body) ? body.returnTo : null);

  if (!env.RESEND_API_KEY || !env.RESEND_FROM_EMAIL) {
    throw new ApiError(503, "Email sign-in is not configured yet.");
  }

  const now = Date.now();
  const ipHash = await clientIpHash(request);
  const recent = await env.DB.prepare(
    `SELECT
       (SELECT COUNT(*) FROM magic_links WHERE email = ? AND created_at > ?) AS email_count,
       (SELECT COUNT(*) FROM magic_links WHERE ip_hash = ? AND created_at > ?) AS ip_count`,
  )
    .bind(email, now - MAGIC_LINK_TTL_MS, ipHash, now - MAGIC_LINK_TTL_MS)
    .first<{ email_count: number; ip_count: number }>();

  const genericResponse = {
    ok: true,
    message: "If that address can receive mail, a sign-in link is on the way.",
  };
  if ((recent?.email_count ?? 0) >= 3 || (recent?.ip_count ?? 0) >= 12) {
    return json(genericResponse);
  }

  const token = randomToken();
  const tokenHash = await hash(token);
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO magic_links
      (id, email, token_hash, return_path, expires_at, used_at, created_at, ip_hash)
     VALUES (?, ?, ?, ?, ?, NULL, ?, ?)`,
  )
    .bind(id, email, tokenHash, returnPath, now + MAGIC_LINK_TTL_MS, now, ipHash)
    .run();

  const verifyUrl = new URL("/api/auth/verify", request.url);
  verifyUrl.searchParams.set("token", token);
  try {
    await sendMagicLink(env, email, verifyUrl.toString());
  } catch (error) {
    await env.DB.prepare("DELETE FROM magic_links WHERE id = ?").bind(id).run();
    throw error;
  }

  ctx.waitUntil(cleanupExpiredAuth(env.DB, now));
  return json(genericResponse);
};

const validMagicToken = (value: unknown) =>
  typeof value === "string" && /^[A-Za-z0-9_-]{20,200}$/.test(value)
    ? value
    : null;

const findMagicLink = async (env: ApiEnv, token: string) =>
  env.DB.prepare(
    `SELECT email, return_path, expires_at, used_at
       FROM magic_links
      WHERE token_hash = ?`,
  )
    .bind(await hash(token))
    .first<MagicLinkRow>();

const verifyMagicLink = async (request: Request, env: ApiEnv) => {
  const url = new URL(request.url);
  if (request.method === "GET") {
    const token = validMagicToken(url.searchParams.get("token"));
    if (!token) return magicLinkPage(null);
    const link = await findMagicLink(env, token);
    const usable = link && link.used_at === null && link.expires_at > Date.now();
    return magicLinkPage(
      usable ? token : null,
      usable ? magicLinkCookie(await hash(token), url) : undefined,
    );
  }

  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > 10_000) {
    throw new ApiError(413, "That request is too large.");
  }
  const form = await request.formData();
  const token = validMagicToken(form.get("token"));
  if (!token) {
    return redirect("/?auth=invalid", clearMagicLinkCookie(url));
  }
  const tokenHash = await hash(token);
  const confirmedTokenHash = parseCookies(request).get(MAGIC_LINK_COOKIE);
  if (confirmedTokenHash !== tokenHash) {
    return redirect("/?auth=invalid", clearMagicLinkCookie(url));
  }
  const now = Date.now();
  const link = await findMagicLink(env, token);

  if (!link || link.used_at !== null || link.expires_at <= now) {
    return redirect("/?auth=invalid", clearMagicLinkCookie(url));
  }

  const consumed = await env.DB.prepare(
    `UPDATE magic_links
        SET used_at = ?
      WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?`,
  )
    .bind(now, tokenHash, now)
    .run();
  if ((consumed.meta?.changes ?? 0) !== 1) {
    return redirect("/?auth=invalid", clearMagicLinkCookie(url));
  }

  const user = await env.DB.prepare(
    `INSERT INTO users (id, email, created_at, last_login_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(email) DO UPDATE SET last_login_at = excluded.last_login_at
     RETURNING id, email`,
  )
    .bind(crypto.randomUUID(), link.email, now, now)
    .first<SessionUser>();
  if (!user) throw new ApiError(500, "The account could not be created.");

  const sessionToken = randomToken();
  await env.DB.prepare(
    `INSERT INTO sessions (token_hash, user_id, expires_at, created_at)
     VALUES (?, ?, ?, ?)`,
  )
    .bind(
      await hash(sessionToken),
      user.id,
      now + SESSION_TTL_SECONDS * 1000,
      now,
    )
    .run();

  const destination = safeReturnPath(link.return_path);
  const separator = destination.includes("?") ? "&" : "?";
  return redirect(
    `${destination}${separator}auth=signed-in`,
    [sessionCookie(sessionToken, url), clearMagicLinkCookie(url)],
  );
};

const sessionResponse = async (request: Request, env: ApiEnv) => {
  const user = await getSession(request, env);
  return json({ user });
};

const logout = async (request: Request, env: ApiEnv) => {
  requireSameOrigin(request);
  const url = new URL(request.url);
  const token = parseCookies(request).get(SESSION_COOKIE);
  if (token && token.length <= 200) {
    await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?")
      .bind(await hash(token))
      .run();
  }
  return json({ ok: true }, 200, { "set-cookie": clearSessionCookie(url) });
};

const normalizedProgress = (value: unknown) => {
  if (!isRecord(value)) throw new ApiError(400, "Progress must be an object.");
  if (
    !Array.isArray(value.completed) ||
    value.completed.length > MAX_PROGRESS_ENTRIES ||
    !value.completed.every(isProgressId) ||
    !Number.isInteger(value.unlocked) ||
    (value.unlocked as number) < 0 ||
    (value.unlocked as number) > MAX_PROGRESS_ENTRIES ||
    !Number.isInteger(value.current) ||
    (value.current as number) < 0 ||
    (value.current as number) > MAX_PROGRESS_ENTRIES ||
    (value.current as number) > (value.unlocked as number) ||
    !isRecord(value.drafts) ||
    Object.keys(value.drafts).length > MAX_PROGRESS_ENTRIES
  ) {
    throw new ApiError(400, "Progress has an invalid shape.");
  }

  const drafts: Record<string, string> = {};
  for (const [id, draft] of Object.entries(value.drafts)) {
    if (!isProgressId(id) || typeof draft !== "string" || draft.length > 20_000) {
      throw new ApiError(400, "A saved answer is invalid.");
    }
    drafts[id] = draft;
  }

  return {
    completed: [...new Set(value.completed as string[])],
    unlocked: value.unlocked as number,
    current: value.current as number,
    drafts,
  };
};

const progressRoute = async (
  request: Request,
  env: ApiEnv,
  course: string,
) => {
  if (!COURSE_KEYS.has(course)) throw new ApiError(404, "Course not found.");
  const user = await getSession(request, env);
  if (!user) throw new ApiError(401, "Sign in to sync progress.");

  if (request.method === "GET") {
    const row = await env.DB.prepare(
      `SELECT progress_json, updated_at
         FROM course_progress
        WHERE user_id = ? AND course = ?`,
    )
      .bind(user.id, course)
      .first<ProgressRow>();
    if (!row) return json({ progress: null, updatedAt: null });
    return json({ progress: JSON.parse(row.progress_json) as unknown, updatedAt: row.updated_at });
  }

  if (request.method === "PUT") {
    requireSameOrigin(request);
    const body = await readJson(request);
    const progress = normalizedProgress(isRecord(body) ? body.progress : null);
    const progressJson = JSON.stringify(progress);
    if (new TextEncoder().encode(progressJson).byteLength > MAX_JSON_BYTES) {
      throw new ApiError(413, "Saved progress is too large.");
    }
    const updatedAt = Date.now();
    await env.DB.prepare(
      `INSERT INTO course_progress (user_id, course, progress_json, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id, course) DO UPDATE SET
         progress_json = excluded.progress_json,
         updated_at = excluded.updated_at`,
    )
      .bind(user.id, course, progressJson, updatedAt)
      .run();
    return json({ ok: true, updatedAt });
  }

  throw new ApiError(405, "Method not allowed.");
};

export async function handleApiRequest(
  request: Request,
  env: ApiEnv,
  ctx: ApiContext,
): Promise<Response> {
  const url = new URL(request.url);
  try {
    if (url.pathname === "/api/auth/request" && request.method === "POST") {
      return await requestMagicLink(request, env, ctx);
    }
    if (
      url.pathname === "/api/auth/verify" &&
      (request.method === "GET" || request.method === "POST")
    ) {
      return await verifyMagicLink(request, env);
    }
    if (url.pathname === "/api/auth/session" && request.method === "GET") {
      return await sessionResponse(request, env);
    }
    if (url.pathname === "/api/auth/logout" && request.method === "POST") {
      return await logout(request, env);
    }
    if (url.pathname.startsWith("/api/progress/")) {
      const course = decodeURIComponent(url.pathname.slice("/api/progress/".length));
      return await progressRoute(request, env, course);
    }
    throw new ApiError(404, "API route not found.");
  } catch (error) {
    if (error instanceof ApiError) {
      return json({ error: error.message }, error.status);
    }
    console.error("Turtle Trail API request failed", url.pathname);
    return json({ error: "The server could not complete that request." }, 500);
  }
}
