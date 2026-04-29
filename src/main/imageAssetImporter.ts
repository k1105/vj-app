import { promises as fs } from "fs";
import { basename, extname, join, relative, resolve } from "path";
import { appRoot, broadcastPluginsNow } from "./pluginLoader";

const TEMPLATE_ENTRY = "../../templates/image-asset/index.js";

function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

async function loadTemplateParamSchema(): Promise<Array<Record<string, unknown>>> {
  const schemaPath = join(appRoot(), "templates", "image-asset", "params.json");
  const raw = await fs.readFile(schemaPath, "utf-8");
  return JSON.parse(raw);
}

/**
 * Fold the imported image URLs into the template param schema: overrides
 * `images.default` and tightens `idx.max` to images.length - 1.
 */
function applyUserValues(
  schema: Array<Record<string, unknown>>,
  imageUrls: string[],
): Array<Record<string, unknown>> {
  return schema.map((def) => {
    if (def.key === "images") return { ...def, default: imageUrls };
    if (def.key === "idx") return { ...def, max: Math.max(0, imageUrls.length - 1) };
    return def;
  });
}

/**
 * Create a new image asset at plugins/image-<slug>/.
 * `srcPaths` are absolute filesystem paths to the source images.
 * Each file is copied into the plugin directory and referenced via
 * a vj-asset:// URL stored in the manifest params.
 * Returns the new plugin id.
 */
export async function createImageAsset(
  name: string,
  srcPaths: string[],
): Promise<string> {
  const cleanPaths = (srcPaths ?? []).filter((p) => typeof p === "string" && p.length > 0);
  if (cleanPaths.length === 0) {
    throw new Error("image asset requires at least one image file");
  }

  const baseSlug = slugify(name) || "image";
  const pluginsDir = join(appRoot(), "plugins");
  let id = `image-${baseSlug}`;
  let suffix = 1;
  while (true) {
    try {
      await fs.access(join(pluginsDir, id));
      suffix++;
      id = `image-${baseSlug}-${suffix}`;
    } catch {
      break;
    }
  }

  const pluginDir = join(pluginsDir, id);
  await fs.mkdir(pluginDir, { recursive: true });

  // Copy each source image into the plugin directory and build vj-asset:// URLs.
  const root = resolve(appRoot());
  const imageUrls: string[] = [];
  for (let i = 0; i < cleanPaths.length; i++) {
    const src = cleanPaths[i];
    const ext = extname(basename(src)).toLowerCase() || ".jpg";
    const destName = `img${i}${ext}`;
    const destAbs = join(pluginDir, destName);
    await fs.copyFile(src, destAbs);
    const rel = relative(root, destAbs).split(/[\\/]/).map(encodeURIComponent).join("/");
    imageUrls.push(`vj-asset://local/${rel}`);
  }

  const schema = await loadTemplateParamSchema();
  const params = applyUserValues(schema, imageUrls);

  const manifest = {
    name: name.trim() || "Untitled Image",
    author: "user",
    version: "0.1.0",
    outputType: "canvas" as const,
    category: "image",
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
