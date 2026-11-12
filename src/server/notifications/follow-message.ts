import { renderTemplate, stripMarkup } from "../../shared/templates";
import type { TimeFormat } from "../../shared/time";
import type { FollowerEvent } from "../db/schema";
import { formatEventTime } from "../lib/template";
import type { FollowMessage } from "./types";

export type FollowEventFields = Pick<
  FollowerEvent,
  "action" | "actorLogin" | "actorUrl" | "actorAvatarUrl" | "followerCount" | "occurredAt"
>;

const FOLLOW_TEXT = {
  followed: {
    title: "New follower: {user}",
    body: "[{user}]({user_url}) followed you on GitHub. You now have {followers}.",
  },
  unfollowed: {
    title: "{user} unfollowed you",
    body: "[{user}]({user_url}) unfollowed you on GitHub. You now have {followers}.",
  },
} as const;

const plural = (n: number) => `${n} ${n === 1 ? "follower" : "followers"}`;

/** Message for a follow or unfollow of `account`, the GitHub login the token belongs to. */
export function buildFollowMessage(
  event: FollowEventFields,
  account: string,
  format: { timeZone: string; timeFormat?: TimeFormat },
  isTest = false,
): FollowMessage {
  const vars = {
    user: event.actorLogin,
    user_url: event.actorUrl ?? `https://github.com/${event.actorLogin}`,
    avatar: event.actorAvatarUrl ?? "",
    repo: "",
    repo_url: "",
    stars: "",
    action: event.action,
    time: formatEventTime(event.occurredAt, format.timeZone, format.timeFormat),
  };
  const text = FOLLOW_TEXT[event.action];
  const values = { ...vars, followers: plural(event.followerCount) };
  return {
    kind: "follow",
    action: event.action,
    title: `${isTest ? "[Test] " : ""}${stripMarkup(renderTemplate(text.title, values))}`,
    body: renderTemplate(text.body, values),
    vars,
    followers: event.followerCount,
    account: { login: account, url: `https://github.com/${account}?tab=followers` },
    occurredAt: event.occurredAt,
    isTest,
  };
}
