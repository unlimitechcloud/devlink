/**
 * Utils Helper v1.0.0
 */

export function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

export function slugify(str) {
  return str.toLowerCase().replace(/\s+/g, '-');
}

export const VERSION = "1.0.0";
