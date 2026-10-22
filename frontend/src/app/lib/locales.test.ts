import fs from "fs";
import path from "path";
import { LOCALES, isLocale } from "./locales";

describe("locales", () => {
  it("has a messages file for every supported locale", () => {
    for (const locale of LOCALES) {
      expect(fs.existsSync(path.join(__dirname, "../../../messages", `${locale}.json`))).toBe(true);
    }
  });

  it("recognises only supported locales", () => {
    expect(isLocale("en")).toBe(true);
    expect(isLocale("es")).toBe(false);
    expect(isLocale("tl")).toBe(false);
  });
});
