import pino from 'pino';

const isDev = process.env.NODE_ENV !== 'production';

const pinoLogger = pino({
  level: isDev ? 'debug' : 'info',
  transport: isDev
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname',
        },
      }
    : undefined,
});

function createLogMethod(level: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal') {
  return (...args: any[]) => {
    if (args.length === 0) return;

    if (args.length === 1) {
      if (typeof args[0] === 'string') {
        pinoLogger[level](args[0]);
      } else {
        pinoLogger[level](args[0]);
      }
      return;
    }

    if (typeof args[0] === 'string') {
      const msg = args[0];
      const rest = args.slice(1);
      if (rest.length === 1 && rest[0] instanceof Error) {
        pinoLogger[level]({ err: rest[0] }, msg);
      } else if (rest.length === 1 && typeof rest[0] === 'object') {
        pinoLogger[level](rest[0], msg);
      } else {
        pinoLogger[level]({ data: rest }, msg);
      }
    } else if (typeof args[0] === 'object') {
      const obj = args[0];
      const msg = typeof args[1] === 'string' ? args[1] : '';
      pinoLogger[level](obj, msg);
    } else {
      pinoLogger[level]({ data: args }, 'log');
    }
  };
}

export const logger = {
  trace: createLogMethod('trace'),
  debug: createLogMethod('debug'),
  info: createLogMethod('info'),
  warn: createLogMethod('warn'),
  error: createLogMethod('error'),
  fatal: createLogMethod('fatal'),
  child: (bindings: pino.Bindings) => pinoLogger.child(bindings),
};

export type Logger = typeof logger;
