import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { listLinks, toHtml, toPlainWithUrls, trailingLink } from "../src/server/notifications/links";
import { gotify } from "../src/server/notifications/providers/gotify";
import { ntfy } from "../src/server/notifications/providers/ntfy";
import { pushover } from "../src/server/notifications/providers/pushover";
import { slack } from "../src/server/notifications/providers/slack";
import { telegram } from "../src/server/notifications/providers/telegram";
import { webhook } from "../src/server/notifications/providers/webhook";
import type { NotificationMessage } from "../src/server/notifications/types";

const vars = {
  user: "octocat",
  user_url: "https://github.com/octocat",
  avatar: "",
  repo: "me/project",
  repo_url: "https://github.com/me/project",
  stars: "42",
  action: "starred",
  time: "7 Nov 2026, 19:00 UTC",
};

const linked = "[octocat](https://github.com/octocat) starred [me/project](https://github.com/me/project).";

function message(body: string): NotificationMessage {
  return { title: "New star", body, action: "created", vars, occurredAt: new Date(), isTest: false };
}

let requests: { url: string; body: string }[] = [];
const realFetch = globalThis.fetch;

beforeEach(() => {
  requests = [];
  globalThis.fetch = (async (input: URL | RequestInfo, init?: RequestInit) => {
    requests.push({ url: String(input), body: String(init?.body ?? "") });
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

const sentJson = () => JSON.parse(requests[0]!.body);
const sentForm = () => new URLSearchParams(requests[0]!.body);

describe("link helpers", () => {
  test("formats links as HTML and plain text", () => {
    expect(toHtml("a & [b](https://x.dev/?a=1&b=2)")).toBe('a &amp; <a href="https://x.dev/?a=1&amp;b=2">b</a>');
    expect(toPlainWithUrls("hi [b](https://x.dev)")).toBe("hi b (https://x.dev)");
  });

  test("lists distinct links", () => {
    expect(listLinks(`${linked} [again](https://github.com/octocat)`)).toEqual([
      { url: "https://github.com/octocat", label: "octocat" },
      { url: "https://github.com/me/project", label: "me/project" },
    ]);
  });

  test("trailing link follows the main link and skips templates with links", () => {
    expect(trailingLink({}, message("plain"))?.url).toBe(vars.repo_url);
    expect(trailingLink({ mainLink: "user" }, message("plain"))?.url).toBe(vars.user_url);
    expect(trailingLink({ mainLink: "none" }, message("plain"))).toBeNull();
    expect(trailingLink({}, message(linked))).toBeNull();
  });
});

describe("gotify", () => {
  const config = { serverUrl: "https://gotify.test/", appToken: "t" };

  test("sends markdown with both links and the main link as click target", async () => {
    await gotify.send({ ...config, mainLink: "user" }, message(linked));
    const json = sentJson();
    expect(requests[0]!.url).toBe("https://gotify.test/message");
    expect(json.message).toBe(linked);
    expect(json.extras["client::display"].contentType).toBe("text/markdown");
    expect(json.extras["client::notification"].click.url).toBe(vars.user_url);
  });

  test("adds the repo link below plain templates and keeps line breaks", async () => {
    await gotify.send(config, message("line one\nline two"));
    expect(sentJson().message).toBe("line one  \nline two  \n[me/project](https://github.com/me/project)");
  });

  test("main link none drops the click target and the extra line", async () => {
    await gotify.send({ ...config, mainLink: "none" }, message("plain"));
    const json = sentJson();
    expect(json.message).toBe("plain");
    expect(json.extras["client::notification"]).toBeUndefined();
  });
});

describe("other providers", () => {
  test("telegram renders anchors and skips the extra line", async () => {
    await telegram.send({ botToken: "123:abc", chatId: "1" }, message(linked));
    expect(sentJson().text).toBe(
      '<b>New star</b>\n<a href="https://github.com/octocat">octocat</a> starred ' +
        '<a href="https://github.com/me/project">me/project</a>.',
    );
  });

  test("slack uses its own link syntax", async () => {
    await slack.send({ webhookUrl: "https://hooks.slack.test/x" }, message(linked));
    expect(sentJson().text).toBe(
      "*New star*\n<https://github.com/octocat|octocat> starred <https://github.com/me/project|me/project>.",
    );
  });

  test("ntfy sends plain text with link buttons", async () => {
    await ntfy.send({ topic: "stars", mainLink: "none" }, message(linked));
    const json = sentJson();
    expect(json.message).toBe("octocat starred me/project.");
    expect(json.click).toBeUndefined();
    expect(json.actions).toEqual([
      { action: "view", label: "octocat", url: "https://github.com/octocat" },
      { action: "view", label: "me/project", url: "https://github.com/me/project" },
    ]);
  });

  test("pushover sends HTML and the main link", async () => {
    await pushover.send({ apiToken: "a", userKey: "u", mainLink: "user" }, message(linked));
    const form = sentForm();
    expect(form.get("html")).toBe("1");
    expect(form.get("message")).toContain('<a href="https://github.com/octocat">octocat</a>');
    expect(form.get("url")).toBe(vars.user_url);
    expect(form.get("url_title")).toBe("octocat");
  });

  test("webhook sends plain and markdown messages", async () => {
    await webhook.send({ url: "https://hook.test" }, message(linked));
    const json = sentJson();
    expect(json.message).toBe("octocat starred me/project.");
    expect(json.message_markdown).toBe(linked);
  });
});
