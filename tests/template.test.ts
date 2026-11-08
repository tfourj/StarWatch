import { describe, expect, test } from "bun:test";
import { DEFAULT_TEMPLATES, formatLinks, hasLinks, parseLinks, stripLinks } from "../src/shared/templates";
import { mergeTemplates, renderMessage, renderTemplate } from "../src/server/lib/template";
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
    const html = formatLinks("a < [b](https://x.dev/?q=1) >", {
      text: (t) => t.replace(/</g, "&lt;").replace(/>/g, "&gt;"),
      link: (t, u) => `<a href="${u}">${t}</a>`,
    });
    expect(html).toBe('a &lt; <a href="https://x.dev/?q=1">b</a> &gt;');
  });

  test("stripLinks keeps the link text", () => {
    expect(stripLinks(text)).toBe("octocat starred me/project.");
    expect(stripLinks("no links here")).toBe("no links here");
  });

  test("renderMessage strips links from the title only", () => {
    const t = mergeTemplates({ starTitle: "[{repo}]({repo_url})", starBody: "[{user}]({user_url})" });
    const msg = renderMessage("created", t, vars);
    expect(msg.title).toBe("me/project");
    expect(msg.body).toBe("[octocat](https://github.com/octocat)");
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
