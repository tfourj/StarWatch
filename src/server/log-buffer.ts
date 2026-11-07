import { LogBuffer } from "../shared/log-buffer";

export { LOG_LEVELS, LogBuffer, type LogEntry, type LogLevel, type LogQuery } from "../shared/log-buffer";

const capacity = Math.max(100, Number(process.env.LOG_BUFFER_SIZE ?? 1000) || 1000);

export const logBuffer = new LogBuffer(capacity);
