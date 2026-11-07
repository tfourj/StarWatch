import { describe, expect, test } from "bun:test";
import { DEFAULT_TEMPLATES } from "../src/shared/templates";
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
