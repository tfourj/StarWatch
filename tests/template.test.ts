import { describe, expect, test } from "bun:test";
import { DEFAULT_TEMPLATES, formatMarkup, hasLinks, parseLinks, parseMarkup, stripMarkup } from "../src/shared/templates";
import { formatEventTime, mergeTemplates, renderMessage, renderTemplate } from "../src/server/lib/template";
import { buildVars } from "../src/server/notifications/worker";

const vars = {
  user: "octocat",
  user_url: "https://github.com/octocat",
  avatar: "https://github.com/octocat.png",
  repo: "me/project",
  repo_url: "https://github.com/me/project",
  stars: "42",
  action: "starred",
  time: "7 Nov 2026, 19:00 UTC",
};

describe("renderTemplate", () => {
  test("replaces every supported variable", () => {
    const tpl = "{user} {user_url} {avatar} {repo} {repo_url} {stars} {action} {time}";
    expect(renderTemplate(tpl, vars)).toBe(Object.values(vars).join(" "));
  });

  test("replaces repeated variables", () => {
    expect(renderTemplate("{user}/{user}", vars)).toBe("octocat/octocat");
  });

  test("leaves unknown placeholders untouched", () => {
    expect(renderTemplate("{user} {nope} {Repo}", vars)).toBe("octocat {nope} {Repo}");
  });

  test("double braces produce literal braces", () => {
    expect(renderTemplate("{{user}} is {user}", vars)).toBe("{user} is octocat");
  });

  test("numbers are stringified", () => {
    expect(renderTemplate("{stars} stars", { stars: 7 })).toBe("7 stars");
  });
});

describe("template links", () => {
  const text = renderTemplate("[{user}]({user_url}) starred [{repo}]({repo_url}).", vars);

  test("parses links into segments", () => {
    expect(parseLinks(text)).toEqual([
      { text: "octocat", url: "https://github.com/octocat" },
      { text: " starred " },
      { text: "me/project", url: "https://github.com/me/project" },
      { text: "." },
    ]);
  });

  test("only http and https URLs are links", () => {
    expect(hasLinks("[a](ftp://x) [b](not a url) [c]()")).toBe(false);
    expect(hasLinks("see [docs](http://example.com)")).toBe(true);
  });

  test("formats links and plain text separately", () => {
    const html = formatMarkup("a < [b](https://x.dev/?q=1) >", {
      text: (t) => t.replace(/</g, "&lt;").replace(/>/g, "&gt;"),
      link: (t, u) => `<a href="${u}">${t}</a>`,
    });
    expect(html).toBe('a &lt; <a href="https://x.dev/?q=1">b</a> &gt;');
  });

  test("stripMarkup keeps the link text", () => {
    expect(stripMarkup(text)).toBe("octocat starred me/project.");
    expect(stripMarkup("no links here")).toBe("no links here");
  });

  test("renderMessage strips links from the title only", () => {
    const t = mergeTemplates({ starTitle: "[{repo}]({repo_url})", starBody: "[{user}]({user_url})" });
    const msg = renderMessage("created", t, vars);
    expect(msg.title).toBe("me/project");
    expect(msg.body).toBe("[octocat](https://github.com/octocat)");
  });
});

describe("template bold", () => {
  const html = (t: string) =>
    formatMarkup(t, { link: (x, u) => `<a href="${u}">${x}</a>`, bold: (inner) => `<b>${inner}</b>` });

  test("parses bold runs around links", () => {
    expect(parseMarkup("**a [b](https://x.dev) c** d")).toEqual([
      { text: "a ", bold: true },
      { text: "b", url: "https://x.dev", bold: true },
      { text: " c", bold: true },
      { text: " d" },
    ]);
  });

  test("wraps each bold run once", () => {
    expect(html("**[octocat](https://github.com/octocat)** has **42** stars")).toBe(
      '<b><a href="https://github.com/octocat">octocat</a></b> has <b>42</b> stars',
    );
  });

  test("a link is bold when its whole text is", () => {
    expect(html("[**octocat**](https://github.com/octocat)")).toBe(
      '<b><a href="https://github.com/octocat">octocat</a></b>',
    );
  });

  test("leaves markers that do not form bold text", () => {
    const text = "** spaced ** and **** and a*b and **open\nclose**";
    expect(html(text)).toBe(text);
    expect(html("[a**b](https://x.dev/**y**)")).toBe('<a href="https://x.dev/**y**">a**b</a>');
  });

  test("stripMarkup drops the markers", () => {
    expect(stripMarkup("**[octocat](https://github.com/octocat)** starred **me/project**.")).toBe(
      "octocat starred me/project.",
    );
  });

  test("renderMessage strips bold from the title only", () => {
    const t = mergeTemplates({ starTitle: "**{repo}**", starBody: "**{user}**" });
    const msg = renderMessage("created", t, vars);
    expect(msg.title).toBe("me/project");
    expect(msg.body).toBe("**octocat**");
  });
});

describe("message templates", () => {
  test("later layers override earlier ones, blanks are ignored", () => {
    const merged = mergeTemplates({ starTitle: "User title", starBody: "" }, { starTitle: "Channel title" }, null);
    expect(merged.starTitle).toBe("Channel title");
    expect(merged.starBody).toBe(DEFAULT_TEMPLATES.starBody);
  });

  test("renderMessage picks star or unstar templates", () => {
    const t = mergeTemplates({ starTitle: "+1 {repo}", unstarTitle: "-1 {repo}" });
    expect(renderMessage("created", t, vars).title).toBe("+1 me/project");
    expect(renderMessage("deleted", t, vars).title).toBe("-1 me/project");
  });

  test("buildVars fills every variable from an event", () => {
    const v = buildVars(
      {
        action: "deleted",
        actorLogin: "octocat",
        actorUrl: null,
        actorAvatarUrl: null,
        starCount: 9,
        occurredAt: new Date("2026-11-07T18:00:00Z"),
      },
      { fullName: "me/project", htmlUrl: "https://github.com/me/project" },
      "UTC",
    );
    expect(v.action).toBe("unstarred");
    expect(v.user_url).toBe("https://github.com/octocat");
    expect(v.stars).toBe("9");
    expect(v.time).toContain("2026");
  });
});

describe("formatEventTime", () => {
  const at = new Date(Date.UTC(2026, 10, 7, 19, 0));

  test("shows date, 24-hour time and zone in the server timezone", () => {
    expect(formatEventTime(at, "UTC")).toBe("7 Nov 2026, 19:00 UTC");
    expect(formatEventTime(at, "Europe/Ljubljana")).toBe("7 Nov 2026, 20:00 CET");
  });

  test("uses 24-hour time unless 12-hour time is chosen", () => {
    expect(formatEventTime(at, "UTC", "auto")).toBe("7 Nov 2026, 19:00 UTC");
    expect(formatEventTime(at, "UTC", "24h")).toBe("7 Nov 2026, 19:00 UTC");
    expect(formatEventTime(at, "UTC", "12h")).toBe("7 Nov 2026, 7:00 pm UTC");
    expect(formatEventTime(new Date(Date.UTC(2026, 10, 7, 0, 5)), "UTC", "12h")).toBe("7 Nov 2026, 12:05 am UTC");
  });

  test("falls back to ISO for an unknown timezone", () => {
    expect(formatEventTime(at, "Not/AZone")).toBe("2026-11-07T19:00:00.000Z");
  });
});
