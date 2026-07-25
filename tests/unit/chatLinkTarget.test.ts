import { describe, expect, it } from "vitest";
import {
  classifyChatLink,
  parseWorkspaceCitation,
  type ChatLinkTarget,
} from "../../src/lib/chatLinkTarget";

function citation(path: string, extra: Partial<ChatLinkTarget> = {}) {
  return { kind: "workspaceCitation", path, ...extra };
}

describe("classifyChatLink: approved external https", () => {
  it("accepts a plain https URL with query and fragment", () => {
    expect(classifyChatLink("https://example.com/a?b=1#c")).toEqual({
      kind: "externalHttps",
      url: "https://example.com/a?b=1#c",
    });
  });

  it("normalizes the scheme case", () => {
    expect(classifyChatLink("HTTPS://Example.com/a")).toMatchObject({ kind: "externalHttps" });
  });
});

describe("classifyChatLink: non-https and dangerous schemes are inert", () => {
  it.each(["http:", "file:", "javascript:", "data:", "mailto:"])(
    "blocks bare %s",
    (scheme) => {
      expect(classifyChatLink(`${scheme}payload`)).toEqual({ kind: "blocked" });
    },
  );

  it.each([
    "http://example.com",
    "file:///etc/passwd",
    "javascript:alert(1)",
    "data:text/html,<script>1</script>",
    "mailto:foo@bar.com",
    "ftp://example.com/file",
  ])("blocks %s", (href) => {
    expect(classifyChatLink(href)).toEqual({ kind: "blocked" });
  });

  it("blocks an unrecognized custom scheme via the ambiguous-delimiter rule", () => {
    expect(classifyChatLink("pickforge://auth/callback?code=abc")).toEqual({ kind: "blocked" });
  });
});

describe("classifyChatLink: https hardening (credentials, hostless, malformed)", () => {
  it.each([
    "https://",
    "https:///",
    "https:///callback",
    "https://user:pass@example.com/",
    "https://:pass@example.com/",
    "https://user:@example.com/",
  ])("blocks %s", (href) => {
    expect(classifyChatLink(href)).toEqual({ kind: "blocked" });
  });

  it("blocks a malformed https URL", () => {
    expect(classifyChatLink("https://[::not-valid")).toEqual({ kind: "blocked" });
  });
});

describe("classifyChatLink: NUL and control characters", () => {
  it("blocks a href containing a NUL byte", () => {
    expect(classifyChatLink("src/a.ts\0.evil")).toEqual({ kind: "blocked" });
  });

  it("blocks a href containing a raw control character", () => {
    expect(classifyChatLink("src/a\u0007.ts")).toEqual({ kind: "blocked" });
  });

  it("blocks an https URL smuggling a control character", () => {
    expect(classifyChatLink("https://example.com/\u0001x")).toEqual({ kind: "blocked" });
  });
});

describe("classifyChatLink: canonical citation syntax", () => {
  it("parses a bare relative path with no location", () => {
    expect(classifyChatLink("src/a.ts")).toEqual(citation("src/a.ts"));
  });

  it("parses #L12", () => {
    expect(classifyChatLink("src/a.ts#L12")).toEqual(citation("src/a.ts", { line: 12 }));
  });

  it("parses #L12C4", () => {
    expect(classifyChatLink("src/a.ts#L12C4")).toEqual(
      citation("src/a.ts", { line: 12, column: 4 }),
    );
  });

  it("parses #L12-L18", () => {
    expect(classifyChatLink("src/a.ts#L12-L18")).toEqual(
      citation("src/a.ts", { line: 12, endLine: 18 }),
    );
  });

  it("parses an absolute path", () => {
    expect(classifyChatLink("/Users/dev/proj/src/a.ts#L3")).toEqual(
      citation("/Users/dev/proj/src/a.ts", { line: 3 }),
    );
  });
});

describe("classifyChatLink: numeric compatibility form", () => {
  it("parses path:line", () => {
    expect(classifyChatLink("src/a.ts:12")).toEqual(citation("src/a.ts", { line: 12 }));
  });

  it("parses path:line:column", () => {
    expect(classifyChatLink("src/a.ts:12:4")).toEqual(
      citation("src/a.ts", { line: 12, column: 4 }),
    );
  });

  it("parses a bare filename (no directory separator) compat form", () => {
    expect(classifyChatLink("a.ts:12:4")).toEqual(citation("a.ts", { line: 12, column: 4 }));
  });

  it("blocks a third trailing colon-digit group as ambiguous", () => {
    expect(classifyChatLink("src/a.ts:12:4:99")).toEqual({ kind: "blocked" });
  });
});

describe("classifyChatLink: Windows drive paths are paths, not schemes", () => {
  it("parses a bare Windows absolute path with no location", () => {
    expect(classifyChatLink("C:\\Users\\me\\a.ts")).toEqual(citation("C:\\Users\\me\\a.ts"));
  });

  it("parses a Windows path with the compat line:column suffix", () => {
    expect(classifyChatLink("C:\\Users\\me\\a.ts:12:4")).toEqual(
      citation("C:\\Users\\me\\a.ts", { line: 12, column: 4 }),
    );
  });

  it("parses a Windows path with the canonical #L suffix", () => {
    expect(classifyChatLink("C:\\Users\\me\\a.ts#L12")).toEqual(
      citation("C:\\Users\\me\\a.ts", { line: 12 }),
    );
  });

  it("parses a forward-slash Windows drive path", () => {
    expect(classifyChatLink("C:/Users/me/a.ts")).toEqual(citation("C:/Users/me/a.ts"));
  });
});

describe("classifyChatLink: ambiguous unescaped delimiters", () => {
  it("blocks a raw ':' in the filename with no numeric tail", () => {
    expect(classifyChatLink("weird:name.ts")).toEqual({ kind: "blocked" });
  });

  it("blocks a raw ':' before the recognized trailing digits", () => {
    expect(classifyChatLink("foo:bar:12")).toEqual({ kind: "blocked" });
  });

  it("blocks a raw ':' inside a Windows path (beyond the drive prefix) even with an otherwise valid #L fragment", () => {
    expect(classifyChatLink("C:\\weird:name.ts#L12")).toEqual({ kind: "blocked" });
  });

  it("accepts the same literal characters once percent-encoded", () => {
    expect(classifyChatLink("weird%3Aname.ts")).toEqual(citation("weird:name.ts"));
    expect(classifyChatLink("weird%23name.ts#L1")).toEqual(
      citation("weird#name.ts", { line: 1 }),
    );
  });
});

describe("classifyChatLink: percent-encoding", () => {
  it("decodes escapes exactly once", () => {
    expect(classifyChatLink("src%2Fa%20b.ts")).toEqual(citation("src/a b.ts"));
  });

  it("blocks a malformed percent escape", () => {
    expect(classifyChatLink("src/a%zz.ts")).toEqual({ kind: "blocked" });
    expect(classifyChatLink("src/a%2.ts")).toEqual({ kind: "blocked" });
  });

  it("blocks a percent-encoded NUL byte in the decoded path", () => {
    expect(classifyChatLink("src/a%00.ts")).toEqual({ kind: "blocked" });
  });

  it("blocks a percent-encoded control character in the decoded path", () => {
    expect(classifyChatLink("src/a%07.ts")).toEqual({ kind: "blocked" });
  });
});

describe("classifyChatLink: local-link queries are rejected", () => {
  it("blocks a query string before the fragment", () => {
    expect(classifyChatLink("src/a.ts?x=1#L1")).toEqual({ kind: "blocked" });
  });

  it("blocks a bare query with no fragment", () => {
    expect(classifyChatLink("src/a.ts?x=1")).toEqual({ kind: "blocked" });
  });
});

describe("classifyChatLink: invalid/zero/overflowing positions", () => {
  it("blocks a zero line", () => {
    expect(classifyChatLink("src/a.ts#L0")).toEqual({ kind: "blocked" });
    expect(classifyChatLink("src/a.ts:0")).toEqual({ kind: "blocked" });
  });

  it("blocks a zero column", () => {
    expect(classifyChatLink("src/a.ts#L1C0")).toEqual({ kind: "blocked" });
  });

  it("blocks an overflowing position", () => {
    expect(classifyChatLink("src/a.ts#L99999999999")).toEqual({ kind: "blocked" });
    expect(classifyChatLink("src/a.ts:4294967296")).toEqual({ kind: "blocked" });
  });

  it("accepts the maximum representable u32 position", () => {
    expect(classifyChatLink("src/a.ts#L4294967295")).toEqual(
      citation("src/a.ts", { line: 4294967295 }),
    );
  });

  it("blocks a non-numeric or negative-looking position", () => {
    expect(classifyChatLink("src/a.ts#L-1")).toEqual({ kind: "blocked" });
    expect(classifyChatLink("src/a.ts#L1.5")).toEqual({ kind: "blocked" });
  });
});

describe("classifyChatLink: invalid ranges", () => {
  it("blocks endLine before line", () => {
    expect(classifyChatLink("src/a.ts#L18-L12")).toEqual({ kind: "blocked" });
  });

  it("accepts a single-line range", () => {
    expect(classifyChatLink("src/a.ts#L12-L12")).toEqual(
      citation("src/a.ts", { line: 12, endLine: 12 }),
    );
  });

  it("blocks unrecognized fragment location syntax", () => {
    expect(classifyChatLink("src/a.ts#C4")).toEqual({ kind: "blocked" });
    expect(classifyChatLink("src/a.ts#L12C4-L18")).toEqual({ kind: "blocked" });
    expect(classifyChatLink("src/a.ts#")).toEqual({ kind: "blocked" });
  });
});

describe("classifyChatLink: malformed location with an otherwise-valid path is blocked, not silently opened", () => {
  it("never falls back to treating the fragment as absent", () => {
    const withoutFragment = classifyChatLink("src/a.ts");
    const withBadFragment = classifyChatLink("src/a.ts#nope");
    expect(withoutFragment).toEqual(citation("src/a.ts"));
    expect(withBadFragment).toEqual({ kind: "blocked" });
  });
});

describe("classifyChatLink: empty/oversized input", () => {
  it("blocks an empty href", () => {
    expect(classifyChatLink("")).toEqual({ kind: "blocked" });
  });

  it("blocks a fragment-only href with no path", () => {
    expect(classifyChatLink("#L12")).toEqual({ kind: "blocked" });
  });

  it("blocks an oversized href", () => {
    expect(classifyChatLink(`src/${"a".repeat(9000)}.ts`)).toEqual({ kind: "blocked" });
  });
});

describe("parseWorkspaceCitation: standalone discriminated result", () => {
  it("reports nonCitation for a known non-https scheme", () => {
    expect(parseWorkspaceCitation("mailto:foo@bar.com")).toEqual({ kind: "nonCitation" });
    expect(parseWorkspaceCitation("javascript:alert(1)")).toEqual({ kind: "nonCitation" });
  });

  it("reports valid for a canonical citation", () => {
    expect(parseWorkspaceCitation("src/a.ts#L12C4")).toEqual({
      kind: "valid",
      path: "src/a.ts",
      line: 12,
      column: 4,
    });
  });

  it("reports malformed for a bad location on an otherwise fine path", () => {
    expect(parseWorkspaceCitation("src/a.ts#L0")).toEqual({ kind: "malformed" });
  });
});
