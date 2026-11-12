import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { listLinks, toHtml, toPlainWithUrls, trailingLink } from "../src/server/notifications/links";
import { buildMail } from "../src/server/notifications/providers/email";
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
const bold = "**[octocat](https://github.com/octocat)** starred **me/project**.";

function message(body: string): NotificationMessage {
  return { kind: "star", title: "New star", body, action: "created", vars, occurredAt: new Date(), isTest: false };
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

  test("formats bold as HTML and escapes inside it", () => {
    expect(toHtml("**a < b** [**c**](https://x.dev)")).toBe('<b>a &lt; b</b> <b><a href="https://x.dev">c</a></b>');
    expect(toPlainWithUrls("**hi** [b](https://x.dev)")).toBe("hi b (https://x.dev)");
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

  test("telegram renders bold", async () => {
    await telegram.send({ botToken: "123:abc", chatId: "1" }, message(bold));
    expect(sentJson().text).toBe(
      '<b>New star</b>\n<b><a href="https://github.com/octocat">octocat</a></b> starred <b>me/project</b>.',
    );
  });

  test("slack uses its own link syntax", async () => {
    await slack.send({ webhookUrl: "https://hooks.slack.test/x" }, message(linked));
    expect(sentJson().text).toBe(
      "*New star*\n<https://github.com/octocat|octocat> starred <https://github.com/me/project|me/project>.",
    );
  });

  test("slack uses single asterisks for bold", async () => {
    await slack.send({ webhookUrl: "https://hooks.slack.test/x" }, message(bold));
    expect(sentJson().text).toBe("*New star*\n*<https://github.com/octocat|octocat>* starred *me/project*.");
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

  test("ntfy and webhook drop bold from the plain message", async () => {
    await ntfy.send({ topic: "stars" }, message(bold));
    await webhook.send({ url: "https://hook.test" }, message(bold));
    expect(JSON.parse(requests[0]!.body).message).toBe("octocat starred me/project.");
    const json = JSON.parse(requests[1]!.body);
    expect(json.message).toBe("octocat starred me/project.");
    expect(json.message_markdown).toBe(bold);
  });

  test("webhook sends plain and markdown messages", async () => {
    await webhook.send({ url: "https://hook.test" }, message(linked));
    const json = sentJson();
    expect(json.message).toBe("octocat starred me/project.");
    expect(json.message_markdown).toBe(linked);
  });
});

describe("email", () => {
  const config = { from: "stars@example.com", to: "me@example.com" };
  const logo = "/web/icon-192.png";

  test("uses the sender name with the from address", () => {
    expect(buildMail({ ...config, fromName: "StarWatch" }, message("plain"), logo).from).toEqual({
      name: "StarWatch",
      address: "stars@example.com",
    });
    expect(buildMail({ ...config, fromName: " " }, message("plain"), logo).from).toBe("stars@example.com");
  });

  test("embeds the logo by default", () => {
    const mail = buildMail(config, message("plain"), logo);
    expect(mail.html).toContain('src="cid:starwatch-logo"');
    expect(mail.attachments).toEqual([{ filename: "starwatch.png", path: logo, cid: "starwatch-logo" }]);
  });

  test("puts the avatar beside the message", () => {
    const withAvatar = { ...message("plain"), vars: { ...vars, avatar: "https://avatars.test/octocat" } };
    const html = String(buildMail(config, withAvatar, logo).html);
    expect(html).toMatch(/<tr><td[^>]*><img src="https:\/\/avatars\.test\/octocat"[^>]*><\/td><td[^>]*><h2/);
  });

  test("lists urls after the plain text so the preview stays clean", () => {
    const text = buildMail(config, message(linked), logo).text;
    expect(text).toBe(
      "octocat starred me/project.\n\noctocat: https://github.com/octocat\nme/project: https://github.com/me/project",
    );
    expect(buildMail(config, message("plain"), logo).text).toBe("plain\n\nme/project: https://github.com/me/project");
    expect(buildMail({ ...config, mainLink: "none" }, message("plain"), logo).text).toBe("plain");
  });

  test("renders bold in the HTML part only", () => {
    const mail = buildMail(config, message(bold), logo);
    expect(mail.html).toContain('<b><a href="https://github.com/octocat">octocat</a></b> starred <b>me/project</b>.');
    expect(String(mail.text).split("\n")[0]).toBe("octocat starred me/project.");
  });

  test("leaves the logo out when turned off or missing", () => {
    const off = buildMail({ ...config, showLogo: false }, message("plain"), logo);
    const missing = buildMail(config, message("plain"), null);
    for (const mail of [off, missing]) {
      expect(mail.html).not.toContain("cid:");
      expect(mail.attachments).toBeUndefined();
    }
  });

  test("adds a unique thread header only when separate threads is on", () => {
    expect(buildMail(config, message("plain"), logo).headers).toBeUndefined();
    const first = buildMail({ ...config, separateThreads: true }, message("plain"), logo).headers;
    const second = buildMail({ ...config, separateThreads: "true" }, message("plain"), logo).headers;
    expect(first).toEqual({ "X-Entity-Ref-ID": expect.any(String) });
    expect(second).not.toEqual(first);
  });
});
