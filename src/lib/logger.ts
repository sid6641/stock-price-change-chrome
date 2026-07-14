const TAG = '[TT]';

type Level = 'log' | 'warn' | 'error' | 'info';

function fmt(module: string, msg: string, data?: unknown): string[] {
  const parts = [`${TAG} ${module} ${msg}`];
  if (data !== undefined) parts.push(data as string);
  return parts;
}

export const logger = {
  log(module: string, msg: string, data?: unknown) {
    console.log(...fmt(module, msg, data));
  },
  info(module: string, msg: string, data?: unknown) {
    console.info(...fmt(module, msg, data));
  },
  warn(module: string, msg: string, data?: unknown) {
    console.warn(...fmt(module, msg, data));
  },
  error(module: string, msg: string, data?: unknown) {
    console.error(...fmt(module, msg, data));
  },
};
