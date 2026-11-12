#!/usr/bin/env bun
/** Fail closed over concrete runners. This is a routing check, not proof that an EC2 instance is Spot. */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";

export type Plans = Record<string, unknown>;
export const ownRunner = (value: unknown): boolean => {
  if (typeof value !== "string") return false;
  const label = value.match(/^l3-ubuntu-26\.04(?:-arm)?(?:-([1-9][0-9]*)core)?$/);
  return !!label && (label[1] === undefined || Number(label[1]) <= 64);
};
const object = (v: unknown): v is Record<string, any> => !!v && typeof v === "object" && !Array.isArray(v);

/** Only the generator's direct selector output, with an optional literal fallback, is supported. */
export function selectionMatrix(expression: string): { output: string; fallback?: unknown } {
  const match = expression.match(
    /^\$\{\{\s*fromJSON\(needs\.select\.outputs\.(run|archive|shards)(?:\s*\|\|\s*'((?:[^']|'')*)')?\)\s*\}\}$/,
  );
  if (!match) throw new Error("unsupported dynamic matrix expression");
  return {
    output: match[1]!,
    ...(match[2] === undefined ? {} : { fallback: JSON.parse(match[2].replaceAll("''", "'")) }),
  };
}

function entries(matrix: unknown): Record<string, unknown>[] {
  if (!object(matrix)) throw new Error("matrix must be an object");
  const { include = [], exclude = [], ...axes } = matrix;
  if (!Array.isArray(include) || !include.every(object) || !Array.isArray(exclude))
    throw new Error("invalid matrix include/exclude");
  let rows: Record<string, unknown>[] = [{}];
  for (const [key, values] of Object.entries(axes)) {
    if (!Array.isArray(values) || values.length === 0) throw new Error(`unresolved matrix axis ${key}`);
    if (rows.length * values.length > 256) throw new Error("matrix exceeds 256 jobs");
    rows = rows.flatMap((row) => values.map((value) => ({ ...row, [key]: value })));
  }
  // Check every declared include and axis combination, even exclusions: later edits cannot reveal hidden external runners.
  return [...(Object.keys(axes).length ? rows : []), ...include];
}

export function auditWorkflow(
  text: string,
  key: string,
  plans: Plans = {},
  resolveReusable?: (use: string) => string,
  seen = new Set<string>(),
): string[] {
  if (seen.size > 16 || seen.has(text)) return [`${key}: recursive reusable workflow`];
  const branch = new Set(seen).add(text);
  const errors: string[] = [];
  let workflow: any;
  try {
    workflow = Bun.YAML.parse(text);
  } catch (error) {
    return [...errors, `${key}: invalid YAML: ${error}`];
  }
  // Inspect decoded scalar values: YAML quoting can double quotes in bracket access.
  const scalars = (value: unknown): string[] =>
    typeof value === "string"
      ? [value]
      : value && typeof value === "object"
        ? Object.values(value).flatMap(scalars)
        : [];
  if (
    /vars\s*(?:\.\s*CI_(?:PLAIN_|DYNAMIC_)?PROVIDER\b|\[\s*['"]CI_(?:PLAIN_|DYNAMIC_)?PROVIDER['"]\s*\])|\bci\s+fallback\b|\bproviders\b[^\n]*--apply|actions\/variables\/CI_(?:PLAIN_|DYNAMIC_)?PROVIDER/i.test(
      scalars(workflow).join("\n"),
    )
  )
    errors.push(`${key}: provider routing/fallback reference`);
  const checkEnv = (env: unknown, where: string) => {
    if (!object(env)) return;
    for (const [name, value] of Object.entries(env))
      if (/^(CI_(PLAIN_|DYNAMIC_)?PROVIDER|TOOLS_PLAN_PROVIDER)$/.test(name) && value !== "l3")
        errors.push(`${where}: ${name} must be literal l3`);
  };
  checkEnv(workflow?.env, key);
  if (!object(workflow?.jobs)) return [...errors, `${key}: missing jobs`];
  for (const [id, job] of Object.entries(workflow.jobs) as [string, any][]) {
    const where = `${key}#${id}`;
    if (!object(job)) {
      errors.push(`${where}: invalid job`);
      continue;
    }
    checkEnv(job.env, where);
    for (const step of job.steps ?? []) checkEnv(step.env, where);
    if (job.uses) {
      try {
        if (
          typeof job.uses !== "string" ||
          (!/^[$.]\/\.github\/workflows\/[\w.-]+\.ya?ml$/.test(job.uses) &&
            !/^[\w.-]+\/[\w.-]+\/\.github\/workflows\/[\w.-]+\.ya?ml@[a-f0-9]{40}$/.test(job.uses))
        )
          throw new Error("reusable workflow must be local or pinned to a full commit");
        if (!resolveReusable) throw new Error("reusable workflow has not been resolved");
        errors.push(
          ...auditWorkflow(resolveReusable(job.uses), `${where}->${job.uses}`, plans, resolveReusable, branch),
        );
      } catch (error) {
        errors.push(`${where}: ${error}`);
      }
      continue;
    }
    const runner = job["runs-on"];
    if (ownRunner(runner)) continue;
    // Reusable arch jobs can choose between exactly two own labels from a finite input enum.
    if (
      typeof runner === "string" &&
      /^\$\{\{\s*inputs\.arch == 'arm64' && 'l3-ubuntu-26\.04-arm' \|\| 'l3-ubuntu-26\.04'\s*\}\}$/.test(runner)
    )
      continue;
    const archChoice =
      typeof runner === "string" &&
      runner.match(/^\$\{\{\s*contains\(matrix\.runner, '-arm'\) && '([^']+)' \|\| '([^']+)'\s*\}\}$/);
    if (archChoice && ownRunner(archChoice[1]) && ownRunner(archChoice[2])) continue;
    if (
      typeof runner === "string" &&
      /^\$\{\{\s*matrix\.arch == 'arm64' && 'l3-ubuntu-26\.04-arm' \|\| 'l3-ubuntu-26\.04'\s*\}\}$/.test(runner)
    )
      continue;
    const field = typeof runner === "string" && runner.match(/^\$\{\{\s*matrix\.([A-Za-z_]\w*)\s*\}\}$/)?.[1];
    const mapped =
      typeof runner === "string" &&
      runner.match(/^\$\{\{\s*fromJSON\((?:needs\.[\w-]+\.outputs|inputs)\.[\w-]+\)\[matrix\.name\]\.runner\s*\}\}$/);
    if (mapped) {
      errors.push(`${where}: runtime runner map needs a literal runner or explicit job split`);
      continue;
    }
    if (!field) {
      errors.push(`${where}: non-L3 or unresolved runner ${JSON.stringify(runner)}`);
      continue;
    }
    try {
      let matrix = job.strategy?.matrix;
      if (typeof matrix === "string") {
        throw new Error(
          "runtime matrix runner needs a literal runner or explicit job split; external plans are not proof",
        );
      }
      const rows = entries(matrix);
      if (!rows.length || rows.some((row) => !ownRunner(row[field])))
        throw new Error("matrix includes a non-L3 or unresolved runner");
    } catch (error) {
      errors.push(`${where}: ${error}`);
    }
  }
  return errors;
}

export function auditTree(root: string, plans: Plans = {}): string[] {
  const folder = join(root, ".github/workflows");
  // A green GitHub workflow does not disable another provider's activation file.
  // Keep these checks independent of whether a GitHub workflow exists at all.
  const external = [
    ".circleci/config.yml", ".circleci/config.yaml", ".rwx/ci.yml", ".rwx/perf.yml",
    ".cirrus.yml", ".cirrus.yaml", ".travis.yml", ".gitlab-ci.yml",
    "azure-pipelines.yml", "azure-pipelines.yaml", ".buildkite/pipeline.yml", ".buildkite/pipeline.yaml",
    ".woodpecker.yml", ".woodpecker.yaml", ".drone.yml", ".drone.yaml",
    "Jenkinsfile", "appveyor.yml", ".appveyor.yml", "bitrise.yml",
  ].filter((path) => existsSync(join(root, path)))
    .map((path) => `${path}: external provider activation must be removed`);
  if (!existsSync(folder)) return [...external, `${root}: no workflows`];
  const load = (use: string): string => {
    if (!/^[$.]\/\.github\/workflows\/[\w.-]+\.ya?ml$/.test(use))
      throw new Error("external reusable requires explicit pinned workflow audit");
    const path = resolve(root, use.replace(/^\$\//, "./"));
    return readFileSync(path, "utf8");
  };
  return [
    ...external,
    ...readdirSync(folder)
      .filter((x) => /\.ya?ml$/.test(x))
      .sort()
      .flatMap((name) => {
        if (/provider-fallback/.test(name)) return [`${name}: provider fallback workflow must be removed`];
        return auditWorkflow(readFileSync(join(folder, name), "utf8"), `.github/workflows/${name}`, plans, load);
      }),
  ];
}

if (import.meta.main) {
  const [root = ".", planFile] = process.argv.slice(2);
  const errors = auditTree(resolve(root), planFile ? JSON.parse(readFileSync(planFile, "utf8")) : {});
  console.log(JSON.stringify({ status: errors.length ? "fail" : "pass", root: resolve(root), errors }, null, 2));
  process.exitCode = errors.length ? 1 : 0;
}
