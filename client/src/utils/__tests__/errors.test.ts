import { describe, it, expect } from "vitest";
import { getErrorMessage } from "../errors";

describe("getErrorMessage", () => {
  it("extracts message from Error instance", () => {
    expect(getErrorMessage(new Error("something broke"))).toBe("something broke");
  });

  it("extracts message from TypeError", () => {
    expect(getErrorMessage(new TypeError("type error"))).toBe("type error");
  });

  it("returns string directly", () => {
    expect(getErrorMessage("raw error string")).toBe("raw error string");
  });

  it("returns fallback for null", () => {
    expect(getErrorMessage(null)).toBe("An unknown error occurred");
  });

  it("returns fallback for undefined", () => {
    expect(getErrorMessage(undefined)).toBe("An unknown error occurred");
  });

  it("returns fallback for number", () => {
    expect(getErrorMessage(42)).toBe("An unknown error occurred");
  });

  it("returns fallback for object without message", () => {
    expect(getErrorMessage({ code: 500 })).toBe("An unknown error occurred");
  });

  it("returns fallback for empty string", () => {
    // Empty string is still a string, returned as-is
    expect(getErrorMessage("")).toBe("");
  });
});
