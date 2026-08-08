import { urlSchema } from './primitives';

describe('urlSchema', () => {
  it.each(['http://localhost:3000', 'https://example.com', 'http://127.0.0.1:8080/app'])(
    'accepts %p',
    (value) => {
      expect(urlSchema.safeParse(value).success).toBe(true);
    },
  );

  it('rejects a host:port with no scheme', () => {
    // WHATWG parses this as the scheme `localhost:` with path `3000`, so plain
    // z.url() accepts it — and it then breaks CORS and Playwright navigation.
    expect(urlSchema.safeParse('localhost:3000').success).toBe(false);
  });

  it.each(['file:///etc/passwd', 'ftp://example.com', 'javascript:alert(1)', 'not a url', ''])(
    'rejects %p',
    (value) => {
      expect(urlSchema.safeParse(value).success).toBe(false);
    },
  );
});
