export function createLogger(scope: string) {
  return {
    info(msg: string, extra?: Record<string, unknown>) {
      console.log(JSON.stringify({ level: "info", scope, msg, ...extra }));
    },
    warn(msg: string, extra?: Record<string, unknown>) {
      console.warn(JSON.stringify({ level: "warn", scope, msg, ...extra }));
    },
    debug(msg: string, extra?: Record<string, unknown>) {
      if (process.env.LOG_LEVEL === "debug") {
        console.log(JSON.stringify({ level: "debug", scope, msg, ...extra }));
      }
    },
  };
}
