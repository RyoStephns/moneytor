import { describe, expect, it } from "vitest";
import { parseEndDate, parseInputDate, parseStartDate, toMysqlDateTime } from "../src/time.js";

describe("time helpers", () => {
  it("formats dates for MySQL in UTC", () => {
    expect(toMysqlDateTime(new Date("2026-05-04T03:02:01.123Z"))).toBe("2026-05-04 03:02:01.123");
  });

  it("treats date-only transaction input as start of day", () => {
    expect(parseInputDate("2026-05-04")).toBe("2026-05-04 00:00:00.000");
  });

  it("expands date-only range bounds", () => {
    expect(parseStartDate("2026-05-04")).toBe("2026-05-04 00:00:00.000");
    expect(parseEndDate("2026-05-04")).toBe("2026-05-04 23:59:59.999");
  });
});
