export interface CookieOptions {
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'strict' | 'lax' | 'none' | boolean;
  maxAge?: number;
  path?: string;
  partitioned?: boolean;
}

export interface WebRequest {
  method: string;
  url: string;
  path: string;
  originalUrl: string;
  params: Record<string, string>;
  query: Record<string, string>;
  headers: Record<string, string>;
  cookies: Record<string, string>;
  body: any;
  secure: boolean;
  ip: string;
  user?: any;
  get(name: string): string | undefined;
}

export interface WebResponse {
  status(code: number): WebResponse;
  setHeader(name: string, value: string): WebResponse;
  cookie(name: string, value: string, options?: CookieOptions): WebResponse;
  clearCookie(name: string, options?: CookieOptions): WebResponse;
  json(data: any): void;
  send(body: any): void;
  readonly ended: boolean;
}

export type NextFunction = () => Promise<void> | void;
export type RouteHandler = (req: WebRequest, res: WebResponse, next: NextFunction) => any;

interface RouteEntry {
  method: string; // 'USE' | 'ALL' | 'GET' | 'POST' | 'PUT' | 'DELETE'
  prefix: string;
  segments: string[];
  handler?: RouteHandler;
  subRouter?: WebRouter;
}

function splitPath(p: string): string[] {
  return p
    .split('/')
    .map((s) => s.trim())
    .filter(Boolean);
}

function matchSegments(
  routeSegments: string[],
  reqSegments: string[],
  isPrefixMatch: boolean
): { matched: boolean; params: Record<string, string> } {
  if (isPrefixMatch) {
    if (reqSegments.length < routeSegments.length) {
      return { matched: false, params: {} };
    }
  } else if (reqSegments.length !== routeSegments.length) {
    return { matched: false, params: {} };
  }

  const params: Record<string, string> = {};
  for (let i = 0; i < routeSegments.length; i++) {
    const rs = routeSegments[i];
    const reqSeg = reqSegments[i];
    if (rs === '*') {
      return { matched: true, params };
    }
    if (rs.startsWith(':')) {
      params[rs.slice(1)] = decodeURIComponent(reqSeg);
    } else if (rs !== reqSeg) {
      return { matched: false, params: {} };
    }
  }
  return { matched: true, params };
}

export class WebRouter {
  private entries: RouteEntry[] = [];

  use(pathOrHandler: string | string[] | RouteHandler | WebRouter, ...rest: Array<RouteHandler | WebRouter>): this {
    if (typeof pathOrHandler === 'function') {
      this.entries.push({ method: 'USE', prefix: '/', segments: [], handler: pathOrHandler });
      for (const h of rest) {
        if (typeof h === 'function') {
          this.entries.push({ method: 'USE', prefix: '/', segments: [], handler: h });
        } else {
          this.entries.push({ method: 'USE', prefix: '/', segments: [], subRouter: h });
        }
      }
      return this;
    }

    if (pathOrHandler instanceof WebRouter) {
      this.entries.push({ method: 'USE', prefix: '/', segments: [], subRouter: pathOrHandler });
      return this;
    }

    const paths = Array.isArray(pathOrHandler) ? pathOrHandler : [pathOrHandler];
    for (const p of paths) {
      const segs = splitPath(p);
      for (const item of rest) {
        if (item instanceof WebRouter) {
          this.entries.push({ method: 'USE', prefix: p, segments: segs, subRouter: item });
        } else {
          this.entries.push({ method: 'USE', prefix: p, segments: segs, handler: item });
        }
      }
    }
    return this;
  }

  private addMethod(method: string, paths: string | string[], handlers: RouteHandler[]): this {
    const list = Array.isArray(paths) ? paths : [paths];
    for (const p of list) {
      const segs = splitPath(p);
      for (const h of handlers) {
        this.entries.push({ method, prefix: p, segments: segs, handler: h });
      }
    }
    return this;
  }

  get(path: string | string[], ...handlers: RouteHandler[]): this {
    return this.addMethod('GET', path, handlers);
  }

  post(path: string | string[], ...handlers: RouteHandler[]): this {
    return this.addMethod('POST', path, handlers);
  }

  put(path: string | string[], ...handlers: RouteHandler[]): this {
    return this.addMethod('PUT', path, handlers);
  }

  delete(path: string | string[], ...handlers: RouteHandler[]): this {
    return this.addMethod('DELETE', path, handlers);
  }

  all(path: string | string[], ...handlers: RouteHandler[]): this {
    return this.addMethod('ALL', path, handlers);
  }

  async dispatch(req: WebRequest, res: WebResponse, relSegments: string[]): Promise<boolean> {
    let idx = 0;

    const runNext = async (): Promise<boolean> => {
      if (res.ended) return true;
      while (idx < this.entries.length) {
        const entry = this.entries[idx++];
        const isUse = entry.method === 'USE';
        const isMethodMatch = isUse || entry.method === 'ALL' || entry.method === req.method;
        if (!isMethodMatch) continue;

        const hasWildcard = entry.segments.includes('*');
        const match = matchSegments(entry.segments, relSegments, isUse || hasWildcard);
        if (!match.matched) continue;

        const prevParams = req.params;
        req.params = { ...prevParams, ...match.params };

        try {
          if (entry.subRouter) {
            const subSegments = relSegments.slice(entry.segments.length);
            const handled = await entry.subRouter.dispatch(req, res, subSegments);
            if (handled || res.ended) return true;
          } else if (entry.handler) {
            let nextCalled = false;
            let nextPromise: Promise<boolean> | null = null;
            await entry.handler(req, res, async () => {
              if (nextCalled) return;
              nextCalled = true;
              nextPromise = runNext();
              await nextPromise;
            });
            if (nextPromise) {
              await nextPromise;
            }
            return res.ended;
          }
        } finally {
          if (!res.ended) {
            req.params = prevParams;
          }
        }
      }
      return res.ended;
    };

    return runNext();
  }
}

function parseCookies(cookieHeader: string | null): Record<string, string> {
  const result: Record<string, string> = {};
  if (!cookieHeader) return result;
  for (const part of cookieHeader.split(';')) {
    const eqIdx = part.indexOf('=');
    if (eqIdx <= 0) continue;
    const key = part.slice(0, eqIdx).trim();
    const rawVal = part.slice(eqIdx + 1).trim();
    try {
      result[key] = decodeURIComponent(rawVal);
    } catch {
      result[key] = rawVal;
    }
  }
  return result;
}

function serializeCookie(name: string, value: string, options: CookieOptions = {}): string {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  if (options.maxAge !== undefined) {
    const maxAgeSec = Math.max(0, Math.floor(options.maxAge / 1000));
    parts.push(`Max-Age=${maxAgeSec}`);
    parts.push(`Expires=${new Date(Date.now() + Math.max(0, options.maxAge)).toUTCString()}`);
  }
  parts.push(`Path=${options.path || '/'}`);
  if (options.httpOnly) parts.push('HttpOnly');
  if (options.secure) parts.push('Secure');
  if (options.partitioned) parts.push('Partitioned');
  if (options.sameSite && typeof options.sameSite === 'string') {
    const s = options.sameSite.charAt(0).toUpperCase() + options.sameSite.slice(1).toLowerCase();
    parts.push(`SameSite=${s}`);
  }
  return parts.join('; ');
}

export async function handleWebRouterFetch(router: WebRouter, request: Request): Promise<Response> {
  const parsedUrl = new URL(request.url);
  const headersMap: Record<string, string> = {};
  request.headers.forEach((v, k) => {
    headersMap[k.toLowerCase()] = v;
  });

  const query: Record<string, string> = {};
  parsedUrl.searchParams.forEach((v, k) => {
    query[k] = v;
  });

  let body: any = {};
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    const ct = (headersMap['content-type'] || '').toLowerCase();
    try {
      if (ct.includes('application/json')) {
        const text = await request.text();
        body = text ? JSON.parse(text) : {};
      } else if (ct.includes('application/x-www-form-urlencoded')) {
        const text = await request.text();
        const form = new URLSearchParams(text);
        const obj: Record<string, string> = {};
        form.forEach((v, k) => {
          obj[k] = v;
        });
        body = obj;
      }
    } catch {
      body = {};
    }
  }

  const forwardedProto = headersMap['x-forwarded-proto'];
  const isHttps = parsedUrl.protocol === 'https:' || forwardedProto === 'https';
  const clientIp =
    headersMap['cf-connecting-ip'] ||
    (headersMap['x-forwarded-for'] ? headersMap['x-forwarded-for'].split(',')[0].trim() : '') ||
    'unknown';

  const req: WebRequest = {
    method: request.method.toUpperCase(),
    url: parsedUrl.pathname + parsedUrl.search,
    path: parsedUrl.pathname,
    originalUrl: parsedUrl.pathname + parsedUrl.search,
    params: {},
    query,
    headers: headersMap,
    cookies: parseCookies(headersMap['cookie'] || null),
    body,
    secure: isHttps,
    ip: clientIp,
    get(name: string) {
      return headersMap[name.toLowerCase()];
    },
  };

  let statusCode = 200;
  const respHeaders = new Headers();
  const setCookies: string[] = [];
  let responseBody: BodyInit | null = null;
  let isEnded = false;

  // Baseline security headers matching Helmet protections
  respHeaders.set('X-Content-Type-Options', 'nosniff');
  respHeaders.set('X-Frame-Options', 'SAMEORIGIN');
  respHeaders.set('Referrer-Policy', 'no-referrer');
  if (isHttps) {
    respHeaders.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }

  const res: WebResponse = {
    get ended() {
      return isEnded;
    },
    status(code: number) {
      statusCode = code;
      return res;
    },
    setHeader(name: string, value: string) {
      respHeaders.set(name, value);
      return res;
    },
    cookie(name: string, value: string, options: CookieOptions = {}) {
      setCookies.push(serializeCookie(name, value, options));
      return res;
    },
    clearCookie(name: string, options: CookieOptions = {}) {
      setCookies.push(
        serializeCookie(name, '', {
          ...options,
          maxAge: 0,
        })
      );
      return res;
    },
    json(data: any) {
      if (isEnded) return;
      if (!respHeaders.has('Content-Type')) {
        respHeaders.set('Content-Type', 'application/json; charset=utf-8');
      }
      responseBody = JSON.stringify(data);
      isEnded = true;
    },
    send(data: any) {
      if (isEnded) return;
      if (data instanceof Uint8Array) {
        responseBody = data as unknown as BodyInit;
      } else if (typeof data === 'string') {
        responseBody = data;
      } else if (data === null || data === undefined) {
        responseBody = '';
      } else {
        if (!respHeaders.has('Content-Type')) {
          respHeaders.set('Content-Type', 'application/json; charset=utf-8');
        }
        responseBody = JSON.stringify(data);
      }
      isEnded = true;
    },
  };

  try {
    const segments = splitPath(parsedUrl.pathname);
    await router.dispatch(req, res, segments);
    if (!isEnded) {
      statusCode = 404;
      respHeaders.set('Content-Type', 'application/json; charset=utf-8');
      responseBody = JSON.stringify({ error: `API route not found: ${req.method} ${req.path}` });
    }
  } catch (err: any) {
    console.error('Unhandled API Error:', err);
    statusCode = err?.status || 500;
    respHeaders.set('Content-Type', 'application/json; charset=utf-8');
    responseBody = JSON.stringify({ error: err?.message || 'Internal server error' });
  }

  for (const cookieStr of setCookies) {
    respHeaders.append('Set-Cookie', cookieStr);
  }

  return new Response(responseBody, {
    status: statusCode,
    headers: respHeaders,
  });
}
