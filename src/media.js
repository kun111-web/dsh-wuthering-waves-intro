import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import groups from './media-packages.json' with { type: 'json' };

const require = createRequire(import.meta.url);
const packages = new Map(groups.flatMap(group => group.characters.map(id => [`${id}.mp4`, group.package])));

export function resolveMediaFile(filename) {
  const packageName = packages.get(filename);
  if (packageName) {
    try {
      return require.resolve(`${packageName}/characters/${filename}`);
    } catch (error) {
      if (error.code !== 'MODULE_NOT_FOUND') throw error;
      // Source checkouts retain the original files for authoring and local validation.
    }
  }
  return fileURLToPath(new URL(`../assets/characters/${filename}`, import.meta.url));
}
