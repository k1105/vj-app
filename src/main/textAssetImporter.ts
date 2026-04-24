import { promises as fs } from "fs";
import { join } from "path";
import { appRoot, broadcastPluginsNow } from "./pluginLoader";

const TEMPLATE_ENTRY = "../../templates/text-asset/index.js";

function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

async function loadTemplateParamSchema(): Promise<Array<Record<string, unknown>>> {
  const schemaPath = join(appRoot(), "templates", "text-asset", "params.json");
  const raw = await fs.readFile(schemaPath, "utf-8");
  return JSON.parse(raw);
}

/**
 * Fold the asset's texts into the template param schema: overrides the
 * `texts.default` and tightens `idx.max` to texts.length - 1 so the slider
 * represents exactly the available indices.
 */
function applyUserValues(
  schema: Array<Record<string, unknown>>,
  texts: string[],
): Array<Record<string, unknown>> {
  return schema.map((def) => {
    if (def.key === "texts") return { ...def, default: texts };
    if (def.key === "idx")
      return { ...def, max: Math.max(0, texts.length - 1) };
    return def;
  });
}

/**
 * Create a new text asset at plugins/text-<slug>/. The manifest references
 * the shared template source via a relative `entry`, so bug fixes in the
 * template apply to every asset without copying code. texts may contain any
 * number of entries; the asset picks one via its `idx` param at draw time.
 */
export async function createTextAsset(
  name: string,
  texts: string[],
): Promise<string> {
  const cleanTexts = (texts ?? [])
    .map((t) => String(t ?? ""))
    .filter((t) => t.length > 0);
  if (cleanTexts.length === 0) {
    throw new Error("text asset requires at least one non-empty text");
  }

  const baseSlug = slugify(name) || "text";
  const pluginsDir = join(appRoot(), "plugins");
  let id = `text-${baseSlug}`;
  let suffix = 1;
  while (true) {
    try {
      await fs.access(join(pluginsDir, id));
      suffix++;
      id = `text-${baseSlug}-${suffix}`;
    } catch {
      break;
    }
  }

  const pluginDir = join(pluginsDir, id);
  await fs.mkdir(pluginDir, { recursive: true });

  const schema = await loadTemplateParamSchema();
  const params = applyUserValues(schema, cleanTexts);

  const manifest = {
    name: name.trim() || "Untitled Text",
    author: "user",
    version: "0.1.0",
    outputType: "canvas" as const,
    entry: TEMPLATE_ENTRY,
    params,
  };

  await fs.writeFile(
    join(pluginDir, "manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
    "utf-8",
  );

  await broadcastPluginsNow();
  return id;
}

/**
 * Rewrite every text-asset manifest so its params match the current template
 * schema while preserving the user-set `texts` array. Run this when the
 * template's params.json changes (e.g. a new option is added).
 * Returns the count of migrated assets.
 */
export async function migrateAllTextAssets(): Promise<number> {
  const pluginsDir = join(appRoot(), "plugins");
  let entries: string[];
  try {
    entries = await fs.readdir(pluginsDir);
  } catch {
    return 0;
  }
  let migrated = 0;
  const schema = await loadTemplateParamSchema();
  for (const entry of entries) {
    const manifestPath = join(pluginsDir, entry, "manifest.json");
    try {
      const raw = await fs.readFile(manifestPath, "utf-8");
      const manifest = JSON.parse(raw);
      if (typeof manifest.entry !== "string") continue;
      if (!manifest.entry.includes("templates/text-asset")) continue;

      const existing = Array.isArray(manifest.params) ? manifest.params : [];
      const textsDef = existing.find(
        (p: Record<string, unknown>) => p.key === "texts",
      );
      const existingTexts = Array.isArray(textsDef?.default)
        ? (textsDef!.default as unknown[]).map((t) => String(t))
        : [];
      manifest.params = applyUserValues(schema, existingTexts);
      await fs.writeFile(
        manifestPath,
        JSON.stringify(manifest, null, 2) + "\n",
        "utf-8",
      );
      migrated++;
    } catch {
      /* skip non-text plugins or unreadable manifests */
    }
  }
  if (migrated > 0) await broadcastPluginsNow();
  return migrated;
}
