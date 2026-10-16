import { DEFAULT_API_URL, NEXT_PUBLIC_API_URL, API_URL } from "./apiConfig";

describe("apiConfig", () => {
  it("exports valid string URLs", () => {
    expect(typeof DEFAULT_API_URL).toBe("string");
    expect(DEFAULT_API_URL).toBe("http://localhost:3001");
    expect(typeof NEXT_PUBLIC_API_URL).toBe("string");
    expect(typeof API_URL).toBe("string");
    expect(NEXT_PUBLIC_API_URL.startsWith("http")).toBe(true);
    expect(API_URL.startsWith("http")).toBe(true);
  });
});
