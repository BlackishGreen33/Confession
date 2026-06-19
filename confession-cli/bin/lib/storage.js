const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');

const {
  CONFESSION_DIR_NAME,
  DEFAULT_CONFIG,
  FILE_LIMIT,
  SCHEMA_VERSION,
  STORAGE_FILES,
  SUPPORTED_EXTS,
  VALID_DEPTHS,
  VALID_LLM_PROVIDERS,
  normalizeSlash,
} = require('./common');

function resolveProjectRoot(runtime) {
  const fromEnv = runtime.env.CONFESSION_PROJECT_ROOT;
  return fromEnv && fromEnv.trim().length > 0
    ? path.resolve(fromEnv.trim())
    : path.resolve(runtime.cwd());
}

function getConfessionDir(projectRoot) {
  return path.join(projectRoot, CONFESSION_DIR_NAME);
}

function getStoragePath(projectRoot, key) {
  return path.join(getConfessionDir(projectRoot), STORAGE_FILES[key]);
}

function normalizeIgnorePaths(paths) {
  if (!Array.isArray(paths)) return [];
  const seen = new Set();
  const output = [];

  for (const raw of paths) {
    const normalized = normalizeSlash(String(raw).trim());
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    output.push(normalized);
  }

  return output;
}

function normalizeConfig(raw) {
  const input = raw && typeof raw === 'object' ? raw : {};
  const llm = input.llm && typeof input.llm === 'object' ? input.llm : {};
  const analysis =
    input.analysis && typeof input.analysis === 'object' ? input.analysis : {};
  const ignore =
    input.ignore && typeof input.ignore === 'object' ? input.ignore : {};
  const api = input.api && typeof input.api === 'object' ? input.api : {};

  const config = {
    llm: normalizeLlmConfig(llm),
    analysis: normalizeAnalysisConfig(analysis),
    ignore: normalizeIgnoreConfig(ignore),
    api: normalizeApiConfig(api),
  };

  if (typeof llm.endpoint === 'string' && llm.endpoint.trim().length > 0) {
    config.llm.endpoint = llm.endpoint.trim();
  }
  if (typeof llm.model === 'string' && llm.model.trim().length > 0) {
    config.llm.model = llm.model.trim();
  }

  return config;
}

function normalizeLlmConfig(llm) {
  return {
    provider: VALID_LLM_PROVIDERS.has(llm.provider) ? llm.provider : 'nvidia',
    apiKey: typeof llm.apiKey === 'string' ? llm.apiKey : '',
  };
}

function normalizeAnalysisConfig(analysis) {
  return {
    triggerMode: analysis.triggerMode === 'manual' ? 'manual' : 'onSave',
    depth: VALID_DEPTHS.has(analysis.depth) ? analysis.depth : 'standard',
    debounceMs:
      typeof analysis.debounceMs === 'number'
        ? Math.max(0, Math.floor(analysis.debounceMs))
        : 500,
  };
}

function normalizeIgnoreConfig(ignore) {
  return {
    paths: normalizeIgnorePaths(ignore.paths),
    types: Array.isArray(ignore.types)
      ? Array.from(
          new Set(
            ignore.types
              .map((item) => String(item).trim())
              .filter((item) => item.length > 0)
          )
        )
      : [],
  };
}

function normalizeApiConfig(api) {
  return {
    baseUrl:
      typeof api.baseUrl === 'string' && api.baseUrl.trim().length > 0
        ? api.baseUrl.trim()
        : 'http://localhost:3000',
    mode: api.mode === 'remote' ? 'remote' : 'local',
  };
}

async function readJson(filePath, fallback) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

async function writeJson(filePath, payload) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

async function initProject(projectRoot) {
  const confessionDir = getConfessionDir(projectRoot);
  await fs.mkdir(confessionDir, { recursive: true });

  const now = new Date().toISOString();
  const targets = [
    { key: 'config', defaultValue: DEFAULT_CONFIG },
    { key: 'vulnerabilities', defaultValue: [] },
    { key: 'vulnerabilityEvents', defaultValue: [] },
    { key: 'scanTasks', defaultValue: [] },
    { key: 'adviceSnapshots', defaultValue: [] },
    { key: 'adviceDecisions', defaultValue: [] },
    {
      key: 'analysisCache',
      defaultValue: {
        schemaVersion: 'analysis-cache-v1',
        analyzerVersion: 'ast-jsts-go-keywords-v1',
        promptVersion: 'llm-prompt-v2',
        updatedAt: now,
        entries: {},
      },
    },
    {
      key: 'meta',
      defaultValue: {
        schemaVersion: SCHEMA_VERSION,
        createdAt: now,
        lastMigrationAt: null,
      },
    },
  ];

  for (const target of targets) {
    const filePath = getStoragePath(projectRoot, target.key);
    if (fsSync.existsSync(filePath)) continue;
    await writeJson(filePath, target.defaultValue);
  }
}

async function loadProjectConfig(projectRoot) {
  const configPath = getStoragePath(projectRoot, 'config');
  const raw = await readJson(configPath, DEFAULT_CONFIG);
  return normalizeConfig(raw);
}

function isIgnored(filePath, ignorePaths) {
  const normalized = normalizeSlash(filePath);
  return ignorePaths.some((pattern) =>
    normalized.includes(normalizeSlash(pattern))
  );
}

function inferLanguage(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.go') return 'go';
  if (ext === '.js' || ext === '.jsx') return 'javascript';
  if (ext === '.ts' || ext === '.tsx') return 'typescript';
  return null;
}

async function collectWorkspaceFiles(projectRoot, ignorePaths) {
  const results = [];
  let snapshotComplete = true;

  async function walk(dirPath) {
    if (results.length >= FILE_LIMIT) {
      snapshotComplete = false;
      return;
    }

    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (results.length >= FILE_LIMIT) {
        snapshotComplete = false;
        break;
      }

      await collectEntry(entry, dirPath, walk);
    }
  }

  await walk(projectRoot);
  return { files: results, workspaceSnapshotComplete: snapshotComplete };

  async function collectEntry(entry, dirPath, walkDir) {
    const absolutePath = path.join(dirPath, entry.name);
    const relativePath = path.relative(projectRoot, absolutePath);

    if (entry.isDirectory()) {
      if (shouldSkipDirectory(entry.name)) return;
      await walkDir(absolutePath);
      return;
    }

    if (!shouldCollectFile(entry, absolutePath, relativePath, ignorePaths)) return;
    const language = inferLanguage(absolutePath);
    if (!language) return;

    const content = await fs.readFile(absolutePath, 'utf8');
    results.push({ path: absolutePath, content, language });
  }
}

function shouldSkipDirectory(name) {
  return (
    name === 'node_modules' ||
    name === '.git' ||
    name === CONFESSION_DIR_NAME
  );
}

function shouldCollectFile(entry, absolutePath, relativePath, ignorePaths) {
  return (
    entry.isFile() &&
    SUPPORTED_EXTS.has(path.extname(entry.name).toLowerCase()) &&
    !isIgnored(absolutePath, ignorePaths) &&
    !isIgnored(relativePath, ignorePaths)
  );
}

module.exports = {
  collectWorkspaceFiles,
  getConfessionDir,
  getStoragePath,
  initProject,
  loadProjectConfig,
  readJson,
  resolveProjectRoot,
  writeJson,
};
