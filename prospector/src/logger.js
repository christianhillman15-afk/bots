/* Tiny dependency-free logger with light ANSI color. */
const c = {
  gray: (s) => `\x1b[90m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
};

const ts = () => new Date().toISOString().slice(11, 19);

export const log = {
  info: (...a) => console.log(c.gray(ts()), ...a),
  step: (...a) => console.log(c.cyan('▸'), ...a),
  ok: (...a) => console.log(c.green('✓'), ...a),
  warn: (...a) => console.warn(c.yellow('!'), ...a),
  err: (...a) => console.error(c.red('✗'), ...a),
  title: (s) => console.log('\n' + c.bold(c.cyan(s))),
};

export { c as color };
