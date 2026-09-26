import yaml from 'js-yaml';

export interface SentinelConfig {
  schemaPath: string;
  consumers: string[];
  ignorePaths: string[];
  severityThreshold?: 'breaking' | 'warning';
}

export const DEFAULT_CONFIG: SentinelConfig = {
  schemaPath: 'openapi.yaml',
  consumers: ['src/**/*.ts', 'src/**/*.tsx'],
  ignorePaths: [
    '**/node_modules/**',
    '**/dist/**',
    '**/__tests__/**',
    '**/*.test.ts',
    '**/*.test.tsx',
    '**/*.spec.ts',
    '**/*.spec.tsx',
    '**/mockData.ts',
  ],
  severityThreshold: 'warning',
};

export function parseConfig(yamlContent?: string): SentinelConfig {
  if (!yamlContent || !yamlContent.trim()) {
    return { ...DEFAULT_CONFIG };
  }

  try {
    const parsed = yaml.load(yamlContent) as Partial<SentinelConfig>;
    if (!parsed || typeof parsed !== 'object') {
      return { ...DEFAULT_CONFIG };
    }

    const schemaPath = typeof parsed.schemaPath === 'string' && parsed.schemaPath.trim()
      ? parsed.schemaPath.trim()
      : DEFAULT_CONFIG.schemaPath;

    const consumers = Array.isArray(parsed.consumers) && parsed.consumers.length > 0
      ? parsed.consumers.filter(c => typeof c === 'string')
      : [...DEFAULT_CONFIG.consumers];

    const userIgnorePaths = Array.isArray(parsed.ignorePaths)
      ? parsed.ignorePaths.filter(p => typeof p === 'string')
      : [];

    // Merge default ignorePaths with user ignorePaths, removing duplicates
    const ignorePaths = Array.from(new Set([...DEFAULT_CONFIG.ignorePaths, ...userIgnorePaths]));

    const severityThreshold = parsed.severityThreshold === 'breaking' || parsed.severityThreshold === 'warning'
      ? parsed.severityThreshold
      : DEFAULT_CONFIG.severityThreshold;

    return {
      schemaPath,
      consumers,
      ignorePaths,
      severityThreshold,
    };
  } catch (err) {
    return { ...DEFAULT_CONFIG };
  }
}

export function shouldIgnoreFile(filePath: string, ignorePaths: string[]): boolean {
  if (!filePath) return false;
  const normalizedPath = filePath.replace(/\\/g, '/');

  for (const pattern of ignorePaths) {
    const cleanPattern = pattern.replace(/\\/g, '/');

    // Simple glob matching support for common ignore patterns
    if (cleanPattern.includes('*')) {
      // Convert glob pattern to regular expression
      const regexString = cleanPattern
        .replace(/\./g, '\\.')
        .replace(/\*\*/g, '.*')
        .replace(/(?<!\.)\*/g, '[^/]*');
      const regex = new RegExp(`^${regexString}$`, 'i');

      if (regex.test(normalizedPath) || regex.test(`/${normalizedPath}`)) {
        return true;
      }
    } else {
      if (normalizedPath.includes(cleanPattern)) {
        return true;
      }
    }
  }

  return false;
}
