import { describe, expect, it } from "vitest";

import { canonicalize } from "./canonical.js";
import { canonicalSha256 } from "./digests.js";

describe("canonicalize", () => {
  it("sorts object keys recursively while preserving array order", () => {
    expect(canonicalize({ z: 1, a: { beta: true, alpha: [3, 2, 1] } })).toBe(
      '{"a":{"alpha":[3,2,1],"beta":true},"z":1}',
    );
  });

  it("produces the same digest for differently ordered objects", () => {
    expect(canonicalSha256({ b: 2, a: 1 })).toBe(
      canonicalSha256({ a: 1, b: 2 }),
    );
  });

  it("rejects values JSON cannot represent safely", () => {
    expect(() => canonicalize({ value: undefined })).toThrow("undefined");
    expect(() => canonicalize(Number.POSITIVE_INFINITY)).toThrow("non-finite");
  });
});
