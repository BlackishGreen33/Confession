#!/usr/bin/env node

const {
  CliError,
  COMMAND_FLAG_SPEC,
  parseFlags,
} = require('./lib/common');
const {
  commandInit,
  commandList,
  commandScan,
  commandStatus,
  commandVerify,
  printHelp,
} = require('./lib/commands');
const { createRuntime } = require('./lib/runtime');
const { resolveProjectRoot } = require('./lib/storage');

function toCliFailure(error) {
  if (error instanceof CliError) {
    return {
      message: error.message,
      exitCode: error.exitCode,
      showHelp: error.showHelp,
    };
  }

  return {
    message: error instanceof Error ? error.message : String(error),
    exitCode: 1,
    showHelp: false,
  };
}

async function dispatchCommand(command, args, projectRoot, runtime) {
  switch (command) {
    case 'init':
      parseFlags(args.slice(1), COMMAND_FLAG_SPEC.init);
      await commandInit(projectRoot, runtime);
      return;

    case 'scan':
      await commandScan(
        projectRoot,
        parseFlags(args.slice(1), COMMAND_FLAG_SPEC.scan),
        runtime
      );
      return;

    case 'list':
      await commandList(
        projectRoot,
        parseFlags(args.slice(1), COMMAND_FLAG_SPEC.list),
        runtime
      );
      return;

    case 'status':
      parseFlags(args.slice(1), COMMAND_FLAG_SPEC.status);
      await commandStatus(projectRoot, runtime);
      return;

    case 'verify': {
      const target = args[1];
      if (!target || target.startsWith('--')) {
        throw new CliError('verify 命令需要 target（目前支援：web）', {
          showHelp: true,
        });
      }
      await commandVerify(
        projectRoot,
        target,
        parseFlags(args.slice(2), COMMAND_FLAG_SPEC.verify),
        runtime
      );
      return;
    }

    default:
      throw new CliError(`未知命令：${command}`, { showHelp: true });
  }
}

async function runCli(argv, runtimeOverrides = {}) {
  const runtime = createRuntime(runtimeOverrides);

  try {
    const args = Array.isArray(argv) ? argv : [];
    const command = args[0];

    if (
      !command ||
      command === '--help' ||
      command === '-h' ||
      command === 'help'
    ) {
      printHelp(runtime.stdout);
      return 0;
    }

    if (!Object.prototype.hasOwnProperty.call(COMMAND_FLAG_SPEC, command)) {
      throw new CliError(`未知命令：${command}`, { showHelp: true });
    }

    if (args[1] === '--help' || args[1] === '-h') {
      printHelp(runtime.stdout);
      return 0;
    }

    await dispatchCommand(command, args, resolveProjectRoot(runtime), runtime);
    return 0;
  } catch (error) {
    const failure = toCliFailure(error);
    runtime.stderr.write(`[confession] ${failure.message}\n`);

    if (failure.showHelp) {
      printHelp(runtime.stdout);
    }

    return failure.exitCode;
  }
}

module.exports = {
  runCli,
  createRuntime,
  parseFlags,
  commandInit,
  commandScan,
  commandList,
  commandStatus,
  commandVerify,
};

if (require.main === module) {
  void runCli(process.argv.slice(2)).then((exitCode) => {
    process.exitCode = exitCode;
  });
}
