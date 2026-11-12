import type { TemplateVars } from "../../shared/templates";

export type ChannelConfig = Record<string, string | number | boolean | undefined>;

interface BaseMessage {
  title: string;
  body: string;
  vars: TemplateVars;
  occurredAt: Date;
  isTest: boolean;
}

export interface StarMessage extends BaseMessage {
  kind: "star";
  action: "created" | "deleted";
}

export interface LoginDetails {
  name: string;
  email: string;
  /** How the user signed in, for example "Password and authenticator app". */
  method: string;
  ip: string | null;
  device: string;
  userAgent: string | null;
}

/** Sent to the channels a user picked for login alerts. */
export interface LoginMessage extends BaseMessage {
  kind: "login";
  login: LoginDetails;
  /** Where the main link points: the account's security settings. */
  link: { url: string; label: string };
}

/** Someone followed or unfollowed the GitHub account the token belongs to. */
export interface FollowMessage extends BaseMessage {
  kind: "follow";
  action: "followed" | "unfollowed";
  /** Follower count right after the event. */
  followers: number;
  /** The tracked GitHub account and its followers page. */
  account: { login: string; url: string };
}

export type NotificationMessage = StarMessage | LoginMessage | FollowMessage;

export interface NotificationProvider {
  type: string;
  send(config: ChannelConfig, message: NotificationMessage): Promise<void>;
}

export class DeliveryError extends Error {
  constructor(
    message: string,
    public status?: number,
  ) {
    super(message);
  }
}
