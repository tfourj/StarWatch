import type { TemplateVars } from "../../shared/templates";

export type ChannelConfig = Record<string, string | number | boolean | undefined>;

export interface NotificationMessage {
  title: string;
  body: string;
  action: "created" | "deleted";
  vars: TemplateVars;
  occurredAt: Date;
  isTest: boolean;
}

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
