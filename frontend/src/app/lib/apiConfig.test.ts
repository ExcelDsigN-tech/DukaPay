describe("apiConfig", () => {
  const originalEnv = process.env;

  // The URLs are read once at import, so each case sets env and re-imports.
  async function load(env: Record<string, string | undefined>) {
    process.env = { ...originalEnv, API_URL: undefined, NEXT_PUBLIC_API_URL: undefined, ...env };
    jest.resetModules();
    return import("./apiConfig");
  }

  afterEach(() => {
    process.env = originalEnv;
  });

  it("defaults both URLs to http://localhost:3001", async () => {
    const { API_URL, NEXT_PUBLIC_API_URL, DEFAULT_API_URL } = await load({});
    expect(DEFAULT_API_URL).toBe("http://localhost:3001");
    expect(NEXT_PUBLIC_API_URL).toBe(DEFAULT_API_URL);
    expect(API_URL).toBe(DEFAULT_API_URL);
  });

  it("falls back from API_URL to NEXT_PUBLIC_API_URL", async () => {
    const { API_URL, NEXT_PUBLIC_API_URL } = await load({
      NEXT_PUBLIC_API_URL: "https://public.example",
    });
    expect(NEXT_PUBLIC_API_URL).toBe("https://public.example");
    expect(API_URL).toBe("https://public.example");
  });

  it("prefers API_URL on the server and leaves NEXT_PUBLIC_API_URL alone", async () => {
    const { API_URL, NEXT_PUBLIC_API_URL } = await load({
      API_URL: "http://backend.internal",
      NEXT_PUBLIC_API_URL: "https://public.example",
    });
    expect(API_URL).toBe("http://backend.internal");
    expect(NEXT_PUBLIC_API_URL).toBe("https://public.example");
  });
});
